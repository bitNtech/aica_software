import { describe, expect, it } from 'vitest'
import type { Role } from '../auth/types'
import { ACTION_ROLES, AGENT_TAB_ACCESS, PAGE_ACCESS, navFor } from '../console/access'

/**
 * Pins console/access.ts to docs/pages-and-access.md (sections 3 and 4).
 * Changing who can do what should mean changing the doc and this table
 * together. Columns: owner, admin, supervisor, front desk, viewer.
 * E edit · R read · O own · - none.
 */
const ROLES: Role[] = ['owner', 'admin', 'supervisor', 'front_desk', 'viewer']
const CODE = { edit: 'E', read: 'R', own: 'O' } as const

const PAGES: Record<keyof typeof PAGE_ACCESS, string> = {
  home: 'RRRRR',
  agents: 'EER-R',
  agentBuilder: 'EE---',
  agentWorkspace: 'EER-R',
  uploads: 'EER--',
  knowledge: 'EER-R',
  integrations: 'EER--',
  numbers: 'EER--',
  live: 'EEEE-',
  handoffs: 'EEEE-',
  callbacks: 'EEEO-',
  appointments: 'EEEER',
  calls: 'RRROR',
  reports: 'RRR-R',
  team: 'EE---',
  activity: 'RR---',
  settings: 'EE---',
  billing: 'E----',
}

const TABS: Record<keyof typeof AGENT_TAB_ACCESS, string> = {
  flow: 'EER-R',
  behaviour: 'EER-R',
  knowledge: 'EER-R',
  tools: 'EER--',
  rules: 'EER-R',
  test: 'EEE--',
  versions: 'EER-R',
  settings: 'EE---',
}

const row = (m: Partial<Record<Role, keyof typeof CODE>>) => ROLES.map((r) => (m[r] ? CODE[m[r]] : '-')).join('')

describe('console access map', () => {
  it('matches the pages table', () => {
    expect(Object.fromEntries(Object.entries(PAGE_ACCESS).map(([k, m]) => [k, row(m)]))).toEqual(PAGES)
  })

  it('matches the agent workspace tabs table', () => {
    expect(Object.fromEntries(Object.entries(AGENT_TAB_ACCESS).map(([k, m]) => [k, row(m)]))).toEqual(TABS)
  })

  it('keeps owner-only actions owner-only', () => {
    expect(ACTION_ROLES.billing).toEqual(['owner'])
    expect(ACTION_ROLES['team.manageOwners']).toEqual(['owner'])
    for (const a of ['agent.publish', 'agent.delete', 'knowledge.delete', 'upload.delete', 'tools.credentials'] as const) {
      expect(ACTION_ROLES[a]).toEqual(['owner', 'admin'])
    }
  })

  it('never lists a page in the sidebar that the role cannot open', () => {
    for (const role of ROLES) {
      for (const item of navFor(role).flatMap((s) => s.items)) {
        expect(PAGE_ACCESS[item.page][role], `${role} → ${item.page}`).toBeTruthy()
      }
    }
  })
})
