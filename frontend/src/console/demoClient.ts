import { AuthError } from '../auth/types'
import { fromRecord, isOpen, needsCheck, nowKey, startsAt } from './appointmentRecords'
import type {
  AlertKey,
  AlertRule,
  AlertSettings,
  AppointmentChange,
  AgentDetail,
  AgentDraft,
  AgentSpec,
  AgentSummary,
  AgentTool,
  AgentVersion,
  ActivityEntry,
  AnswerFlag,
  Appointment,
  BookingSettings,
  Billing,
  Callback,
  CallSummary,
  CallNote,
  ChangeRequest,
  ConsoleClient,
  Credential,
  Desk,
  DoctorChange,
  Handoff,
  LiveCall,
  Member,
  Notice,
  OrgSettings,
  Scenario,
  Viewer,
  FlowNode,
  KnowledgeSource,
  PhoneNumber,
  SourceCall,
  SourceCallStatus,
} from './types'
import { seedAgents } from './demo/agents'
import { seedCalls, topicFor, transcriptFor } from './demo/calls'
import { defaultGlobalFlows, extractAttributes, extractFlowGroups } from './demo/extraction'
import { detectFlowPatterns } from './demo/flowPatterns'
import { seedKnowledge, seedNumbers, seedTools } from './demo/library'
import { copy, DAY, makeWait, newId } from './demo/runtime'
import { seedDetail, specFromDraft } from './demo/specs'
import { defaultAnalysisSettings, defaultGuardrails, defaultSpeech } from './specDefaults'
import { flowOutline } from './flowRequest'
import { countForks, countPaths } from './flowCounts'
import { passagesOf, search, seedCredentials } from './demo/passages'
import { advanceUpdates, queueUpdates, refreshRanks, runAuto, seedBookingSettings, seedRequests, withdrawQueued } from './demo/bookingRequests'
import { callLog, callRecord, DEPARTMENTS, handoffCalls, liveCalls, report, seedAppointments, seedCallbacks, seedHandoffs, seedMembers, type LiveExtras, type LogContext, type Pauses } from './demo/operations'
import { defaultPipeline } from './demo/agentConfig'
import { seedChangeRequests } from './demo/requests'
import { seedDoctorChanges, seedFlags, seedNotices, type LineMode } from './demo/desk'
import { runScenario, seedScenarios } from './demo/scenarios'
import { permissionsFor } from './access'
import type { Permission } from '../auth/types'
import { localDay } from '../lib/time'
import { billingPeriod, seedActivity, seedBilling, seedSettings } from './demo/manage'
import { checkTool } from './toolRules'
import { LANGUAGE_LABEL, ROLE_LABEL } from '../auth/roles'
import type { Role } from '../auth/types'
import { defaultBehaviour } from './demo/templates'
import { currentPlans, enabledVoices, findSubType, MODEL_OPTIONS, platform, publishedTypes } from './demo/platform'

/**
 * Sample data for the organisation console until the real API exists. No
 * request leaves the browser. Each organisation's data is seeded on first
 * use and kept in this browser tab (sessionStorage), so a reload keeps a
 * half-built agent; closing the tab or signing out starts afresh. The UI
 * labels all of it "Demo data".
 */

/** Bump when the stored shape changes, so old tabs start from fresh seeds. */
const STORE_KEY = 'aica.demo.console.v11'

/** Versions kept per agent in the demo. */
const KEEP_VERSIONS = 6

/** A published agent's setup: what callers get, plus saved edits. */
interface AgentRecord {
  working: AgentSpec
  versions: AgentVersion[]
  /** Saved edits not published yet. */
  changed: boolean
}

/** One organisation's sample data. */
interface OrgData {
  agents: AgentSummary[]
  /** Each published agent's setup and versions, seeded on first open. */
  details: Record<string, AgentRecord>
  calls: SourceCall[]
  /** Uploaded calls: when processing started (ms), to derive their status. */
  processing: Record<string, number>
  drafts: AgentDraft[]
  knowledge: KnowledgeSource[]
  tools: AgentTool[]
  numbers: PhoneNumber[]
  /** Published draft id → the agent it became, so a retried publish is safe. */
  published: Record<string, string>
  /** Knowledge being (re)indexed: when it started (ms). */
  indexing: Record<string, number>
  credentials: Credential[]
  members: Member[]
  handoffs: Handoff[]
  callbacks: Callback[]
  appointments: Appointment[]
  /** Absent in demo data saved before requests were ranked: seeded on first read. */
  booking?: BookingSettings
  /** When the agent last sent in a new request (the demo makes one every few minutes, a few at most). */
  incomingAt?: number
  incomingCount?: number
  /** Notes people added to past calls, by call id. */
  callNotes: Record<string, CallNote[]>
  /** Live calls someone took over: id → their name. */
  liveTaken: Record<string, string>
  /** When each agent was paused, so the call log has no calls then. */
  pauses: Pauses
  settings: OrgSettings
  /** Newest first. */
  activity: ActivityEntry[]
  billing: Omit<Billing, 'plans' | 'usage'>
  /** Absent in demo data saved before alerts existed: seeded on first read. */
  alerts?: AlertSettings
  /** Requests to bitNtech, newest first. */
  requests: ChangeRequest[]
  notices: Notice[]
  doctorChanges: DoctorChange[]
  flags: AnswerFlag[]
  /** Lines switched to staff, by number id. */
  lineModes: Record<string, LineMode>
  /** Test scenarios per agent, seeded on first use. */
  scenarios: Record<string, Scenario[]>
  /** Notes to the agent and transfers on live calls, by call id. */
  live: LiveExtras
}

export interface DemoConsoleOptions {
  /** Simulated round trip, in ms. Tests pass 0. */
  latency?: number
  /** How long an uploaded call takes to process, in ms. 0: instantly. */
  processingMs?: number
  /** Keep the data in sessionStorage across reloads. On by default. */
  persist?: boolean
}

function seedOrg(slug: string): OrgData {
  return {
    agents: seedAgents(slug),
    details: {},
    calls: seedCalls(slug),
    processing: {},
    drafts: seedDrafts(slug),
    knowledge: seedKnowledge(),
    tools: seedTools(),
    numbers: seedNumbers(),
    published: {},
    indexing: {},
    credentials: seedCredentials(),
    members: seedMembers(slug),
    handoffs: seedHandoffs(slug),
    callbacks: seedCallbacks(slug),
    appointments: seedRequests(slug, seedAppointments(slug)),
    callNotes: {},
    liveTaken: {},
    // The sample lab agent was paused 9 days ago.
    pauses: Object.fromEntries(seedAgents(slug).filter((a) => a.status === 'paused').map((a) => [a.id, [{ from: Date.now() - 9 * DAY, to: null }]])),
    settings: seedSettings(slug),
    activity: seedActivity(slug),
    billing: seedBilling(slug),
    requests: seedChangeRequests(slug),
    notices: seedNotices(slug),
    doctorChanges: seedDoctorChanges(slug),
    flags: seedFlags(slug),
    lineModes: {},
    scenarios: {},
    live: { whispers: {}, transfers: {} },
  }
}

/** A half-built sample agent, so the list shows "Continue setup". */
function seedDrafts(slug: string): AgentDraft[] {
  if (seedAgents(slug).length === 0) return []
  const calls = seedCalls(slug).filter((c) => c.topic === 'Bill and insurance')
  return [
    {
      id: 'draft_billing',
      reached: 'behaviour',
      sourceCallIds: calls.map((c) => c.id),
      consent: true,
      redact: true,
      typeId: 'hospital',
      subTypeId: 'billing',
      name: 'Billing and insurance',
      behaviour: { ...defaultBehaviour('Arogya Demo Hospital'), languages: ['english', 'tanglish'], startLanguage: 'english' },
      flow: [],
      attributes: [],
      globalFlows: [],
      context: { knowledgeSourceIds: [], answerOnlyFromKnowledge: true, topK: 4, minScore: 0.6, toolIds: [], confirmBeforeActions: true },
      pipeline: defaultPipeline(),
      updatedAt: new Date(Date.now() - 12 * 36e5).toISOString(),
    },
  ]
}

const startPause = (d: OrgData, id: string) => (d.pauses[id] ??= []).push({ from: Date.now(), to: null })
const endPause = (d: OrgData, id: string) => {
  const open = d.pauses[id]?.find((p) => p.to === null)
  if (open) open.to = Date.now()
}

function readStore(): Record<string, OrgData> {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, OrgData>) : {}
  } catch {
    return {}
  }
}

const notFound = (what: string) => new AuthError('invalid_input', `That ${what} doesn't exist any more. It may have been deleted.`)

/** Short names for the alerts, for messages. */
const ALERT_NAME: Record<AlertKey, string> = {
  emergency: 'Emergency calls',
  handoff_waiting: 'Callers waiting',
  handoff_missed: 'Missed handoffs',
  callback_overdue: 'Overdue callbacks',
  agent_failing: 'Agent problems',
  usage_threshold: 'Minutes running out',
  invoice: 'Invoices',
  daily_summary: 'Daily summary',
  weekly_report: 'Weekly report',
  agent_published: 'Agent published',
  team_changes: 'Team changes',
}

/** Who gets what, until someone changes it. */
function seedAlerts(): AlertSettings {
  const rule = (key: AlertKey, roles: Role[], threshold?: number, enabled = true): AlertRule => ({ key, enabled, roles, memberIds: [], ...(threshold !== undefined ? { threshold } : {}) })
  return {
    rules: [
      rule('emergency', ['owner', 'admin', 'supervisor', 'front_desk']),
      rule('handoff_waiting', ['supervisor'], 3),
      rule('handoff_missed', ['supervisor', 'front_desk']),
      rule('callback_overdue', ['supervisor'], 30),
      rule('agent_failing', ['owner', 'admin']),
      rule('usage_threshold', ['owner'], 80),
      rule('invoice', ['owner']),
      rule('daily_summary', ['owner', 'admin', 'supervisor'], undefined, false),
      rule('weekly_report', ['owner', 'admin']),
      rule('agent_published', ['owner', 'admin', 'supervisor']),
      rule('team_changes', ['owner', 'admin']),
    ],
    quietHours: { enabled: false, from: '21:00', to: '07:00' },
    updatedAt: new Date(Date.now() - 30 * DAY).toISOString(),
    updatedBy: 'AICA (defaults)',
  }
}

