import type { Membership, Permission, PlatformRole, Role } from '../auth/types'

/**
 * Who may open which organisation page, and who may take which action.
 * The single source for the sidebar and the route guards, transcribed from
 * docs/pages-and-access.md. Hiding a page is not access control: the backend
 * must check the same rules on every request.
 *
 * bitNtech's master admin creates each agent and owns its structure (the
 * conversation flow, the details it collects, its tools and voice
 * pipeline). A hospital changes the everyday settings and asks bitNtech for
 * anything structural. Inside a hospital, each role starts from a default
 * set of permissions, which an owner or admin can change per person.
 */

/** edit: change and act · read: look only · own: only their own items. */
export type AccessLevel = 'edit' | 'read' | 'own'

export type PageKey =
  | 'home'
  | 'agents'
  | 'agentBuilder'
  | 'agentWorkspace'
  | 'requests'
  | 'uploads'
  | 'knowledge'
  | 'integrations'
  | 'numbers'
  | 'desk'
  | 'live'
  | 'callbacks'
  | 'appointments'
  | 'calls'
  | 'reports'
  | 'team'
  | 'activity'
  | 'settings'
  | 'billing'
  | 'owners'
  | 'usage'
  | 'notifications'
  | 'profile'

export type PermissionGroup = 'agents' | 'desk' | 'calls' | 'manage'

export interface PermissionMeta {
  label: string
  /** One line saying what it allows. */
  description: string
  group: PermissionGroup
  /** Roles that have it unless someone changes it. */
  defaults: readonly Role[]
  /** Roles it may be given to at all. Viewers only ever look. */
  grantable: readonly Role[]
}

const MANAGERS: readonly Role[] = ['owner', 'admin']
const STAFF: readonly Role[] = ['owner', 'admin', 'supervisor', 'front_desk']
const EVERYONE: readonly Role[] = ['owner', 'admin', 'supervisor', 'front_desk', 'viewer']

export const PERMISSION_GROUP_LABEL: Record<PermissionGroup, string> = {
  agents: 'Agents and setup',
  desk: 'Front desk',
  calls: 'Calls and reports',
  manage: 'Organisation',
}

