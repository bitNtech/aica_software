import {
  AuthError,
  type AcceptInviteInput,
  type AuthClient,
  type BusinessType,
  type Invite,
  type Language,
  type Membership,
  type OrgStatus,
  type OrgSummary,
  type PlatformRole,
  type Role,
  type Session,
  type SignInInput,
  type SignUpInput,
  type SignupRequest,
  type User,
} from './types'
import { normalisePhone, validateEmail, validateNewPassword } from './validation'

/**
 * A stand-in for the auth backend, so the pages can be built and reviewed
 * before one exists. No request leaves the browser. Its "database" lives in
 * this browser's localStorage so a demo survives a reload (sign up → sign out
 * → approve as master admin → sign in as the owner). Nothing here is secure,
 * and it is never meant to be: passwords sit in plain text in storage, and
 * every role check is the honour system. Swap in a real AuthClient.
 */

export const DEMO_PASSWORD = 'aica-demo-2026'

export interface DemoAccount {
  email: string
  label: string
  note: string
}

/** Shown on the sign-in page in demo mode. Organisations are fictional. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'master@example.com', label: 'Master admin', note: 'bitNtech, manages everything' },
  { email: 'ops@example.com', label: 'bitNtech staff', note: 'Reviews sign-ups, cannot suspend' },
  { email: 'frontdesk@example.com', label: 'Front desk', note: 'One hospital, goes straight in' },
  { email: 'admin@example.com', label: 'Admin', note: 'Two hospitals, picks one' },
  { email: 'pending@example.com', label: 'Sign-up in review', note: 'Waiting for bitNtech' },
  { email: 'suspended@example.com', label: 'Suspended org', note: 'Access paused by bitNtech' },
  { email: 'locked@example.com', label: 'Locked account', note: 'Shows the locked state' },
  { email: 'offline@example.com', label: 'Network failure', note: 'Shows the offline error' },
]

interface DbOrg {
  slug: string
  name: string
  city: string
  type: BusinessType
  languages: Language[]
  status: OrgStatus
  statusReason?: string
  createdAt: string
}

interface DbUser {
  id: string
  name: string
  email: string
  phone: string
  password: string
  verified: boolean
  locked?: boolean
  platformRole?: PlatformRole
  memberships: { orgSlug: string; role: Role }[]
}

interface DbInvite extends Invite {
  orgSlug?: string
  used?: boolean
}

interface Db {
  v: 1
  orgs: DbOrg[]
  users: DbUser[]
  invites: Record<string, DbInvite>
  /** token → email */
  resetTokens: Record<string, string>
  verifyTokens: Record<string, string>
}

const DAY = 864e5
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString()

function seed(): Db {
  const user = (id: string, name: string, email: string, extra: Partial<DbUser> = {}): DbUser => ({
    id,
    name,
    email,
    phone: '9876543210',
    password: DEMO_PASSWORD,
    verified: true,
    memberships: [],
    ...extra,
  })
  return {
    v: 1,
    orgs: [
      { slug: 'arogya-demo', name: 'Arogya Demo Hospital', city: 'Coimbatore', type: 'hospital', languages: ['tamil', 'english', 'tanglish'], status: 'active', createdAt: ago(120) },
      { slug: 'nila-eye-demo', name: 'Nila Eye Clinic (demo)', city: 'Madurai', type: 'clinic', languages: ['tamil', 'tanglish'], status: 'active', createdAt: ago(60) },
      { slug: 'kaveri-scan-demo', name: 'Kaveri Scans (demo)', city: 'Tiruchirappalli', type: 'diagnostics', languages: ['tamil', 'english'], status: 'pending_review', createdAt: ago(2) },
      { slug: 'thendral-demo', name: 'Thendral Child Clinic (demo)', city: 'Salem', type: 'clinic', languages: ['tamil', 'tanglish'], status: 'pending_review', createdAt: ago(0.2) },
      { slug: 'marutham-demo', name: 'Marutham Hospital (demo)', city: 'Erode', type: 'hospital', languages: ['tamil'], status: 'suspended', statusReason: 'The annual licence lapsed on 30 September. Renew it to restore access.', createdAt: ago(400) },
    ],
    users: [
      user('u_master', 'Vikram S', 'master@example.com', { platformRole: 'master_admin' }),
      user('u_ops', 'Divya K', 'ops@example.com', { platformRole: 'staff' }),
      user('u_frontdesk', 'Meena S', 'frontdesk@example.com', { memberships: [{ orgSlug: 'arogya-demo', role: 'front_desk' }] }),
      user('u_admin', 'Karthik R', 'admin@example.com', {
        memberships: [
          { orgSlug: 'arogya-demo', role: 'admin' },
          { orgSlug: 'nila-eye-demo', role: 'owner' },
        ],
      }),
      user('u_pending', 'Sathish V', 'pending@example.com', { phone: '9445012345', memberships: [{ orgSlug: 'kaveri-scan-demo', role: 'owner' }] }),
      user('u_thendral', 'Dr. Anitha M', 'anitha@example.com', { phone: '9003312345', verified: false, memberships: [{ orgSlug: 'thendral-demo', role: 'owner' }] }),
      user('u_suspended', 'Ravi P', 'suspended@example.com', { memberships: [{ orgSlug: 'marutham-demo', role: 'owner' }] }),
      user('u_locked', 'Locked User', 'locked@example.com', { locked: true, memberships: [{ orgSlug: 'arogya-demo', role: 'viewer' }] }),
    ],
    invites: {
      demo: { email: 'newstaff@example.com', orgName: 'Arogya Demo Hospital', orgSlug: 'arogya-demo', role: 'supervisor', invitedBy: 'Karthik R', expiresAt: ahead(6) },
      staff: { email: 'newops@example.com', orgName: 'BitNTech', role: 'staff', invitedBy: 'Vikram S', expiresAt: ahead(3) },
      expired: { email: 'late@example.com', orgName: 'Arogya Demo Hospital', orgSlug: 'arogya-demo', role: 'viewer', invitedBy: 'Karthik R', expiresAt: ago(1) },
      used: { email: 'joined@example.com', orgName: 'Arogya Demo Hospital', orgSlug: 'arogya-demo', role: 'viewer', invitedBy: 'Karthik R', expiresAt: ahead(1), used: true },
    },
    resetTokens: {},
    verifyTokens: { 'demo-verify': 'anitha@example.com' },
  }
}

