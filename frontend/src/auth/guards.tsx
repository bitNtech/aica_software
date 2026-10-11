import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { FullScreenStatus } from '../components/auth/FullScreenStatus'
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
