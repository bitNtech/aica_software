import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { homeFor, useAuth } from '../auth/AuthProvider'
import { ROLE_LABEL, STATUS_LABEL } from '../auth/roles'
import { asAuthError, type Device, type NotificationKey, type NotificationPrefs, type Role, type User } from '../auth/types'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/Dialog'
import { Checkbox, TextField } from '../components/ui/Field'
import { Spinner } from '../components/ui/Spinner'
import { Wordmark } from '../components/ui/Wordmark'
import { useAsync } from '../lib/useAsync'
import { timeAgo } from '../lib/time'
import { useAnnouncer } from './console/operate/LiveBits'
import './Account.css'

type Who = Role | 'staff'
/** Each email, and who it's for. */
const NOTIFICATIONS: { key: NotificationKey; label: string; hint: string; for: Who[] }[] = [
  { key: 'handoff_missed', label: 'A caller hung up waiting for a person', hint: 'So someone calls them back.', for: ['owner', 'admin', 'supervisor', 'front_desk'] },
  { key: 'callback_assigned', label: 'A callback is given to you', hint: 'With who to call and why.', for: ['owner', 'admin', 'supervisor', 'front_desk'] },
  { key: 'daily_summary', label: 'Each evening: the day’s calls', hint: 'Calls, handovers and anything left open.', for: ['owner', 'admin', 'supervisor', 'viewer'] },
  { key: 'weekly_report', label: 'Monday morning: last week’s report', hint: 'The same figures as Analytics and reports.', for: ['owner', 'admin', 'supervisor', 'viewer'] },
  { key: 'agent_published', label: 'An agent is published or rolled back', hint: 'Who did it, and their note.', for: ['owner', 'admin', 'supervisor'] },
  { key: 'team_changes', label: 'Someone joins, leaves or changes role', hint: 'For your organisation’s team.', for: ['owner', 'admin'] },
  { key: 'billing', label: 'Invoices and payment problems', hint: 'Sent to owners.', for: ['owner'] },
  { key: 'signup_requests', label: 'A new organisation signs up', hint: 'So it can be reviewed quickly.', for: ['staff'] },
  { key: 'service_alerts', label: 'A speech, voice or language service is slow or down', hint: 'And when it recovers.', for: ['staff'] },
]

export const rolesOf = (u: User): Who[] => [...new Set<Who>([...u.memberships.map((m) => m.role), ...(u.platformRole ? (['staff'] as const) : [])])]

/** /account: every signed-in person's own settings. */
export default function AccountPage() {
  const { user, impersonator, signOut } = useAuth()
  const [leaving, setLeaving] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    document.title = 'Your account · AICA'
    heading.current?.focus()
  }, [])

  if (!user) return null
  // bitNtech staff keep their account inside Ops.
  if (user.platformRole && !impersonator) return <Navigate to="/ops/profile" replace />
  // Someone in one organisation keeps their account inside its console.
  const active = user.memberships.filter((m) => m.orgStatus === 'active')
  if (!user.platformRole && active.length === 1) return <Navigate to={`/o/${active[0].orgSlug}/profile`} replace />
  const home = homeFor(user)
  const back = user.platformRole ? 'Back to Ops' : user.memberships.filter((m) => m.orgStatus === 'active').length === 1 ? `Back to ${user.memberships.find((m) => m.orgStatus === 'active')!.orgName}` : 'Back'

  return (
    <div className="acct">
      <a className="skip-link" href="#acct-main">
        Skip to content
      </a>
      <header className="acct__bar">
        <Link to={home} className="acct__brand" aria-label="AICA home">
          <Wordmark by={false} />
        </Link>
        <Link to={home} className="link acct__back">
          ← {back}
        </Link>
        <button
          type="button"
          className="acct__out"
          disabled={leaving}
          onClick={() => {
            setLeaving(true)
            void signOut()
          }}
        >
          {leaving ? 'Signing out…' : 'Sign out'}
        </button>
      </header>
      <main id="acct-main" className="acct__main" tabIndex={-1}>
        <p className="label">Account</p>
        <h1 ref={heading} tabIndex={-1} className="display acct__title">
          Your account
        </h1>
        {impersonator ? (
          <Alert tone="info" title={`You're acting as ${user.name}`}>
            <p>Their name, password, signed-in browsers and emails are theirs to change. Stop acting to see your own account.</p>
          </Alert>
        ) : (
          <>
            <Profile user={user} />
            <Password email={user.email} />
            <Devices />
            <Notifications who={rolesOf(user)} />
          </>
        )}
        <Organisations user={user} />
      </main>
    </div>
  )
}

/** Shown when the backend has no endpoint for a section yet. */
function NotYet() {
  return <p className="row__meta">Not available yet: this needs the account API.</p>
}

