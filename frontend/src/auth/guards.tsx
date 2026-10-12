import { Fragment, type ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { FullScreenStatus } from '../components/auth/FullScreenStatus'
import { canOpen, type ConsolePage } from '../console/access'
import { homeFor, useAuth } from './AuthProvider'

function safePath(p: unknown): string | null {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : null
}

/** Pages for signed-in users. Others go to /login and come back after —
 * or to /signed-out or /session-expired when their session just ended. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, endReason } = useAuth()
  const location = useLocation()
  if (status === 'restoring') return <FullScreenStatus />
  if (status === 'signedOut') {
    const from = location.pathname + location.search
    if (endReason === 'signedOut') return <Navigate to="/signed-out" replace />
    if (endReason === 'expired') return <Navigate to="/session-expired" replace state={{ from }} />
    return <Navigate to="/login" replace state={{ from }} />
  }
  return children
}

/** bitNtech pages. Client accounts get the no-access page. The server must
 * make the same check on every ops call. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return (
    <RequireAuth>
      {user?.platformRole ? children : <Navigate to="/403" replace />}
    </RequireAuth>
  )
}

/** An organisation page (/o/:slug/...). The person must belong to that
 * organisation, it must be active, and their role must be allowed the page
 * (console/access.ts). Someone in the organisation whose role can't open the
 * page goes to its Home, which says why. The server must make the same check
 * on every call. */
export function RequireOrgPage({ page, children }: { page: ConsolePage; children: ReactNode }) {
  return (
    <RequireAuth>
      <OrgPageGate page={page}>{children}</OrgPageGate>
    </RequireAuth>
  )
}

function OrgPageGate({ page, children }: { page: ConsolePage; children: ReactNode }) {
  const { user } = useAuth()
  const { slug } = useParams()
  if (!user) return null
  const org = user.memberships.find((m) => m.orgSlug === slug)
  if (!org) return <Navigate to="/403" replace />
  // In review, declined or suspended: the status pages explain why.
  if (org.orgStatus !== 'active') return <Navigate to={homeFor(user)} replace />
  if (!canOpen(org.role, page)) return <Navigate to={`/o/${org.orgSlug}`} replace state={{ deniedPage: page }} />
  // Keyed by organisation: switching organisation starts each page afresh,
  // so one organisation's data never shows under another's name.
  return <Fragment key={org.orgSlug}>{children}</Fragment>
}

/** Pages for signed-out users. A signed-in user is sent on to where they
 * were headed before /login, or to their home. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()
  if (status === 'restoring') return <FullScreenStatus />
  if (status === 'signedIn' && user) {
    const from = safePath((location.state as { from?: string } | null)?.from)
    const home = homeFor(user)
    // A client can't be sent into /ops, and staff can't be sent into a client org.
    const allowed = from && (from.startsWith('/ops') ? !!user.platformRole : !user.platformRole)
    return <Navigate to={allowed ? from : home} replace />
  }
  return children
}