export function createDemoConsoleClient({ latency = 600, processingMs = 9000, persist = true }: DemoConsoleOptions = {}): ConsoleClient {
  const wait = makeWait(latency)
  // Everything this tab knows, including organisations not opened since the
  // last reload: saving one organisation must never drop another's.
  let orgs: Record<string, OrgData> = persist ? readStore() : {}
  const org = (slug: string): OrgData => (orgs[slug] ??= seedOrg(slug))

  /** After every change: keep this tab's demo data across reloads. */
  const keep = () => {
    if (!persist) return
    try {
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(orgs))
    } catch {
      /* storage blocked or full: changes last until reload */
    }
  }

  /** Uploaded calls move through the stages as time passes. */
  const statusOf = (started: number): SourceCallStatus => {
    if (processingMs === 0) return 'ready'
    const t = (Date.now() - started) / processingMs
    return t >= 1 ? 'ready' : t < 0.2 ? 'queued' : t < 0.6 ? 'transcribing' : 'extracting'
  }
  const refresh = (d: OrgData) => {
    for (const c of d.calls) {
      const started = d.processing[c.id]
      if (started === undefined) continue
      c.status = statusOf(started)
      if (c.status === 'ready') {
        c.topic = topicFor(c)
        delete d.processing[c.id]
      }
    }
  }

  const subTypeOf = (dr: AgentDraft) => findSubType(dr.typeId, dr.subTypeId)

  const voiceName = (id: string) => enabledVoices().find((v) => v.id === id)?.name
  /** How an agent or draft comes across on a call, for showing it. */
  const profile = (s: Pick<AgentSpec, 'behaviour' | 'flow'>): Pick<AgentSummary, 'persona' | 'voiceName' | 'greeting' | 'intents'> => ({
    persona: s.behaviour.persona,
    voiceName: voiceName(s.behaviour.voiceId),
    greeting: s.behaviour.greeting,
    intents: s.flow.map((n) => n.label),
  })
  const requestState = (dr: AgentDraft) => ({ state: dr.submittedAt ? ('sent' as const) : ('drafting' as const), by: dr.requestedBy?.name ?? 'bitNtech', requestId: dr.requestId ?? null })

  const draftSummary = (dr: AgentDraft): AgentSummary => ({
    id: dr.id,
    name: dr.name.trim() || 'Untitled agent',
    useCase: subTypeOf(dr)?.label ?? 'Use case not chosen',
    status: 'draft',
    phoneNumber: null,
    languages: dr.behaviour.languages,
    version: null,
    lastPublishedAt: null,
    updatedAt: dr.updatedAt,
    callsThisWeek: 0,
    setupStep: dr.reached,
    ...profile(dr),
    ...(dr.requestedBy ? { request: requestState(dr) } : {}),
  })

  const findAgent = (o: string, id: string) => {
    const a = org(o).agents.find((x) => x.id === id)
    if (!a) throw notFound('agent')
    return a
  }

  const patternsForAgent = (o: string, agentId: string, windowSize: number) => {
    const agent = findAgent(o, agentId)
    const flow = recordOf(o, agentId).working.flow
    // Enough days to gather `windowSize` calls for a normal week's volume.
    const calls = callLog(logContext(o), 90)
      .filter((c) => c.agentId === agentId)
      .slice(0, windowSize)
      .map((c) => ({ id: c.id, path: callRecord(c).path }))
    return detectFlowPatterns({ agentId, agentName: agent.name, calls, knownFlow: flow, windowSize, now: new Date().toISOString() })
  }

  /** The agent's record, seeded the first time it's opened. */
  const recordOf = (o: string, id: string): AgentRecord => {
    const d = org(o)
    const a = findAgent(o, id)
    if (!d.details[id]) {
      const seeded = seedDetail(o, a, d.calls)
      if (!seeded) throw notFound('agent')
      d.details[id] = { ...seeded, changed: false }
    }
    return d.details[id]
  }

  const detail = (o: string, id: string): AgentDetail => {
    const r = recordOf(o, id)
    const dr = org(o).drafts.find((x) => x.baseAgentId === id)
    const change = dr ? { draftId: dr.id, ...requestState(dr), step: dr.reached } : undefined
    return copy({ agent: { ...findAgent(o, id), hasChanges: r.changed, change }, working: r.working, versions: r.versions })
  }

  /** Knowledge sources list the agents whose live version uses them. */
  const syncUsage = (d: OrgData, agentId: string, spec: AgentSpec | null) => {
    for (const k of d.knowledge) {
      const uses = !!spec?.context.knowledgeSourceIds.includes(k.id)
      k.usedByAgentIds = k.usedByAgentIds.filter((x) => x !== agentId).concat(uses ? [agentId] : [])
    }
  }

  /** Every setup in the organisation, by the name to show for it: each
   * agent's live version and draft changes, and builder drafts. */
  const setups = (o: string): { name: string; spec: Pick<AgentSpec, 'flow' | 'context'>; draft?: AgentDraft }[] => {
    const d = org(o)
    const out: { name: string; spec: Pick<AgentSpec, 'flow' | 'context'>; draft?: AgentDraft }[] = []
    for (const a of d.agents) {
      try {
        const r = recordOf(o, a.id)
        // Every version it keeps: a rollback can make any of them live again.
        out.push({ name: a.name, spec: r.working }, ...r.versions.map((v) => ({ name: a.name, spec: v.spec })))
      } catch {
        /* an agent without a setup: nothing uses anything */
      }
    }
    for (const dr of d.drafts) out.push({ name: dr.name.trim() || 'Untitled agent', spec: dr, draft: dr })
    return out
  }
  const names = (xs: string[]) => [...new Set(xs)].sort()
  const flowCalls = (nodes: FlowNode[]): string[] => nodes.flatMap((n) => [...n.sourceCallIds, ...flowCalls(n.children)])
  const callUsers = (o: string, id: string) => names(setups(o).filter((x) => x.draft?.sourceCallIds.includes(id) || flowCalls(x.spec.flow).includes(id)).map((x) => x.name))
  const toolUsers = (o: string, id: string) => names(setups(o).filter((x) => x.spec.context.toolIds.includes(id)).map((x) => x.name))
  const knowledgeUsers = (o: string, id: string) => names(setups(o).filter((x) => x.spec.context.knowledgeSourceIds.includes(id)).map((x) => x.name))

  /** Knowledge being indexed is ready once its time is up. */
  const refreshKnowledgeStatus = (d: OrgData) => {
    for (const k of d.knowledge) {
      const started = d.indexing[k.id]
      if (started === undefined) continue
      if (processingMs === 0 || Date.now() - started >= processingMs) {
        k.status = 'ready'
        k.refreshedAt = new Date().toISOString()
        if (!k.passages) k.passages = passagesOf(k).length * 7
        delete d.indexing[k.id]
      }
    }
  }
  const findKnowledge = (o: string, id: string) => {
    const k = org(o).knowledge.find((x) => x.id === id)
    if (!k) throw notFound('knowledge source')
    return k
  }
  const findTool = (o: string, id: string) => {
    const t = org(o).tools.find((x) => x.id === id)
    if (!t) throw notFound('tool')
    return t
  }

  /** Publishes `spec` as the agent's next version. */
  const release = (o: string, id: string, spec: AgentSpec, note: string) => {
    const d = org(o)
    const a = findAgent(o, id)
    const r = recordOf(o, id)
    const now = new Date().toISOString()
    a.version = (a.version ?? 0) + 1
    a.lastPublishedAt = now
    a.languages = spec.behaviour.languages
    a.updatedAt = now
    r.versions = [{ version: a.version, publishedAt: now, publishedBy: by(), note, spec: copy(spec) }, ...r.versions].slice(0, KEEP_VERSIONS)
    r.working = copy(spec)
    r.changed = false
    syncUsage(d, id, spec)
  }

  const findDraft = (o: string, id: string) => {
    const dr = org(o).drafts.find((x) => x.id === id)
    if (!dr) throw notFound('draft')
    return dr
  }

  /** Who's using the console (a real server knows this from the session). */
  let viewer: Viewer | null = null
  const by = () => viewer?.name ?? 'You'
  const roleIn = (o: string) => viewer?.roles[o]
  const master = () => viewer?.platformRole === 'master_admin'
  /** What the viewer may do in `o`. bitNtech: everything for the master
   * admin, looking for staff. No viewer (some tests): everything. */
  const permsIn = (o: string): Set<Permission> => {
    if (!viewer || master()) return new Set(permissionsFor('owner'))
    if (viewer.platformRole) return new Set<Permission>(['agents.view', 'agents.test', 'calls.viewAll', 'reports.view'])
    const role = roleIn(o)
    return new Set(role ? permissionsFor(role, viewer.permissions?.[o]) : [])
  }
  const has = (o: string, p: Permission) => permsIn(o).has(p)
  /** Refuses unless the viewer has one of `perms`, as the server will. */
  const allowPerm = (o: string, perms: Permission | Permission[], what: string) => {
    const list = Array.isArray(perms) ? perms : [perms]
    if (viewer && !list.some((p) => has(o, p))) throw new AuthError('forbidden', `You don’t have permission to ${what}.`)
  }
  /** Agents are created and restructured by bitNtech's master admin only. */
  const allowMaster = (what: string) => {
    if (viewer && !master()) throw new AuthError('forbidden', `Only bitNtech can ${what}. Send them a request instead.`)
  }
  /** The builder: bitNtech's master admin works on any draft. The
   * organisation writes its own drafts, to send as requests, until one is
   * sent; bitNtech's own drafts are theirs. */
  const allowDraft = (o: string, dr: AgentDraft | null, what: string) => {
    if (!viewer || master()) return
    if (viewer.platformRole) throw new AuthError('forbidden', `Only bitNtech’s master admin can ${what}.`)
    allowPerm(o, 'requests.create', what)
    if (!dr) return
    if (!dr.requestedBy) throw new AuthError('forbidden', 'bitNtech is building this agent. Send them a request instead.')
    if (dr.submittedAt) throw new AuthError('invalid_input', 'This was sent to bitNtech. Withdraw the request first to change it.')
  }
  /** A request's draft can be changed again once it's withdrawn or declined. */
  const unlockDraft = (o: string, r: ChangeRequest) => {
    const dr = r.draftId ? org(o).drafts.find((x) => x.id === r.draftId) : undefined
    if (!dr) return
    dr.submittedAt = null
    dr.requestId = null
  }
  /** What bitNtech gets with a draft, after the organisation's note. */
  const draftBrief = (dr: AgentDraft): string => {
    const sub = subTypeOf(dr)
    const lines = [
      dr.baseAgentId ? `Changes to ${dr.name.trim()}, made in the agent builder.` : `A new agent, “${dr.name.trim() || 'Untitled'}”, made in the agent builder.`,
      `Job: ${sub?.label ?? 'not chosen'}. Speaks ${dr.behaviour.languages.map((l) => LANGUAGE_LABEL[l]).join(', ')} as ${dr.behaviour.persona}.`,
      `Flow: ${dr.flow.length} intents, ${countForks(dr.flow)} decision points, ${countPaths(dr.flow)} ways a call can end. From ${dr.sourceCallIds.length} recorded calls.`,
      '',
      ...flowOutline(dr.flow),
    ]
    return lines.join('\n')
  }

  /** Refuses roles not in `roles`, as the server will. (No viewer set, as in
   * some tests: allowed.) */
  const allow = (o: string, roles: string[], what: string) => {
    const role = roleIn(o)
    if (viewer && (!role || !roles.includes(role))) throw new AuthError('forbidden', `Your role can’t ${what}.`)
  }
  /** A logged call by id, if it exists. */
  const findCall = (o: string, id: string) => {
    const m = /^call_(\d+)_\d+$/.exec(id)
    const day = m ? Number(m[1]) : NaN
    // Call ids carry their IST day number (see operations.ts).
    const days = Math.floor((Date.now() + 5.5 * 36e5) / DAY) - day + 1
    return Number.isFinite(day) && days >= 1 && days <= 400 ? callLog(logContext(o), days).find((c) => c.id === id) : undefined
  }

  /** Agents not taking calls now: paused, or their line switched to staff. */
  const liveOff = (o: string) => {
    const d = org(o)
    const off = logContext(o).paused
    for (const n of d.numbers) if (n.agentId && staffMode(o, n.id)) off.add(n.agentId)
    return off
  }
  /** A line's switch to staff, unless it has run out. */
  const staffMode = (o: string, numberId: string): LineMode | null => {
    const m = org(o).lineModes[numberId]
    if (!m) return null
    if (m.until && Date.parse(m.until) <= Date.now()) {
      delete org(o).lineModes[numberId]
      return null
    }
    return m
  }
  const logContext = (o: string): LogContext => {
    const d = org(o)
    return { orgSlug: o, paused: new Set(d.agents.filter((a) => a.status === 'paused').map((a) => a.id)), pauses: d.pauses }
  }
  /** Ties some sample callbacks and appointments to sample calls, once per
   * organisation, so "where it came from" and the booking call show
   * something: the seeds can't, as call ids depend on the date. Only the
   * link is set; the callers' own names and numbers stay as seeded. */
  const linked = new Set<string>()
  /** The agent keeps taking calls: every few minutes (a few times at most) a new request arrives, for a time someone else already asked for. */
  const INCOMING = ['Breathless at night, ankles swollen', 'Follow-up after the angiogram', 'Ear pain and fever', 'Routine check-up']
  const incoming = (o: string) => {
    const d = org(o)
    const t = Date.now()
    if (d.incomingAt === undefined) return void (d.incomingAt = t)
    if (t - d.incomingAt < 4 * 60e3 || (d.incomingCount ?? 0) >= INCOMING.length) return
    const rival = d.appointments.find((a) => a.status === 'pending' && a.source === 'ai_call' && startsAt(a) > nowKey(t + 864e5))
    if (!rival) return
    const n = d.incomingCount ?? 0
    const at = new Date(t).toISOString()
    d.appointments.push({
      ...rival,
      id: `apt_in${t.toString(36)}`,
      patientName: ['Saravanan P', 'Kavitha R', 'Abdul Rahman', 'Jaya Lakshmi'][n],
      phone: `+91 98400 ${String(61000 + n * 137).slice(0, 5)}`,
      visitReason: INCOMING[n],
      type: n === 1 || n === 3 ? 'follow_up' : 'new_visit',
      callId: null,
      createdAt: at,
      updatedAt: at,
      updatedBy: rival.agentName ?? 'The agent',
      history: [{ at, by: rival.agentName ?? 'The agent', kind: 'created', text: 'Booked on a call by the agent' }],
      rank: undefined,
      checkReason: undefined,
      note: undefined,
    })
    d.incomingAt = t
    d.incomingCount = n + 1
    keep()
  }

  const linkSamples = (o: string) => {
    if (linked.has(o)) return
    linked.add(o)
    const d = org(o)
    const calls = callLog(logContext(o), 3)
    const take = (test: (c: CallSummary) => boolean) => {
      const i = calls.findIndex(test)
      return i < 0 ? undefined : calls.splice(i, 1)[0]
    }
    // Anand's insurance question: an unnamed billing call from before he asked.
    const anand = d.callbacks.find((c) => c.id === 'cb_5' && !c.callId)
    const billing = anand && take((c) => /bill|insurance/i.test(c.intent) && !c.callerName && Date.parse(c.startedAt) < Date.parse(anand.requestedAt))
    if (anand && billing) anand.callId = billing.id
    // The first few bookings the agents made link to booking calls.
    for (const a of d.appointments.filter((x) => x.bookedBy === 'agent' && !x.callId).slice(0, 4)) {
      const call = take((c) => c.outcome === 'booked')
      if (call) a.callId = call.id
    }
  }
  /** Writes to the organisation's activity log, as the server would. */
  const log = (o: string, area: ActivityEntry['area'], text: string, detail?: string) => {
    org(o).activity.unshift({
      id: newId('act'),
      at: new Date().toISOString(),
      actor: viewer?.platformRole ? `${by()} (bitNtech)` : by(),
      actorKind: viewer?.platformRole ? 'bitntech' : 'member',
      ...(viewer && !viewer.platformRole ? { actorId: viewer.id } : {}),
      area,
      text,
      ...(detail ? { detail } : {}),
    })
  }
  const findMember = (o: string, id: string) => {
    const m = org(o).members.find((x) => x.id === id)
    if (!m) throw notFound('person')
    return m
  }
  /** Owners left if `without` went. */
  const ownersBut = (o: string, without: string) => org(o).members.filter((m) => m.role === 'owner' && m.status === 'active' && m.id !== without).length
  /** Callbacks given to someone who can no longer take them go back to nobody. */
  const freeCallbacks = (o: string, memberId: string) => {
    for (const c of org(o).callbacks) if (c.status === 'open' && c.assignedTo?.id === memberId) c.assignedTo = null
  }
  const billingOf = (o: string): Billing => {
    const d = org(o)
    const p = billingPeriod()
    const calls = callLog(logContext(o), p.daysSoFar).filter((c) => Date.parse(c.startedAt) >= p.start)
    const uploaded = d.calls.filter((c) => Date.parse(c.addedAt) >= p.start).reduce((s, c) => s + c.durationSec, 0)
    return copy({
      ...d.billing,
      plans: currentPlans(),
      usage: { minutes: Math.round(calls.reduce((s, c) => s + c.durationSec, 0) / 60), calls: calls.length, uploadHours: Math.round((uploaded / 3600) * 10) / 10 },
    })
  }

  const findCallback = (o: string, id: string) => {
    const c = org(o).callbacks.find((x) => x.id === id)
    if (!c) throw notFound('callback')
    return c
  }
  const KIND_WORD: Record<ChangeRequest['kind'], string> = { new_agent: 'a new agent', flow_change: 'a flow change', integration: 'an integration', number: 'a phone number', other: 'a change' }
  /** Files a request to bitNtech (checks done by the caller). */
  const addRequest = (o: string, input: Pick<ChangeRequest, 'kind' | 'agentId' | 'title' | 'detail' | 'urgency'>): ChangeRequest => {
    const d = org(o)
    const now = new Date().toISOString()
    const agent = input.agentId ? d.agents.find((a) => a.id === input.agentId) : null
    const r: ChangeRequest = {
      id: newId('cr'),
      orgSlug: o,
      kind: input.kind,
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      title: input.title,
      detail: input.detail,
      urgency: input.urgency,
      status: 'open',
      createdAt: now,
      createdBy: by(),
      createdById: viewer?.id ?? null,
      updatedAt: now,
      replies: [],
    }
    d.requests.unshift(r)
    log(o, 'agents', `Asked bitNtech for ${KIND_WORD[r.kind]}: “${r.title}”`)
    return r
  }
  const findRequest = (o: string, id: string) => {
    const r = org(o).requests.find((x) => x.id === id)
    if (!r) throw notFound('request')
    return r
  }

  /** The bot desk as the page shows it. */
  const desk = (o: string): Desk => {
    const d = org(o)
    const now = new Date().toISOString()
    const live = liveCalls(o, d.liveTaken, logContext(o).paused, d.live)
    d.notices = d.notices.filter((n) => n.until > now)
    const today = localDay(0)
    d.doctorChanges = d.doctorChanges.filter((c) => c.date >= today)
    const open = d.flags.filter((f) => f.status === 'open')
    const done = d.flags.filter((f) => f.status !== 'open').slice(0, 5)
    return copy({
      lines: d.numbers.map((n) => {
        const agent = d.agents.find((a) => a.id === n.agentId) ?? null
        const m = staffMode(o, n.id)
        return {
          numberId: n.id,
          number: n.number,
          label: n.label,
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? null,
          agentStatus: agent?.status ?? null,
          mode: m ? 'staff' : 'agent',
          staffUntil: m?.until ?? null,
          staffReason: m?.reason ?? null,
          staffBy: m?.by ?? null,
          liveCalls: m || !agent ? 0 : live.filter((c) => c.agentId === agent.id).length,
        }
      }),
      notices: [...d.notices].sort((a, b) => a.until.localeCompare(b.until)),
      doctorChanges: [...d.doctorChanges].sort((a, b) => a.date.localeCompare(b.date)),
      flags: [...open, ...done],
      doctors: DEPARTMENTS.map(([department, doctor]) => ({ doctor, department })),
    })
  }
  const scenariosOf = (o: string, agentId: string) => {
    findAgent(o, agentId)
    return (org(o).scenarios[agentId] ??= seedScenarios(agentId))
  }
  /** Calls in progress: the lines' own, and the ones behind the handovers. */
  const liveOf = (o: string): LiveCall[] => {
    const d = org(o)
    const off = liveOff(o)
    return [...liveCalls(o, d.liveTaken, off, d.live), ...handoffCalls(d.handoffs, d.liveTaken, off, d.live)]
  }
  const findLive = (o: string, id: string): LiveCall => {
    const call = liveOf(o).find((c) => c.id === id)
    if (!call) throw new AuthError('invalid_input', 'That call has ended.')
    return call
  }

  const findHandoff = (o: string, id: string) => {
    const h = org(o).handoffs.find((x) => x.id === id)
    if (!h) throw notFound('handover')
    return h
  }

  return {
    isDemo: true,

    setViewer(v) {
      viewer = v
    },

    reset() {
      orgs = {}
      try {
        window.sessionStorage.removeItem(STORE_KEY)
      } catch {
        /* nothing stored */
      }
    },

    async listAgents(o) {
      await wait()
      const d = org(o)
      // This week's calls, from the same call log the Operate pages show.
      const week = callLog(logContext(o), 7)
      const calls = (id: string) => week.filter((c) => c.agentId === id).length
      const look = (id: string) => {
        try {
          return profile(recordOf(o, id).working)
        } catch {
          return {}
        }
      }
      const changeOf = (id: string): AgentSummary['change'] => {
        const dr = d.drafts.find((x) => x.baseAgentId === id)
        return dr ? { draftId: dr.id, ...requestState(dr), step: dr.reached } : undefined
      }
      return copy([
        ...d.agents.map((a) => ({ ...a, callsThisWeek: calls(a.id), hasChanges: !!d.details[a.id]?.changed, ...look(a.id), change: changeOf(a.id) })),
        ...d.drafts.filter((dr) => !dr.baseAgentId).map(draftSummary),
      ])
    },

    async listCalls(o) {
      await wait()
      const d = org(o)
      refresh(d)
      keep()
      return copy([...d.calls].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).map((c) => ({ ...c, usedBy: callUsers(o, c.id) })))
    },

    async deleteCall(o, id) {
      await wait()
      allowPerm(o, 'library.uploads', 'remove recordings')
      const d = org(o)
      if (!d.calls.some((c) => c.id === id)) throw notFound('call')
      d.calls = d.calls.filter((c) => c.id !== id)
      delete d.processing[id]
      // Drafts stop learning from it; flows already read keep their steps.
      for (const dr of d.drafts) dr.sourceCallIds = dr.sourceCallIds.filter((x) => x !== id)
      keep()
    },

    async addRecordings(o, files) {
      await wait()
      allowPerm(o, 'library.uploads', 'upload calls')
      const d = org(o)
      const now = new Date().toISOString()
      const added = files.map((f): SourceCall => {
        const call: SourceCall = {
          id: newId('call'),
          name: f.name,
          // Roughly 1 MB per minute of compressed speech.
          durationSec: Math.max(8, Math.round((f.size / 1_000_000) * 60)),
          language: 'mixed',
          status: 'queued',
          addedAt: now,
          size: f.size,
        }
        if (f.size === 0) {
          call.status = 'failed'
          call.error = 'The file is empty. Export the recording again and re-upload it.'
        } else d.processing[call.id] = Date.now()
        return call
      })
      d.calls.push(...added)
      refresh(d)
      keep()
      return copy(added)
    },

    async getTranscript(o, callId) {
      await wait()
      const call = org(o).calls.find((c) => c.id === callId)
      if (!call) throw notFound('call')
      if (call.status !== 'ready') throw new AuthError('invalid_input', 'This call is still being processed. Its transcript will be ready soon.')
      return transcriptFor(call)
    },

    async listAgentTypes() {
      await wait()
      return copy(publishedTypes())
    },

    async listVoices() {
      await wait()
      return copy(enabledVoices())
    },

    async listModels() {
      await wait()
      return copy({ ...MODEL_OPTIONS, defaults: platform().models })
    },

    async createDraft(o, orgName) {
      await wait()
      allowDraft(o, null, 'ask for new agents')
      const dr: AgentDraft = {
        requestedBy: viewer && !viewer.platformRole ? { id: viewer.id, name: viewer.name } : null,
        id: newId('draft'),
        reached: 'calls',
        sourceCallIds: [],
        consent: false,
        redact: true,
        typeId: null,
        subTypeId: null,
        name: '',
        behaviour: defaultBehaviour(orgName),
        flow: [],
        attributes: [],
        globalFlows: [],
        context: { knowledgeSourceIds: [], answerOnlyFromKnowledge: true, topK: 4, minScore: 0.6, toolIds: [], confirmBeforeActions: true },
        pipeline: defaultPipeline(),
        speech: defaultSpeech(),
        guardrails: defaultGuardrails(),
        analysis: defaultAnalysisSettings(),
        updatedAt: new Date().toISOString(),
      }
      org(o).drafts.push(dr)
      keep()
      return copy(dr)
    },

    async getDraft(o, id) {
      await wait()
      const dr = findDraft(o, id)
      if (viewer && !viewer.platformRole && !dr.requestedBy) throw new AuthError('forbidden', 'bitNtech is building this agent. It appears in Agents once it’s published.')
      return copy(dr)
    },

    async saveDraft(o, draft) {
      await wait()
      const d = org(o)
      const i = d.drafts.findIndex((x) => x.id === draft.id)
      if (i < 0) throw notFound('draft')
      const was = d.drafts[i]
      allowDraft(o, was, 'build agents')
      // Who it's for, what it changes and whether it's been sent are the server's to say.
      d.drafts[i] = {
        ...copy(draft),
        requestedBy: was.requestedBy ?? null,
        baseAgentId: was.baseAgentId ?? null,
        baseVersion: was.baseVersion ?? null,
        requestId: was.requestId ?? null,
        submittedAt: was.submittedAt ?? null,
        flowGroups: was.flowGroups,
        updatedAt: new Date().toISOString(),
      }
      keep()
      return copy(d.drafts[i])
    },

    async discardDraft(o, id) {
      await wait()
      allowDraft(o, findDraft(o, id), 'discard drafts')
      const d = org(o)
      d.drafts = d.drafts.filter((x) => x.id !== id)
      keep()
    },

    async extractFlow(o, id) {
      // Reading calls takes a moment, even in the demo.
      await wait()
      await wait()
      const d = org(o)
      const dr = findDraft(o, id)
      allowDraft(o, dr, 'read calls into a flow')
      const calls = d.calls.filter((c) => dr.sourceCallIds.includes(c.id) && c.status === 'ready')
      if (!calls.length) throw new AuthError('invalid_input', 'None of the chosen calls is ready. Go back to step 1 and choose ready calls.')
      dr.flowGroups = extractFlowGroups(dr.subTypeId, dr.typeId, calls)
      dr.extraction = { at: new Date().toISOString(), callIds: calls.map((c) => c.id), subTypeId: dr.subTypeId }
      // Changes to an agent keep its flow and setup: the person adds from the groups.
      if (dr.baseAgentId) {
        dr.updatedAt = new Date().toISOString()
        keep()
        return copy(dr)
      }
      const [pick] = dr.flowGroups
      dr.flow = pick.flow
      dr.flowGroupId = pick.id
      dr.attributes = extractAttributes(dr.subTypeId)
      dr.globalFlows = defaultGlobalFlows()
      // Start from the knowledge and tools that suit the job.
      dr.context = {
        ...dr.context,
        knowledgeSourceIds: d.knowledge.filter((k) => k.status === 'ready' && (k.expiresAt === null || k.expiresAt > new Date().toISOString())).map((k) => k.id),
        toolIds: d.tools.filter((t) => t.enabled && (t.kind === 'builtin' ? t.builtin === 'transfer' || t.builtin === 'end_call' : dr.subTypeId === 'appointments' ? t.id !== 'tool_report' : dr.subTypeId === 'reports' && t.id === 'tool_report')).map((t) => t.id),
      }
      dr.updatedAt = new Date().toISOString()
      keep()
      return copy(dr)
    },

    async publishDraft(o, id, numberId) {
      await wait()
      allowMaster('publish new agents')
      const d = org(o)
      const done = d.published[id] && d.agents.find((a) => a.id === d.published[id])
      if (done) return copy(done)
      const dr = findDraft(o, id)
      /** The request it was sent with is done, and says so. */
      const finish = (text: string) => {
        const r = dr.requestId ? d.requests.find((x) => x.id === dr.requestId) : undefined
        if (!r) return
        const at = new Date().toISOString()
        r.status = 'done'
        r.replies.push({ id: newId('crr'), by: by(), byKind: 'bitntech', at, text })
        r.updatedAt = at
      }
      if (dr.baseAgentId) {
        const target = findAgent(o, dr.baseAgentId)
        release(o, target.id, specFromDraft(copy(dr)), dr.requestId ? `Changes asked for by ${dr.requestedBy?.name ?? 'the organisation'}, from the builder.` : 'Changes from the builder.')
        finish(`Built and published as version ${target.version}. Callers get it now${target.status === 'live' ? '' : ', once the agent is turned on'}.`)
        d.drafts = d.drafts.filter((x) => x.id !== id)
        d.published[id] = target.id
        log(o, 'agents', `Published ${target.name}, version ${target.version}`, 'Changes from the agent builder.')
        keep()
        return copy(target)
      }
      const number = numberId ? d.numbers.find((n) => n.id === numberId) : null
      if (numberId && !number) throw notFound('phone number')
      if (number?.agentId) throw new AuthError('invalid_input', `${number.number} already has an agent. Choose a free number.`)
      const agentId = newId('agt')
      const now = new Date().toISOString()
      const agent: AgentSummary = {
        id: agentId,
        name: dr.name.trim(),
        useCase: subTypeOf(dr)?.label ?? 'General enquiries',
        status: number ? 'live' : 'paused',
        phoneNumber: number?.number ?? null,
        languages: dr.behaviour.languages,
        version: 1,
        lastPublishedAt: now,
        updatedAt: now,
        callsThisWeek: 0,
        builtBy: viewer?.platformRole ? `bitNtech (${by()})` : by(),
      }
      d.agents.push(agent)
      const spec = specFromDraft(copy(dr))
      d.details[agentId] = { working: copy(spec), versions: [{ version: 1, publishedAt: now, publishedBy: by(), note: 'First version, from the builder.', spec }], changed: false }
      d.drafts = d.drafts.filter((x) => x.id !== id)
      d.published[id] = agentId
      if (number) number.agentId = agentId
      syncUsage(d, agentId, spec)
      finish(number ? `Built and published as ${agent.name}. It’s answering ${number.number} now.` : `Built and published as ${agent.name}, paused for now: it starts answering once it has a number.`)
      log(o, 'agents', `Published ${agent.name}, version 1`, number ? `Answering ${number.number}.` : 'Paused: no number yet.')
      keep()
      return copy(agent)
    },

    async startAgentChange(o, agentId) {
      await wait()
      allowDraft(o, null, 'change agents')
      const d = org(o)
      const a = findAgent(o, agentId)
      const open = d.drafts.find((x) => x.baseAgentId === agentId)
      if (open) {
        // One set of changes at a time: the organisation's, or bitNtech's.
        if (viewer && !master() && !open.requestedBy) throw new AuthError('invalid_input', `bitNtech is already changing ${a.name}. Ask them in Requests.`)
        return copy(open)
      }
      const w = recordOf(o, agentId).working
      const dr: AgentDraft = {
        id: newId('draft'),
        reached: 'review',
        sourceCallIds: [],
        consent: false,
        redact: w.redact,
        typeId: w.typeId,
        subTypeId: w.subTypeId,
        name: a.name,
        behaviour: copy(w.behaviour),
        flow: copy(w.flow),
        attributes: copy(w.attributes),
        globalFlows: copy(w.globalFlows),
        context: copy(w.context),
        pipeline: copy(w.pipeline),
        speech: copy(w.speech),
        guardrails: copy(w.guardrails),
        analysis: copy(w.analysis),
        baseAgentId: agentId,
        baseVersion: a.version,
        requestedBy: viewer && !viewer.platformRole ? { id: viewer.id, name: viewer.name } : null,
        updatedAt: new Date().toISOString(),
      }
      d.drafts.push(dr)
      keep()
      return copy(dr)
    },

    async submitDraft(o, id, input) {
      await wait()
      if (viewer?.platformRole) throw new AuthError('forbidden', 'Requests come from the organisation. bitNtech builds them.')
      const dr = findDraft(o, id)
      allowDraft(o, dr, 'ask bitNtech for agents')
      if (!dr.requestedBy) throw new AuthError('invalid_input', 'Only the organisation’s own drafts are sent as requests.')
      const title = input.title.trim()
      const note = input.note.trim()
      if (title.length < 5 || title.length > 120) throw new AuthError('invalid_input', 'Give the request a title of 5 to 120 characters.')
      if (note.length > 800) throw new AuthError('invalid_input', 'Keep the note under 800 characters.')
      if (!['normal', 'soon', 'urgent'].includes(input.urgency)) throw new AuthError('invalid_input', 'Choose how soon you need it.')
      if (!dr.name.trim() || dr.flow.length === 0) throw new AuthError('invalid_input', 'Name the agent and give it a conversation flow first.')
      const changed = (input.changes ?? []).slice(0, 30).map((c) => `- ${c.trim().slice(0, 200)}`)
      const brief = draftBrief(dr)
      const detail = [note, changed.length ? `What changed:\n${changed.join('\n')}` : '', brief].filter(Boolean).join('\n\n').slice(0, 2000)
      const r = addRequest(o, { kind: dr.baseAgentId ? 'flow_change' : 'new_agent', agentId: dr.baseAgentId ?? null, title, detail, urgency: input.urgency })
      r.draftId = dr.id
      dr.submittedAt = r.createdAt
      dr.requestId = r.id
      keep()
      return copy(r)
    },

    async listKnowledge(o) {
      await wait()
      const d = org(o)
      refreshKnowledgeStatus(d)
      keep()
      return copy(d.knowledge.map((k) => ({ ...k, usedBy: knowledgeUsers(o, k.id) })))
    },

    async addKnowledge(o, input) {
      await wait()
      allowPerm(o, 'library.knowledge', 'add knowledge')
      const d = org(o)
      const name = input.name.trim()
      if (name.length < 3) throw new AuthError('invalid_input', 'Give the source a name of at least 3 characters.')
      if (d.knowledge.some((k) => k.name.toLowerCase() === name.toLowerCase())) throw new AuthError('invalid_input', `There's already a source called “${name}”.`)
      if (input.kind === 'web' && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(input.url.trim())) throw new AuthError('invalid_input', 'Give a full web address starting with https://.')
      if (input.kind === 'faq' && input.faq.filter((f) => f.q.trim() && f.a.trim()).length === 0) throw new AuthError('invalid_input', 'Add at least one question with its answer.')
      const k: KnowledgeSource = {
        id: newId('kb'),
        name,
        kind: input.kind,
        origin: input.kind === 'web' ? input.url.trim() : input.kind === 'faq' ? `${input.faq.filter((f) => f.q.trim() && f.a.trim()).length} questions` : input.fileName,
        description: input.description.trim(),
        status: 'indexing',
        passages: input.kind === 'faq' ? input.faq.length : 0,
        refreshedAt: new Date().toISOString(),
        expiresAt: input.expiresAt,
        refreshEvery: input.kind === 'web' ? input.refreshEvery : 'never',
        usedByAgentIds: [],
        faq: input.kind === 'faq' ? input.faq.filter((f) => f.q.trim() && f.a.trim()) : undefined,
      }
      if ((input.kind === 'document' || input.kind === 'table') && input.size === 0) {
        k.status = 'failed'
        k.error = 'The file is empty. Export it again and re-upload it.'
      } else d.indexing[k.id] = Date.now()
      d.knowledge.push(k)
      refreshKnowledgeStatus(d)
      log(o, 'library', `Added the knowledge source “${k.name}”`)
      keep()
      return copy(k)
    },

    async updateKnowledge(o, id, patch) {
      await wait()
      allowPerm(o, 'library.knowledge', 'change knowledge')
      const d = org(o)
      const k = findKnowledge(o, id)
      // Check everything first: a refused change changes nothing.
      const name = patch.name?.trim()
      if (name !== undefined) {
        if (name.length < 3) throw new AuthError('invalid_input', 'Give the source a name of at least 3 characters.')
        if (d.knowledge.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new AuthError('invalid_input', `There's already a source called “${name}”.`)
      }
      const faq = patch.faq?.filter((f) => f.q.trim() && f.a.trim())
      if (faq && !faq.length) throw new AuthError('invalid_input', 'Keep at least one question with its answer.')

      if (name !== undefined) k.name = name
      if (patch.description !== undefined) k.description = patch.description.trim()
      if (patch.expiresAt !== undefined) k.expiresAt = patch.expiresAt
      if (patch.refreshEvery !== undefined) k.refreshEvery = patch.refreshEvery
      if (faq && JSON.stringify(faq) !== JSON.stringify(k.faq)) {
        k.faq = faq
        k.origin = `${faq.length} questions`
        k.passages = faq.length
        // Edited answers are indexed again.
        k.status = 'indexing'
        d.indexing[k.id] = Date.now()
      }
      refreshKnowledgeStatus(d)
      keep()
      return copy(k)
    },

    async refreshKnowledge(o, id) {
      await wait()
      const d = org(o)
      const k = findKnowledge(o, id)
      if (k.kind === 'faq') throw new AuthError('invalid_input', 'An FAQ written here is always up to date.')
      k.status = 'indexing'
      delete k.error
      d.indexing[k.id] = Date.now()
      refreshKnowledgeStatus(d)
      keep()
      return copy(k)
    },

    async deleteKnowledge(o, id) {
      await wait()
      allowPerm(o, 'library.knowledge', 'delete knowledge')
      const d = org(o)
      const k = findKnowledge(o, id)
      const users = knowledgeUsers(o, id)
      if (users.length) throw new AuthError('invalid_input', `${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} “${k.name}”. Take it out of ${users.length === 1 ? 'that agent' : 'those agents'} first.`)
      d.knowledge = d.knowledge.filter((x) => x.id !== id)
      delete d.indexing[id]
      log(o, 'library', `Deleted the knowledge source “${k.name}”`)
      keep()
    },

    async listPassages(o, id) {
      await wait()
      const k = findKnowledge(o, id)
      if (k.status !== 'ready') throw new AuthError('invalid_input', k.status === 'failed' ? 'This source couldn’t be read, so it has no sections.' : 'This source is still being read. Its sections will show soon.')
      return copy(passagesOf(k))
    },

    async searchKnowledge(o, ids, question) {
      await wait()
      return copy(search(org(o).knowledge.filter((k) => ids.includes(k.id)), question))
    },

    async listTools(o) {
      await wait()
      return copy(org(o).tools.map((t) => ({ ...t, usedBy: toolUsers(o, t.id) })))
    },

    async saveTool(o, tool) {
      await wait()
      allowMaster('set up tools')
      const d = org(o)
      const existing = d.tools.find((t) => t.id === tool.id)
      if (existing?.kind === 'builtin') {
        // Built-in tools can only be switched on or off.
        existing.enabled = tool.enabled
        keep()
        return copy({ ...existing, usedBy: toolUsers(o, existing.id) })
      }
      // An id that's gone was deleted elsewhere: don't quietly make a new one.
      if (tool.id && !existing) throw notFound('tool')
      const problems = Object.values(checkTool(tool, d.tools))
      if (problems.length) throw new AuthError('invalid_input', problems[0])
      const name = tool.name.trim()
      if (tool.credentialName && !d.credentials.some((c) => c.name === tool.credentialName)) throw new AuthError('invalid_input', `There's no secret called ${tool.credentialName}. Add it under Secrets first.`)
      // Changed (or new), so not tested yet.
      const next: AgentTool = { ...copy(tool), name, url: tool.url!.trim(), kind: 'http', id: existing ? tool.id : newId('tool'), lastTestedAt: null }
      delete next.usedBy
      if (existing) d.tools[d.tools.indexOf(existing)] = next
      else d.tools.push(next)
      log(o, 'library', `${existing ? 'Changed' : 'Added'} the tool “${name}”`)
      keep()
      return copy({ ...next, usedBy: toolUsers(o, next.id) })
    },

    async deleteTool(o, id) {
      await wait()
      allowMaster('remove tools')
      const d = org(o)
      const t = findTool(o, id)
      if (t.kind === 'builtin') throw new AuthError('invalid_input', 'Built-in tools can be switched off, not deleted.')
      const users = toolUsers(o, id)
      if (users.length) throw new AuthError('invalid_input', `${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} “${t.name}”. Take it out of ${users.length === 1 ? 'that agent' : 'those agents'} first.`)
      d.tools = d.tools.filter((x) => x.id !== id)
      log(o, 'library', `Deleted the tool “${t.name}”`)
      keep()
    },

    async testTool(o, id, inputs) {
      await wait()
      const d = org(o)
      const t = findTool(o, id)
      const ms = Math.round(180 + Math.random() * 600)
      const missing = t.params.filter((p) => p.required && !inputs[p.name]?.trim()).map((p) => p.name)
      if (missing.length) return { ok: false, ms: 0, summary: `Fill in ${missing.join(', ')} to run a test.` }
      if (!t.enabled) return { ok: false, ms: 0, summary: 'The tool is switched off. Switch it on to test it.' }
      if (t.kind === 'builtin') return { ok: true, ms, summary: 'Works. In a test nothing is sent to anyone.' }
      if (t.credentialName && !d.credentials.some((c) => c.name === t.credentialName))
        return { ok: false, status: 401, ms, summary: `The secret ${t.credentialName} isn't set, so the system refused the request.` }
      const sample = Object.entries(inputs).slice(0, 2).map(([k, v]) => `"${k}": "${v}"`).join(', ')
      t.lastTestedAt = new Date().toISOString()
      keep()
      return { ok: true, status: 200, ms, summary: `{ "ok": true${sample ? `, ${sample}` : ''} } (a sample reply: the demo doesn't call your system)` }
    },

    async listCredentials(o) {
      await wait()
      return copy(org(o).credentials)
    },

    async setCredential(o, name, value) {
      await wait()
      allowPerm(o, 'library.secrets', 'set secrets')
      const d = org(o)
      const key = name.trim().toUpperCase()
      if (!/^[A-Z][A-Z0-9_]{2,39}$/.test(key)) throw new AuthError('invalid_input', 'Use 3 to 40 capital letters, digits and underscores, starting with a letter, e.g. HIS_API_KEY.')
      if (!value.trim()) throw new AuthError('invalid_input', 'Paste the secret’s value.')
      // The demo keeps only that it was set, never the value.
      const c: Credential = { name: key, setAt: new Date().toISOString(), setBy: by() }
      const had = d.credentials.some((x) => x.name === key)
      d.credentials = [...d.credentials.filter((x) => x.name !== key), c].sort((a, b) => a.name.localeCompare(b.name))
      log(o, 'library', `${had ? 'Changed' : 'Set'} the secret ${key}`, 'The value isn’t shown here or anywhere else.')
      keep()
      return copy(c)
    },

    async deleteCredential(o, name) {
      await wait()
      allowPerm(o, 'library.secrets', 'delete secrets')
      const d = org(o)
      const users = d.tools.filter((t) => t.credentialName === name)
      if (users.length) throw new AuthError('invalid_input', `${users.map((t) => `“${t.name}”`).join(', ')} ${users.length === 1 ? 'uses' : 'use'} ${name}. Change ${users.length === 1 ? 'that tool' : 'those tools'} first.`)
      if (!d.credentials.some((c) => c.name === name)) throw notFound('secret')
      d.credentials = d.credentials.filter((c) => c.name !== name)
      log(o, 'library', `Deleted the secret ${name}`)
      keep()
    },

    async listNumbers(o) {
      await wait()
      return copy(org(o).numbers)
    },

    async updateNumber(o, id, patch) {
      await wait()
      allowPerm(o, 'library.numbers', 'change phone lines')
      const d = org(o)
      const n = d.numbers.find((x) => x.id === id)
      if (!n) throw notFound('phone number')
      // Check first: a refused change changes nothing.
      const label = patch.label?.trim()
      if (label !== undefined && label.length < 2) throw new AuthError('invalid_input', 'Give the number a label, e.g. “Main reception”.')
      if (patch.hours !== undefined && !patch.hours.trim()) throw new AuthError('invalid_input', 'Say when the agent answers, e.g. “8 AM to 8 PM”.')
      const agent = patch.agentId ? d.agents.find((a) => a.id === patch.agentId) : null
      if (patch.agentId && !agent) throw notFound('agent')
      const transfer = patch.transferTo !== undefined ? patch.transferTo?.trim() || null : n.transferTo
      const after = patch.afterHours ?? n.afterHours
      if (after === 'transfer' && !transfer) throw new AuthError('invalid_input', 'Say where calls go after hours, or choose another option.')

      if (label !== undefined) n.label = label
      if (patch.hours !== undefined) n.hours = patch.hours.trim()
      n.afterHours = after
      n.transferTo = transfer
      if (patch.agentId !== undefined && patch.agentId !== n.agentId) {
        // The agent that answered it has no number now, so it's paused.
        const before = d.agents.find((a) => a.id === n.agentId)
        if (before) {
          before.phoneNumber = null
          before.status = 'paused'
        }
        if (agent) {
          // An agent answers one number: its old one is freed.
          for (const x of d.numbers) if (x.agentId === agent.id) x.agentId = null
          agent.phoneNumber = n.number
        }
        n.agentId = agent?.id ?? null
      }
      keep()
      return copy(n)
    },

    async requestNumber(o, note) {
      await wait()
      allowPerm(o, ['library.numbers', 'requests.create'], 'ask for numbers')
      if (note.length > 500) throw new AuthError('invalid_input', 'Keep the note under 500 characters.')
      addRequest(o, { kind: 'number', agentId: null, title: 'Another phone number', detail: note.trim() || 'No note.', urgency: 'normal' })
      keep()
    },

    async getAgent(o, id) {
      await wait()
      const out = detail(o, id)
      keep()
      return out
    },

    async saveAgent(o, id, working) {
      await wait()
      allowPerm(o, 'agents.configure', 'change agents')
      const r = recordOf(o, id)
      // The structure is bitNtech's: a hospital's save may not change it.
      if (viewer && !master()) {
        const locked = (x: AgentSpec) =>
          JSON.stringify([x.typeId, x.subTypeId, x.redact, x.flow, x.attributes, x.globalFlows, x.pipeline, x.context.toolIds, x.context.confirmBeforeActions, x.analysis?.fields])
        if (locked(working) !== locked(r.working)) throw new AuthError('forbidden', 'The flow, tools and voice pipeline are set up by bitNtech. Send them a request to change these.')
      }
      r.working = copy(working)
      r.changed = JSON.stringify(working) !== JSON.stringify(r.versions[0]?.spec)
      findAgent(o, id).updatedAt = new Date().toISOString()
      keep()
      return detail(o, id)
    },

    async publishAgent(o, id, note) {
      await wait()
      allowPerm(o, 'agents.publish', 'publish agents')
      const r = recordOf(o, id)
      if (!r.changed) throw new AuthError('invalid_input', 'There are no unpublished changes to publish.')
      release(o, id, r.working, note.trim() || 'No note.')
      const a = findAgent(o, id)
      log(o, 'agents', `Published ${a.name}, version ${a.version}`, note.trim() || undefined)
      keep()
      return detail(o, id)
    },

    async discardAgentChanges(o, id) {
      await wait()
      allowPerm(o, ['agents.publish', 'agents.configure'], 'discard changes')
      const r = recordOf(o, id)
      r.working = copy(r.versions[0].spec)
      r.changed = false
      keep()
      return detail(o, id)
    },

    async rollbackAgent(o, id, version) {
      await wait()
      allowPerm(o, 'agents.publish', 'roll agents back')
      const v = recordOf(o, id).versions.find((x) => x.version === version)
      if (!v) throw notFound('version')
      release(o, id, v.spec, `Went back to version ${version}.`)
      const a = findAgent(o, id)
      log(o, 'agents', `Rolled ${a.name} back to version ${version}`, `Published as version ${a.version}.`)
      keep()
      return detail(o, id)
    },

    async updateAgent(o, id, patch) {
      await wait()
      const d = org(o)
      const a = findAgent(o, id)
      // Check everything first: a refused patch changes nothing.
      const name = patch.name?.trim()
      if (name !== undefined) {
        if (name.length < 3 || name.length > 60) throw new AuthError('invalid_input', 'Give the agent a name of 3 to 60 characters.')
        if (d.agents.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new AuthError('invalid_input', `Another agent is already called “${name}”.`)
      }
      if (name !== undefined) allowPerm(o, 'agents.configure', 'rename agents')
      if (patch.status !== undefined) allowPerm(o, 'agents.publish', 'pause or turn on agents')
      if (patch.numberId !== undefined) allowPerm(o, 'library.numbers', 'move agents between lines')
      const next = patch.numberId ? d.numbers.find((n) => n.id === patch.numberId) : null
      if (patch.numberId && !next) throw notFound('phone number')
      if (next?.agentId && next.agentId !== id) throw new AuthError('invalid_input', `${next.number} already has an agent. Choose a free number.`)
      const number = patch.numberId !== undefined ? (next?.number ?? null) : a.phoneNumber
      if (patch.status === 'live' && !number) throw new AuthError('invalid_input', 'Give the agent a phone number before turning it on.')

      const was = { name: a.name, status: a.status }
      if (name !== undefined) a.name = name
      if (patch.numberId !== undefined) {
        for (const n of d.numbers) if (n.agentId === id) n.agentId = null
        if (next) next.agentId = id
        a.phoneNumber = number
        // No number, nothing to answer.
        if (!number) {
          if (a.status !== 'paused') startPause(d, id)
          a.status = 'paused'
        }
      }
      if (patch.status === 'paused' && a.status !== 'paused') startPause(d, id)
      if (patch.status === 'live' && a.status === 'paused') endPause(d, id)
      if (patch.status) a.status = patch.status
      a.updatedAt = new Date().toISOString()
      if (a.name !== was.name) log(o, 'agents', `Renamed ${was.name} to ${a.name}`)
      if (a.status !== was.status) log(o, 'agents', `${a.status === 'paused' ? 'Paused' : 'Turned on'} ${a.name}`)
      keep()
      return detail(o, id)
    },

    async deleteAgent(o, id) {
      await wait()
      allowMaster('delete agents')
      const d = org(o)
      const gone = findAgent(o, id)
      d.agents = d.agents.filter((x) => x.id !== id)
      log(o, 'agents', `Deleted the agent ${gone.name}`)
      for (const n of d.numbers) if (n.agentId === id) n.agentId = null
      syncUsage(d, id, null)
      delete d.details[id]
      keep()
    },

    async listMembers(o) {
      await wait()
      return copy(org(o).members)
    },

    async inviteMember(o, invite) {
      await wait()
      allowPerm(o, 'team.manage', 'manage the team')
      const d = org(o)
      const email = invite.email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new AuthError('invalid_input', 'Enter an email address like name@hospital.in.')
      if (!(invite.role in ROLE_LABEL)) throw new AuthError('invalid_input', 'Choose a role.')
      if (invite.role === 'owner' && roleIn(o) !== 'owner') throw new AuthError('forbidden', 'Only an owner can invite another owner.')
      const there = d.members.find((m) => m.email.toLowerCase() === email)
      if (there) throw new AuthError('invalid_input', there.status === 'invited' ? `${email} is already invited. Send the invitation again from their row.` : `${there.name} is already in the team.`)
      const m: Member = { id: newId('inv'), name: email, email, role: invite.role, permissions: null, lastActiveAt: null, status: 'invited', invitedAt: new Date().toISOString(), invitedBy: by() }
      d.members.push(m)
      log(o, 'team', `Invited ${email} as ${ROLE_LABEL[invite.role]}`)
      keep()
      return copy(m)
    },

    async resendInvite(o, id) {
      await wait()
      allowPerm(o, 'team.manage', 'manage the team')
      const m = findMember(o, id)
      if (m.status !== 'invited') throw new AuthError('invalid_input', `${m.name} has already joined.`)
      if (m.role === 'owner' && roleIn(o) !== 'owner') throw new AuthError('forbidden', 'Only an owner can send an owner’s invitation.')
      m.invitedAt = new Date().toISOString()
      m.invitedBy = by()
      log(o, 'team', `Sent the invitation to ${m.email} again`)
      keep()
      return copy(m)
    },

    async changeRole(o, id, role) {
      await wait()
      allowPerm(o, 'team.manage', 'manage the team')
      const m = findMember(o, id)
      if (!(role in ROLE_LABEL)) throw new AuthError('invalid_input', 'Choose a role.')
      if (viewer && m.id === viewer.id) throw new AuthError('forbidden', 'You can’t change your own role. Ask another owner.')
      if ((m.role === 'owner' || role === 'owner') && roleIn(o) !== 'owner') throw new AuthError('forbidden', 'Only an owner can change an owner, or make someone an owner.')
      if (m.role === role) return copy(m)
      if (m.role === 'owner' && m.status === 'active' && ownersBut(o, m.id) === 0) throw new AuthError('invalid_input', 'The organisation needs at least one owner. Make someone else an owner first.')
      const was = m.role
      m.role = role as Role
      // A new role starts from its own defaults.
      m.permissions = null
      if (role === 'viewer') freeCallbacks(o, m.id)
      log(o, 'team', m.status === 'invited' ? `Changed ${m.email}’s invitation from ${ROLE_LABEL[was]} to ${ROLE_LABEL[role]}` : `Changed ${m.name}’s role from ${ROLE_LABEL[was]} to ${ROLE_LABEL[role]}`)
      keep()
      return copy(m)
    },

    async removeMember(o, id) {
      await wait()
      allowPerm(o, 'team.manage', 'manage the team')
      const d = org(o)
      const m = findMember(o, id)
      if (viewer && m.id === viewer.id) throw new AuthError('forbidden', 'You can’t remove yourself. Ask another owner.')
      if (m.role === 'owner' && roleIn(o) !== 'owner') throw new AuthError('forbidden', 'Only an owner can remove an owner.')
      if (m.role === 'owner' && m.status === 'active' && ownersBut(o, m.id) === 0) throw new AuthError('invalid_input', 'The organisation needs at least one owner.')
      d.members = d.members.filter((x) => x.id !== id)
      freeCallbacks(o, id)
      log(o, 'team', m.status === 'invited' ? `Cancelled the invitation for ${m.email}` : `Removed ${m.name} (${ROLE_LABEL[m.role]})`)
      keep()
    },

    async listActivity(o, q) {
      await wait()
      allowPerm(o, 'activity.view', 'read the organisation’s activity')
      // Billing is the owners' business.
      const owner = !viewer || roleIn(o) === 'owner'
      const rows = org(o).activity.filter(
        (e) => (owner || e.area !== 'billing') && (!q.area || e.area === q.area) && (!q.actorId || e.actorId === q.actorId) && (!q.before || e.at < q.before),
      )
      const page = rows.slice(0, 25)
      return copy({ entries: page, nextBefore: rows.length > page.length ? page[page.length - 1].at : null })
    },

    async getAlertSettings(o) {
      await wait()
      allowPerm(o, 'settings.manage', 'see the organisation’s alerts')
      return copy((org(o).alerts ??= seedAlerts()))
    },

    async updateAlertSettings(o, input) {
      await wait()
      allowPerm(o, 'settings.manage', 'change the organisation’s alerts')
      const d = org(o)
      const members = new Set(d.members.map((m) => m.id))
      const known = new Set(seedAlerts().rules.map((r) => r.key))
      const time = /^([01]\d|2[0-3]):[0-5]\d$/
      // Check everything first: a refused change changes nothing.
      for (const r of input.rules) {
        if (!known.has(r.key)) throw new AuthError('invalid_input', 'That alert doesn’t exist.')
        if (r.memberIds.some((id) => !members.has(id))) throw new AuthError('invalid_input', 'One of the people chosen isn’t in the team any more.')
        if (r.enabled && r.roles.length === 0 && r.memberIds.length === 0) throw new AuthError('invalid_input', `${ALERT_NAME[r.key]}: choose who gets it, or turn it off.`)
        if (r.threshold !== undefined && (!Number.isInteger(r.threshold) || r.threshold < 1 || r.threshold > (r.key === 'usage_threshold' ? 100 : 240)))
          throw new AuthError('invalid_input', `${ALERT_NAME[r.key]}: ${r.key === 'usage_threshold' ? 'a percentage from 1 to 100' : 'minutes from 1 to 240'}.`)
      }
      if (input.quietHours.enabled && (!time.test(input.quietHours.from) || !time.test(input.quietHours.to))) throw new AuthError('invalid_input', 'Quiet hours: write times like 21:00.')
      d.alerts = { rules: input.rules.map((r) => ({ ...r, roles: [...r.roles], memberIds: [...r.memberIds] })), quietHours: { ...input.quietHours }, updatedAt: new Date().toISOString(), updatedBy: by() }
      log(o, 'settings', 'Changed who gets the organisation’s alerts')
      keep()
      return copy(d.alerts)
    },

    async getOrgSettings(o) {
      await wait()
      allowPerm(o, 'settings.manage', 'see the organisation’s settings')
      return copy(org(o).settings)
    },

    async updateOrgSettings(o, input) {
      await wait()
      allowPerm(o, 'settings.manage', 'change the organisation’s settings')
      const d = org(o)
      // Check everything first: a refused change changes nothing.
      const name = input.name.trim()
      const city = input.city.trim()
      if (name.length < 3 || name.length > 120) throw new AuthError('invalid_input', 'Give the organisation a name of 3 to 120 characters.')
      if (city.length < 2 || city.length > 80) throw new AuthError('invalid_input', 'Give the city, e.g. Coimbatore.')
      const languages = [...new Set(input.languages)].filter((l) => l in LANGUAGE_LABEL)
      if (languages.length === 0) throw new AuthError('invalid_input', 'Choose at least one language callers use.')
      if (input.hours.length !== 7) throw new AuthError('invalid_input', 'Give hours for each day of the week.')
      const time = /^([01]\d|2[0-3]):[0-5]\d$/
      for (const h of input.hours) {
        if (h.open && (!time.test(h.from) || !time.test(h.to) || h.from >= h.to)) throw new AuthError('invalid_input', 'Each open day needs an opening time before its closing time.')
      }
      const closed = input.closed.map((c) => ({ date: c.date, label: c.label.trim() }))
      for (const c of closed) {
        const t = Date.parse(`${c.date}T00:00:00Z`)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== c.date) throw new AuthError('invalid_input', 'Each closed day needs a real date.')
        if (!c.label || c.label.length > 40) throw new AuthError('invalid_input', 'Name each closed day in up to 40 characters, e.g. Pongal.')
      }
      if (new Set(closed.map((c) => c.date)).size !== closed.length) throw new AuthError('invalid_input', 'A date is listed twice.')
      if (closed.length > 60) throw new AuthError('invalid_input', 'List up to 60 closed days.')

      const was = d.settings
      const said: string[] = []
      if (name !== was.name) said.push(`Renamed the organisation to ${name}`)
      if (city !== was.city) said.push(`Changed the city to ${city}`)
      if (languages.slice().sort().join() !== was.languages.slice().sort().join()) said.push(`Changed the languages to ${languages.map((l) => LANGUAGE_LABEL[l]).join(', ')}`)
      if (JSON.stringify(input.hours) !== JSON.stringify(was.hours)) said.push('Changed the business hours')
      for (const c of closed) if (!was.closed.some((x) => x.date === c.date)) said.push(`Added the closed day ${c.label}`)
      for (const c of was.closed) if (!closed.some((x) => x.date === c.date)) said.push(`Removed the closed day ${c.label}`)
      d.settings = {
        name,
        city,
        languages,
        hours: input.hours.map((h) => ({ open: h.open, from: h.from, to: h.to })),
        closed: closed.sort((a, b) => a.date.localeCompare(b.date)),
        updatedAt: said.length ? new Date().toISOString() : was.updatedAt,
        updatedBy: said.length ? by() : was.updatedBy,
      }
      for (const t of said) log(o, 'settings', t)
      keep()
      return copy(d.settings)
    },

    async getBilling(o) {
      await wait()
      // bitNtech's master admin manages every organisation's billing.
      if (!master()) allow(o, ['owner'], 'see billing')
      return billingOf(o)
    },

    async changePlan(o, planId) {
      await wait()
      if (!master()) allow(o, ['owner'], 'change the plan')
      const d = org(o)
      const b = d.billing
      if (planId === null) {
        if (!b.pendingPlan) return billingOf(o)
        log(o, 'billing', `Cancelled the move to ${currentPlans().find((p) => p.id === b.pendingPlan)!.name}`)
        b.pendingPlan = null
        keep()
        return billingOf(o)
      }
      const next = currentPlans().find((p) => p.id === planId)
      if (!next) throw new AuthError('invalid_input', 'Choose a plan.')
      const now = currentPlans().find((p) => p.id === b.plan)!
      if (next.id === now.id) {
        b.pendingPlan = null
        keep()
        return billingOf(o)
      }
      if (next.price > now.price) {
        b.plan = next.id
        b.pendingPlan = null
        log(o, 'billing', `Changed the plan from ${now.name} to ${next.name}`)
      } else {
        const agents = d.agents.length
        const numbers = d.numbers.length
        if (agents > next.agents) throw new AuthError('invalid_input', `${next.name} allows ${next.agents} ${next.agents === 1 ? 'agent' : 'agents'} and you have ${agents}. Delete some first.`)
        if (numbers > next.numbers) throw new AuthError('invalid_input', `${next.name} allows ${next.numbers} ${next.numbers === 1 ? 'number' : 'numbers'} and you have ${numbers}. Ask bitNtech to release some first.`)
        b.pendingPlan = next.id
        log(o, 'billing', `Chose to move from ${now.name} to ${next.name} at renewal`)
      }
      keep()
      return billingOf(o)
    },

    async updateBillingDetails(o, input) {
      await wait()
      if (!master()) allow(o, ['owner'], 'change billing details')
      const legalName = input.legalName.trim()
      const email = input.email.trim().toLowerCase()
      const gstin = input.gstin.trim().toUpperCase()
      if (legalName.length < 2 || legalName.length > 120) throw new AuthError('invalid_input', 'Give the name invoices are made out to.')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new AuthError('invalid_input', 'Enter the email invoices go to, like accounts@hospital.in.')
      if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new AuthError('invalid_input', 'A GST number has 15 characters, like 33AABCA1234F1Z5. Leave it empty if you don’t have one.')
      const d = org(o)
      d.billing.details = { legalName, email, gstin }
      log(o, 'billing', 'Changed the billing details')
      keep()
      return billingOf(o)
    },

    async listLiveCalls(o) {
      await wait()
      // Anyone who may see calls can watch; taking and guiding need calls.take.
      allowPerm(o, ['calls.take', 'calls.viewAll'], 'see live calls')
      return copy(liveOf(o))
    },

    async takeOverCall(o, id) {
      await wait()
      allowPerm(o, 'calls.take', 'take calls')
      const d = org(o)
      const call = liveOf(o).find((c) => c.id === id)
      if (!call) throw new AuthError('invalid_input', 'That call has ended.')
      if (call.takenBy && call.takenBy !== by()) throw new AuthError('invalid_input', `${call.takenBy} has already taken this call.`)
      d.liveTaken[id] = by()
      keep()
      return copy({ ...call, takenBy: by() })
    },

    async listHandoffs(o) {
      await wait()
      allowPerm(o, ['calls.viewAll', 'calls.take'], 'see who is waiting for a person')
      // As the server does: a personal value is blank for someone without calls.personal.
      const personal = !viewer || has(o, 'calls.personal')
      return copy(
        [...org(o).handoffs]
          .sort((a, b) => a.waitingSince.localeCompare(b.waitingSince))
          .map((h) => (personal ? h : { ...h, details: h.details.map((x) => (x.personal ? { ...x, value: '' } : x)) })),
      )
    },

    async takeHandoff(o, id) {
      await wait()
      allowPerm(o, 'calls.take', 'take calls')
      const h = findHandoff(o, id)
      if (h.status === 'taken') throw new AuthError('invalid_input', `${h.takenBy} has already taken this call.`)
      if (h.status === 'missed') throw new AuthError('invalid_input', 'The caller hung up. Make it a callback instead.')
      h.status = 'taken'
      h.takenBy = by()
      h.takenAt = new Date().toISOString()
      // Its call goes to them too.
      org(o).liveTaken[h.callId] = by()
      keep()
      return copy(h)
    },

    async handoffToCallback(o, id) {
      await wait()
      allowPerm(o, 'calls.take', 'make callbacks')
      const d = org(o)
      const h = findHandoff(o, id)
      if (h.status === 'taken') throw new AuthError('invalid_input', `${h.takenBy} has already taken this call.`)
      if (h.status === 'missed') throw new AuthError('invalid_input', 'This caller already has a callback. It’s on the Callbacks page.')
      h.status = 'missed'
      const name = h.details.find((x) => x.label === 'Patient name')?.value ?? null
      const now = new Date().toISOString()
      const cb: Callback = {
        id: newId('cb'),
        callerName: name,
        // The full number: whoever calls back needs it. (The queue shows it
        // masked; a real server has it. The demo makes the hidden part up.)
        callerPhone: `+91 9${h.callerPhone.slice(-5, -1)} ${h.callerPhone.slice(-5)}`,
        reason: h.summary,
        requestedAt: now,
        dueBy: new Date(Date.now() + 2 * 36e5).toISOString(),
        assignedTo: viewer && roleIn(o) ? { id: viewer.id, name: viewer.name } : null,
        status: 'open',
        attempts: 0,
        notes: [],
        callId: h.callId,
      }
      d.callbacks.unshift(cb)
      keep()
      return copy(cb)
    },

    async listCallbacks(o) {
      await wait()
      linkSamples(o)
      const d = org(o)
      // Without "Assign callbacks": theirs, and ones nobody has yet.
      const own = !has(o, 'callbacks.assign')
      return copy(d.callbacks.filter((c) => !own || !c.assignedTo || c.assignedTo.id === viewer?.id))
    },

    async updateCallback(o, id, patch) {
      await wait()
      allowPerm(o, ['calls.take', 'callbacks.assign'], 'change callbacks')
      const d = org(o)
      const c = findCallback(o, id)
      // Without "Assign callbacks": only their own, or one nobody has.
      const own = !has(o, 'callbacks.assign')
      if (own && c.assignedTo && c.assignedTo.id !== viewer?.id)
        throw new AuthError('forbidden', `This callback is ${c.assignedTo.name}’s. Ask a supervisor to move it.`)
      const member = patch.assignedTo ? d.members.find((m) => m.id === patch.assignedTo && m.status === 'active') : null
      if (patch.assignedTo && !member) throw notFound('team member')
      if (member && member.role === 'viewer') throw new AuthError('invalid_input', `${member.name} is a viewer and can’t make calls for the team.`)
      // They can take one for themselves, or give it back (null), as the API allows.
      if (own && patch.assignedTo !== undefined && patch.assignedTo !== null && patch.assignedTo !== viewer?.id)
        throw new AuthError('forbidden', 'You can take callbacks for yourself, not assign them to others.')
      if (patch.note !== undefined && !patch.note.trim() && !patch.attempt) throw new AuthError('invalid_input', 'Write the note first.')

      if (patch.assignedTo !== undefined) c.assignedTo = member ? { id: member.id, name: member.name } : null
      if (patch.reopen) c.status = 'open'
      if (patch.attempt === 'reached') c.status = 'done'
      if (patch.attempt === 'no_answer') {
        c.attempts += 1
        if (c.attempts >= 3) c.status = 'unreachable'
      }
      const text = patch.note?.trim()
      if (text) c.notes.push({ id: newId('note'), by: by(), at: new Date().toISOString(), text })
      keep()
      return copy(c)
    },

    async listAppointments(o, from, to) {
      await wait()
      linkSamples(o)
      // Demo data saved before the statuses changed is read the new way.
      const d = org(o)
      d.appointments = d.appointments.map(fromRecord)
      const s = (d.booking ??= seedBookingSettings())
      incoming(o)
      refreshRanks(d.appointments)
      for (const a of d.appointments) advanceUpdates(a, s)
      return copy(d.appointments.filter((a) => a.date >= from && a.date <= to).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)))
    },

    async updateAppointment(o, id, patch) {
      await wait()
      allowPerm(o, 'appointments.manage', 'change appointments')
      const d = org(o)
      const i = d.appointments.findIndex((x) => x.id === id)
      if (i < 0) throw notFound('appointment')
      const a = fromRecord(d.appointments[i])
      // A real date, not just the right shape (no 31 February).
      if (patch.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) throw new AuthError('invalid_input', 'Choose a date.')
      if (patch.date !== undefined && new Date(`${patch.date}T12:00:00`).toISOString().slice(0, 10) !== patch.date) throw new AuthError('invalid_input', 'Choose a real date.')
      if (patch.time !== undefined && !/^\d{2}:\d{2}$/.test(patch.time)) throw new AuthError('invalid_input', 'Choose a time.')
      const reason = patch.changeReason?.trim() ?? ''
      if (reason.length > 300) throw new AuthError('invalid_input', 'Keep the reason under 300 characters.')
      const now = new Date().toISOString()
      const change = (kind: AppointmentChange['kind'], text: string, why?: string) => (a.history = [{ at: now, by: by(), kind, text, ...(why ? { reason: why } : {}) }, ...(a.history ?? [])])
      const slot = (x: Pick<Appointment, 'date' | 'time' | 'doctor'>) => `${new Date(`${x.date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${x.time} with ${x.doctor}`

      const s = (d.booking ??= seedBookingSettings())
      if (patch.undo) {
        // Undo puts back exactly what was there, and stops any message to the patient that hasn't gone yet.
        const was = slot(a)
        for (const k of ['status', 'date', 'time', 'doctor', 'department', 'note', 'type', 'visitReason'] as const) if (patch[k] !== undefined) (a as unknown as Record<string, unknown>)[k] = patch[k]
        if (a.status !== 'cancelled') delete a.cancelReason
        if (a.status !== 'declined') delete a.declineReason
        if (a.status !== 'confirmed' && a.status !== 'completed' && a.status !== 'no_show') delete a.confirmedBy
        const withdrawn = withdrawQueued(a)
        change('undone', `${slot(a) === was ? 'Undone' : `Undone: back to ${slot(a)}`}${withdrawn ? '. The patient wasn’t told' : ''}`)
      } else {
        const moving = (patch.date !== undefined && patch.date !== a.date) || (patch.time !== undefined && patch.time !== a.time) || (patch.doctor !== undefined && patch.doctor !== a.doctor)
        const target = patch.status
        const open = isOpen(a)
        const passed = startsAt(a) <= nowKey()
        if (a.status === 'cancelled' && (moving || (target && target !== 'pending'))) throw new AuthError('invalid_input', 'This appointment was cancelled. Book it again first.')
        if (a.status === 'declined' && (moving || (target && target !== 'pending'))) throw new AuthError('invalid_input', 'This request was declined. Book it again first.')
        if (moving) {
          if (!open && a.status !== 'no_show') throw new AuthError('invalid_input', 'Only an appointment still to come, or one that was missed, can be moved.')
          if (reason.length < 3) throw new AuthError('invalid_input', 'Say why it’s being moved. It goes in the history.')
          const from = slot(a)
          if (patch.date !== undefined) a.date = patch.date
          if (patch.time !== undefined) a.time = patch.time
          if (patch.doctor !== undefined) a.doctor = patch.doctor
          if (patch.department !== undefined) a.department = patch.department
          a.status = target === 'confirmed' ? 'confirmed' : 'rescheduled'
          if (a.status === 'confirmed') a.confirmedBy = 'staff'
          change('rescheduled', `Moved from ${from} to ${slot(a)}${a.status === 'confirmed' ? ', confirmed with the patient' : ''}`, reason)
          queueUpdates(a, a.status === 'confirmed' ? 'confirmed' : 'moved', s, now)
        } else if (target && target !== a.status) {
          if (target === 'confirmed') {
            if (a.status !== 'pending' && a.status !== 'rescheduled') throw new AuthError('invalid_input', 'Only a pending or moved appointment can be confirmed.')
            change('confirmed', a.rank && a.rank.of > 1 ? `Confirmed: ranked ${a.rank.position} of ${a.rank.of} for this time` : 'Confirmed')
            a.confirmedBy = 'staff'
            queueUpdates(a, 'confirmed', s, now)
          } else if (target === 'declined') {
            if (a.status !== 'pending' && a.status !== 'rescheduled') throw new AuthError('invalid_input', 'Only a request still waiting can be declined.')
            if (reason.length < 3) throw new AuthError('invalid_input', 'Say why it’s declined. The agent tells the patient.')
            a.declineReason = reason
            change('declined', 'Declined', reason)
            queueUpdates(a, 'declined', s, now)
          } else if (target === 'cancelled') {
            if (!open) throw new AuthError('invalid_input', 'Only an appointment still to come can be cancelled.')
            if (reason.length < 3) throw new AuthError('invalid_input', 'Say why it’s being cancelled. It goes in the history.')
            a.cancelReason = reason
            change('cancelled', 'Cancelled', reason)
          } else if (target === 'completed' || target === 'no_show') {
            if (!open) throw new AuthError('invalid_input', 'Only an appointment that was booked can be marked.')
            if (!passed) throw new AuthError('invalid_input', 'Mark it once the appointment time has come.')
            change(target, target === 'completed' ? 'Marked completed' : 'Marked as a no-show')
          } else if (target === 'pending') {
            if (a.status !== 'cancelled' && a.status !== 'no_show' && a.status !== 'declined') throw new AuthError('invalid_input', 'That appointment is already booked.')
            delete a.cancelReason
            delete a.declineReason
            delete a.confirmedBy
            change('restored', a.status === 'cancelled' ? 'Booked again after being cancelled' : a.status === 'declined' ? 'Booked again after being declined' : 'Booked again after a no-show')
          } else {
            throw new AuthError('invalid_input', 'Move the appointment to a new time to reschedule it.')
          }
          a.status = target
        }
        const edits: string[] = []
        if (patch.note !== undefined && (patch.note || undefined) !== a.note) edits.push('the note')
        if (patch.type !== undefined && patch.type !== a.type) edits.push('the type')
        if (patch.visitReason !== undefined && patch.visitReason !== a.visitReason) edits.push('the reason for the visit')
        if (patch.note !== undefined) a.note = patch.note.trim() || undefined
        if (patch.type !== undefined) a.type = patch.type
        if (patch.visitReason !== undefined) a.visitReason = patch.visitReason.trim() || undefined
        if (edits.length) change('edited', `Changed ${edits.join(' and ')}`)
      }
      if (!a.note) delete a.note
      if (!needsCheck(a) || a.status === 'confirmed') delete a.checkReason
      a.updatedAt = now
      a.updatedBy = by()
      d.appointments[i] = a
      keep()
      return copy(a)
    },

    async createAppointment(o, input) {
      await wait()
      allowPerm(o, 'appointments.manage', 'add appointments')
      const name = input.patientName.trim()
      const digits = input.phone.replace(/\D/g, '')
      const doctor = input.doctor.trim()
      const department = input.department.trim()
      if (name.length < 2 || name.length > 80) throw new AuthError('invalid_input', 'Write the patient’s name.')
      if (digits.length < 10 || digits.length > 13) throw new AuthError('invalid_input', 'Write a 10-digit phone number.')
      if (!doctor || !department) throw new AuthError('invalid_input', 'Choose a doctor.')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || new Date(`${input.date}T12:00:00`).toISOString().slice(0, 10) !== input.date) throw new AuthError('invalid_input', 'Choose a real date.')
      if (!/^\d{2}:\d{2}$/.test(input.time)) throw new AuthError('invalid_input', 'Choose a time.')
      if (input.date < localDay(0)) throw new AuthError('invalid_input', 'Choose today or a later day.')
      if (input.visitReason.trim().length > 200) throw new AuthError('invalid_input', 'Keep the reason for the visit under 200 characters.')
      const now = new Date().toISOString()
      const local = digits.slice(-10)
      const history: AppointmentChange[] = [{ at: now, by: by(), kind: 'created', text: input.source === 'front_desk' ? 'Booked on a phone call by the front desk' : 'Entered by hand' }]
      if (input.confirmed) history.unshift({ at: now, by: by(), kind: 'confirmed', text: 'Confirmed with the patient' })
      const a: Appointment = {
        id: `apt_${Date.now().toString(36)}`,
        patientName: name,
        phone: `+91 ${local.slice(0, 5)} ${local.slice(5)}`,
        department,
        doctor,
        date: input.date,
        time: input.time,
        status: input.confirmed ? 'confirmed' : 'pending',
        source: input.source,
        bookedBy: 'staff',
        agentName: null,
        callId: null,
        type: input.type,
        ...(input.visitReason.trim() ? { visitReason: input.visitReason.trim() } : {}),
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        createdAt: now,
        updatedAt: now,
        updatedBy: by(),
        history,
      }
      org(o).appointments.push(a)
      keep()
      return copy(a)
    },

    async getBookingSettings(o) {
      await wait()
      allowPerm(o, ['appointments.manage', 'calls.viewAll'], 'see the booking settings')
      return copy((org(o).booking ??= seedBookingSettings()))
    },

    async updateBookingSettings(o, input) {
      await wait()
      allowPerm(o, 'settings.manage', 'change the booking settings')
      if (input.confirm !== 'staff' && input.confirm !== 'auto') throw new AuthError('invalid_input', 'Choose how requests are confirmed.')
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.autoAt)) throw new AuthError('invalid_input', 'Choose a time for the automatic confirmation.')
      if (input.others !== 'offer' && input.others !== 'decline') throw new AuthError('invalid_input', 'Choose what happens to the other requests.')
      const d = org(o)
      d.booking = {
        confirm: input.confirm,
        autoAt: input.autoAt,
        autoSkipUrgent: !!input.autoSkipUrgent,
        autoSkipFlagged: !!input.autoSkipFlagged,
        others: input.others,
        callback: !!input.callback,
        whatsapp: !!input.whatsapp,
        retryCallback: !!input.retryCallback,
        updatedAt: new Date().toISOString(),
        updatedBy: by(),
      }
      keep()
      return copy(d.booking)
    },

    async runAutoConfirm(o) {
      await wait()
      allowPerm(o, 'appointments.manage', 'confirm requests')
      const d = org(o)
      const s = (d.booking ??= seedBookingSettings())
      if (s.confirm !== 'auto') throw new AuthError('invalid_input', 'Automatic confirmation is off. Turn it on in Booking settings first.')
      d.appointments = d.appointments.map(fromRecord)
      const result = runAuto(d.appointments, s)
      keep()
      return result
    },

    async retryPatientUpdate(o, id, updateId) {
      await wait()
      allowPerm(o, 'appointments.manage', 'send updates to patients')
      const d = org(o)
      const a = d.appointments.find((x) => x.id === id)
      const u = a?.updates?.find((x) => x.id === updateId)
      if (!a || !u) throw notFound('update')
      if (u.state !== 'failed' && u.state !== 'no_answer') throw new AuthError('invalid_input', 'That update didn’t fail: there is nothing to send again.')
      const now = new Date().toISOString()
      Object.assign(u, { state: 'queued', at: now, updatedAt: now, attempts: u.attempts + 1, detail: undefined })
      a.history = [{ at: now, by: by(), kind: 'notified', text: u.channel === 'callback' ? 'Asked the agent to call the patient again' : 'Sent the WhatsApp message again' }, ...(a.history ?? [])]
      keep()
      return copy(a)
    },

    async listCallLog(o, q) {
      await wait()
      const all = callLog(logContext(o), q.days)
      const own = !has(o, 'calls.viewAll')
      const text = q.q?.trim().toLowerCase()
      const digits = text?.replace(/\D/g, '')
      const hits = all.filter(
        (c) =>
          (!own || c.handledBy === viewer?.name) &&
          (!q.agentId || c.agentId === q.agentId) &&
          (!q.outcome || c.outcome === q.outcome) &&
          (!text ||
            // Viewers can't search by the caller's name: they don't see it.
            [c.intent, c.agentName, has(o, 'calls.personal') ? (c.callerName ?? '') : ''].some((v) => v.toLowerCase().includes(text)) ||
            (digits && digits.length >= 3 && c.callerPhone.replace(/\D/g, '').includes(digits))),
      )
      return copy({ calls: hits.slice(0, q.limit ?? 50), total: hits.length })
    },

    async getCallRecord(o, id) {
      await wait()
      const s = findCall(o, id)
      if (!s) throw notFound('call')
      const rec = callRecord(s)
      if (!has(o, 'calls.viewAll') && rec.handledById !== viewer?.id) throw new AuthError('forbidden', 'You can open the calls you handled.')
      return copy({ ...rec, notes: org(o).callNotes[id] ?? [] })
    },

    async addCallNote(o, callId, text) {
      await wait()
      const t = text.trim()
      if (!t) throw new AuthError('invalid_input', 'Write the note first.')
      if (t.length > 1000) throw new AuthError('invalid_input', 'Keep notes under 1,000 characters.')
      if (roleIn(o) === 'viewer') throw new AuthError('forbidden', 'Viewers can read notes, not add them.')
      const call = findCall(o, callId)
      if (!call) throw notFound('call')
      if (!has(o, 'calls.viewAll') && callRecord(call).handledById !== viewer?.id) throw new AuthError('forbidden', 'You can add notes to the calls you handled.')
      const d = org(o)
      const note: CallNote = { id: newId('note'), by: by(), at: new Date().toISOString(), text: t }
      ;(d.callNotes[callId] ??= []).push(note)
      keep()
      return copy(note)
    },

    async getReport(o, q) {
      await wait()
      return copy(report(logContext(o), q.days, q.agentId))
    },

    async detectNewFlowPatterns(o, agentId, opts) {
      await wait()
      return copy(patternsForAgent(o, agentId, opts.windowSize))
    },

    async listNewFlowPatterns(o, opts) {
      await wait()
      return copy(org(o).agents.flatMap((a) => patternsForAgent(o, a.id, opts.windowSize)))
    },

    // ---- requests to bitNtech

    async listChangeRequests(o) {
      await wait()
      if (viewer && !viewer.platformRole) allowPerm(o, ['requests.create', 'agents.view'], 'see requests to bitNtech')
      return copy(org(o).requests)
    },

    async createChangeRequest(o, input) {
      await wait()
      if (viewer?.platformRole) throw new AuthError('forbidden', 'Requests come from the organisation. bitNtech replies to them.')
      allowPerm(o, 'requests.create', 'ask bitNtech for changes')
      const title = input.title.trim()
      const detail = input.detail.trim()
      if (!(input.kind in KIND_WORD)) throw new AuthError('invalid_input', 'Choose what you need.')
      if (title.length < 5 || title.length > 120) throw new AuthError('invalid_input', 'Give the request a title of 5 to 120 characters.')
      if (detail.length < 10 || detail.length > 2000) throw new AuthError('invalid_input', 'Describe what you need in 10 to 2,000 characters.')
      if (input.agentId && !org(o).agents.some((a) => a.id === input.agentId)) throw notFound('agent')
      if (input.kind === 'flow_change' && !input.agentId) throw new AuthError('invalid_input', 'Choose the agent whose flow should change.')
      if (!['normal', 'soon', 'urgent'].includes(input.urgency)) throw new AuthError('invalid_input', 'Choose how soon you need it.')
      const r = addRequest(o, { ...input, title, detail })
      keep()
      return copy(r)
    },

    async replyChangeRequest(o, id, text) {
      await wait()
      if (viewer && !master()) allowPerm(o, 'requests.create', 'reply to requests')
      const r = findRequest(o, id)
      const t = text.trim()
      if (!t) throw new AuthError('invalid_input', 'Write the reply first.')
      if (t.length > 1000) throw new AuthError('invalid_input', 'Keep replies under 1,000 characters.')
      if (r.status === 'withdrawn') throw new AuthError('invalid_input', 'This request was withdrawn.')
      const now = new Date().toISOString()
      r.replies.push({ id: newId('crr'), by: by(), byKind: viewer?.platformRole ? 'bitntech' : 'member', at: now, text: t })
      r.updatedAt = now
      keep()
      return copy(r)
    },

    async withdrawChangeRequest(o, id) {
      await wait()
      const r = findRequest(o, id)
      if (viewer && r.createdById !== viewer.id && !has(o, 'team.manage')) throw new AuthError('forbidden', `Only ${r.createdBy} or someone who manages the team can withdraw this.`)
      if (r.status !== 'open' && r.status !== 'in_progress') throw new AuthError('invalid_input', 'Only open requests can be withdrawn.')
      r.status = 'withdrawn'
      r.updatedAt = new Date().toISOString()
      unlockDraft(o, r)
      log(o, 'agents', `Withdrew the request “${r.title}”`)
      keep()
      return copy(r)
    },

    async updateChangeRequest(o, id, patch) {
      await wait()
      if (viewer && !master()) throw new AuthError('forbidden', 'Only bitNtech’s master admin can move requests on.')
      const r = findRequest(o, id)
      if (r.status === 'withdrawn') throw new AuthError('invalid_input', 'This request was withdrawn.')
      const reply = patch.reply?.trim()
      if (patch.status === 'declined' && !reply) throw new AuthError('invalid_input', 'Say why it’s declined. The organisation sees your reply.')
      if (reply && reply.length > 1000) throw new AuthError('invalid_input', 'Keep replies under 1,000 characters.')
      const now = new Date().toISOString()
      if (reply) r.replies.push({ id: newId('crr'), by: by(), byKind: 'bitntech', at: now, text: reply })
      if (patch.status && patch.status !== r.status) {
        r.status = patch.status
        // Declined: the organisation can change its draft and send it again.
        if (patch.status === 'declined') unlockDraft(o, r)
        const word = { open: 'reopened', in_progress: 'started on', done: 'finished', declined: 'declined' }[patch.status]
        log(o, 'agents', `bitNtech ${word} the request “${r.title}”`, reply)
      }
      r.updatedAt = now
      keep()
      return copy(r)
    },

    // ---- bot desk

    async getDesk(o) {
      await wait()
      allowPerm(o, ['desk.bot', 'desk.notices'], 'open the bot desk')
      const out = desk(o)
      keep()
      return out
    },

    async setLineMode(o, numberId, change) {
      await wait()
      allowPerm(o, 'desk.bot', 'switch lines to staff')
      const d = org(o)
      const n = d.numbers.find((x) => x.id === numberId)
      if (!n) throw notFound('phone number')
      if (change.mode === 'agent') {
        if (staffMode(o, numberId)) log(o, 'agents', `Gave ${n.label} (${n.number}) back to the agent`)
        delete d.lineModes[numberId]
      } else {
        if (!n.agentId) throw new AuthError('invalid_input', 'No agent answers this line, so its calls already go to your team.')
        if (!n.transferTo) throw new AuthError('invalid_input', `Say where ${n.label}’s calls go first: Phone numbers → ${n.label} → handovers.`)
        const until = change.until ?? null
        if (until && Date.parse(until) <= Date.now()) throw new AuthError('invalid_input', 'Choose a time later than now.')
        const reason = change.reason?.trim() ?? ''
        if (reason.length > 120) throw new AuthError('invalid_input', 'Keep the reason under 120 characters.')
        d.lineModes[numberId] = { until, reason, by: by() }
        log(o, 'agents', `Sent ${n.label} (${n.number}) to staff`, reason || undefined)
      }
      const out = desk(o)
      keep()
      return out
    },

    async saveNotice(o, input) {
      await wait()
      allowPerm(o, 'desk.notices', 'post notices')
      const d = org(o)
      const text = input.text.trim()
      if (text.length < 5 || text.length > 300) throw new AuthError('invalid_input', 'Write the notice in 5 to 300 characters.')
      if (Number.isNaN(Date.parse(input.from)) || Number.isNaN(Date.parse(input.until))) throw new AuthError('invalid_input', 'Choose when the notice starts and ends.')
      if (input.until <= input.from) throw new AuthError('invalid_input', 'The notice must end after it starts.')
      if (Date.parse(input.until) <= Date.now()) throw new AuthError('invalid_input', 'Choose an end later than now.')
      if (Date.parse(input.until) - Date.parse(input.from) > 31 * DAY) throw new AuthError('invalid_input', 'Notices last up to 31 days. For longer, add it to Knowledge.')
      if (input.agentId && !d.agents.some((a) => a.id === input.agentId)) throw notFound('agent')
      const existing = input.id ? d.notices.find((x) => x.id === input.id) : null
      if (input.id && !existing) throw notFound('notice')
      const n: Notice = { id: existing?.id ?? newId('ntc'), text, agentId: input.agentId, from: input.from, until: input.until, createdBy: existing?.createdBy ?? by(), createdAt: existing?.createdAt ?? new Date().toISOString() }
      d.notices = [...d.notices.filter((x) => x.id !== n.id), n]
      log(o, 'agents', `${existing ? 'Changed' : 'Posted'} a notice: “${text.length > 60 ? `${text.slice(0, 57)}…` : text}”`)
      const out = desk(o)
      keep()
      return out
    },

    async removeNotice(o, id) {
      await wait()
      allowPerm(o, 'desk.notices', 'remove notices')
      const d = org(o)
      const n = d.notices.find((x) => x.id === id)
      if (!n) throw notFound('notice')
      d.notices = d.notices.filter((x) => x.id !== id)
      log(o, 'agents', 'Took down a notice', n.text)
      const out = desk(o)
      keep()
      return out
    },

    async saveDoctorChange(o, input) {
      await wait()
      allowPerm(o, 'desk.notices', 'change doctor availability')
      const d = org(o)
      const doctor = input.doctor.trim()
      const detail = input.detail.trim()
      if (doctor.length < 3) throw new AuthError('invalid_input', 'Choose the doctor.')
      const t = Date.parse(`${input.date}T00:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== input.date) throw new AuthError('invalid_input', 'Choose a real date.')
      if (input.date < localDay(0)) throw new AuthError('invalid_input', 'Choose today or a later day.')
      if (!['away', 'late', 'moved'].includes(input.kind)) throw new AuthError('invalid_input', 'Choose what changed.')
      if (detail.length > 200) throw new AuthError('invalid_input', 'Keep the detail under 200 characters.')
      if ((input.kind === 'late' || input.kind === 'moved') && !detail) throw new AuthError('invalid_input', input.kind === 'late' ? 'Say from when they’re seeing patients.' : 'Say where they’re seeing patients.')
      const existing = input.id ? d.doctorChanges.find((x) => x.id === input.id) : null
      if (input.id && !existing) throw notFound('doctor change')
      if (d.doctorChanges.some((x) => x.id !== input.id && x.doctor === doctor && x.date === input.date)) throw new AuthError('invalid_input', `${doctor} already has a change that day. Edit that one.`)
      const c: DoctorChange = { id: existing?.id ?? newId('doc'), doctor, department: input.department.trim(), date: input.date, kind: input.kind, detail, createdBy: existing?.createdBy ?? by(), createdAt: existing?.createdAt ?? new Date().toISOString() }
      d.doctorChanges = [...d.doctorChanges.filter((x) => x.id !== c.id), c]
      log(o, 'agents', `Marked ${doctor} ${c.kind === 'away' ? 'away' : c.kind === 'late' ? 'late' : 'in another room'} on ${c.date}`, detail || undefined)
      const out = desk(o)
      keep()
      return out
    },

    async removeDoctorChange(o, id) {
      await wait()
      allowPerm(o, 'desk.notices', 'change doctor availability')
      const d = org(o)
      const c = d.doctorChanges.find((x) => x.id === id)
      if (!c) throw notFound('doctor change')
      d.doctorChanges = d.doctorChanges.filter((x) => x.id !== id)
      log(o, 'agents', `Removed ${c.doctor}’s change on ${c.date}`)
      const out = desk(o)
      keep()
      return out
    },

    async flagAnswer(o, input) {
      await wait()
      if (viewer && (viewer.platformRole || roleIn(o) === 'viewer' || !roleIn(o))) throw new AuthError('forbidden', 'Viewers can read calls, not flag answers.')
      const text = input.text.trim()
      const correction = input.correction.trim()
      if (text.length < 5 || text.length > 300) throw new AuthError('invalid_input', 'Say what the agent got wrong, in 5 to 300 characters.')
      if (correction.length > 300) throw new AuthError('invalid_input', 'Keep the correction under 300 characters.')
      const f: AnswerFlag = { id: newId('flag'), callId: input.callId, agentName: input.agentName, text, correction, by: by(), at: new Date().toISOString(), status: 'open' }
      org(o).flags.unshift(f)
      keep()
      return copy(f)
    },

    async resolveFlag(o, id, resolution) {
      await wait()
      allowPerm(o, ['agents.configure', 'library.knowledge'], 'resolve flagged answers')
      const f = org(o).flags.find((x) => x.id === id)
      if (!f) throw notFound('flagged answer')
      if (resolution.status === 'open') {
        if (f.status === 'open') throw new AuthError('invalid_input', 'This is already open.')
        f.status = 'open'
        delete f.resolution
        log(o, 'agents', 'Reopened a flagged answer')
        const back = desk(o)
        keep()
        return back
      }
      if (f.status !== 'open') throw new AuthError('invalid_input', `${f.resolution?.by ?? 'Someone'} has already dealt with this.`)
      const note = resolution.note.trim()
      if (note.length > 300) throw new AuthError('invalid_input', 'Keep the note under 300 characters.')
      if (resolution.status === 'fixed' && !note) throw new AuthError('invalid_input', 'Say what you changed, so the desk knows.')
      f.status = resolution.status
      f.resolution = { by: by(), at: new Date().toISOString(), note }
      log(o, 'agents', `${resolution.status === 'fixed' ? 'Fixed' : 'Dismissed'} a flagged answer`, note || undefined)
      const out = desk(o)
      keep()
      return out
    },

    // ---- live call monitoring

    async whisperToAgent(o, id, text) {
      await wait()
      allowPerm(o, 'calls.take', 'guide the agent')
      const call = findLive(o, id)
      const t = text.trim()
      if (!t) throw new AuthError('invalid_input', 'Write what the agent should know.')
      if (t.length > 200) throw new AuthError('invalid_input', 'Keep it under 200 characters: the agent reads it mid-call.')
      if (call.takenBy) throw new AuthError('invalid_input', `${call.takenBy} has taken this call, so the agent is no longer on it.`)
      const d = org(o)
      ;(d.live.whispers[id] ??= []).push({ by: by(), at: new Date().toISOString(), text: t })
      keep()
      return copy(findLive(o, id))
    },

    async transferCall(o, id, to, warm) {
      await wait()
      allowPerm(o, 'calls.take', 'transfer calls')
      const call = findLive(o, id)
      const d = org(o)
      const m = d.members.find((x) => x.id === to && x.status === 'active')
      if (!m) throw notFound('team member')
      if (m.role === 'viewer') throw new AuthError('invalid_input', `${m.name} is a viewer and doesn’t take calls.`)
      if (call.takenBy && call.takenBy !== by()) throw new AuthError('invalid_input', `${call.takenBy} has already taken this call.`)
      d.liveTaken[id] = m.name
      d.live.transfers[id] = { name: m.name, warm }
      keep()
      return copy(findLive(o, id))
    },

    // ---- test scenarios

    async listScenarios(o, agentId) {
      await wait()
      allowPerm(o, ['agents.test', 'agents.view'], 'see test scenarios')
      const out = copy(scenariosOf(o, agentId))
      keep()
      return out
    },

    async saveScenario(o, agentId, input) {
      await wait()
      allowPerm(o, 'agents.test', 'change test scenarios')
      const list = scenariosOf(o, agentId)
      const name = input.name.trim()
      const lines = input.callerSays.map((l) => l.trim()).filter(Boolean)
      if (name.length < 3 || name.length > 80) throw new AuthError('invalid_input', 'Give the scenario a name of 3 to 80 characters.')
      if (!lines.length) throw new AuthError('invalid_input', 'Add at least one thing the caller says.')
      if (lines.length > 10) throw new AuthError('invalid_input', 'Keep scenarios to 10 lines or fewer.')
      if (list.some((x) => x.id !== input.id && x.name.toLowerCase() === name.toLowerCase())) throw new AuthError('invalid_input', `There’s already a scenario called “${name}”.`)
      const existing = input.id ? list.find((x) => x.id === input.id) : null
      if (input.id && !existing) throw notFound('scenario')
      const sc: Scenario = {
        id: existing?.id ?? newId('scn'),
        name,
        callerSays: lines,
        expect: { intent: input.expect.intent.trim(), mustSay: input.expect.mustSay.map((w) => w.trim()).filter(Boolean), handover: input.expect.handover },
        // Changed, so the last run no longer applies.
        lastRun: null,
      }
      org(o).scenarios[agentId] = existing ? list.map((x) => (x.id === sc.id ? sc : x)) : [...list, sc]
      keep()
      return copy(sc)
    },

    async deleteScenario(o, agentId, id) {
      await wait()
      allowPerm(o, 'agents.test', 'change test scenarios')
      const list = scenariosOf(o, agentId)
      if (!list.some((x) => x.id === id)) throw notFound('scenario')
      org(o).scenarios[agentId] = list.filter((x) => x.id !== id)
      keep()
    },

    async runScenarios(o, agentId) {
      await wait()
      allowPerm(o, 'agents.test', 'run test scenarios')
      const d = org(o)
      const r = recordOf(o, agentId)
      const list = scenariosOf(o, agentId)
      const version = r.changed ? null : (findAgent(o, agentId).version ?? null)
      for (const sc of list) sc.lastRun = runScenario(sc, r.working, d.tools, d.knowledge, version)
      keep()
      return copy(list)
    },

    async setPermissions(o, id, permissions) {
      await wait()
      allowPerm(o, 'team.manage', 'manage the team')
      const m = findMember(o, id)
      if (viewer && m.id === viewer.id) throw new AuthError('forbidden', 'You can’t change your own permissions. Ask another owner or admin.')
      if (m.role === 'owner' && roleIn(o) !== 'owner' && viewer) throw new AuthError('forbidden', 'Only an owner can change an owner’s permissions.')
      const next = permissions ? permissionsFor(m.role, permissions) : null
      const same = (a: string[] | null, b: string[] | null) => JSON.stringify(a ? [...a].sort() : null) === JSON.stringify(b ? [...b].sort() : null)
      // Exactly the defaults is the same as no change.
      const stored = next && same(next, permissionsFor(m.role)) ? null : next
      if (same(stored, m.permissions)) return copy(m)
      m.permissions = stored
      // Callbacks they can no longer take go back to nobody.
      if (!permissionsFor(m.role, stored).includes('calls.take')) freeCallbacks(o, m.id)
      log(o, 'team', stored ? `Changed what ${m.name} can do` : `Gave ${m.name} the ${ROLE_LABEL[m.role].toLowerCase()} defaults again`)
      keep()
      return copy(m)
    },
  }
}