export function Profile({ user }: { user: User }) {
  const { client, setSession } = useAuth()
  const id = useId()
  const [name, setName] = useState(user.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, say] = useAnnouncer()
  const field = useRef<HTMLInputElement>(null)
  const dirty = name.trim() !== user.name

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy || !dirty || !client.updateProfile) return
    const clean = name.trim()
    if (clean.length < 2) {
      setError('Enter your name, 2 to 60 characters.')
      field.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const s = await client.updateProfile({ name: clean })
      setSession(s)
      setName(s.user.name)
      say('Name saved.')
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="acct-card" aria-labelledby={`${id}-h`}>
      <h2 className="acct-card__title" id={`${id}-h`}>
        Profile
      </h2>
      <p className="sr-only" role="status">
        {note}
      </p>
      {client.updateProfile ? (
        <form className="acct-form" onSubmit={save} noValidate>
          <TextField ref={field} label="Your name" autoComplete="name" maxLength={60} value={name} error={error} hint="Your team sees it on notes, callbacks and changes." onChange={(e) => setName(e.target.value)} />
          <div className="acct-form__row">
            <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…" aria-disabled={!dirty || undefined}>
              Save name
            </Button>
          </div>
        </form>
      ) : (
        <NotYet />
      )}
      <dl className="acct-facts">
        <div>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
      </dl>
      <p className="row__meta">{user.platformRole ? 'To change your email, ask the master admin.' : 'To change your email, ask an owner of your organisation to invite the new address.'}</p>
    </section>
  )
}