export const PERMISSIONS: Record<Permission, PermissionMeta> = {
  'agents.view': { label: 'See agents', description: 'Open each agent and read how it’s set up.', group: 'agents', defaults: ['owner', 'admin', 'supervisor', 'viewer'], grantable: EVERYONE },
  'agents.configure': {
    label: 'Change everyday settings',
    description: 'Greeting, voice, languages, knowledge, handover rules and what to note after calls.',
    group: 'agents',
    defaults: MANAGERS,
    grantable: ['owner', 'admin', 'supervisor'],
  },
  'agents.publish': { label: 'Publish and pause agents', description: 'Make saved changes live, roll back, pause or turn on.', group: 'agents', defaults: MANAGERS, grantable: ['owner', 'admin', 'supervisor'] },
  'agents.test': { label: 'Test agents', description: 'Try an agent and run its test scenarios. Changes nothing.', group: 'agents', defaults: ['owner', 'admin', 'supervisor'], grantable: EVERYONE },
  'requests.create': {
    label: 'Ask bitNtech for changes',
    description: 'A new agent, a change to a flow, a new integration or number.',
    group: 'agents',
    defaults: MANAGERS,
    grantable: STAFF,
  },
  'library.knowledge': { label: 'Manage knowledge', description: 'Add and change documents, web pages, FAQs and tables.', group: 'agents', defaults: MANAGERS, grantable: STAFF },
  'library.uploads': { label: 'Upload past calls', description: 'Add recordings for bitNtech to build and improve agents from.', group: 'agents', defaults: MANAGERS, grantable: ['owner', 'admin', 'supervisor'] },
  'library.numbers': { label: 'Change phone lines', description: 'Each line’s agent, hours and where calls go after hours.', group: 'agents', defaults: MANAGERS, grantable: ['owner', 'admin', 'supervisor'] },
  'library.secrets': { label: 'Replace system secrets', description: 'Set the keys your connected systems use. Values are never shown.', group: 'agents', defaults: MANAGERS, grantable: MANAGERS },
  'desk.bot': { label: 'Switch lines to staff', description: 'Send a line’s calls to people instead of the agent, and back.', group: 'desk', defaults: STAFF, grantable: STAFF },
  'desk.notices': { label: 'Post notices', description: 'Today’s notices and doctor changes the agents tell callers about.', group: 'desk', defaults: STAFF, grantable: STAFF },
  'calls.take': { label: 'Take calls', description: 'Live calls and callers waiting for a person: guide the agent, hand over, take over.', group: 'desk', defaults: STAFF, grantable: STAFF },
  'callbacks.assign': { label: 'Assign callbacks', description: 'See every callback and give them to anyone. Without it: their own.', group: 'desk', defaults: ['owner', 'admin', 'supervisor'], grantable: STAFF },
  'appointments.manage': { label: 'Manage appointments', description: 'Confirm, change and cancel bookings made on calls.', group: 'desk', defaults: STAFF, grantable: STAFF },
  'calls.viewAll': { label: 'See every call', description: 'The whole call history. Without it: only calls they handled.', group: 'calls', defaults: ['owner', 'admin', 'supervisor', 'viewer'], grantable: EVERYONE },
  'calls.personal': { label: 'See callers’ details', description: 'Names, numbers and IDs in transcripts and handovers.', group: 'calls', defaults: STAFF, grantable: EVERYONE },
  'calls.recordings': { label: 'Play recordings', description: 'Any call’s recording. Without it: only calls they handled.', group: 'calls', defaults: ['owner', 'admin', 'supervisor'], grantable: EVERYONE },
  'reports.view': { label: 'See reports', description: 'Volumes, outcomes, quality and response times.', group: 'calls', defaults: ['owner', 'admin', 'supervisor', 'viewer'], grantable: EVERYONE },
  'reports.export': { label: 'Export', description: 'Download reports and call lists as CSV.', group: 'calls', defaults: ['owner', 'admin', 'supervisor'], grantable: EVERYONE },
  'team.manage': { label: 'Manage the team', description: 'Invite people, set their roles and what they can do.', group: 'manage', defaults: MANAGERS, grantable: MANAGERS },
  'settings.manage': { label: 'Organisation settings', description: 'Name, languages, business hours and closed days.', group: 'manage', defaults: MANAGERS, grantable: MANAGERS },
  'activity.view': { label: 'See activity', description: 'Who changed what in the organisation.', group: 'manage', defaults: MANAGERS, grantable: ['owner', 'admin', 'supervisor'] },
}

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

/** What a role has unless someone changes it. */
export function defaultPermissions(role: Role): Permission[] {
  return ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].defaults.includes(role))
}

export const canGrant = (role: Role, p: Permission) => PERMISSIONS[p].grantable.includes(role)

/** A custom set, trimmed to what the role may hold. `null`: the defaults. */
export function permissionsFor(role: Role, custom?: readonly Permission[] | null): Permission[] {
  if (!custom) return defaultPermissions(role)
  return ALL_PERMISSIONS.filter((p) => custom.includes(p) && canGrant(role, p))
}

/**
 * What the person in front of the console may do. `platform` is set for
 * bitNtech accounts working on an organisation from Ops: the master admin
 * may do everything there, staff only look.
 */
export interface Access {
  role: Role
  perms: ReadonlySet<Permission>
  platform: PlatformRole | null
}

export function accessFor(m: Pick<Membership, 'role' | 'permissions'>): Access {
  return { role: m.role, perms: new Set(permissionsFor(m.role, m.permissions)), platform: null }
}

/** bitNtech in Ops. Staff can open what a viewer could, plus test. */
export function platformAccess(platform: PlatformRole): Access {
  const perms: Permission[] = platform === 'master_admin' ? ALL_PERMISSIONS : ['agents.view', 'agents.test', 'calls.viewAll', 'reports.view']
  return { role: 'owner', perms: new Set(perms), platform }
}

