/** The shapes the console expects from an auth backend. The mock client
 * implements them today; a real client must return the same. */

/** A person's role inside one client organisation. */
export type Role = 'owner' | 'admin' | 'supervisor' | 'front_desk' | 'viewer'

/** bitNtech's own accounts, above every organisation. Never self-assigned:
 * the master admin is seeded, staff join by a master admin's invitation. */
export type PlatformRole = 'master_admin' | 'staff'

/** An organisation starts in review after sign-up; the master admin or
 * staff approve or decline it. Only the master admin can suspend one. */
export type OrgStatus = 'pending_review' | 'active' | 'declined' | 'suspended'

export type BusinessType = 'hospital' | 'clinic' | 'diagnostics' | 'other'
export type Language = 'tamil' | 'english' | 'tanglish'

export interface Membership {
  orgSlug: string
  orgName: string
  city: string
  role: Role
  orgStatus: OrgStatus
  /** Why an organisation was declined or suspended, in words for the client. */
  statusReason?: string
}

export interface User {
  id: string
  name: string
  email: string
  platformRole?: PlatformRole
  memberships: Membership[]
}

export interface Session {
  user: User
  /** "Keep me signed in": no sign-out after inactivity. */
  remember: boolean
  /** ISO timestamp. */
  expiresAt: string
}

export interface SignInInput {
  email: string
  password: string
  /** Keep the session after the browser closes. */
  remember: boolean
}

export interface SignUpInput {
  name: string
  email: string
  phone: string
  password: string
  business: {
    name: string
    type: BusinessType
    city: string
    languages: Language[]
  }
  acceptedTerms: boolean
}

export interface Invite {
  email: string
  /** The organisation, or "BitNTech" for a staff invitation. */
  orgName: string
  role: Role | PlatformRole
  invitedBy: string
  /** ISO timestamp. */
  expiresAt: string
}

export interface AcceptInviteInput {
  name: string
  password: string
}

/** A business waiting for bitNtech to approve its sign-up. */
export interface SignupRequest {
  orgSlug: string
  orgName: string
  businessType: BusinessType
  city: string
  languages: Language[]
  owner: { name: string; email: string; phone: string; emailVerified: boolean }
  /** ISO timestamp. */
  submittedAt: string
}

export interface OrgSummary {
  slug: string
  name: string
  city: string
  businessType: BusinessType
  status: OrgStatus
  statusReason?: string
  ownerEmail: string
  /** ISO timestamp. */
  createdAt: string
}

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'account_locked'
  | 'rate_limited'
  | 'network'
  | 'invalid_token'
  | 'expired_token'
  | 'used_token'
  | 'weak_password'
  | 'email_taken'
  | 'email_unverified'
  | 'forbidden'
  | 'invalid_input'
  | 'unknown'

export class AuthError extends Error {
  readonly code: AuthErrorCode
  /** Seconds until the caller may try again (rate_limited only). */
  readonly retryAfter?: number

  constructor(code: AuthErrorCode, message: string, retryAfter?: number) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.retryAfter = retryAfter
  }
}

export interface AuthClient {
  /** Whether this client talks to a real backend. The UI labels mock mode. */
  readonly isDemo: boolean
  restore(): Promise<Session | null>
  signIn(input: SignInInput): Promise<Session>
  signOut(): Promise<void>

  /** Creates the owner account and an organisation in review. The owner
   * must verify their email before they can sign in. */
  signUp(input: SignUpInput): Promise<{ email: string }>
  /** Resolves whether or not the account exists. */
  resendVerification(email: string): Promise<void>
  verifyEmail(token: string): Promise<{ email: string }>
  /** For a signed-in person with no organisation yet (e.g. after Google
   * sign-in): creates their business, in review. */
  completeBusiness(business: SignUpInput['business']): Promise<Session>

  /** Resolves whether or not the account exists, so the response never
   * reveals which emails have accounts. */
  requestPasswordReset(email: string): Promise<void>
  /** Returns the email the reset link was issued for. */
  verifyResetToken(token: string): Promise<{ email: string }>
  resetPassword(token: string, password: string): Promise<void>
  getInvite(token: string): Promise<Invite>
  acceptInvite(token: string, input: AcceptInviteInput): Promise<Session>

  /* ---- bitNtech only. The server must check the caller's platform role;
     the UI hiding a button is not access control. ---- */
  listSignupRequests(): Promise<SignupRequest[]>
  reviewSignup(orgSlug: string, decision: 'approve' | 'decline', reason?: string): Promise<void>
  listOrgs(): Promise<OrgSummary[]>
  /** Master admin only. */
  setOrgSuspended(orgSlug: string, suspended: boolean, reason?: string): Promise<void>

  /** Where "Continue with Google" goes; absent when Google isn't offered. */
  googleSignInUrl?(): string

  /** Mock only: the links a real backend would have emailed. */
  lastResetToken?(): string | null
  lastVerifyToken?(): string | null
}

export function asAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err
  return new AuthError('unknown', 'Something went wrong on our side. Try again in a moment.')
}
