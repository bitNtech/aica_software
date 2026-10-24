import { request } from '../auth/httpClient'
import { AuthError, type AuthErrorCode } from '../auth/types'
import { apiBase, apiCredentials, apiUrl } from '../lib/api'
import { createDemoConsoleClient } from './demoClient'
import type {
  ActivityPage,
  ActivityQuery,
  AgentDetail,
  AgentDraft,
  AgentSummary,
  AgentTool,
  AgentType,
  Credential,
  KnowledgeSource,
  Passage,
  PhoneNumber,
  Scenario,
  SourceCall,
  ToolTestResult,
  Transcript,
  Voice,
  Appointment,
  Callback,
  CallLogPage,
  CallNote,
  CallRecord,
  ChangeRequest,
  ConsoleClient,
  ConsoleSection,
  Handoff,
  Member,
  NewChangeRequest,
  NewInvite,
  OrgSettings,
  OrgSettingsInput,
  Report,
} from './types'

/** Every section the API serves (docs/backend-workflow.md, Phases 1–3). */
export const ALL_LIVE_SECTIONS: readonly ConsoleSection[] = ['team', 'settings', 'activity', 'requests', 'calls', 'callbacks', 'appointments', 'handoffs', 'reports', 'numbers', 'tools', 'knowledge', 'uploads', 'agents']

/** What's live unless an environment says otherwise. The operations
 * sections (calls, callbacks, appointments, handoffs) only fill up once the
 * voice pipeline sends calls, so each environment turns them on itself. */
export const DEFAULT_LIVE_SECTIONS: readonly ConsoleSection[] = ['team', 'settings', 'activity', 'requests']

/** VITE_CONSOLE_LIVE, e.g. "team,settings,activity,requests,calls": the
 * known names in it, or the default when it's empty. Unknown names are
 * ignored, so a typo can't turn anything on. */
export function liveSections(env: string | undefined): ConsoleSection[] {
  const wanted = (env ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!wanted.length) return [...DEFAULT_LIVE_SECTIONS]
  return ALL_LIVE_SECTIONS.filter((s) => wanted.includes(s))
}

/**
 * The console against the AICA API, one section at a time: the sections in
 * `sections` call /api/orgs/{slug}/…, and everything else is still answered
 * by `fallback` (the demo client), whose pages keep their "Demo data" note.
 * The session cookie goes with every call; nothing secret is held in
 * JavaScript. Errors arrive as AuthError with a message for the person
 * using the console, as from the demo client.
 */