const DB_KEY = 'aica.demo.db'
const SESSION_KEY = 'aica.demo.session'
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60_000

function loadDb(): Db {
  try {
    const raw = window.localStorage.getItem(DB_KEY)
    if (raw) {
      const db = JSON.parse(raw) as Db
      if (db.v === 1) return db
    }
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return seed()
}

function store(remember: boolean): Storage | null {
  try {
    return remember ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

interface Saved {
  id: string
  remember: boolean
}

function readSaved(): Saved | null {
  for (const remember of [false, true]) {
    try {
      const v = store(remember)?.getItem(SESSION_KEY)
      if (v) return { id: v, remember }
    } catch {
      /* storage blocked: no saved session */
    }
  }
  return null
}

function clearSaved() {
  for (const remember of [false, true]) {
    try {
      store(remember)?.removeItem(SESSION_KEY)
    } catch {
      /* nothing to clear */
    }
  }
}

const token = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 10)}`

function slugify(name: string, taken: (s: string) => boolean): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  let slug = base
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`
  return slug
}

const NETWORK = () => new AuthError('network', "We couldn't reach AICA. Check your connection and try again.")

export interface MockOptions {
  /** Simulated round trip, in ms. Tests pass 0. */
  latency?: number
}

export function createMockAuthClient({ latency = 750 }: MockOptions = {}): AuthClient {
  const db = loadDb()
  const attempts = new Map<string, { count: number; until: number }>()
  let currentId: string | null = readSaved()?.id ?? null
  let lastReset: string | null = null
  let lastVerify: string | null = null

  const save = () => {
    try {
      window.localStorage.setItem(DB_KEY, JSON.stringify(db))
    } catch {
      /* storage blocked: changes last until reload */
    }
  }

  const wait = () =>
    new Promise<void>((resolve, reject) => {
      const ms = latency ? latency * (0.8 + Math.random() * 0.5) : 0
      setTimeout(() => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) reject(NETWORK())
        else resolve()
      }, ms)
    })

  const org = (slug: string) => db.orgs.find((o) => o.slug === slug)
  const byEmail = (email: string) => db.users.find((u) => u.email === email.trim().toLowerCase())

  const publicUser = (u: DbUser): User => ({
    id: u.id,
    name: u.name,
    email: u.email,
    platformRole: u.platformRole,
    memberships: u.memberships.flatMap((m): Membership[] => {
      const o = org(m.orgSlug)
      return o
        ? [{ orgSlug: o.slug, orgName: o.name, city: o.city, role: m.role, orgStatus: o.status, statusReason: o.statusReason }]
        : []
    }),
  })

  const session = (u: DbUser, remember: boolean): Session => ({
    user: publicUser(u),
    remember,
    expiresAt: new Date(Date.now() + 8 * 36e5).toISOString(),
  })

  const start = (u: DbUser, remember: boolean): Session => {
    clearSaved()
    try {
      store(remember)?.setItem(SESSION_KEY, u.id)
    } catch {
      /* storage blocked: the session lasts until reload */
    }
    currentId = u.id
    return session(u, remember)
  }

  const requireStaff = (masterOnly = false) => {
    const me = db.users.find((u) => u.id === currentId)
    if (!me?.platformRole || (masterOnly && me.platformRole !== 'master_admin')) {
      throw new AuthError('forbidden', masterOnly ? 'Only the master admin can do that.' : 'Only bitNtech accounts can do that.')
    }
    return me
  }

  const ownerOf = (slug: string) => db.users.find((u) => u.memberships.some((m) => m.orgSlug === slug && m.role === 'owner'))
  /** The person bitNtech contacts: the owner, else the first admin. */
  const contactOf = (slug: string) =>
    ownerOf(slug) ?? db.users.find((u) => u.memberships.some((m) => m.orgSlug === slug && m.role === 'admin'))

  return {
    isDemo: true,

    async restore() {
      const saved = readSaved()
      const u = saved ? db.users.find((x) => x.id === saved.id && !x.locked) : undefined
      currentId = u?.id ?? null
      return u ? session(u, saved!.remember) : null
    },

    async signIn({ email, password, remember }: SignInInput) {
      await wait()
      const key = email.trim().toLowerCase()
      if (key === 'offline@example.com') throw NETWORK()
      const now = Date.now()
      const a = attempts.get(key)
      if (a && a.until > now) {
        throw new AuthError('rate_limited', 'Too many attempts.', Math.ceil((a.until - now) / 1000))
      }
      const u = byEmail(key)
      if (!u || u.password !== password) {
        const count = (a && a.until !== 0 && a.until <= now ? 0 : (a?.count ?? 0)) + 1
        attempts.set(key, { count, until: count >= MAX_ATTEMPTS ? now + LOCKOUT_MS : 0 })
        if (count >= MAX_ATTEMPTS) throw new AuthError('rate_limited', 'Too many attempts.', LOCKOUT_MS / 1000)
        throw new AuthError('invalid_credentials', "That email and password don't match.")
      }
      if (u.locked) throw new AuthError('account_locked', 'This account is locked.')
      if (!u.verified) throw new AuthError('email_unverified', 'Verify your email before signing in.')
      attempts.delete(key)
      return start(u, remember)
    },

    async signOut() {
      clearSaved()
      currentId = null
    },

    async signUp(input: SignUpInput) {
      await wait()
      const email = input.email.trim().toLowerCase()
      if (validateEmail(email) || !input.acceptedTerms || input.business.languages.length === 0) {
        throw new AuthError('invalid_input', 'Some details are missing. Check the form and try again.')
      }
      const weak = validateNewPassword(input.password, email)
      if (weak) throw new AuthError('weak_password', weak)
      if (byEmail(email)) {
        throw new AuthError('email_taken', 'An account with this email already exists.')
      }
      const slug = slugify(input.business.name, (s) => !!org(s))
      db.orgs.push({
        slug,
        name: input.business.name.trim(),
        city: input.business.city.trim(),
        type: input.business.type,
        languages: input.business.languages,
        status: 'pending_review',
        createdAt: new Date().toISOString(),
      })
      db.users.push({
        id: token('u_'),
        name: input.name.trim(),
        email,
        phone: normalisePhone(input.phone),
        password: input.password,
        verified: false,
        memberships: [{ orgSlug: slug, role: 'owner' }],
      })
      const t = token('v')
      db.verifyTokens[t] = email
      lastVerify = t
      save()
      return { email }
    },

    async completeBusiness(business) {
      await wait()
      const me = db.users.find((u) => u.id === currentId)
      if (!me) throw new AuthError('invalid_input', 'Sign in to continue.')
      if (me.platformRole || me.memberships.length) throw new AuthError('invalid_input', 'Your account already belongs to an organisation.')
      const slug = slugify(business.name, (s) => !!org(s))
      db.orgs.push({ slug, name: business.name.trim(), city: business.city.trim(), type: business.type, languages: business.languages, status: 'pending_review', createdAt: new Date().toISOString() })
      me.memberships.push({ orgSlug: slug, role: 'owner' })
      save()
      return session(me, readSaved()?.remember ?? false)
    },

    async resendVerification(email: string) {
      await wait()
      const u = byEmail(email)
      if (u && !u.verified) {
        const t = token('v')
        db.verifyTokens[t] = u.email
        lastVerify = t
        save()
      }
    },

    lastVerifyToken() {
      return lastVerify
    },

    async verifyEmail(t: string) {
      await wait()
      if (t === 'expired') throw new AuthError('expired_token', 'This verification link has expired.')
      const email = db.verifyTokens[t]
      const u = email ? byEmail(email) : undefined
      if (!u) throw new AuthError('invalid_token', "This verification link isn't valid.")
      // Idempotent: opening the same link twice (or React running the effect
      // twice in dev) confirms again rather than failing.
      u.verified = true
      save()
      return { email: u.email }
    },

    async requestPasswordReset(email: string) {
      await wait()
      const t = token('r')
      db.resetTokens[t] = email.trim().toLowerCase()
      lastReset = t
      save()
    },

    lastResetToken() {
      return lastReset
    },

    async verifyResetToken(t: string) {
      await wait()
      if (t === 'expired') throw new AuthError('expired_token', 'This reset link has expired.')
      const email = db.resetTokens[t]
      if (!email) throw new AuthError('invalid_token', "This reset link isn't valid.")
      return { email }
    },

    async resetPassword(t: string, password: string) {
      await wait()
      const email = db.resetTokens[t]
      if (!email) throw new AuthError('invalid_token', "This reset link isn't valid.")
      const weak = validateNewPassword(password, email)
      if (weak) throw new AuthError('weak_password', weak)
      const u = byEmail(email)
      if (u) {
        u.password = password
        // Following the emailed link proves the inbox, same as verifying.
        u.verified = true
      }
      delete db.resetTokens[t]
      attempts.delete(email)
      save()
    },

    async getInvite(t: string) {
      await wait()
      const invite = db.invites[t]
      if (!invite) throw new AuthError('invalid_token', "This invitation link isn't valid.")
      if (invite.used) throw new AuthError('used_token', 'This invitation has already been accepted.')
      if (Date.parse(invite.expiresAt) < Date.now()) throw new AuthError('expired_token', 'This invitation has expired.')
      return { email: invite.email, orgName: invite.orgName, role: invite.role, invitedBy: invite.invitedBy, expiresAt: invite.expiresAt }
    },

    async acceptInvite(t: string, { name, password }: AcceptInviteInput) {
      await wait()
      const invite = db.invites[t]
      if (!invite || invite.used) throw new AuthError('invalid_token', "This invitation link isn't valid.")
      const weak = validateNewPassword(password, invite.email)
      if (weak) throw new AuthError('weak_password', weak)
      invite.used = true
      const staff = invite.role === 'staff' || invite.role === 'master_admin'
      const u: DbUser = {
        id: token('u_'),
        name: name.trim(),
        email: invite.email,
        phone: '',
        password,
        verified: true,
        platformRole: staff ? (invite.role as PlatformRole) : undefined,
        memberships: !staff && invite.orgSlug ? [{ orgSlug: invite.orgSlug, role: invite.role as Role }] : [],
      }
      db.users.push(u)
      save()
      return start(u, false)
    },

    async listSignupRequests() {
      await wait()
      requireStaff()
      return db.orgs
        .filter((o) => o.status === 'pending_review')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((o): SignupRequest => {
          const owner = ownerOf(o.slug)
          return {
            orgSlug: o.slug,
            orgName: o.name,
            businessType: o.type,
            city: o.city,
            languages: o.languages,
            owner: { name: owner?.name ?? '—', email: owner?.email ?? '—', phone: owner?.phone ?? '', emailVerified: !!owner?.verified },
            submittedAt: o.createdAt,
          }
        })
    },

    async reviewSignup(slug, decision, reason) {
      await wait()
      requireStaff()
      const o = org(slug)
      if (!o || o.status !== 'pending_review') throw new AuthError('invalid_input', 'This request was already handled.')
      if (decision === 'approve') {
        if (!ownerOf(slug)?.verified) throw new AuthError('invalid_input', "The owner hasn't verified their email yet.")
        o.status = 'active'
        delete o.statusReason
      } else {
        if (!reason?.trim()) throw new AuthError('invalid_input', 'Give the business a reason.')
        o.status = 'declined'
        o.statusReason = reason.trim()
      }
      save()
    },

    async listOrgs() {
      await wait()
      requireStaff()
      return db.orgs.map(
        (o): OrgSummary => ({
          slug: o.slug,
          name: o.name,
          city: o.city,
          businessType: o.type,
          status: o.status,
          statusReason: o.statusReason,
          ownerEmail: contactOf(o.slug)?.email ?? '—',
          createdAt: o.createdAt,
        }),
      )
    },

    async setOrgSuspended(slug, suspended, reason) {
      await wait()
      requireStaff(true)
      const o = org(slug)
      if (!o) throw new AuthError('invalid_input', 'Organisation not found.')
      if (suspended) {
        if (o.status !== 'active') throw new AuthError('invalid_input', 'Only an active organisation can be suspended.')
        if (!reason?.trim()) throw new AuthError('invalid_input', 'Give the organisation a reason.')
        o.status = 'suspended'
        o.statusReason = reason.trim()
      } else {
        if (o.status !== 'suspended') throw new AuthError('invalid_input', 'This organisation is not suspended.')
        o.status = 'active'
        delete o.statusReason
      }
      save()
    },
  }
}
