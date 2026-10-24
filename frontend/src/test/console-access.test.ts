import { describe, expect, it } from 'vitest'
import type { Role } from '../auth/types'
import {
  accessFor,
  AGENT_TABS,
  can,
  canGrant,
  defaultPermissions,
  NAV,
  navFor,
  PAGE_KEYS,
  pageAccess,
  permissionsFor,
  platformAccess,
  tabAccess,
  type Access,
  type ConsoleAction,
} from '../console/access'

/**
 * Pins console/access.ts to docs/pages-and-access.md (sections 3 and 4), for
 * each role with its default permissions. Changing who can do what should
 * mean changing the doc and this table together. Columns: owner, admin,
 * supervisor, front desk, viewer, then master admin and staff in Ops.
 * E edit · R read · O own · - none.
 */
const ROLES: Role[] = ['owner', 'admin', 'supervisor', 'front_desk', 'viewer']
const CODE = { edit: 'E', read: 'R', own: 'O' } as const
const WHO: Access[] = [...ROLES.map((role) => accessFor({ role })), platformAccess('master_admin'), platformAccess('staff')]
const row = (f: (a: Access) => keyof typeof CODE | null) => WHO.map((a) => (f(a) ? CODE[f(a)!] : '-')).join('')

const PAGES: Record<(typeof PAGE_KEYS)[number], string> = {
  home: 'RRRRR--',
  agents: 'EER-RER',
  agentBuilder: '-----E-',
  agentWorkspace: 'EER-RER',
  requests: 'EER-R--',
  uploads: 'EER--E-',
  knowledge: 'EER-RER',
  integrations: 'EER--ER',
  numbers: 'EER--ER',
  desk: 'EEEE---',
  // Everyone who may see calls can watch; taking needs calls.take.
  live: 'EEEERER',
  callbacks: 'EEEO-E-',
  appointments: 'EEEERER',
  calls: 'RRRORRR',
  reports: 'RRR-RRR',
  team: 'EE---E-',
  activity: 'RR---R-',
  settings: 'EE---E-',
  // Owners, and bitNtech's master admin (from Ops).
  billing: 'E----E-',
  owners: 'ER-----',
  usage: 'E----E-',
  notifications: 'EE-----',
  profile: 'EEEEE--',
}

const TABS: Record<(typeof AGENT_TABS)[number], string> = {
  flow: 'RRR-RER',
  behaviour: 'EER-RER',
  pipeline: 'RRR--ER',
  knowledge: 'EER-RER',
  tools: 'RRR--ER',
  rules: 'EER-RER',
  analysis: 'EER-RER',
  test: 'EEE--EE',
  versions: 'EER-RER',
  settings: 'EE---E-',
}

describe('console access map', () => {
  it('matches the pages table', () => {
    expect(Object.fromEntries(PAGE_KEYS.map((p) => [p, row((a) => pageAccess(a, p))]))).toEqual(PAGES)
  })

  it('matches the agent workspace tabs table', () => {
    expect(Object.fromEntries(AGENT_TABS.map((t) => [t, row((a) => tabAccess(a, t))]))).toEqual(TABS)
  })

  it('keeps creating and restructuring agents with bitNtech’s master admin', () => {
    for (const action of ['agent.create', 'agent.structure', 'agent.delete', 'tools.manage'] as ConsoleAction[]) {
      expect(row((a) => (can(a, action) ? 'edit' : null)), action).toBe('-----E-')
    }
    // Hospitals ask instead; bitNtech doesn't file requests to itself.
    expect(row((a) => (can(a, 'request.create') ? 'edit' : null))).toBe('EE-----')
  })

  it('keeps billing with owners, and owners with owners', () => {
    expect(row((a) => (can(a, 'billing') ? 'edit' : null))).toBe('E------')
    expect(row((a) => (can(a, 'team.manageOwners') ? 'edit' : null))).toBe('E----E-')
  })

  it('folds the handoff queue into Live calls: one entry, no Handoff queue in the sidebar', () => {
    const items = navFor(accessFor({ role: 'front_desk' })).flatMap((s) => s.items)
    expect(items.map((i) => i.label)).toContain('Live calls')
    expect(items.map((i) => i.label)).not.toContain('Handoff queue')
    expect(NAV.flatMap((s) => s.items).some((i) => i.path === 'handoffs')).toBe(false)
    // A viewer can watch the queue, without any way to act on it.
    expect(navFor(accessFor({ role: 'viewer' })).flatMap((s) => s.items).map((i) => i.label)).toContain('Live calls')
  })

  it('never lists a page in the sidebar that the person cannot open', () => {
    for (const a of WHO) {
      for (const item of navFor(a).flatMap((s) => s.items)) expect(pageAccess(a, item.page), `${a.role} → ${item.page}`).toBeTruthy()
    }
  })
})

describe('per-person permissions', () => {
  it('follows changed permissions: a front desk member given reports, without the bot switch', () => {
    const a = accessFor({ role: 'front_desk', permissions: ['desk.notices', 'calls.take', 'reports.view'] })
    // Reports lives embedded in Home now, not as its own nav destination;
    // this is what gates that embedded section (ConsoleHomePage's `may('reports')`).
    expect(pageAccess(a, 'reports')).toBe('read')
    expect(can(a, 'desk.bot')).toBe(false)
    // Still opens the desk for notices.
    expect(pageAccess(a, 'desk')).toBe('edit')
  })

  it('never gives a role what it may not hold', () => {
    // Viewers only look, and the team stays with owners and admins.
    expect(permissionsFor('viewer', ['agents.configure', 'reports.view'])).toEqual(['reports.view'])
    expect(canGrant('supervisor', 'team.manage')).toBe(false)
    expect(permissionsFor('front_desk', ['team.manage', 'calls.take'])).toEqual(['calls.take'])
  })

  it('gives each role defaults it may hold', () => {
    for (const role of ROLES) for (const p of defaultPermissions(role)) expect(canGrant(role, p), `${role}: ${p}`).toBe(true)
  })
})