export const has = (a: Access, p: Permission) => a.perms.has(p)
/** The master admin, working on an organisation from Ops. */
export const isMaster = (a: Access) => a.platform === 'master_admin'

/** Each page's access, worked out from permissions. */
const PAGE_RULE: Record<PageKey, (a: Access) => AccessLevel | null> = {
  home: (a) => (a.platform ? null : 'read'),
  // Build
  agents: (a) => (isMaster(a) || has(a, 'agents.configure') ? 'edit' : has(a, 'agents.view') ? 'read' : null),
  // Only the master admin creates agents.
  agentBuilder: (a) => (isMaster(a) ? 'edit' : null),
  agentWorkspace: (a) => (isMaster(a) || has(a, 'agents.configure') ? 'edit' : has(a, 'agents.view') || has(a, 'agents.test') ? 'read' : null),
  requests: (a) => (a.platform ? null : has(a, 'requests.create') ? 'edit' : has(a, 'agents.view') ? 'read' : null),
  // Recordings hold personal details.
  uploads: (a) => (has(a, 'library.uploads') ? 'edit' : has(a, 'agents.view') && has(a, 'calls.personal') ? 'read' : null),
  knowledge: (a) => (has(a, 'library.knowledge') ? 'edit' : has(a, 'agents.view') ? 'read' : null),
  integrations: (a) => (has(a, 'library.secrets') ? 'edit' : has(a, 'agents.view') && a.role !== 'viewer' ? 'read' : null),
  numbers: (a) => (has(a, 'library.numbers') ? 'edit' : has(a, 'agents.view') && a.role !== 'viewer' ? 'read' : null),
  // Operate
  desk: (a) => (a.platform ? null : has(a, 'desk.bot') || has(a, 'desk.notices') ? 'edit' : null),
  // Everyone who may see calls can watch the queue; taking and guiding need calls.take.
  live: (a) => (has(a, 'calls.take') ? 'edit' : has(a, 'calls.viewAll') ? 'read' : null),
  callbacks: (a) => (has(a, 'callbacks.assign') ? 'edit' : has(a, 'calls.take') ? 'own' : null),
  appointments: (a) => (has(a, 'appointments.manage') ? 'edit' : has(a, 'calls.viewAll') ? 'read' : null),
  calls: (a) => (has(a, 'calls.viewAll') ? 'read' : has(a, 'calls.take') ? 'own' : null),
  reports: (a) => (has(a, 'reports.view') ? 'read' : null),
  // Manage
  team: (a) => (has(a, 'team.manage') ? 'edit' : null),
  activity: (a) => (has(a, 'activity.view') ? 'read' : null),
  settings: (a) => (has(a, 'settings.manage') ? 'edit' : null),
  // Billing stays with owners (it isn't a permission anyone can be given),
  // and bitNtech's master admin, who manages every organisation's billing.
  billing: (a) => (a.role === 'owner' && (!a.platform || a.platform === 'master_admin') ? 'edit' : null),
  // Owners add and change owners; admins see who they are.
  owners: (a) => (a.platform ? null : a.role === 'owner' ? 'edit' : has(a, 'team.manage') ? 'read' : null),
  // Use against the plan: billing's people.
  usage: (a) => (a.role === 'owner' && (!a.platform || a.platform === 'master_admin') ? 'edit' : null),
  // Who gets the organisation's alerts.
  notifications: (a) => (a.platform ? null : has(a, 'settings.manage') ? 'edit' : null),
  // Everyone's own account; bitNtech's is in Ops.
  profile: (a) => (a.platform ? null : 'edit'),
}

export const PAGE_KEYS = Object.keys(PAGE_RULE) as PageKey[]

export const PAGE_LABEL: Record<PageKey, string> = {
  home: 'Home',
  agents: 'Agents',
  agentBuilder: 'the agent builder',
  agentWorkspace: 'the agent workspace',
  requests: 'Requests to bitNtech',
  uploads: 'Call uploads',
  knowledge: 'the Knowledge library',
  integrations: 'Tools and integrations',
  numbers: 'Phone numbers',
  desk: 'the Bot desk',
  live: 'Live calls',
  callbacks: 'Callbacks',
  appointments: 'Appointments',
  calls: 'Call history',
  reports: 'Reports',
  team: 'Team',
  activity: 'the audit log',
  settings: 'Organisation settings',
  billing: 'Billing and plan',
  owners: 'Owners',
  usage: 'Usage and limits',
  notifications: 'Notifications',
  profile: 'Your profile',
}

