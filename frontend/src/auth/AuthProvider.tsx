import { createContext, startTransition, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthError, type AcceptInviteInput, type AuthClient, type Impersonator, type Session, type SignInInput, type User } from './types'

type Status = 'restoring' | 'signedOut' | 'signedIn'

/** Why the last session ended, so the guard can say so: a deliberate
 * sign-out goes to /signed-out, inactivity to /session-expired. */
export type EndReason = 'signedOut' | 'expired' | null

interface AuthValue {
  client: AuthClient
  status: Status
  user: User | null
  /** Set while a master admin acts as `user`. */
  impersonator: Impersonator | null
  endReason: EndReason
  signIn(input: SignInInput): Promise<Session>
  acceptInvite(token: string, input: AcceptInviteInput): Promise<Session>
  /** Signed in already: join the invitation's organisation with this account. */
  joinInvite(token: string): Promise<Session>
  signOut(): Promise<void>
  /** Master admin only: become `userId` until endActing() or expiry.
   * `go` runs before the new session applies, so the caller can leave a
   * page the new user may not see (an Ops page, a client page) first. */
  actAs(userId: string, reason: string, go: (s: Session) => void): Promise<Session>
  /** Back to the master admin's own session; `go` as for actAs. */
  endActing(go: (s: Session) => void): Promise<Session>
  /** Replaces the session with a fresh one from the server, e.g. after the business step. */
  setSession(s: Session): void
  /** Called by /signed-out and /session-expired once they have shown it. */
  clearEndReason(): void
}

const AuthContext = createContext<AuthValue | null>(null)

/** Signed out after this long without a key press or click, unless "keep me
 * signed in" was ticked. A real backend must enforce its own expiry too. */
export const IDLE_MS = 30 * 60_000
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export function AuthProvider({
  client,
  idleMs = IDLE_MS,
  children,
}: {
  client: AuthClient
  idleMs?: number
  children: ReactNode
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<Status>('restoring')
  const [endReason, setEndReason] = useState<EndReason>(null)

  useEffect(() => {
    let live = true
    client
      .restore()
      .catch(() => null)
      .then((s) => {
        if (!live) return
        setSession(s)
        setStatus(s ? 'signedIn' : 'signedOut')
      })
    return () => {
      live = false
    }
  }, [client])

  const take = useCallback((s: Session) => {
    setSession(s)
    setStatus('signedIn')
    setEndReason(null)
    return s
  }, [])

  const end = useCallback(
    async (reason: Exclude<EndReason, null>) => {
      await client.signOut().catch(() => undefined)
      setSession(null)
      setStatus('signedOut')
      setEndReason(reason)
    },
    [client],
  )

  const remember = session?.remember ?? false
  useEffect(() => {
    if (status !== 'signedIn' || remember) return
    let last = Date.now()
    const bump = () => {
      last = Date.now()
    }
    ACTIVITY.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const timer = window.setInterval(
      () => {
        if (Date.now() - last >= idleMs) void end('expired')
      },
      Math.min(30_000, Math.max(10, idleMs / 4)),
    )
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, bump))
      window.clearInterval(timer)
    }
  }, [status, remember, idleMs, end])

  const signIn = useCallback((input: SignInInput) => client.signIn(input).then(take), [client, take])
  const acceptInvite = useCallback(
    (token: string, input: AcceptInviteInput) => client.acceptInvite(token, input).then(take),
    [client, take],
  )
  const joinInvite = useCallback(
    (token: string) =>
      client.joinInvite
        ? client.joinInvite(token).then(take)
        : Promise.reject(new AuthError('unknown', 'Joining with an existing account needs the AICA server. It isn’t available in demo mode.')),
    [client, take],
  )
  const signOut = useCallback(() => end('signedOut'), [end])
  const swap = useCallback(
    (go: (s: Session) => void) => (s: Session) => {
      // React Router applies navigation as a transition. Swapping the session
      // in the same transition renders both together, so no guard ever sees
      // the new user on the old page (and bounces them to /403).
      startTransition(() => {
        go(s)
        take(s)
      })
      return s
    },
    [take],
  )
  const actAs = useCallback(
    (userId: string, reason: string, go: (s: Session) => void) => client.actAs(userId, reason).then(swap(go)),
    [client, swap],
  )
  const endActing = useCallback((go: (s: Session) => void) => client.endActing().then(swap(go)), [client, swap])
  const clearEndReason = useCallback(() => setEndReason(null), [])

  const value = useMemo<AuthValue>(
    () => ({
      client,
      status,
      user: session?.user ?? null,
      impersonator: session?.impersonator ?? null,
      endReason,
      signIn,
      acceptInvite,
      joinInvite,
      signOut,
      actAs,
      endActing,
      setSession: take,
      clearEndReason,
    }),
    [client, status, session, endReason, signIn, acceptInvite, joinInvite, signOut, actAs, endActing, take, clearEndReason],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthValue {
  const v = use(AuthContext)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}

/** Where a user lands after signing in:
 * bitNtech accounts → /ops; one active organisation → straight in; several →
 * the chooser; none active yet → the status page that explains why. */
export function homeFor(user: User): string {
  if (user.platformRole) return '/ops'
  const active = user.memberships.filter((m) => m.orgStatus === 'active')
  if (active.length === 1) return `/o/${active[0].orgSlug}`
  if (active.length > 1) return '/choose'
  if (user.memberships.some((m) => m.orgStatus === 'suspended')) return '/suspended'
  // Signed in (e.g. with Google) but no business yet.
  if (user.memberships.length === 0) return '/signup/business'
  return '/pending'
}
