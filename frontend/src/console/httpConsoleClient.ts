import { request } from '../auth/httpClient'
import { apiBase } from '../lib/api'
import { createDemoConsoleClient } from './demoClient'
import type { ActivityPage, ActivityQuery, ConsoleClient, ConsoleSection, Member, NewInvite, OrgSettings, OrgSettingsInput } from './types'

/** The sections the API serves today (docs/backend-workflow.md, Phase 1). */
export const LIVE_SECTIONS: readonly ConsoleSection[] = ['team', 'settings', 'activity']

/**
 * The console against the AICA API, one section at a time: the sections in
 * LIVE_SECTIONS call /api/orgs/{slug}/…, and everything else is still
 * answered by `fallback` (the demo client), whose pages keep their "Demo
 * data" note. The session cookie goes with every call; nothing secret is
 * held in JavaScript. Errors arrive as AuthError with a message for the
 * person using the console, as from the demo client.
 */
export function createHttpConsoleClient(base = apiBase(), fallback: ConsoleClient = createDemoConsoleClient()): ConsoleClient {
  const get = <T>(path: string) => request<T>(base, 'GET', path)
  const post = <T>(path: string, body?: unknown) => request<T>(base, 'POST', path, body)
  const org = (slug: string, path = '') => `/orgs/${encodeURIComponent(slug)}${path}`
  const member = (slug: string, id: string, action: string) => org(slug, `/members/${encodeURIComponent(id)}/${action}`)
  const live = new Set<ConsoleSection>(LIVE_SECTIONS)

  return {
    ...fallback,
    // Most pages are still sample data, so the console as a whole is a demo.
    isDemo: true,
    isLive: (section) => live.has(section),

    listMembers: (o) => get<Member[]>(org(o, '/members')),
    inviteMember: (o, invite: NewInvite) => post<Member>(org(o, '/members/invite'), { email: invite.email.trim(), role: invite.role }),
    resendInvite: (o, id) => post<Member>(member(o, id, 'resend')),
    changeRole: (o, id, role) => post<Member>(member(o, id, 'role'), { role }),
    setPermissions: (o, id, permissions) => post<Member>(member(o, id, 'permissions'), { permissions }),
    removeMember: (o, id) => post<void>(member(o, id, 'remove')),

    listActivity: (o, q: ActivityQuery) => {
      const params = new URLSearchParams()
      if (q.area) params.set('area', q.area)
      if (q.actorId) params.set('actorId', q.actorId)
      if (q.before) params.set('before', q.before)
      const qs = params.toString()
      return get<ActivityPage>(org(o, `/activity${qs ? `?${qs}` : ''}`))
    },

    getOrgSettings: (o) => get<OrgSettings>(org(o, '/settings')),
    updateOrgSettings: (o, s: OrgSettingsInput) =>
      post<OrgSettings>(org(o, '/settings'), { name: s.name, city: s.city, languages: s.languages, hours: s.hours, closed: s.closed }),
  }
}
