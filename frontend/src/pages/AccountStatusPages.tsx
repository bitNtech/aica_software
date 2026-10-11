import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { homeFor, IDLE_MS, useAuth } from '../auth/AuthProvider'
import { STATUS_LABEL } from '../auth/roles'
import type { Membership } from '../auth/types'
import { AuthLayout } from '../components/auth/AuthLayout'
import { Button } from '../components/ui/Button'

function SignOutButton({ variant = 'line' }: { variant?: 'line' | 'plum' }) {
  const { signOut } = useAuth()
  const [leaving, setLeaving] = useState(false)
  return (
    <Button
      variant={variant}
      block
      busy={leaving}
      busyLabel="Signing out…"
      onClick={() => {
        setLeaving(true)
        void signOut()
      }}
    >
      Sign out
    </Button>
  )
}

function StatusRow({ m }: { m: Membership }) {
  return (
    <div className="status-card">
      <div className="status-card__head">
        <span className="status-card__name">{m.orgName}</span>
        <span className={`status-chip status-chip--${m.orgStatus}`}>{STATUS_LABEL[m.orgStatus]}</span>
      </div>
      <p className="status-card__meta">{m.city}</p>
      {m.statusReason && (
        <p className="status-card__reason">
          <span className="label label--quiet">Reason</span>
          {m.statusReason}
        </p>
      )}
    </div>
  )
}

/** /pending — an owner whose business is still in review, or was declined. */
export function PendingPage() {
  const { user } = useAuth()
  if (!user) return null
  const target = homeFor(user)
  if (target !== '/pending') return <Navigate to={target} replace />

  const declined = user.memberships.filter((m) => m.orgStatus === 'declined')
  const inReview = user.memberships.filter((m) => m.orgStatus === 'pending_review')
  const onlyDeclined = inReview.length === 0 && declined.length > 0

  return (
    <AuthLayout
      kicker={onlyDeclined ? 'Not approved' : 'In review'}
      docTitle={onlyDeclined ? 'Request not approved' : 'Request in review'}
      voice={onlyDeclined ? 'error' : 'idle'}
      title={
        onlyDeclined ? (
          <>
            We couldn't approve this <em>request.</em>
          </>
        ) : (
          <>
            You're on the <em>list.</em>
          </>
        )
      }
      lede={
        <p>
          {onlyDeclined
            ? 'The reason is below. If something has changed, or you think this is a mistake, write to us and we’ll look again.'
            : `Thanks, ${user.name.split(' ')[0]}. bitNtech is reviewing your business. You’ll be able to sign in to the console once it’s approved.`}
        </p>
      }
    >
      <div className="status-list">
        {[...inReview, ...declined].map((m) => (
          <StatusRow key={m.orgSlug} m={m} />
        ))}
      </div>

      {!onlyDeclined && (
        <ol className="steps-list">
          <li>bitNtech checks the details you sent.</li>
          <li>We contact you to plan your setup.</li>
          <li>Once approved, sign in here and invite your team.</li>
        </ol>
      )}

      <div className="form">
        {onlyDeclined && (
          <a className="btn btn--orange btn--block" href="mailto:support@bitntech.in?subject=AICA%20sign-up%20request">
            <span>Write to support@bitntech.in</span>
          </a>
        )}
        <SignOutButton />
      </div>
    </AuthLayout>
  )
}

/** /suspended — every organisation this person belongs to is suspended. */
export function SuspendedPage() {
  const { user } = useAuth()
  if (!user) return null
  const target = homeFor(user)
  if (target !== '/suspended') return <Navigate to={target} replace />
  const suspended = user.memberships.filter((m) => m.orgStatus === 'suspended')

  return (
    <AuthLayout
      kicker="Access paused"
      docTitle="Access paused"
      voice="error"
      title={
        <>
          Access is <em>paused.</em>
        </>
      }
      lede={
        <p>
          bitNtech has paused this organisation's console, so your team can't sign in until access is restored. The reason is
          below.
        </p>
      }
    >
      <div className="status-list">
        {suspended.map((m) => (
          <StatusRow key={m.orgSlug} m={m} />
        ))}
      </div>
      <div className="form">
        <a className="btn btn--orange btn--block" href="mailto:support@bitntech.in?subject=AICA%20access%20paused">
          <span>Write to support@bitntech.in</span>
        </a>
        <SignOutButton />
      </div>
    </AuthLayout>
  )
}

/** /signed-out — confirms a deliberate sign-out. */
export function SignedOutPage() {
  const { clearEndReason } = useAuth()
  useEffect(() => clearEndReason(), [clearEndReason])
  return (
    <AuthLayout
      kicker="Signed out"
      docTitle="Signed out"
      voice="idle"
      title={
        <>
          You've signed <em>out.</em>
        </>
      }
      lede={<p>On a shared front-desk computer, close the browser too.</p>}
    >
      <div className="form">
        <Link className="btn btn--orange btn--block" to="/login">
          <span>Sign in again</span>
          <span className="arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>
    </AuthLayout>
  )
}

/** /session-expired — signed out after inactivity. Signing back in returns
 * to the page they were on. */
export function SessionExpiredPage() {
  const { clearEndReason } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  useEffect(() => clearEndReason(), [clearEndReason])
  return (
    <AuthLayout
      kicker="Session ended"
      docTitle="Session ended"
      voice="idle"
      title={
        <>
          Signed out to keep things <em>safe.</em>
        </>
      }
      lede={
        <p>
          Nothing happened on this computer for {Math.round(IDLE_MS / 60_000)} minutes, so we signed you out. Sign in to pick up
          where you left off.
        </p>
      }
    >
      <div className="form">
        <Link className="btn btn--orange btn--block" to="/login" state={from ? { from } : undefined}>
          <span>Sign in again</span>
          <span className="arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>
      <p className="form__after">Tick “Keep me signed in” next time if this is your own computer.</p>
    </AuthLayout>
  )
}
