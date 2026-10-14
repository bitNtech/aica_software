import { AuthError } from '../auth/types'
import type {
  AgentDetail,
  AgentDraft,
  AgentSpec,
  AgentSummary,
  AgentTool,
  AgentVersion,
  Appointment,
  Callback,
  CallNote,
  ConsoleClient,
  Credential,
  Handoff,
  Member,
  Viewer,
  FlowNode,
  KnowledgeSource,
  PhoneNumber,
  SourceCall,
  SourceCallStatus,
} from './types'
import { seedAgents } from './demo/agents'
import { seedCalls, topicFor, transcriptFor } from './demo/calls'
import { defaultGlobalFlows, extractAttributes, extractFlow } from './demo/extraction'
import { seedKnowledge, seedNumbers, seedTools } from './demo/library'
import { copy, DAY, makeWait, newId } from './demo/runtime'
import { seedDetail, specFromDraft } from './demo/specs'
import { passagesOf, search, seedCredentials } from './demo/passages'
import { callLog, callRecord, liveCalls, report, seedAppointments, seedCallbacks, seedHandoffs, seedMembers, type LogContext, type Pauses } from './demo/operations'
import { checkTool } from './toolRules'
import { AGENT_TYPES, defaultBehaviour, VOICES } from './demo/templates'

/**
 * Sample data for the organisation console until the real API exists. No
 * request leaves the browser. Each organisation's data is seeded on first
 * use and kept in this browser tab (sessionStorage), so a reload keeps a
 * half-built agent; closing the tab or signing out starts afresh. The UI
 * labels all of it "Demo data".
 */