/** The agent workspace's tabs differ by who's looking (docs/pages-and-access.md,
 * "Agent workspace tabs"). `agentWorkspace` above opens the workspace; these
 * decide which tabs show and whether they're editable. Structural tabs
 * (flow, tools, pipeline) are the master admin's; a hospital reads them and
 * asks for changes. */
export type AgentTab = 'flow' | 'behaviour' | 'pipeline' | 'knowledge' | 'tools' | 'rules' | 'analysis' | 'test' | 'versions' | 'settings'

const configure = (a: Access): AccessLevel | null => (isMaster(a) || has(a, 'agents.configure') ? 'edit' : has(a, 'agents.view') ? 'read' : null)
const structure = (a: Access): AccessLevel | null => (isMaster(a) ? 'edit' : has(a, 'agents.view') ? 'read' : null)

const TAB_RULE: Record<AgentTab, (a: Access) => AccessLevel | null> = {
  flow: structure,
  behaviour: configure,
  // How it listens and replies: technical, so not for viewers.
  pipeline: (a) => (isMaster(a) ? 'edit' : has(a, 'agents.view') && a.role !== 'viewer' ? 'read' : null),
  knowledge: configure,
  tools: (a) => (isMaster(a) ? 'edit' : has(a, 'agents.view') && a.role !== 'viewer' ? 'read' : null),
  rules: configure,
  analysis: configure,
  test: (a) => (has(a, 'agents.test') ? 'edit' : null),
  versions: (a) => (isMaster(a) || has(a, 'agents.publish') ? 'edit' : has(a, 'agents.view') ? 'read' : null),
  settings: (a) => (isMaster(a) || has(a, 'agents.configure') || has(a, 'agents.publish') ? 'edit' : null),
}

export const AGENT_TABS = Object.keys(TAB_RULE) as AgentTab[]

export function tabAccess(a: Access, tab: AgentTab): AccessLevel | null {
  return TAB_RULE[tab](a)
}

export function pageAccess(a: Access, page: PageKey): AccessLevel | null {
  return PAGE_RULE[page](a)
}

export function canOpen(a: Access, page: PageKey): boolean {
  return pageAccess(a, page) !== null
}

export type ConsoleAction =
  | 'agent.create'
  | 'agent.structure'
  | 'agent.configure'
  | 'agent.publish'
  | 'agent.delete'
  | 'agent.test'
  | 'request.create'
  | 'knowledge.delete'
  | 'upload.delete'
  | 'tools.manage'
  | 'tools.credentials'
  | 'desk.bot'
  | 'desk.notices'
  | 'desk.resolveFlags'
  | 'call.takeOver'
  | 'call.seeWaiting'
  | 'call.playRecording'
  | 'call.notes'
  | 'call.personal'
  | 'export'
  | 'team.inviteAdmin'
  | 'team.manageOwners'
  | 'billing'

