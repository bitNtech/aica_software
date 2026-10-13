import { AuthError } from '../auth/types'
import type {
  AgentDetail,
  AgentDraft,
  AgentSpec,
  AgentSummary,
  AgentTool,
  AgentVersion,
  ConsoleClient,
  KnowledgeSource,
  PhoneNumber,
  SourceCall,
  SourceCallStatus,
} from './types'
import { seedAgents } from './demo/agents'
import { seedCalls, topicFor, transcriptFor } from './demo/calls'
import { defaultGlobalFlows, extractAttributes, extractFlow } from './demo/extraction'
import { seedKnowledge, seedNumbers, seedTools } from './demo/library'
import { copy, makeWait, newId } from './demo/runtime'
import { seedDetail, specFromDraft } from './demo/specs'
import { AGENT_TYPES, defaultBehaviour, VOICES } from './demo/templates'

/**
 * Sample data for the organisation console until the real API exists. No
 * request leaves the browser. Each organisation's data is seeded on first
 * use and kept in this browser tab (sessionStorage), so a reload keeps a
 * half-built agent; closing the tab or signing out starts afresh. The UI
 * labels all of it "Demo data".
 */

/** Bump when the stored shape changes, so old tabs start from fresh seeds. */
const STORE_KEY = 'aica.demo.console.v4'

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
    r.versions = [{ version: a.version, publishedAt: now, publishedBy: 'You', note, spec: copy(spec) }, ...r.versions].slice(0, KEEP_VERSIONS)
    r.working = copy(spec)
    r.changed = false
    syncUsage(d, id, spec)
  }

  const findDraft = (o: string, id: string) => {
    const dr = org(o).drafts.find((x) => x.id === id)
    if (!dr) throw notFound('draft')
    return dr
  }

  return {
    isDemo: true,

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
      return copy([...d.agents.map((a) => ({ ...a, hasChanges: !!d.details[a.id]?.changed })), ...d.drafts.map(draftSummary)])
    },

    async listCalls(o) {
      await wait()
      const d = org(o)
      refresh(d)
      keep()
      return copy([...d.calls].sort((a, b) => b.addedAt.localeCompare(a.addedAt)))
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
      d.details[agentId] = { working: copy(spec), versions: [{ version: 1, publishedAt: now, publishedBy: 'You', note: 'First version, from the builder.', spec }], changed: false }
      d.drafts = d.drafts.filter((x) => x.id !== id)
      d.published[id] = agentId
      if (number) number.agentId = agentId
      syncUsage(d, agentId, spec)
      keep()
      return copy(agent)
    },

    async listKnowledge(o) {
      await wait()
      return copy(org(o).knowledge)
    },

    async listTools(o) {
      await wait()
      return copy(org(o).tools)
    },

    async listNumbers(o) {
      await wait()
      return copy(org(o).numbers)
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
        if (!number) a.status = 'paused'
      }
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
  }
}
