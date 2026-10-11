import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { asAuthError, type AuthError } from '../auth/types'
import { validateEmail } from '../auth/validation'
import { AuthLayout } from '../components/auth/AuthLayout'
import { useCountdown } from '../components/auth/useCountdown'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/Field'
import { useFormErrors } from '../lib/useFormErrors'

const RESEND_AFTER = 30

/** Request a reset link. Two steps in one card: the email, then "check your
 * inbox". The answer is the same whether or not the account exists. */
export default function ForgotPasswordPage() {
  const { client } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '')
  const [step, setStep] = useState<'request' | 'sent'>('request')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const [resendAt, setResendAt] = useState<number | null>(null)
  const [resent, setResent] = useState(false)
  const alertRef = useRef<HTMLDivElement>(null)
  const wait = useCountdown(resendAt)

  const form = useFormErrors({ email: validateEmail(email) })

  useEffect(() => {
    if (error) alertRef.current?.focus()
  }, [error])

  async function send(isResend: boolean) {
    setBusy(true)
    setError(null)
    try {
      await client.requestPasswordReset(email.trim())
      setStep('sent')
      setResent(isResend)
      setResendAt(Date.now() + RESEND_AFTER * 1000)
    } catch (err) {
      setError(asAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy || !form.check()) return
    void send(false)
  }

  // Demo only: a real backend emails this link instead.
  const demoToken = client.lastResetToken?.() ?? null

  if (step === 'sent') {
    return (
      <AuthLayout
        kicker="Reset password"
        docTitle="Check your inbox"
        step={step}
        voice={busy ? 'busy' : 'ok'}
        title={
          <>
            Check your <em>inbox.</em>
          </>
        }
        lede={
          <p>
            If <strong className="auth__em">{email.trim()}</strong> has an AICA account, a link to reset the password is on its
            way. It works once, for an hour.
          </p>
        }
      >
        {error && (
          <Alert tone="error" ref={alertRef} className="form__alert" title="We couldn't send that">
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
              <Link className="link" to={`/reset/${demoToken}`}>
                Open the reset link
              </Link>{' '}
              a real backend would email.
            </p>
          </Alert>
        )}

        <ul className="steps-list">
          <li>Open the email from AICA and use the button in it.</li>
          <li>Nothing there after a few minutes? Check spam or promotions.</li>
        </ul>

        <div className="form__row">
          <Button variant="line" busy={busy} busyLabel="Sending…" disabled={wait > 0} onClick={() => void send(true)}>
            {wait > 0 ? `Resend in ${wait}s` : 'Resend link'}
          </Button>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              setStep('request')
              setResendAt(null)
              setResent(false)
            }}
          >
            Use a different email
          </button>
        </div>

        <p className="form__after">
          <Link className="link" to="/login" state={{ email: email.trim() }}>
            ← Back to sign in
          </Link>
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      kicker="Reset password"
      docTitle="Reset password"
      step={step}
      voice={busy ? 'busy' : error ? 'error' : undefined}
      title={
        <>
          Forgot your <em>password?</em>
        </>
      }
      lede={<p>Enter your work email and we'll send a link to choose a new one.</p>}
    >
      {error && (
        <Alert tone="error" ref={alertRef} className="form__alert" title="We couldn't send that">
          <p>{error.message}</p>
        </Alert>
      )}
      <form className="form" noValidate onSubmit={onSubmit}>
        <TextField
          ref={form.ref('email')}
          label="Work email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          placeholder="name@hospital.in"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={form.blur('email')}
          error={form.shown('email')}
        />
        <Button type="submit" block arrow busy={busy} busyLabel="Sending link…">
          Send reset link
        </Button>
      </form>
      <p className="form__after">
        Remembered it?{' '}
        <Link className="link" to="/login" state={{ email: email.trim() }}>
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