const ACTION_RULE: Record<ConsoleAction, (a: Access) => boolean> = {
  'agent.create': isMaster,
  // The flow, details to collect, tools, voice pipeline and call analysis fields.
  'agent.structure': isMaster,
  'agent.configure': (a) => isMaster(a) || has(a, 'agents.configure'),
  'agent.publish': (a) => isMaster(a) || has(a, 'agents.publish'),
  'agent.delete': isMaster,
  'agent.test': (a) => has(a, 'agents.test'),
  'request.create': (a) => !a.platform && has(a, 'requests.create'),
  'knowledge.delete': (a) => has(a, 'library.knowledge'),
  'upload.delete': (a) => has(a, 'library.uploads'),
  'tools.manage': isMaster,
  'tools.credentials': (a) => has(a, 'library.secrets'),
  'desk.bot': (a) => has(a, 'desk.bot'),
  'desk.notices': (a) => has(a, 'desk.notices'),
  // A flagged answer is fixed by changing the agent or its knowledge.
  'desk.resolveFlags': (a) => has(a, 'agents.configure') || has(a, 'library.knowledge'),
  'call.takeOver': (a) => has(a, 'calls.take'),
  // Who is waiting for a person: anyone who can see calls (GET /handoffs).
  'call.seeWaiting': (a) => has(a, 'calls.take') || has(a, 'calls.viewAll'),
  // Without the permission: only calls they handled; the page checks per call.
  'call.playRecording': (a) => has(a, 'calls.recordings') || has(a, 'calls.take'),
  'call.notes': (a) => a.role !== 'viewer' && (has(a, 'calls.take') || has(a, 'calls.viewAll')),
  'call.personal': (a) => has(a, 'calls.personal'),
  export: (a) => has(a, 'reports.export'),
  'team.inviteAdmin': (a) => has(a, 'team.manage'),
  'team.manageOwners': (a) => a.role === 'owner' && has(a, 'team.manage'),
  billing: (a) => a.role === 'owner' && !a.platform,
}

export function can(a: Access, action: ConsoleAction): boolean {
  return ACTION_RULE[action](a)
}

/** The sidebar. Only pages that exist are listed. Grouped as in
 * docs/pages-and-access.md. */
export interface NavItem {
  page: PageKey
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
    heading: 'Operate',
    items: [
      { page: 'desk', label: 'Bot desk', path: 'desk', description: 'Each line’s agent, today’s notices and doctor changes.' },
      { page: 'live', label: 'Live calls', path: 'live', description: 'Calls the agents are on now, and callers waiting for a person.' },
      { page: 'callbacks', label: 'Callbacks', path: 'callbacks', description: 'Missed calls and people to call back.' },
      { page: 'appointments', label: 'Appointments', path: 'appointments', description: 'Bookings made on calls, to check.' },
      { page: 'calls', label: 'Call history', path: 'calls', description: 'Every call, with its transcript and what happened.' },
      { page: 'reports', label: 'Analytics and reports', path: 'analytics', description: 'How calls went over a period: outcomes, topics, hours and agents.' },
    ],
  },
  {
    heading: 'Agent setup',
    items: [
      { page: 'agents', label: 'Agents', path: 'agents', description: 'The voice agents bitNtech set up for your phone lines.' },
      { page: 'requests', label: 'Requests to bitNtech', path: 'requests', description: 'New agents and flow changes you’ve asked for.' },
      { page: 'uploads', label: 'Call uploads', path: 'uploads', description: 'Recordings of past calls that agents learn from.' },
      { page: 'knowledge', label: 'Knowledge', path: 'knowledge', description: 'Schedules, prices and FAQs the agents answer from.' },
      { page: 'integrations', label: 'Tools and integrations', path: 'integrations', description: 'What agents can do during a call, and your connected systems.' },
      { page: 'numbers', label: 'Phone numbers', path: 'numbers', description: 'Your lines, the agent on each, and its hours.' },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { page: 'team', label: 'Team', path: 'team', description: 'Who can sign in, their roles and what they can do.' },
      { page: 'owners', label: 'Owners', path: 'owners', description: 'Who owns the organisation, and handing ownership over.' },
      { page: 'activity', label: 'Audit log', path: 'audit', description: 'What changed, and who changed it.' },
      { page: 'settings', label: 'Settings', path: 'settings', description: 'Name, languages and business hours.' },
      { page: 'notifications', label: 'Notifications', path: 'notifications', description: 'Who gets which alerts, and quiet hours.' },
      { page: 'billing', label: 'Billing and plan', path: 'billing', description: 'Plan, invoices and payment.' },
      { page: 'usage', label: 'Usage and limits', path: 'usage', description: 'Minutes, agents and lines against your plan.' },
    ],
  },
]

export function navFor(a: Access): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => canOpen(a, i.page)) })).filter((s) => s.items.length > 0)
}