export function createHttpConsoleClient(
  base = apiBase(),
  fallback: ConsoleClient = createDemoConsoleClient(),
  sections: readonly ConsoleSection[] = DEFAULT_LIVE_SECTIONS,
): ConsoleClient {
  const get = <T>(path: string) => request<T>(base, 'GET', path)
  const post = <T>(path: string, body?: unknown) => request<T>(base, 'POST', path, body)
  const enc = encodeURIComponent
  const org = (slug: string, path = '') => `/orgs/${enc(slug)}${path}`
  const member = (slug: string, id: string, action: string) => org(slug, `/members/${enc(id)}/${action}`)
  const live = new Set<ConsoleSection>(sections)
  /** A file from the API, e.g. a CSV. Errors arrive as JSON like any other call's. */
  const file = async (path: string): Promise<Blob> => {
    let res: Response
    try {
      res = await fetch(apiUrl(`/api${path}`, base), { credentials: apiCredentials(base) })
    } catch {
      throw new AuthError('network', "We couldn't reach AICA. Check your connection and try again.")
    }
    if (res.ok) return res.blob()
    const err = ((await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null)?.error
    throw new AuthError((err?.code as AuthErrorCode) ?? 'unknown', err?.message ?? 'Something went wrong on our side. Try again in a moment.')
  }
  /** Where and how the browser sends a file straight to storage (backend/app/data/blobs.py). */
  type Upload = { url: string; method: 'PUT'; headers: Record<string, string> }
  const put = async (upload: Upload, body: Blob, name: string) => {
    let res: Response
    try {
      // To the storage bucket, not the API: no cookies.
      res = await fetch(upload.url, { method: upload.method, headers: upload.headers, body })
    } catch {
      throw new AuthError('network', `We couldn't upload ${name}. Check your connection and add it again.`)
    }
    if (!res.ok) throw new AuthError('unknown', `We couldn't upload ${name}. Add it again.`)
  }
  /** Saves carry the revision they were made from, so one tab can't
   * overwrite another's newer save (the server answers "conflict"). */
  const agentRev = new Map<string, number>()
  const draftRev = new Map<string, number>()
  const seen = (d: AgentDetail & { revision?: number }) => {
    if (typeof d.revision === 'number') agentRev.set(d.agent.id, d.revision)
    return d
  }
  const seenDraft = (d: AgentDraft & { revision?: number }) => {
    if (typeof d.revision === 'number') draftRev.set(d.id, d.revision)
    return d
  }
  const NEEDS_PIPELINE = (what: string) => Promise.reject(new AuthError('unknown', `${what} needs the AI pipeline, which isn’t connected yet.`))
  const qs = (params: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ''
  }

  const bySection: Partial<Record<ConsoleSection, Partial<ConsoleClient>>> = {
    team: {
      listMembers: (o) => get<Member[]>(org(o, '/members')),
      inviteMember: (o, invite: NewInvite) => post<Member>(org(o, '/members/invite'), { email: invite.email.trim(), role: invite.role }),
      resendInvite: (o, id) => post<Member>(member(o, id, 'resend')),
      changeRole: (o, id, role) => post<Member>(member(o, id, 'role'), { role }),
      setPermissions: (o, id, permissions) => post<Member>(member(o, id, 'permissions'), { permissions }),
      removeMember: (o, id) => post<void>(member(o, id, 'remove')),
    },
    activity: {
      listActivity: (o, q: ActivityQuery) => get<ActivityPage>(org(o, `/activity${qs({ area: q.area, actorId: q.actorId, before: q.before })}`)),
    },
    settings: {
      getOrgSettings: (o) => get<OrgSettings>(org(o, '/settings')),
      updateOrgSettings: (o, s: OrgSettingsInput) =>
        post<OrgSettings>(org(o, '/settings'), { name: s.name, city: s.city, languages: s.languages, hours: s.hours, closed: s.closed }),
    },
    requests: {
      listChangeRequests: (o) => get<ChangeRequest[]>(org(o, '/requests')),
      createChangeRequest: async (o, input: NewChangeRequest) => {
        // Agents aren't on the server yet (Phase 6): send the name the console shows.
        const agentName = input.agentId ? ((await fallback.listAgents(o).catch(() => [])).find((a) => a.id === input.agentId)?.name ?? null) : null
        return post<ChangeRequest>(org(o, '/requests'), { ...input, agentName })
      },
      requestNumber: (o, note) => post<void>(org(o, '/requests/number'), { note }),
      replyChangeRequest: (o, id, text) => post<ChangeRequest>(org(o, `/requests/${enc(id)}/reply`), { text }),
      withdrawChangeRequest: (o, id) => post<ChangeRequest>(org(o, `/requests/${enc(id)}/withdraw`)),
      updateChangeRequest: (o, id, patch) => post<ChangeRequest>(org(o, `/requests/${enc(id)}/update`), patch),
      listAllChangeRequests: () => get<(ChangeRequest & { orgName: string })[]>('/ops/change-requests'),
    },
    calls: {
      listCallLog: (o, q) => get<CallLogPage>(org(o, `/calls${qs({ days: q.days, agentId: q.agentId, outcome: q.outcome, q: q.q, limit: q.limit })}`)),
      getCallRecord: (o, id) => get<CallRecord>(org(o, `/calls/${enc(id)}`)),
      addCallNote: (o, id, text) => post<CallNote>(org(o, `/calls/${enc(id)}/notes`), { text }),
    },
    callbacks: {
      listCallbacks: (o) => get<Callback[]>(org(o, '/callbacks')),
      updateCallback: (o, id, patch) => post<Callback>(org(o, `/callbacks/${enc(id)}`), patch),
    },
    appointments: {
      listAppointments: (o, from, to) => get<Appointment[]>(org(o, `/appointments${qs({ from, to })}`)),
      updateAppointment: (o, id, patch) => post<Appointment>(org(o, `/appointments/${enc(id)}`), patch),
    },
    reports: {
      getReport: (o, q) => get<Report>(org(o, `/reports${qs({ days: q.days, agentId: q.agentId })}`)),
      exportCallLog: (o, q) => file(org(o, `/reports/calls.csv${qs({ days: q.days, agentId: q.agentId })}`)),
    },
    numbers: {
      listNumbers: (o) => get<PhoneNumber[]>(org(o, '/numbers')),
      updateNumber: (o, id, patch) => post<PhoneNumber>(org(o, `/numbers/${enc(id)}`), patch),
    },
    tools: {
      listTools: (o) => get<AgentTool[]>(org(o, '/tools')),
      saveTool: (o, tool) => post<AgentTool>(org(o, '/tools'), tool),
      deleteTool: (o, id) => post<void>(org(o, `/tools/${enc(id)}/delete`)),
      testTool: (o, id, inputs) => post<ToolTestResult>(org(o, `/tools/${enc(id)}/test`), { inputs }),
      listCredentials: (o) => get<Credential[]>(org(o, '/credentials')),
      setCredential: (o, name, value) => post<Credential>(org(o, '/credentials'), { name, value }),
      deleteCredential: (o, name) => post<void>(org(o, `/credentials/${enc(name)}/delete`)),
    },
    knowledge: {
      listKnowledge: (o) => get<KnowledgeSource[]>(org(o, '/knowledge')),
      addKnowledge: async (o, src) => {
        const { file, ...meta } = src as typeof src & { file?: Blob }
        const r = await post<{ source: KnowledgeSource; upload: Upload | null }>(org(o, '/knowledge'), meta)
        if (!r.upload || !file) return r.source
        try {
          await put(r.upload, file, src.name)
          return await post<KnowledgeSource>(org(o, `/knowledge/${enc(r.source.id)}/uploaded`))
        } catch (err) {
          // Don't leave a source that never got its file (and blocks its own name).
          await post(org(o, `/knowledge/${enc(r.source.id)}/delete`)).catch(() => undefined)
          throw err
        }
      },
      updateKnowledge: (o, id, patch) => post<KnowledgeSource>(org(o, `/knowledge/${enc(id)}`), patch),
      refreshKnowledge: (o, id) => post<KnowledgeSource>(org(o, `/knowledge/${enc(id)}/refresh`)),
      deleteKnowledge: (o, id) => post<void>(org(o, `/knowledge/${enc(id)}/delete`)),
      listPassages: (o, id) => get<Passage[]>(org(o, `/knowledge/${enc(id)}/passages`)),
      searchKnowledge: (o, sourceIds, question) => post<Passage[]>(org(o, '/knowledge/search'), { sourceIds, question }),
    },
    uploads: {
      listCalls: (o) => get<SourceCall[]>(org(o, '/uploads')),
      addRecordings: async (o, files) => {
        const r = await post<{ calls: SourceCall[]; uploads: (Upload & { id: string })[] }>(org(o, '/uploads'), { files: files.map(({ name, size, type }) => ({ name, size, type })) })
        const failed: string[] = []
        for (const [i, call] of r.calls.entries()) {
          const upload = r.uploads.find((u) => u.id === call.id)
          const file = files[i]?.file
          if (!upload || !file) continue
          try {
            await put(upload, file, call.name)
            await post(org(o, `/uploads/${enc(call.id)}/uploaded`))
          } catch {
            failed.push(call.name)
            await post(org(o, `/uploads/${enc(call.id)}/delete`)).catch(() => undefined)
          }
        }
        if (failed.length) throw new AuthError('unknown', `We couldn't upload ${failed.join(', ')}. Add ${failed.length === 1 ? 'it' : 'them'} again.`)
        return get<SourceCall[]>(org(o, '/uploads')).then((all) => all.filter((c) => r.calls.some((x) => x.id === c.id)))
      },
      deleteCall: (o, id) => post<void>(org(o, `/uploads/${enc(id)}/delete`)),
      getTranscript: (o, id) => get<Transcript>(org(o, `/uploads/${enc(id)}/transcript`)),
    },
    agents: {
      listAgents: (o) => get<AgentSummary[]>(org(o, '/agents')),
      getAgent: (o, id) => get<AgentDetail>(org(o, `/agents/${enc(id)}`)).then(seen),
      saveAgent: (o, id, working) => post<AgentDetail>(org(o, `/agents/${enc(id)}`), { working, revision: agentRev.get(id) }).then(seen),
      // These act on what this page last saw: someone else's newer save is refused, not published.
      publishAgent: (o, id, note) => post<AgentDetail>(org(o, `/agents/${enc(id)}/publish`), { note, revision: agentRev.get(id) }).then(seen),
      discardAgentChanges: (o, id) => post<AgentDetail>(org(o, `/agents/${enc(id)}/discard`), { revision: agentRev.get(id) }).then(seen),
      rollbackAgent: (o, id, version) => post<AgentDetail>(org(o, `/agents/${enc(id)}/rollback`), { version, revision: agentRev.get(id) }).then(seen),
      // Not seen(): the page keeps its own setup after a rename or pause, so
      // taking this reply's revision would hide another tab's newer save.
      updateAgent: (o, id, patch) => post<AgentDetail>(org(o, `/agents/${enc(id)}/settings`), patch),
      deleteAgent: (o, id) => post<void>(org(o, `/agents/${enc(id)}/delete`)),
      createDraft: (o, orgName) => post<AgentDraft>(org(o, '/drafts'), { orgName }).then(seenDraft),
      getDraft: (o, id) => get<AgentDraft>(org(o, `/drafts/${enc(id)}`)).then(seenDraft),
      saveDraft: (o, draft) => post<AgentDraft>(org(o, `/drafts/${enc(draft.id)}`), { draft, revision: draftRev.get(draft.id) }).then(seenDraft),
      discardDraft: (o, id) => post<void>(org(o, `/drafts/${enc(id)}/discard`)),
      publishDraft: (o, id, numberId) => post<AgentSummary>(org(o, `/drafts/${enc(id)}/publish`), { numberId }),
      listScenarios: (o, id) => get<Scenario[]>(org(o, `/agents/${enc(id)}/scenarios`)),
      saveScenario: (o, id, scenario) => post<Scenario>(org(o, `/agents/${enc(id)}/scenarios`), scenario),
      deleteScenario: (o, id, sid) => post<void>(org(o, `/agents/${enc(id)}/scenarios/${enc(sid)}/delete`)),
      listAgentTypes: () => get<AgentType[]>('/catalogue/agent-types'),
      listVoices: () => get<Voice[]>('/catalogue/voices'),
      // AI work (docs/backend-workflow.md, out of scope): say so instead of pretending.
      runScenarios: () => NEEDS_PIPELINE('Running test scenarios'),
      extractFlow: () => NEEDS_PIPELINE('Reading a flow from calls'),
    },
    handoffs: {
      listHandoffs: (o) => get<Handoff[]>(org(o, '/handoffs')),
      takeHandoff: (o, id) => post<Handoff>(org(o, `/handoffs/${enc(id)}/take`)),
      handoffToCallback: (o, id) => post<Callback>(org(o, `/handoffs/${enc(id)}/to-callback`)),
    },
  }

  return {
    ...fallback,
    ...Object.assign({}, ...sections.map((s) => bySection[s] ?? {})),
    // Some pages are still sample data, so the console as a whole is a demo
    // until every section is live.
    isDemo: true,
    isLive: (section: ConsoleSection) => live.has(section),
  }
}