/** Bump when the stored shape changes, so old tabs start from fresh seeds. */
const STORE_KEY = 'aica.demo.console.v7'

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
  /** Notes people added to past calls, by call id. */
  callNotes: Record<string, CallNote[]>
  /** Live calls someone took over: id → their name. */
  liveTaken: Record<string, string>
  /** When each agent was paused, so the call log has no calls then. */
  pauses: Pauses
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
    appointments: seedAppointments(slug),
    callNotes: {},
    liveTaken: {},
    // The sample lab agent was paused 9 days ago.
    pauses: Object.fromEntries(seedAgents(slug).filter((a) => a.status === 'paused').map((a) => [a.id, [{ from: Date.now() - 9 * DAY, to: null }]])),
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

  const subTypeOf = (dr: AgentDraft) => AGENT_TYPES.find((t) => t.id === dr.typeId)?.subTypes.find((s) => s.id === dr.subTypeId)

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
  })

  const findAgent = (o: string, id: string) => {
    const a = org(o).agents.find((x) => x.id === id)
    if (!a) throw notFound('agent')
    return a
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
    return copy({ agent: { ...findAgent(o, id), hasChanges: r.changed }, working: r.working, versions: r.versions })
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

  /** The roles that handle calls (Live calls, Handoffs, Callbacks, Appointments). */
  const HANDLERS = ['owner', 'admin', 'supervisor', 'front_desk']
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

  const logContext = (o: string): LogContext => {
    const d = org(o)
    return { orgSlug: o, paused: new Set(d.agents.filter((a) => a.status === 'paused').map((a) => a.id)), pauses: d.pauses }
  }
  const findCallback = (o: string, id: string) => {
    const c = org(o).callbacks.find((x) => x.id === id)
    if (!c) throw notFound('callback')
    return c
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
      return copy([...d.agents.map((a) => ({ ...a, callsThisWeek: calls(a.id), hasChanges: !!d.details[a.id]?.changed })), ...d.drafts.map(draftSummary)])
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
      return copy(AGENT_TYPES)
    },

    async listVoices() {
      await wait()
      return copy(VOICES)
    },

    async createDraft(o, orgName) {
      await wait()
      const dr: AgentDraft = {
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
        updatedAt: new Date().toISOString(),
      }
      org(o).drafts.push(dr)
      keep()
      return copy(dr)
    },

    async getDraft(o, id) {
      await wait()
      return copy(findDraft(o, id))
    },

    async saveDraft(o, draft) {
      await wait()
      const d = org(o)
      const i = d.drafts.findIndex((x) => x.id === draft.id)
      if (i < 0) throw notFound('draft')
      d.drafts[i] = { ...copy(draft), updatedAt: new Date().toISOString() }
      keep()
      return copy(d.drafts[i])
    },

    async discardDraft(o, id) {
      await wait()
      findDraft(o, id)
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
      const calls = d.calls.filter((c) => dr.sourceCallIds.includes(c.id) && c.status === 'ready')
      if (!calls.length) throw new AuthError('invalid_input', 'None of the chosen calls is ready. Go back to step 1 and choose ready calls.')
      dr.flow = extractFlow(dr.subTypeId, dr.typeId, calls)
      dr.attributes = extractAttributes(dr.subTypeId)
      dr.globalFlows = defaultGlobalFlows()
      dr.extraction = { at: new Date().toISOString(), callIds: calls.map((c) => c.id), subTypeId: dr.subTypeId }
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
      const d = org(o)
      const done = d.published[id] && d.agents.find((a) => a.id === d.published[id])
      if (done) return copy(done)
      const dr = findDraft(o, id)
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
      }
      d.agents.push(agent)
      const spec = specFromDraft(copy(dr))
      d.details[agentId] = { working: copy(spec), versions: [{ version: 1, publishedAt: now, publishedBy: by(), note: 'First version, from the builder.', spec }], changed: false }
      d.drafts = d.drafts.filter((x) => x.id !== id)
      d.published[id] = agentId
      if (number) number.agentId = agentId
      syncUsage(d, agentId, spec)
      keep()
      return copy(agent)
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
      keep()
      return copy(k)
    },

    async updateKnowledge(o, id, patch) {
      await wait()
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
      const d = org(o)
      const k = findKnowledge(o, id)
      const users = knowledgeUsers(o, id)
      if (users.length) throw new AuthError('invalid_input', `${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} “${k.name}”. Take it out of ${users.length === 1 ? 'that agent' : 'those agents'} first.`)
      d.knowledge = d.knowledge.filter((x) => x.id !== id)
      delete d.indexing[id]
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
      keep()
      return copy({ ...next, usedBy: toolUsers(o, next.id) })
    },

    async deleteTool(o, id) {
      await wait()
      const d = org(o)
      const t = findTool(o, id)
      if (t.kind === 'builtin') throw new AuthError('invalid_input', 'Built-in tools can be switched off, not deleted.')
      const users = toolUsers(o, id)
      if (users.length) throw new AuthError('invalid_input', `${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} “${t.name}”. Take it out of ${users.length === 1 ? 'that agent' : 'those agents'} first.`)
      d.tools = d.tools.filter((x) => x.id !== id)
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
      const d = org(o)
      const key = name.trim().toUpperCase()
      if (!/^[A-Z][A-Z0-9_]{2,39}$/.test(key)) throw new AuthError('invalid_input', 'Use 3 to 40 capital letters, digits and underscores, starting with a letter, e.g. HIS_API_KEY.')
      if (!value.trim()) throw new AuthError('invalid_input', 'Paste the secret’s value.')
      // The demo keeps only that it was set, never the value.
      const c: Credential = { name: key, setAt: new Date().toISOString(), setBy: by() }
      d.credentials = [...d.credentials.filter((x) => x.name !== key), c].sort((a, b) => a.name.localeCompare(b.name))
      keep()
      return copy(c)
    },

    async deleteCredential(o, name) {
      await wait()
      const d = org(o)
      const users = d.tools.filter((t) => t.credentialName === name)
      if (users.length) throw new AuthError('invalid_input', `${users.map((t) => `“${t.name}”`).join(', ')} ${users.length === 1 ? 'uses' : 'use'} ${name}. Change ${users.length === 1 ? 'that tool' : 'those tools'} first.`)
      d.credentials = d.credentials.filter((c) => c.name !== name)
      keep()
    },

    async listNumbers(o) {
      await wait()
      return copy(org(o).numbers)
    },

    async updateNumber(o, id, patch) {
      await wait()
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
      org(o)
      if (note.length > 500) throw new AuthError('invalid_input', 'Keep the note under 500 characters.')
    },

    async getAgent(o, id) {
      await wait()
      const out = detail(o, id)
      keep()
      return out
    },

    async saveAgent(o, id, working) {
      await wait()
      const r = recordOf(o, id)
      r.working = copy(working)
      r.changed = JSON.stringify(working) !== JSON.stringify(r.versions[0]?.spec)
      findAgent(o, id).updatedAt = new Date().toISOString()
      keep()
      return detail(o, id)
    },

    async publishAgent(o, id, note) {
      await wait()
      const r = recordOf(o, id)
      if (!r.changed) throw new AuthError('invalid_input', 'There are no unpublished changes to publish.')
      release(o, id, r.working, note.trim() || 'No note.')
      keep()
      return detail(o, id)
    },

    async discardAgentChanges(o, id) {
      await wait()
      const r = recordOf(o, id)
      r.working = copy(r.versions[0].spec)
      r.changed = false
      keep()
      return detail(o, id)
    },

    async rollbackAgent(o, id, version) {
      await wait()
      const v = recordOf(o, id).versions.find((x) => x.version === version)
      if (!v) throw notFound('version')
      release(o, id, v.spec, `Went back to version ${version}.`)
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
      const next = patch.numberId ? d.numbers.find((n) => n.id === patch.numberId) : null
      if (patch.numberId && !next) throw notFound('phone number')
      if (next?.agentId && next.agentId !== id) throw new AuthError('invalid_input', `${next.number} already has an agent. Choose a free number.`)
      const number = patch.numberId !== undefined ? (next?.number ?? null) : a.phoneNumber
      if (patch.status === 'live' && !number) throw new AuthError('invalid_input', 'Give the agent a phone number before turning it on.')

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
      keep()
      return detail(o, id)
    },

    async deleteAgent(o, id) {
      await wait()
      const d = org(o)
      findAgent(o, id)
      d.agents = d.agents.filter((x) => x.id !== id)
      for (const n of d.numbers) if (n.agentId === id) n.agentId = null
      syncUsage(d, id, null)
      delete d.details[id]
      keep()
    },

    async listMembers(o) {
      await wait()
      return copy(org(o).members)
    },

    async listLiveCalls(o) {
      await wait()
      allow(o, HANDLERS, 'see live calls')
      const d = org(o)
      return copy(liveCalls(o, d.liveTaken, logContext(o).paused))
    },

    async takeOverCall(o, id) {
      await wait()
      allow(o, HANDLERS, 'take calls')
      const d = org(o)
      const call = liveCalls(o, d.liveTaken, logContext(o).paused).find((c) => c.id === id)
      if (!call) throw new AuthError('invalid_input', 'That call has ended.')
      if (call.takenBy && call.takenBy !== by()) throw new AuthError('invalid_input', `${call.takenBy} has already taken this call.`)
      d.liveTaken[id] = by()
      keep()
      return copy({ ...call, takenBy: by() })
    },

    async listHandoffs(o) {
      await wait()
      allow(o, HANDLERS, 'see the handoff queue')
      return copy([...org(o).handoffs].sort((a, b) => a.waitingSince.localeCompare(b.waitingSince)))
    },

    async takeHandoff(o, id) {
      await wait()
      allow(o, HANDLERS, 'take calls')
      const h = findHandoff(o, id)
      if (h.status === 'taken') throw new AuthError('invalid_input', `${h.takenBy} has already taken this call.`)
      if (h.status === 'missed') throw new AuthError('invalid_input', 'The caller hung up. Make it a callback instead.')
      h.status = 'taken'
      h.takenBy = by()
      h.takenAt = new Date().toISOString()
      keep()
      return copy(h)
    },

    async handoffToCallback(o, id) {
      await wait()
      allow(o, HANDLERS, 'make callbacks')
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
      const d = org(o)
      // Front desk see theirs, and ones nobody has yet.
      const own = roleIn(o) === 'front_desk'
      return copy(d.callbacks.filter((c) => !own || !c.assignedTo || c.assignedTo.id === viewer?.id))
    },

    async updateCallback(o, id, patch) {
      await wait()
      allow(o, HANDLERS, 'change callbacks')
      const d = org(o)
      const c = findCallback(o, id)
      // Front desk change only their own, or take one nobody has.
      if (roleIn(o) === 'front_desk' && c.assignedTo && c.assignedTo.id !== viewer?.id)
        throw new AuthError('forbidden', `This callback is ${c.assignedTo.name}’s. Ask a supervisor to move it.`)
      const member = patch.assignedTo ? d.members.find((m) => m.id === patch.assignedTo && m.status === 'active') : null
      if (patch.assignedTo && !member) throw notFound('team member')
      if (member && member.role === 'viewer') throw new AuthError('invalid_input', `${member.name} is a viewer and can’t make calls for the team.`)
      if (roleIn(o) === 'front_desk' && patch.assignedTo !== undefined && patch.assignedTo !== viewer?.id)
        throw new AuthError('forbidden', 'Front desk can take callbacks for themselves, not assign them to others.')
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
      return copy(org(o).appointments.filter((a) => a.date >= from && a.date <= to).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)))
    },

    async updateAppointment(o, id, patch) {
      await wait()
      allow(o, HANDLERS, 'change appointments')
      const a = org(o).appointments.find((x) => x.id === id)
      if (!a) throw notFound('appointment')
      // A real date, not just the right shape (no 31 February).
      if (patch.date !== undefined && new Date(`${patch.date}T12:00:00`).toISOString().slice(0, 10) !== patch.date) throw new AuthError('invalid_input', 'Choose a real date.')
      if (patch.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) throw new AuthError('invalid_input', 'Choose a date.')
      if (patch.time !== undefined && !/^\d{2}:\d{2}$/.test(patch.time)) throw new AuthError('invalid_input', 'Choose a time.')
      if (a.status === 'cancelled' && patch.status && patch.status !== 'booked') throw new AuthError('invalid_input', 'This appointment was cancelled. Book it again first.')
      Object.assign(a, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
      // An empty note clears it.
      if (a.note === '') delete a.note
      if (patch.status && patch.status !== 'needs_check') delete a.checkReason
      keep()
      return copy(a)
    },

    async listCallLog(o, q) {
      await wait()
      const all = callLog(logContext(o), q.days)
      const own = roleIn(o) === 'front_desk'
      const text = q.q?.trim().toLowerCase()
      const digits = text?.replace(/\D/g, '')
      const hits = all.filter(
        (c) =>
          (!own || c.handledBy === viewer?.name) &&
          (!q.agentId || c.agentId === q.agentId) &&
          (!q.outcome || c.outcome === q.outcome) &&
          (!text ||
            // Viewers can't search by the caller's name: they don't see it.
            [c.intent, c.agentName, roleIn(o) === 'viewer' ? '' : (c.callerName ?? '')].some((v) => v.toLowerCase().includes(text)) ||
            (digits && digits.length >= 3 && c.callerPhone.replace(/\D/g, '').includes(digits))),
      )
      return copy({ calls: hits.slice(0, q.limit ?? 50), total: hits.length })
    },

    async getCallRecord(o, id) {
      await wait()
      const s = findCall(o, id)
      if (!s) throw notFound('call')
      const rec = callRecord(s)
      if (roleIn(o) === 'front_desk' && rec.handledById !== viewer?.id) throw new AuthError('forbidden', 'Front desk can open the calls they handled.')
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
      if (roleIn(o) === 'front_desk' && callRecord(call).handledById !== viewer?.id) throw new AuthError('forbidden', 'Front desk can add notes to the calls they handled.')
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
  }
}
