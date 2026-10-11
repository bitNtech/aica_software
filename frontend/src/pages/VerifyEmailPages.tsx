import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { asAuthError, type AuthError } from '../auth/types'
import { AuthLayout } from '../components/auth/AuthLayout'
import { useCountdown } from '../components/auth/useCountdown'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'

const RESEND_AFTER = 30

/** /signup/verify — right after sign-up, or from /login when the email
 * isn't verified yet. */
export function VerifyEmailSentPage() {
  const { client } = useAuth()
  const location = useLocation()
  const state = location.state as { email?: string; fromLogin?: boolean } | null
  const email = state?.email ?? ''
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const [resendAt, setResendAt] = useState<number | null>(() => (state?.fromLogin ? null : Date.now() + RESEND_AFTER * 1000))
  const wait = useCountdown(resendAt)

  if (!email) return <Navigate to="/signup" replace />

  async function resend() {
    setBusy(true)
    setError(null)
    try {
      await client.resendVerification(email)
      setResent(true)
      setResendAt(Date.now() + RESEND_AFTER * 1000)
    } catch (err) {
      setError(asAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  const demoToken = client.lastVerifyToken?.() ?? null

  return (
    <AuthLayout
      kicker="Verify email"
      docTitle="Verify your email"
      voice={busy ? 'busy' : 'ok'}
      title={
        <>
          Confirm your <em>email.</em>
        </>
      }
      lede={
        <p>
          {state?.fromLogin ? 'Before you can sign in, confirm ' : 'We sent a link to '}
          <strong className="auth__em">{email}</strong>
          {state?.fromLogin ? '. Use the link in the email we sent, or ask for a new one.' : '. Open it to confirm the address.'}
        </p>
      }
    >
      {error && (
        <Alert tone="error" className="form__alert" title="We couldn't send that">
          <p>{error.message}</p>
        </Alert>
      )}
      {resent && !error && (
        <Alert tone="ok" className="form__alert">
          Sent again. Allow a minute, and check spam.
        </Alert>
      )}
      {demoToken && (
        <Alert tone="info" className="form__alert" title="Demo mode: no email was sent">
          <p>
            <Link className="link" to={`/verify/${demoToken}`}>
              Open the verification link
            </Link>{' '}
            a real backend would email.
          </p>
        </Alert>
      )}

      <ol className="steps-list">
        <li>Confirm your email with the link we sent.</li>
        <li>bitNtech reviews your business and contacts you to plan setup.</li>
        <li>Once approved, sign in and invite your team.</li>
      </ol>

      <div className="form__row">
        <Button variant="line" busy={busy} busyLabel="Sending…" disabled={wait > 0} onClick={() => void resend()}>
          {wait > 0 ? `Resend in ${wait}s` : 'Resend link'}
        </Button>
        <Link className="btn-text" to="/login" state={{ email }}>
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  )
}

/** /verify/:token — the page the emailed link opens. */
export function VerifyEmailPage() {
  const { token = '' } = useParams()
  const { client } = useAuth()
  const [result, setResult] = useState<{ state: 'checking' } | { state: 'ok'; email: string } | { state: 'bad'; error: AuthError }>({
    state: 'checking',
  })

  useEffect(() => {
    let live = true
    client.verifyEmail(token).then(
      ({ email }) => live && setResult({ state: 'ok', email }),
      (err) => live && setResult({ state: 'bad', error: asAuthError(err) }),
    )
    return () => {
      live = false
    }
  }, [client, token])

  if (result.state === 'checking') {
    return (
      <AuthLayout kicker="Verify email" docTitle="Verifying email" voice="busy" title="Confirming your email…">
        <div className="loading-row">
          <Spinner label="Confirming your email" />
          <span>This takes a second.</span>
        </div>
      </AuthLayout>
    )
  }

  if (result.state === 'bad') {
    const expired = result.error.code === 'expired_token'
    return (
      <AuthLayout
        kicker="Verify email"
        docTitle={expired ? 'Link expired' : 'Link not valid'}
        voice="error"
        title={
          expired ? (
            <>
              This link has <em>expired.</em>
            </>
          ) : (
            <>
              This link doesn't <em>work.</em>
            </>
          )
        }
        lede={
          <p>
            {expired
              ? 'Verification links last 3 days. Sign in and we’ll offer to send a new one.'
              : 'It may have been used already — if so, just sign in. Otherwise open the latest email we sent.'}
          </p>
        }
      >
        <div className="form">
          <Link className="btn btn--orange btn--block" to="/login">
            <span>Go to sign in</span>
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      kicker="Verify email"
      docTitle="Email confirmed"
      voice="ok"
      title={
        <>
          Email <em>confirmed.</em>
        </>
      }
      lede={
        <p>
          Thanks — <strong className="auth__em">{result.email}</strong> is confirmed. Sign in to follow your request.
        </p>
      }
    >
      <div className="form">
        <Link className="btn btn--orange btn--block" to="/login" state={{ email: result.email }}>
          <span>Sign in</span>
          <span className="arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>
    </AuthLayout>
  )
}
