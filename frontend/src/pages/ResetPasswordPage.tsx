import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { asAuthError, type AuthError } from '../auth/types'
import { validateConfirm, validateNewPassword } from '../auth/validation'
import { AuthLayout } from '../components/auth/AuthLayout'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { PasswordField } from '../components/ui/Field'
import { PasswordStrength } from '../components/ui/PasswordStrength'
import { Spinner } from '../components/ui/Spinner'
import { useFormErrors } from '../lib/useFormErrors'

type Link_ = { state: 'checking' } | { state: 'valid'; email: string } | { state: 'bad'; error: AuthError }

/** /reset/:token — the page the emailed link opens. */
export default function ResetPasswordPage() {
  const { token = '' } = useParams()
  const { client } = useAuth()
  const navigate = useNavigate()
  const [link, setLink] = useState<Link_>({ state: 'checking' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setLink({ state: 'checking' })
    client.verifyResetToken(token).then(
      ({ email }) => live && setLink({ state: 'valid', email }),
      (err) => live && setLink({ state: 'bad', error: asAuthError(err) }),
    )
    return () => {
      live = false
    }
  }, [client, token])

  useEffect(() => {
    if (error) alertRef.current?.focus()
  }, [error])

  const email = link.state === 'valid' ? link.email : ''
  const form = useFormErrors({
    password: validateNewPassword(password, email),
    confirm: validateConfirm(password, confirm),
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy || !form.check()) return
    setBusy(true)
    setError(null)
    try {
      await client.resetPassword(token, password)
      navigate('/login', { replace: true, state: { email, notice: 'Password changed. Sign in with your new password.' } })
    } catch (err) {
      setError(asAuthError(err))
      setBusy(false)
    }
  }

  if (link.state === 'checking') {
    return (
      <AuthLayout kicker="Reset password" docTitle="Checking link" voice="busy" title="Checking your link…">
        <div className="loading-row">
          <Spinner label="Checking your reset link" />
          <span>This takes a second.</span>
        </div>
      </AuthLayout>
    )
  }

  if (link.state === 'bad') {
    const expired = link.error.code === 'expired_token'
    return (
      <AuthLayout
        kicker="Reset password"
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
              ? 'Reset links last an hour and work once. Ask for a fresh one — it only takes a moment.'
              : "It may have been used already, or copied only in part. Ask for a new link and open it from the latest email."}
          </p>
        }
      >
        <div className="form">
          <Link className="btn btn--orange btn--block" to="/reset">
            <span>Send a new link</span>
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </div>
        <p className="form__after">
          <Link className="link" to="/login">
            ← Back to sign in
          </Link>
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      kicker="Reset password"
      docTitle="Choose a new password"
      voice={busy ? 'busy' : error ? 'error' : undefined}
      title={
        <>
          Choose a new <em>password.</em>
        </>
      }
      lede={
        <p>
          For <strong className="auth__em">{email}</strong>.
        </p>
      }
    >
      {error && (
        <Alert tone="error" ref={alertRef} className="form__alert" title="Password not changed">
          <p>{error.message}</p>
        </Alert>
      )}
      <form className="form" noValidate onSubmit={onSubmit}>
        {/* Lets password managers file the new password under the right account. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <PasswordField
          ref={form.ref('password')}
          label="New password"
          name="new-password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={form.blur('password')}
          error={form.shown('password')}
          below={<PasswordStrength password={password} email={email} />}
        />
        <PasswordField
          ref={form.ref('confirm')}
          label="Type it again"
          name="confirm-password"
          autoComplete="new-password"
          capsWarning={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={form.blur('confirm')}
          error={form.shown('confirm')}
        />
        <Button type="submit" block arrow busy={busy} busyLabel="Saving…">
          Save new password
        </Button>
      </form>
    </AuthLayout>
  )
}