export function Password({ email }: { email: string }) {
  const { client } = useAuth()
  const id = useId()
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (state === 'busy') return
    setState('busy')
    setError(null)
    try {
      await client.requestPasswordReset(email)
      setState('sent')
    } catch (err) {
      setError(asAuthError(err).message)
      setState('idle')
    }
  }

  // Demo only: a real backend emails the link.
  const demoToken = state === 'sent' ? (client.lastResetToken?.() ?? null) : null
  return (
    <section className="acct-card" aria-labelledby={`${id}-h`}>
      <h2 className="acct-card__title" id={`${id}-h`}>
        Password
      </h2>
      <p>We email you a link to set a new one. The link works for an hour; your password doesn’t change until you use it.</p>
      <div className="acct-form__row">
        <Button variant="line" size="sm" busy={state === 'busy'} busyLabel="Sending…" onClick={() => void send()}>
          {state === 'sent' ? 'Send it again' : 'Email me a link'}
        </Button>
      </div>
      <div role="status">
        {state === 'sent' && (
          <p className="acct-ok">
            Sent to {email}.{' '}
            {demoToken && (
              <Link className="link" to={`/reset/${demoToken}`}>
                Open the link (demo)
              </Link>
            )}
          </p>
        )}
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export function Devices() {
  const { client } = useAuth()
  const id = useId()
  const load = useCallback(() => (client.listDevices ? client.listDevices() : Promise.resolve(null)), [client])
  const [list, reload, setList] = useAsync(load)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, say] = useAnnouncer()
  const headingRef = useRef<HTMLHeadingElement>(null)

  const drop = (keep: (d: Device) => boolean) => setList((r) => (r.state === 'ready' && r.data ? { ...r, data: r.data.filter(keep) } : r))

  async function one(d: Device) {
    if (!client.signOutDevice) return
    setBusy(d.id)
    setError(null)
    try {
      await client.signOutDevice(d.id)
      drop((x) => x.id !== d.id)
      say(`${d.label} is signed out.`)
      headingRef.current?.focus()
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  async function others() {
    if (!client.signOutOtherDevices) return
    setBusy('others')
    setError(null)
    try {
      const n = await client.signOutOtherDevices()
      drop((x) => x.current)
      setConfirm(false)
      say(n === 1 ? 'One other browser is signed out.' : `${n} other browsers are signed out.`)
      window.setTimeout(() => headingRef.current?.focus(), 0)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  const devices = list.state === 'ready' ? list.data : null
  const otherCount = devices?.filter((d) => !d.current).length ?? 0
  return (
    <section className="acct-card" aria-labelledby={`${id}-h`}>
      <h2 className="acct-card__title" id={`${id}-h`} ref={headingRef} tabIndex={-1}>
        Where you’re signed in
      </h2>
      <p className="sr-only" role="status">
        {note}
      </p>
      {list.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading…</span>
        </div>
      )}
      {list.state === 'error' && (
        <Alert tone="error" title="Couldn't load your browsers">
          <p>{asAuthError(list.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {list.state === 'ready' && !devices && <NotYet />}
      {devices && (
        <>
          <ul className="acct-devices">
            {devices.map((d) => (
              <li key={d.id}>
                <div>
                  <p className="acct-devices__label">
                    {d.label}
                    {d.current && <span className="status-chip status-chip--active">This one</span>}
                  </p>
                  <p className="row__meta">
                    {d.place} <i aria-hidden="true">·</i> {d.current ? 'active now' : `active ${timeAgo(d.lastActiveAt)}`}
                  </p>
                </div>
                {!d.current && (
                  <Button variant="line" size="sm" busy={busy === d.id} busyLabel="Signing out…" onClick={() => void one(d)} aria-label={busy === d.id ? undefined : `Sign out ${d.label}`}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {otherCount > 0 ? (
            <div className="acct-form__row">
              <Button variant="line" size="sm" onClick={() => setConfirm(true)}>
                Sign out everywhere else
              </Button>
            </div>
          ) : (
            <p className="row__meta">You’re signed in only here.</p>
          )}
        </>
      )}
      {error && !confirm && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Sign out ${otherCount === 1 ? 'the other browser' : `the other ${otherCount} browsers`}?`}
        confirmLabel="Sign out everywhere else"
        busyLabel="Signing out…"
        busy={busy === 'others'}
        error={confirm ? error : null}
        onConfirm={() => void others()}
        onCancel={() => {
          setConfirm(false)
          setError(null)
        }}
      >
        <p>Anyone using your account there has to sign in again. This browser stays signed in. If you think someone knows your password, change it too.</p>
      </ConfirmDialog>
    </section>
  )
}

export function Notifications({ who }: { who: Who[] }) {
  const { client } = useAuth()
  const id = useId()
  const load = useCallback(() => (client.getNotificationPrefs ? client.getNotificationPrefs() : Promise.resolve(null)), [client])
  const [prefs, reload, setPrefs] = useAsync(load)
  const [error, setError] = useState<string | null>(null)
  const [note, say] = useAnnouncer()
  const mine = NOTIFICATIONS.filter((n) => n.for.some((r) => who.includes(r)))

  async function toggle(key: NotificationKey, on: boolean) {
    if (prefs.state !== 'ready' || !prefs.data || !client.setNotificationPrefs) return
    const before = prefs.data
    const next: NotificationPrefs = { ...before, [key]: on }
    // Shown at once; put back if saving fails.
    setPrefs({ state: 'ready', data: next })
    setError(null)
    try {
      setPrefs({ state: 'ready', data: await client.setNotificationPrefs(next) })
      say(on ? 'Saved: you’ll get this email.' : 'Saved: you won’t get this email.')
    } catch (err) {
      setPrefs({ state: 'ready', data: before })
      setError(asAuthError(err).message)
    }
  }

  return (
    <section className="acct-card" aria-labelledby={`${id}-h`}>
      <h2 className="acct-card__title" id={`${id}-h`}>
        Emails
      </h2>
      <p className="sr-only" role="status">
        {note}
      </p>
      {prefs.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading…</span>
        </div>
      )}
      {prefs.state === 'error' && (
        <Alert tone="error" title="Couldn't load your email choices">
          <p>{asAuthError(prefs.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {prefs.state === 'ready' && !prefs.data && <NotYet />}
      {prefs.state === 'ready' && prefs.data && (
        <fieldset className="acct-prefs">
          <legend className="acct-legend">What we email you about. Each change saves at once. Sign-in and security emails always come.</legend>
          {mine.map((n) => (
            <Checkbox key={n.key} label={n.label} hint={n.hint} checked={prefs.data![n.key]} onChange={(e) => void toggle(n.key, e.target.checked)} />
          ))}
        </fieldset>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export function Organisations({ user }: { user: User }) {
  const id = useId()
  if (user.platformRole) {
    return (
      <section className="acct-card" aria-labelledby={`${id}-h`}>
        <h2 className="acct-card__title" id={`${id}-h`}>
          Your role
        </h2>
        <p>
          {ROLE_LABEL[user.platformRole]} at bitNtech. bitNtech accounts don’t belong to an organisation; {user.platformRole === 'master_admin' ? 'you can act as one of its users from Ops.' : 'you support them from Ops.'}
        </p>
      </section>
    )
  }
  return (
    <section className="acct-card" aria-labelledby={`${id}-h`}>
      <h2 className="acct-card__title" id={`${id}-h`}>
        Your organisations
      </h2>
      {user.memberships.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <ul className="acct-orgs">
          {user.memberships.map((m) => (
            <li key={m.orgSlug}>
              {m.orgStatus === 'active' ? (
                <Link className="link" to={`/o/${m.orgSlug}`}>
                  {m.orgName}
                </Link>
              ) : (
                <span>{m.orgName}</span>
              )}{' '}
              <span className="row__meta">
                {ROLE_LABEL[m.role]}
                {m.orgStatus !== 'active' && `, ${STATUS_LABEL[m.orgStatus].toLowerCase()}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="row__meta">Your role in each is set by its owners and admins.</p>
    </section>
  )
}
