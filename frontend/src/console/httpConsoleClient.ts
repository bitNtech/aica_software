import { request } from '../auth/httpClient'
import { apiBase } from '../lib/api'
import { createDemoConsoleClient } from './demoClient'
import type {
  ActivityPage,
  ActivityQuery,
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
} from './types'

/** Every section the API serves (docs/backend-workflow.md, Phases 1–3). */
export const ALL_LIVE_SECTIONS: readonly ConsoleSection[] = ['team', 'settings', 'activity', 'requests', 'calls', 'callbacks', 'appointments', 'handoffs']

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
