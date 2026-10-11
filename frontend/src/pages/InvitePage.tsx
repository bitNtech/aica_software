import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { homeFor, useAuth } from '../auth/AuthProvider'
import { ROLE_LABEL, ROLE_PLAIN } from '../auth/roles'
import { asAuthError, type AuthError, type Invite } from '../auth/types'
import { validateConfirm, validateName, validateNewPassword } from '../auth/validation'
import { AuthLayout } from '../components/auth/AuthLayout'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { PasswordField, TextField } from '../components/ui/Field'
import { PasswordStrength } from '../components/ui/PasswordStrength'
import { Spinner } from '../components/ui/Spinner'
import { useFormErrors } from '../lib/useFormErrors'

type Load = { state: 'loading' } | { state: 'ready'; invite: Invite } | { state: 'bad'; error: AuthError }

function daysLeft(iso: string): string {
  const d = Math.ceil((Date.parse(iso) - Date.now()) / 864e5)
  return d <= 1 ? 'today' : `in ${d} days`
}

/** /invite/:token — states the organisation and the role, in plain words,
 * before asking for anything. */
export default function InvitePage() {
  const { token = '' } = useParams()
  const { client, acceptInvite } = useAuth()
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setLoad({ state: 'loading' })
    client.getInvite(token).then(
      (invite) => live && setLoad({ state: 'ready', invite }),
      (err) => live && setLoad({ state: 'bad', error: asAuthError(err) }),
    )
    return () => {
      live = false
    }
  }, [client, token])

  useEffect(() => {
    if (error) alertRef.current?.focus()
  }, [error])

  const invite = load.state === 'ready' ? load.invite : null
  const form = useFormErrors({
    name: validateName(name),
    password: validateNewPassword(password, invite?.email),
    confirm: validateConfirm(password, confirm),
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy || !form.check()) return
    setBusy(true)
    setError(null)
    try {
      const session = await acceptInvite(token, { name: name.trim(), password })
      navigate(homeFor(session.user), { replace: true })
    } catch (err) {
      setError(asAuthError(err))
      setBusy(false)
    }
  }

  if (load.state === 'loading') {
    return (
      <AuthLayout kicker="Invitation" docTitle="Opening invitation" voice="busy" title="Opening your invitation…">
        <div className="loading-row">
          <Spinner label="Opening your invitation" />
          <span>This takes a second.</span>
        </div>
      </AuthLayout>
    )
  }

  if (load.state === 'bad') {
    const { code } = load.error
    const used = code === 'used_token'
    return (
      <AuthLayout
        kicker="Invitation"
        docTitle="Invitation unavailable"
        voice="error"
        title={
          used ? (
            <>
              You've already <em>joined.</em>
            </>
          ) : code === 'expired_token' ? (
            <>
              This invitation has <em>expired.</em>
            </>
          ) : (
            <>
              This invitation doesn't <em>work.</em>
            </>
          )
        }
        lede={
          <p>
            {used
              ? 'This invitation was accepted already. Sign in with the email it was sent to.'
              : code === 'expired_token'
                ? 'Invitations last 7 days. Ask the person who invited you to send a new one.'
                : 'The link may be incomplete. Open it again from the email, or ask your practice admin for a new invitation.'}
          </p>
        }
      >
        <div className="form">
          <Link className={`btn btn--block ${used ? 'btn--orange' : 'btn--line'}`} to="/login">
            <span>{used ? 'Go to sign in' : 'Back to sign in'}</span>
          </Link>
        </div>
      </AuthLayout>
    )
  }

  const inv = load.invite
  return (
    <AuthLayout
      kicker="Invitation"
      docTitle={`Join ${inv.orgName}`}
      voice={busy ? 'busy' : error ? 'error' : undefined}
      title={
        <>
          Join {inv.orgName}
          <em>.</em>
        </>
      }
    >
      <section className="invite" aria-label="Your invitation">
        <div className="invite__row">
          <span className="label label--quiet">Your role</span>
          <span className="chip">{ROLE_LABEL[inv.role]}</span>
        </div>
        <p className="invite__plain">{ROLE_PLAIN[inv.role]}</p>
        <p className="invite__meta">
          Invited by {inv.invitedBy} <i aria-hidden="true">·</i> expires {daysLeft(inv.expiresAt)}
        </p>
      </section>

      {error && (
        <Alert tone="error" ref={alertRef} className="form__alert" title="We couldn't set up your account">
          <p>{error.message}</p>
        </Alert>
      )}

      <form className="form" noValidate onSubmit={onSubmit}>
        <TextField label="Work email" type="email" name="username" autoComplete="username" value={inv.email} readOnly hint="Set by your invitation." />
        <TextField
          ref={form.ref('name')}
          label="Your name"
          name="name"
          autoComplete="name"
          autoFocus
          placeholder="As your team knows you"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={form.blur('name')}
          error={form.shown('name')}
        />
        <PasswordField
          ref={form.ref('password')}
          label="Create a password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={form.blur('password')}
          error={form.shown('password')}
          below={<PasswordStrength password={password} email={inv.email} />}
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
        <Button type="submit" block arrow busy={busy} busyLabel="Setting up…">
          Accept and join
        </Button>
      </form>
      <p className="form__after">
        Not you, or not expecting this? You can ignore it — nothing happens until you accept.
      </p>
    </AuthLayout>
  )
}
