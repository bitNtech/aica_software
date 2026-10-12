import {
  AuthError,
  type AcceptInviteInput,
  type AuditEntry,
  type AuthClient,
  type BusinessType,
  type Invite,
  type Language,
  type Membership,
  type OrgStatus,
  type OrgSummary,
  type Person,
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
  { email: 'supervisor@example.com', label: 'Supervisor', note: 'Reviews calls and agents, read-only builder' },
  { email: 'viewer@example.com', label: 'Viewer', note: 'Reads everything, changes nothing' },
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
  v: 2
  orgs: DbOrg[]
  users: DbUser[]
  invites: Record<string, DbInvite>
  /** token → email */
  resetTokens: Record<string, string>
  verifyTokens: Record<string, string>
  /** Added after v1 shipped; older saved demos lack it. */
  audit?: AuditEntry[]
}

/** A master admin acting as a client user. */
interface Acting {
  actorId: string
  targetId: string
  reason: string
  expiresAt: string
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
    v: 2,
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
      user('u_supervisor', 'Priya N', 'supervisor@example.com', { memberships: [{ orgSlug: 'arogya-demo', role: 'supervisor' }] }),
      user('u_viewer', 'Arun V', 'viewer@example.com', { memberships: [{ orgSlug: 'arogya-demo', role: 'viewer' }] }),
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
const ACTING_KEY = 'aica.demo.acting'
const ACT_AS_MS = 30 * 60_000
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60_000

function loadDb(): Db {
  try {
    const raw = window.localStorage.getItem(DB_KEY)
    if (raw) {
      const db = JSON.parse(raw) as Db
      if (db.v === 2) return db
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

function readActing(): Acting | null {
  try {
    const raw = window.sessionStorage.getItem(ACTING_KEY)
    return raw ? (JSON.parse(raw) as Acting) : null
  } catch {
    return null
  }
}

function writeActing(a: Acting | null) {
  try {
    if (a) window.sessionStorage.setItem(ACTING_KEY, JSON.stringify(a))
    else window.sessionStorage.removeItem(ACTING_KEY)
  } catch {
    /* storage blocked: acting lasts until reload */
  }
}

const ACTING_MSG = "You're acting as someone. End that first."
const LAST_MASTER_MSG = 'AICA needs at least one active master admin. Make someone else a master admin first.'

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
  let acting: Acting | null = readActing()
  db.audit ??= []
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

  const audit = (actor: string, action: string, target: string, detail = '') => {
    db.audit!.push({ at: new Date().toISOString(), actor, actorLabel: actor, action, target, targetLabel: target, detail })
  }

  const me = () => db.users.find((u) => u.id === currentId)

  /** The acting session this browser holds, if it is still good. The same
   * checks as the backend makes on every request. */
  const liveActing = (): { a: Acting; target: DbUser } | null => {
    if (!acting || acting.actorId !== currentId || Date.parse(acting.expiresAt) <= Date.now()) return null
    if (me()?.platformRole !== 'master_admin') return null
    const target = db.users.find((u) => u.id === acting!.targetId)
    return target && !target.locked && !target.platformRole ? { a: acting, target } : null
  }

  const session = (u: DbUser, remember: boolean): Session => {
    const live = u.id === currentId ? liveActing() : null
    const base = live ? live.target : u
    const actor = live ? me() : undefined
    return {
      user: publicUser(base),
      remember,
      expiresAt: new Date(Date.now() + 8 * 36e5).toISOString(),
      impersonator: live && actor ? { name: actor.name, email: actor.email, reason: live.a.reason, expiresAt: live.a.expiresAt } : null,
    }
  }

  const stopActing = () => {
    const live = liveActing()
    if (live) {
      audit(live.a.actorId, 'act_as_ended', live.a.targetId)
      save()
    }
    acting = null
    writeActing(null)
  }

  const start = (u: DbUser, remember: boolean): Session => {
    acting = null
    writeActing(null)
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
    if (liveActing()) throw new AuthError('forbidden', ACTING_MSG)
    const self = me()
    if (!self?.platformRole || (masterOnly && self.platformRole !== 'master_admin')) {
      throw new AuthError('forbidden', masterOnly ? 'Only the master admin can do that.' : 'Only bitNtech accounts can do that.')
    }
    return self
  }

  /** A master admin acting on someone else's account. */
  const other = (id: string, selfMessage = "You can't change your own account here.") => {
    const caller = requireStaff(true)
    if (id === caller.id) throw new AuthError('invalid_input', selfMessage)
    const u = db.users.find((x) => x.id === id)
    if (!u) throw new AuthError('invalid_input', "That account doesn't exist.")
    return { caller, u }
  }

  const keepAMaster = (u: DbUser) => {
    const others = db.users.filter((x) => x.platformRole === 'master_admin' && !x.locked && x.id !== u.id)
    if (u.platformRole === 'master_admin' && others.length === 0) throw new AuthError('invalid_input', LAST_MASTER_MSG)
  }

  const label = (v: string) => db.users.find((u) => u.id === v)?.email ?? v

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
      stopActing()
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
      if (liveActing()) throw new AuthError('forbidden', ACTING_MSG)
      const self = me()
      if (!self) throw new AuthError('invalid_input', 'Sign in to continue.')
      if (self.platformRole || self.memberships.length) throw new AuthError('invalid_input', 'Your account already belongs to an organisation.')
      const slug = slugify(business.name, (s) => !!org(s))
      db.orgs.push({ slug, name: business.name.trim(), city: business.city.trim(), type: business.type, languages: business.languages, status: 'pending_review', createdAt: new Date().toISOString() })
      self.memberships.push({ orgSlug: slug, role: 'owner' })
      save()
      return session(self, readSaved()?.remember ?? false)
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
        audit(currentId!, 'signup_approved', slug)
      } else {
        if (!reason?.trim()) throw new AuthError('invalid_input', 'Give the business a reason.')
        o.status = 'declined'
        o.statusReason = reason.trim()
        audit(currentId!, 'signup_declined', slug, o.statusReason)
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
          ownerId: contactOf(o.slug)?.id ?? '',
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
        audit(currentId!, 'org_suspended', slug, o.statusReason)
      } else {
        if (o.status !== 'suspended') throw new AuthError('invalid_input', 'This organisation is not suspended.')
        o.status = 'active'
        delete o.statusReason
        audit(currentId!, 'org_restored', slug)
      }
      save()
    },

    async inviteStaff(email, role) {
      await wait()
      const caller = requireStaff(true)
      const addr = email.trim().toLowerCase()
      if (validateEmail(addr)) throw new AuthError('invalid_input', 'Enter a valid email address.')
      if (byEmail(addr)) throw new AuthError('email_taken', 'That email already has an AICA account.')
      db.invites[token('i')] = { email: addr, orgName: 'BitNTech', role, invitedBy: caller.name, expiresAt: ahead(7) }
      audit(caller.id, 'staff_invited', addr, role)
      save()
    },

    async listPeople() {
      await wait()
      requireStaff(true)
      const rank = (r?: PlatformRole) => (r === 'master_admin' ? 0 : r === 'staff' ? 1 : 2)
      return [...db.users]
        .sort((a, b) => rank(a.platformRole) - rank(b.platformRole) || a.name.localeCompare(b.name))
        .map(
          (u): Person => ({
            id: u.id,
            name: u.name,
            email: u.email,
            platformRole: u.platformRole ?? null,
            disabled: !!u.locked,
            emailVerified: u.verified,
            memberships: u.memberships.map((m) => ({ orgSlug: m.orgSlug, orgName: org(m.orgSlug)?.name ?? m.orgSlug, role: m.role })),
            createdAt: null,
          }),
        )
    },

    async setPlatformRole(id, role, reason) {
      await wait()
      const { caller, u } = other(id)
      if ((u.platformRole ?? null) === role) throw new AuthError('invalid_input', 'They already have that role.')
      if (role && u.memberships.length) throw new AuthError('invalid_input', 'This is a client account. Invite their bitNtech email address instead.')
      if (role !== 'master_admin') keepAMaster(u)
      if (reason.trim().length < 10) throw new AuthError('invalid_input', 'Give a reason.')
      audit(caller.id, 'role_changed', u.id, `${u.platformRole ?? 'none'} → ${role ?? 'none'}: ${reason.trim()}`)
      u.platformRole = role ?? undefined
      save()
    },

    async setDisabled(id, disabled, reason) {
      await wait()
      const { caller, u } = other(id)
      if (disabled) {
        if (u.locked) throw new AuthError('invalid_input', 'This account is already disabled.')
        keepAMaster(u)
        if (!reason || reason.trim().length < 10) throw new AuthError('invalid_input', 'Give a reason.')
        u.locked = true
        audit(caller.id, 'user_disabled', u.id, reason.trim())
      } else {
        if (!u.locked) throw new AuthError('invalid_input', "This account isn't disabled.")
        u.locked = false
        audit(caller.id, 'user_enabled', u.id)
      }
      save()
    },

    async signOutEverywhere(id) {
      await wait()
      const { caller, u } = other(id, 'To sign yourself out, use Sign out.')
      audit(caller.id, 'sessions_revoked', u.id)
      save()
    },

    async actAs(id, reason) {
      await wait()
      const { caller, u } = other(id, "You can't act as yourself.")
      if (u.platformRole) throw new AuthError('invalid_input', "bitNtech accounts can't be acted as.")
      if (u.locked) throw new AuthError('invalid_input', 'This account is disabled.')
      if (reason.trim().length < 10) throw new AuthError('invalid_input', 'Give a reason.')
      acting = { actorId: caller.id, targetId: u.id, reason: reason.trim(), expiresAt: new Date(Date.now() + ACT_AS_MS).toISOString() }
      writeActing(acting)
      audit(caller.id, 'act_as_started', u.id, acting.reason)
      save()
      return session(caller, readSaved()?.remember ?? false)
    },

    async endActing() {
      await wait()
      const self = me()
      if (!self) throw new AuthError('invalid_input', 'Sign in to continue.')
      stopActing()
      return session(self, readSaved()?.remember ?? false)
    },

    async listAudit(query) {
      await wait()
      requireStaff(true)
      const filters = (['action', 'actor', 'target'] as const).filter((k) => query[k]?.trim())
      if (filters.length > 1) throw new AuthError('invalid_input', 'Filter on one thing at a time.')
      const key = filters[0]
      let value = key ? query[key]!.trim() : ''
      if (key && key !== 'action' && value.includes('@')) value = byEmail(value)?.id ?? value.toLowerCase()
      const rows = [...db.audit!]
        .reverse()
        .filter((e) => !key || e[key] === value)
        .filter((e) => !query.before || e.at < query.before)
      const page = rows.slice(0, 50)
      return {
        entries: page.map((e) => ({ ...e, actorLabel: label(e.actor), targetLabel: label(e.target) })),
        nextBefore: rows.length > 50 ? page[page.length - 1].at : null,
      }
    },
  }
}
