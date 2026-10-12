import type { Role } from '../auth/types'

/**
 * Who may open which organisation page, and who may take which action.
 * The single source for the sidebar and the route guards, transcribed from
 * docs/pages-and-access.md. Hiding a page is not access control: the backend
 * must check the same rules on every request.
 */

/** edit: change and act · read: look only · own: only their own items. */
export type AccessLevel = 'edit' | 'read' | 'own'

export type ConsolePage =
  | 'home'
  | 'agents'
  | 'agentBuilder'
  | 'agentWorkspace'
  | 'uploads'
  | 'knowledge'
  | 'integrations'
  | 'numbers'
  | 'live'
  | 'handoffs'
  | 'callbacks'
  | 'appointments'
  | 'calls'
  | 'reports'
  | 'team'
  | 'activity'
  | 'settings'
  | 'billing'

type Matrix = Partial<Record<Role, AccessLevel>>

const ALL_READ: Matrix = { owner: 'read', admin: 'read', supervisor: 'read', front_desk: 'read', viewer: 'read' }
const BUILDERS: Matrix = { owner: 'edit', admin: 'edit' }
const BUILD_LIBRARY: Matrix = { owner: 'edit', admin: 'edit', supervisor: 'read', viewer: 'read' }
const CALL_HANDLERS: Matrix = { owner: 'edit', admin: 'edit', supervisor: 'edit', front_desk: 'edit' }

export const PAGE_ACCESS: Record<ConsolePage, Matrix> = {
  home: ALL_READ,
  // Build
  agents: { owner: 'edit', admin: 'edit', supervisor: 'read', viewer: 'read' },
  agentBuilder: BUILDERS,
  agentWorkspace: { owner: 'edit', admin: 'edit', supervisor: 'read', viewer: 'read' },
  uploads: { owner: 'edit', admin: 'edit', supervisor: 'read' },
  knowledge: BUILD_LIBRARY,
  integrations: { owner: 'edit', admin: 'edit', supervisor: 'read' },
  numbers: { owner: 'edit', admin: 'edit', supervisor: 'read' },
  // Operate
  live: CALL_HANDLERS,
  handoffs: CALL_HANDLERS,
  callbacks: { owner: 'edit', admin: 'edit', supervisor: 'edit', front_desk: 'own' },
  appointments: { ...CALL_HANDLERS, viewer: 'read' },
  calls: { owner: 'read', admin: 'read', supervisor: 'read', front_desk: 'own', viewer: 'read' },
  reports: { owner: 'read', admin: 'read', supervisor: 'read', viewer: 'read' },
  // Manage
  team: { owner: 'edit', admin: 'edit' },
  activity: { owner: 'read', admin: 'read' },
  settings: { owner: 'edit', admin: 'edit' },
  billing: { owner: 'edit' },
}

export const PAGE_LABEL: Record<ConsolePage, string> = {
  home: 'Home',
  agents: 'Agents',
  agentBuilder: 'the agent builder',
  agentWorkspace: 'the agent workspace',
  uploads: 'Call uploads',
  knowledge: 'the Knowledge library',
  integrations: 'Tools and integrations',
  numbers: 'Phone numbers',
  live: 'Live calls',
  handoffs: 'the Handoff queue',
  callbacks: 'Callbacks',
  appointments: 'Appointments',
  calls: 'Call history',
  reports: 'Reports',
  team: 'Team',
  activity: 'Organisation activity',
  settings: 'Organisation settings',
  billing: 'Billing and plan',
}

/** The agent workspace's tabs differ by role (docs/pages-and-access.md,
 * "Agent workspace tabs"). `agentWorkspace` above opens the workspace; these
 * decide which tabs show and whether they're editable. */
export type AgentTab = 'flow' | 'behaviour' | 'knowledge' | 'tools' | 'rules' | 'test' | 'versions' | 'settings'

const TAB_READ_ALL: Matrix = { owner: 'edit', admin: 'edit', supervisor: 'read', viewer: 'read' }

export const AGENT_TAB_ACCESS: Record<AgentTab, Matrix> = {
  flow: TAB_READ_ALL,
  behaviour: TAB_READ_ALL,
  knowledge: TAB_READ_ALL,
  tools: { owner: 'edit', admin: 'edit', supervisor: 'read' },
  rules: TAB_READ_ALL,
  // Supervisors test agents; testing changes nothing.
  test: { owner: 'edit', admin: 'edit', supervisor: 'edit' },
  versions: TAB_READ_ALL,
  settings: { owner: 'edit', admin: 'edit' },
}

export function tabAccess(role: Role, tab: AgentTab): AccessLevel | null {
  return AGENT_TAB_ACCESS[tab][role] ?? null
}

export function pageAccess(role: Role, page: ConsolePage): AccessLevel | null {
  return PAGE_ACCESS[page][role] ?? null
}

export function canOpen(role: Role, page: ConsolePage): boolean {
  return pageAccess(role, page) !== null
}

export type ConsoleAction =
  | 'agent.create'
  | 'agent.publish'
  | 'agent.delete'
  | 'agent.test'
  | 'knowledge.delete'
  | 'upload.delete'
  | 'tools.credentials'
  | 'call.takeOver'
  | 'call.playRecording'
  | 'call.notes'
  | 'export'
  | 'team.inviteAdmin'
  | 'team.manageOwners'
  | 'billing'

export const ACTION_ROLES: Record<ConsoleAction, readonly Role[]> = {
  'agent.create': ['owner', 'admin'],
  'agent.publish': ['owner', 'admin'],
  'agent.delete': ['owner', 'admin'],
  'agent.test': ['owner', 'admin', 'supervisor'],
  'knowledge.delete': ['owner', 'admin'],
  'upload.delete': ['owner', 'admin'],
  'tools.credentials': ['owner', 'admin'],
  'call.takeOver': ['owner', 'admin', 'supervisor', 'front_desk'],
  // Front desk only for calls they handled; the page checks that per call.
  // Assumed until decided: docs/pages-and-access.md, "Open decisions".
  'call.playRecording': ['owner', 'admin', 'supervisor', 'front_desk'],
  // Front desk only on calls they handled, as for recordings.
  'call.notes': ['owner', 'admin', 'supervisor', 'front_desk'],
  export: ['owner', 'admin', 'supervisor'],
  'team.inviteAdmin': ['owner', 'admin'],
  'team.manageOwners': ['owner'],
  billing: ['owner'],
}

export function can(role: Role, action: ConsoleAction): boolean {
  return ACTION_ROLES[action].includes(role)
}

/** The sidebar. Only pages that exist are listed; each step of the build
 * adds its page here. Grouped as in docs/pages-and-access.md. */
export interface NavItem {
  page: ConsolePage
  label: string
  /** Relative to /o/:slug. Empty for Home. */
  path: string
  /** One line for the Home page's list of pages. */
  description: string
}

export interface NavSection {
  /** No heading for the first, ungrouped section. */
  heading?: string
  items: NavItem[]
}

export const NAV: NavSection[] = [
  { items: [{ page: 'home', label: 'Home', path: '', description: 'Today at a glance.' }] },
  {
    heading: 'Build',
    items: [{ page: 'agents', label: 'Agents', path: 'agents', description: 'The voice agents that answer your phone lines.' }],
  },
]

export function navFor(role: Role): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => canOpen(role, i.page)) })).filter((s) => s.items.length > 0)
}
