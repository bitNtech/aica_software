import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { homeFor, useAuth } from '../../auth/AuthProvider'
import { ROLE_LABEL } from '../../auth/roles'
import { asAuthError, type Person, type PlatformRole } from '../../auth/types'
import { validateEmail } from '../../auth/validation'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { ReasonForm } from '../../components/ui/ReasonForm'
import { Spinner } from '../../components/ui/Spinner'
import { useAsync } from '../../lib/useAsync'
import { initials } from '../ChooseOrgPage'

type Notice = { tone: 'ok' | 'error'; text: string }
type Panel = { id: string; kind: 'role' | 'disable' | 'act' } | null

const ROLE_CHOICES: { value: PlatformRole | null; label: string; plain: string }[] = [
  { value: 'master_admin', label: 'Master admin', plain: 'Everything, including people, the audit log and acting as clients.' },
  { value: 'staff', label: 'bitNtech staff', plain: 'Reviews sign-ups and sees every organisation.' },
  { value: null, label: 'No bitNtech role', plain: 'Loses access to Ops.' },
]

const INTERNAL = 'Write at least a short sentence. It goes in the audit log.'

/** /ops/people — master admins only. Every account, and what can be done to it. */
export default function OpsPeoplePage() {
  const { client, user, actAs } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const load = useCallback(() => client.listPeople(), [client])
  const [people, reload] = useAsync(load)
  const [panel, setPanel] = useState<Panel>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<Notice | null>(() => {
    const text = (location.state as { notice?: string } | null)?.notice
    return text ? { tone: 'ok', text } : null
  })

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key)
    setNotice(null)
    try {
      await action()
      setNotice({ tone: 'ok', text: done })
      setPanel(null)
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: asAuthError(err).message })
    } finally {
      setBusy(null)
    }
  }

  async function startActing(p: Person, reason: string) {
    setBusy(`act:${p.id}`)
    setNotice(null)
    try {
      await actAs(p.id, reason, (s) => navigate(homeFor(s.user), { replace: true }))
    } catch (err) {
      setNotice({ tone: 'error', text: asAuthError(err).message })
      setBusy(null)
    }
  }

  if (user?.platformRole !== 'master_admin') {
    return (
      <OpsLayout kicker="People" docTitle="People" title="People">
        <Alert tone="info">Only master admins can manage people.</Alert>
      </OpsLayout>
    )
  }

  const q = query.trim().toLowerCase()
  const list =
    people.state === 'ready'
      ? people.data.filter(
          (p) => !q || [p.name, p.email, ...p.memberships.map((m) => m.orgName)].some((v) => v.toLowerCase().includes(q)),
        )
      : []
  const bitntech = list.filter((p) => p.platformRole)
  const clients = list.filter((p) => !p.platformRole)

  const row = (p: Person) => (
    <PersonRow
      key={p.id}
      person={p}
      isMe={p.id === user.id}
      panel={panel?.id === p.id ? panel.kind : null}
      busy={busy}
      onPanel={(kind) => {
        setNotice(null)
        setPanel(kind ? { id: p.id, kind } : null)
      }}
      onRole={(role, reason) =>
        void run(
          `role:${p.id}`,
          () => client.setPlatformRole(p.id, role, reason),
          `${p.name} is now ${role ? ROLE_LABEL[role].toLowerCase() : 'without a bitNtech role'}. They've been signed out so it applies at once.`,
        )
      }
      onDisable={(reason) =>
        void run(`disable:${p.id}`, () => client.setDisabled(p.id, true, reason), `${p.name} is disabled and signed out everywhere.`)
      }
      onEnable={() => void run(`enable:${p.id}`, () => client.setDisabled(p.id, false), `${p.name} can sign in again.`)}
      onSignOut={() => void run(`out:${p.id}`, () => client.signOutEverywhere(p.id), `${p.name} is signed out everywhere.`)}
      onActAs={(reason) => void startActing(p, reason)}
    />
  )

  return (
    <OpsLayout
      kicker="People"
      docTitle="People"
      title={
        <>
          Everyone with <em>a key.</em>
        </>
      }
      lede={
        <p>
          Change bitNtech roles, disable accounts, sign people out, or act as a client to see what they see. Every change needs a reason
          and goes in the audit log.
        </p>
      }
    >
      <InviteForm onInvited={(text) => setNotice({ tone: 'ok', text })} />

      {notice && (
        <Alert tone={notice.tone} className="ops-section__notice">
          {notice.text}
        </Alert>
      )}

      {people.state === 'loading' && (
        <div className="loading-row">
          <Spinner label="Loading people" />
          <span>Loading people…</span>
        </div>
      )}

      {people.state === 'error' && (
        <Alert tone="error" title="Couldn't load people">
          <p>{asAuthError(people.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}

      {people.state === 'ready' && (
        <>
          <div className="people-search">
            <TextField
              label="Find a person"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, email or organisation"
              autoComplete="off"
            />
          </div>

          <section className="ops-section" aria-labelledby="bitntech-h">
            <div className="ops-section__head">
              <h2 id="bitntech-h" className="ops-section__title">
                bitNtech
              </h2>
              <p className="ops-section__note">{bitntech.length} accounts</p>
            </div>
            {bitntech.length ? <ul className="rows">{bitntech.map(row)}</ul> : <p className="empty-note">{q ? `No bitNtech accounts match “${query.trim()}”.` : 'No bitNtech accounts.'}</p>}
          </section>

          <section className="ops-section" aria-labelledby="clients-h">
            <div className="ops-section__head">
              <h2 id="clients-h" className="ops-section__title">
                Clients
              </h2>
              <p className="ops-section__note">{clients.length} accounts</p>
            </div>
            {clients.length ? <ul className="rows">{clients.map(row)}</ul> : <p className="empty-note">{q ? `No client accounts match “${query.trim()}”.` : 'No client accounts yet.'}</p>}
          </section>
        </>
      )}
    </OpsLayout>
  )
}

interface RowProps {
  person: Person
  isMe: boolean
  panel: 'role' | 'disable' | 'act' | null
  busy: string | null
  onPanel(kind: 'role' | 'disable' | 'act' | null): void
  onRole(role: PlatformRole | null, reason: string): void
  onDisable(reason: string): void
  onEnable(): void
  onSignOut(): void
  onActAs(reason: string): void
}

function PersonRow({ person: p, isMe, panel, busy, onPanel, onRole, onDisable, onEnable, onSignOut, onActAs }: RowProps) {
  const isClient = !p.platformRole
  // Client accounts belong to an organisation; they can't hold a bitNtech role.
  const canChangeRole = !isClient || p.memberships.length === 0
  const canActAs = isClient && !p.disabled
  const closed = panel === null

  return (
    <li className="row">
      <div className="row__main">
        <span className="org__mark" aria-hidden="true">
          {initials(p.name)}
        </span>
        <div className="row__text">
          <span className="row__name">
            {p.name}
            {isMe && <span className="person-chip">You</span>}
          </span>
          <span className="row__meta">
            {p.email}
            {!p.emailVerified && (
              <>
                {' '}
                <i aria-hidden="true">·</i> email not confirmed
              </>
            )}
          </span>
          {p.memberships.length > 0 && (
            <span className="row__meta">
              {p.memberships.map((m) => `${m.orgName} (${ROLE_LABEL[m.role].toLowerCase()})`).join(', ')}
            </span>
          )}
        </div>
      </div>
      <div className="row__side">
        {p.platformRole && <span className={`role-chip role-chip--${p.platformRole}`}>{ROLE_LABEL[p.platformRole]}</span>}
        {p.disabled && <span className="status-chip status-chip--suspended">Disabled</span>}
        {!isMe && closed && (
          <div className="person-actions">
            {canActAs && (
              <Button variant="line" size="sm" onClick={() => onPanel('act')} aria-label={`Act as ${p.name}`}>
                Act as
              </Button>
            )}
            {canChangeRole && (
              <Button variant="line" size="sm" onClick={() => onPanel('role')} aria-label={`Change role for ${p.name}`}>
                Change role
              </Button>
            )}
            {p.disabled ? (
              <Button variant="line" size="sm" busy={busy === `enable:${p.id}`} busyLabel="Enabling…" onClick={onEnable} aria-label={`Enable ${p.name}`}>
                Enable
              </Button>
            ) : (
              <Button variant="line" size="sm" onClick={() => onPanel('disable')} aria-label={`Disable ${p.name}`}>
                Disable
              </Button>
            )}
            {!p.disabled && (
              <Button
                variant="line"
                size="sm"
                busy={busy === `out:${p.id}`}
                busyLabel="Signing out…"
                onClick={onSignOut}
                aria-label={`Sign ${p.name} out everywhere`}
              >
                Sign out everywhere
              </Button>
            )}
          </div>
        )}
      </div>

      {panel === 'act' && (
        <div className="row__extra">
          <ReasonForm
            label={`Why act as ${p.name}?`}
            hint="You'll see AICA exactly as they do for 30 minutes. The reason goes in the audit log; they aren't emailed."
            confirmLabel={`Act as ${p.name}`}
            busyLabel="Starting…"
            busy={busy === `act:${p.id}`}
            tooShort={INTERNAL}
            onConfirm={onActAs}
            onCancel={() => onPanel(null)}
          />
        </div>
      )}
      {panel === 'disable' && (
        <div className="row__extra">
          <ReasonForm
            label={`Why disable ${p.name}?`}
            hint="They're signed out everywhere and can't sign in until enabled. The reason goes in the audit log."
            confirmLabel="Disable account"
            busyLabel="Disabling…"
            busy={busy === `disable:${p.id}`}
            tooShort={INTERNAL}
            onConfirm={onDisable}
            onCancel={() => onPanel(null)}
          />
        </div>
      )}
      {panel === 'role' && (
        <div className="row__extra">
          <RoleForm person={p} busy={busy === `role:${p.id}`} onConfirm={onRole} onCancel={() => onPanel(null)} />
        </div>
      )}
    </li>
  )
}

function RoleForm({
  person,
  busy,
  onConfirm,
  onCancel,
}: {
  person: Person
  busy: boolean
  onConfirm(role: PlatformRole | null, reason: string): void
  onCancel(): void
}) {
  const name = useId()
  const choices = ROLE_CHOICES.filter((c) => c.value !== (person.platformRole ?? null))
  const [role, setRole] = useState<PlatformRole | null>(choices[0].value)

  return (
    <div className="role-form">
      <fieldset className="role-form__set">
        <legend className="field__label">New role for {person.name}</legend>
        {choices.map((c) => (
          <label key={c.label} className="role-form__choice">
            <input type="radio" name={name} checked={role === c.value} onChange={() => setRole(c.value)} />
            <span>
              <strong>{c.label}</strong>
              <span className="role-form__plain">{c.plain}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {role === 'master_admin' && (
        <Alert tone="warn">Master admins can do everything here, including removing you. Every master admin is emailed about this.</Alert>
      )}
      <ReasonForm
        label="Why?"
        hint="They're signed out everywhere so the new role applies at once. The reason goes in the audit log."
        confirmLabel="Change role"
        busyLabel="Changing…"
        busy={busy}
        tooShort={INTERNAL}
        onConfirm={(reason) => onConfirm(role, reason)}
        onCancel={onCancel}
      />
    </div>
  )
}

function InviteForm({ onInvited }: { onInvited(text: string): void }) {
  const { client } = useAuth()
  const roleId = useId()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<PlatformRole>('staff')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validateEmail(email.trim())
    if (problem) {
      setError(problem)
      ref.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await client.inviteStaff(email.trim(), role)
      onInvited(`Invitation sent to ${email.trim()} as ${ROLE_LABEL[role].toLowerCase()}. It lasts 7 days.`)
      setEmail('')
      setRole('staff')
    } catch (err) {
      setError(asAuthError(err).message)
      ref.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ops-section" aria-labelledby="invite-h">
      <div className="ops-section__head">
        <h2 id="invite-h" className="ops-section__title">
          Invite to bitNtech
        </h2>
      </div>
      <form className="invite-form" noValidate onSubmit={submit}>
        <TextField
          ref={ref}
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (error) setError(null)
          }}
          error={error}
          className="invite-form__email"
        />
        <div className="field">
          <label className="field__label" htmlFor={roleId}>
            Role
          </label>
          <select id={roleId} className="field__input" value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}>
            <option value="staff">bitNtech staff</option>
            <option value="master_admin">Master admin</option>
          </select>
        </div>
        <Button type="submit" variant="plum" busy={busy} busyLabel="Sending…" className="invite-form__go">
          Send invitation
        </Button>
      </form>
    </section>
  )
}
