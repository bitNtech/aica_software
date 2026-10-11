import type { BusinessType, Language, OrgStatus, PlatformRole, Role } from './types'

/** Roles in plain words. An invite states what the person will be able to
 * do before it asks them for anything. */
export const ROLE_LABEL: Record<Role | PlatformRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  supervisor: 'Supervisor',
  front_desk: 'Front desk',
  viewer: 'Viewer',
  master_admin: 'Master admin',
  staff: 'bitNtech staff',
}

export const ROLE_PLAIN: Record<Role | PlatformRole, string> = {
  owner: "You'll have full control, including billing and who can sign in.",
  admin: "You'll be able to change the agent, manage your team and review every call.",
  supervisor: "You'll be able to review calls and take over live ones, but not change the agent.",
  front_desk: "You'll be able to watch live calls and take over when a caller needs a person.",
  viewer: "You'll be able to read call history and reports, but not change anything.",
  master_admin: "You'll be able to manage every organisation and every bitNtech account.",
  staff: "You'll be able to review sign-up requests and support client organisations, but not manage bitNtech staff.",
}

export const isPlatformRole = (r: Role | PlatformRole): r is PlatformRole => r === 'master_admin' || r === 'staff'

export const BUSINESS_LABEL: Record<BusinessType, string> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  diagnostics: 'Diagnostic centre',
  other: 'Other',
}

export const LANGUAGE_LABEL: Record<Language, string> = {
  tamil: 'Tamil',
  english: 'English',
  tanglish: 'Tanglish',
}

export const STATUS_LABEL: Record<OrgStatus, string> = {
  pending_review: 'In review',
  active: 'Active',
  declined: 'Declined',
  suspended: 'Suspended',
}
