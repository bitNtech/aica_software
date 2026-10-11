import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../auth/mockClient'
import { asAuthError, type AuthError } from '../auth/types'
import { validateEmail, validatePasswordEntered } from '../auth/validation'
import { AuthLayout } from '../components/auth/AuthLayout'
import { GoogleButton, OrDivider } from '../components/auth/GoogleButton'
import { formatClock, useCountdown } from '../components/auth/useCountdown'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Checkbox, PasswordField, TextField } from '../components/ui/Field'
import { useFormErrors } from '../lib/useFormErrors'

export default function LoginPage() {
  const { signIn, client } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const googleError = GOOGLE_ERRORS[params.get('error') ?? '']
  const prefill = (location.state as { email?: string; notice?: string } | null) ?? {}

  const [email, setEmail] = useState(prefill.email ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const left = useCountdown(lockedUntil)

  const form = useFormErrors({ email: validateEmail(email), password: validatePasswordEntered(password) })

  useEffect(() => {
    if (lockedUntil && left === 0) {
      setLockedUntil(null)
      setError(null)
    }
  }, [left, lockedUntil])

  useEffect(() => {
    if (error) alertRef.current?.focus()
  }, [error])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy || lockedUntil) return
    if (!form.check()) return
    setBusy(true)
    setError(null)
    try {
      // On success the /login guard redirects to the console.
      await signIn({ email: email.trim(), password, remember })
    } catch (err) {
      const ae = asAuthError(err)
      if (ae.code === 'email_unverified') {
        navigate('/signup/verify', { state: { email: email.trim(), fromLogin: true } })
        return
      }
      setError(ae)
      if (ae.code === 'rate_limited' && ae.retryAfter) setLockedUntil(Date.now() + ae.retryAfter * 1000)
      if (ae.code === 'invalid_credentials') setPassword('')
      setBusy(false)
    }
  }

  function resetDemo() {
    try {
      localStorage.removeItem('aica.demo.db')
    } catch {
      /* storage blocked: nothing saved anyway */
    }
    window.location.reload()
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail)
    setPassword(DEMO_PASSWORD)
    setError(null)
  }

  return (
    <AuthLayout
      kicker="Sign in"
      docTitle="Sign in"
      title={
        <>
          Welcome <em>back.</em>
        </>
      }
      lede={<p>Sign in with your work email. bitNtech and client accounts use the same page.</p>}
      voice={busy ? 'busy' : error ? 'error' : undefined}
    >
      {googleError && !error && (
        <Alert tone="error" className="form__alert" title={googleError.title}>
          <p>{googleError.text}</p>
        </Alert>
      )}
      {prefill.notice && !error && (
        <Alert tone="ok" className="form__alert">
          {prefill.notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" ref={alertRef} className="form__alert" title={errorTitle(error)}>
          <ErrorBody error={error} left={left} />
        </Alert>
      )}

      {client.googleSignInUrl && (
        <div className="form__alt">
          <GoogleButton href={client.googleSignInUrl()} />
          <OrDivider />
        </div>
      )}

      <form className={client.googleSignInUrl ? 'form form--after-alt' : 'form'} noValidate onSubmit={onSubmit}>
        <TextField
          ref={form.ref('email')}
          label="Work email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={!prefill.email}
          placeholder="name@hospital.in"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={form.blur('email')}
          error={form.shown('email')}
        />

        <PasswordField
          ref={form.ref('password')}
          label="Password"
          name="password"
          autoComplete="current-password"
          autoFocus={!!prefill.email}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={form.blur('password')}
          error={form.shown('password')}
          aside={
            <Link className="field__aside link" to="/reset" state={{ email: email.trim() }}>
              Forgot password?
            </Link>
          }
        />

        <Checkbox
          label="Keep me signed in"
          hint="Leave this off on a shared front-desk computer."
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />

        <Button type="submit" block arrow busy={busy} busyLabel="Signing in…" disabled={!!lockedUntil}>
          {lockedUntil ? `Try again in ${formatClock(left)}` : 'Sign in'}
        </Button>
      </form>

      <div className="signup-cta">
        <p>
          <strong>New to AICA?</strong> Bring it to your front desk.
        </p>
        <Link className="btn btn--line btn--sm" to="/signup">
          <span>Sign up your business</span>
          <span className="arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>
      <p className="form__after">Joining a team that already uses AICA? Ask its admin for an invite.</p>

      {client.isDemo && (
        <details className="demo">
          <summary>
            <span className="label label--quiet">Demo accounts</span>
            <span className="demo__chev" aria-hidden="true" />
          </summary>
          <p className="demo__note">
            Pick one to fill the form. Password for all: <code>{DEMO_PASSWORD}</code>. Invites:{' '}
            <Link className="link" to="/invite/demo">
              team
            </Link>
            ,{' '}
            <Link className="link" to="/invite/staff">
              bitNtech staff
            </Link>
            . Data is kept in this browser;{' '}
            <button type="button" className="btn-text" onClick={resetDemo}>
              reset demo data
            </button>
            .
          </p>
          <ul className="demo__list">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button type="button" className="demo__pick" onClick={() => fillDemo(a.email)}>
                  <span className="demo__who">{a.label}</span>
                  <span className="demo__mail">{a.email}</span>
                  <span className="demo__what">{a.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </AuthLayout>
  )
}

const GOOGLE_ERRORS: Record<string, { title: string; text: string }> = {
  google_cancelled: { title: 'Google sign-in was cancelled', text: 'Try again, or sign in with your email and password.' },
  google_failed: { title: "Google sign-in didn't finish", text: 'Try again. If it keeps happening, sign in with your email and password.' },
  google_unavailable: { title: 'Google sign-in is not set up yet', text: 'Sign in with your email and password for now.' },
  account_locked: { title: 'This account is locked', text: 'Ask your practice admin to unlock it, or write to support@bitntech.in.' },
}

function errorTitle(e: AuthError): string {
  switch (e.code) {
    case 'invalid_credentials':
      return "That email and password don't match"
    case 'account_locked':
      return 'This account is locked'
    case 'rate_limited':
      return 'Too many attempts'
    case 'network':
      return "We couldn't reach AICA"
    default:
      return 'Something went wrong'
  }
}

function ErrorBody({ error, left }: { error: AuthError; left: number }) {
  switch (error.code) {
    case 'invalid_credentials':
      return (
        <p>
          Check for typos, or{' '}
          <Link className="link" to="/reset">
            reset your password
          </Link>
          .
        </p>
      )
    case 'account_locked':
      return (
        <p>
          Ask your practice admin to unlock it, or write to{' '}
          <a className="link" href="mailto:support@bitntech.in">
            support@bitntech.in
          </a>
          .
        </p>
      )
    case 'rate_limited':
      return left > 0 ? (
        <p>
          For your account's safety, sign-in is paused. Try again in <strong>{formatClock(left)}</strong>.
        </p>
      ) : (
        <p>You can try again now.</p>
      )
    case 'network':
      return <p>Check your connection and try again. Your details are still in the form.</p>
    default:
      return <p>{error.message}</p>
  }
}
