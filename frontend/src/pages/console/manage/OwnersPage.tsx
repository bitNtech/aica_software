import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../../auth/AuthProvider'
import { ROLE_LABEL } from '../../../auth/roles'
import { asAuthError, type Role } from '../../../auth/types'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { SelectField, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Member } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { useAsync } from '../../../lib/useAsync'
import { timeAgo } from '../../../lib/time'
import { useAnnouncer } from '../operate/LiveBits'
import '../library/Library.css'
import '../operate/Operate.css'
import './Manage.css'

/** What only owners can do, said once on the page. */
const OWNER_POWERS = ['Billing, the plan and invoices', 'Adding and changing owners', 'Everything admins can do: the team, settings, alerts and agents’ everyday settings']

/**
 * /o/:slug/owners: who owns the organisation. An owner makes someone else
 * an owner and changes another owner to admin, with the team API's rules:
 * nobody changes their own role, and there is always at least one owner.
 * Admins see who the owners are.
 */
export default function OwnersPage() {
  const { org, access } = useOrg()
  const { user } = useAuth()
  const client = useConsole()
  const id = useId()
  const canEdit = pageAccess(access, 'owners') === 'edit'
  const load = useCallback(() => client.listMembers(org.orgSlug), [client, org.orgSlug])
  const [members, reload] = useAsync(load)
  const [note, say] = useAnnouncer()
  const [demoting, setDemoting] = useState<Member | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const all = members.state === 'ready' ? members.data : []
  const owners = all.filter((m) => m.role === 'owner' && m.status !== 'disabled')
  const activeOwners = owners.filter((m) => m.status === 'active')
  const candidates = all.filter((m) => m.role !== 'owner' && m.status === 'active')

  async function demote() {
    if (!demoting) return
    setBusy(true)
    setError(null)
    try {
      await client.changeRole(org.orgSlug, demoting.id, 'admin')
      say(`${demoting.name || demoting.email} is now an admin.`)
      setDemoting(null)
      reload()
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConsolePage
      section="team"
      kicker="Manage"
      title="Owners"
      docTitle="Owners"
      lede={<p>Owners are responsible for {org.orgName} on AICA. {canEdit ? 'You can make someone an owner, or change another owner to admin.' : 'Only an owner can change who the owners are.'}</p>}
    >
      <p className="sr-only" role="status">
        {note}
      </p>
      {members.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading owners…</span>
        </div>
      )}
      {members.state === 'error' && (
        <Alert tone="error" title="Couldn't load the owners">
          <p>{asAuthError(members.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {members.state === 'ready' && (
        <>
          <section className="lib__section" aria-labelledby={`${id}-o`}>
            <h2 className="lib__heading" id={`${id}-o`}>
              {owners.length === 1 ? '1 owner' : `${owners.length} owners`}
            </h2>
            <ul className="own-list">
              {owners.map((m) => {
                const me = m.id === user?.id || m.email === user?.email
                return (
                  <li key={m.id} className="own-card">
                    <div className="own-card__main">
                      <p className="own-card__name">
                        {m.name || m.email}
                        {me && <span className="op-badge">You</span>}
                        {m.status === 'invited' && <span className="op-badge">Invited</span>}
                      </p>
                      <p className="row__meta">
                        {m.email} · {m.status === 'invited' ? `invited${m.invitedBy ? ` by ${m.invitedBy}` : ''}` : m.lastActiveAt ? `last signed in ${timeAgo(m.lastActiveAt)}` : 'hasn’t signed in yet'}
                      </p>
                    </div>
                    {canEdit && !me && (m.status === 'invited' || activeOwners.length > 1) && (
                      <Button variant="line" size="sm" onClick={() => setDemoting(m)} aria-label={`Change ${m.name || m.email} to admin`}>
                        Change to admin
                      </Button>
                    )}
                    {canEdit && me && <p className="own-card__why">To step down, ask {activeOwners.length > 1 ? 'another owner' : 'someone you make an owner'} to change you to admin.</p>}
                  </li>
                )
              })}
            </ul>
            {activeOwners.length === 1 && <p className="row__meta">There must always be at least one owner, so the last one can’t be changed.</p>}
          </section>

          <section className="lib__section" aria-labelledby={`${id}-p`}>
            <h2 className="lib__heading" id={`${id}-p`}>
              What only owners can do
            </h2>
            <ul className="own-powers">
              {OWNER_POWERS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>

          {canEdit && (
            <MakeOwner
              candidates={candidates}
              onDone={(m) => {
                say(`${m.name} is now an owner.`)
                reload()
              }}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={!!demoting}
        title={`Change ${demoting?.name || demoting?.email} to admin?`}
        confirmLabel="Change to admin"
        busyLabel="Changing…"
        busy={busy}
        error={error}
        onConfirm={() => void demote()}
        onCancel={() => {
          setDemoting(null)
          setError(null)
        }}
      >
        <p>They keep managing the team and settings, but can no longer see billing or change owners. It goes in the audit log.</p>
      </ConfirmDialog>
    </ConsolePage>
  )
}

/** Choosing a team member, and typing the organisation's name to confirm. */
function MakeOwner({ candidates, onDone }: { candidates: Member[]; onDone(m: Member): void }) {
  const { org } = useOrg()
  const client = useConsole()
  const id = useId()
  const [who, setWho] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = useRef<HTMLInputElement>(null)
  const matches = typed.trim().toLowerCase() === org.orgName.toLowerCase()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const m = candidates.find((c) => c.id === who)
    if (!m) return setError('Choose who to make an owner.')
    if (!matches) {
      setError(`Type ${org.orgName} to confirm.`)
      confirm.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await client.changeRole(org.orgSlug, m.id, 'owner' as Role)
      setWho('')
      setTyped('')
      onDone(m)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lib__section" aria-labelledby={`${id}-h`}>
      <h2 className="lib__heading" id={`${id}-h`}>
        Make someone an owner
      </h2>
      {candidates.length === 0 ? (
        <p className="empty-note">
          Everyone in the team who has signed in is already an owner. <Link to="../team">Invite someone</Link> as an owner from Team.
        </p>
      ) : (
        <form className="set-card own-form" onSubmit={submit}>
          {error && <Alert tone="error">{error}</Alert>}
          <SelectField label="Who" value={who} onChange={(e) => setWho(e.target.value)} options={[{ value: '', label: 'Choose someone' }, ...candidates.map((c) => ({ value: c.id, label: `${c.name} (${ROLE_LABEL[c.role]})` }))]} />
          <TextField ref={confirm} label={`Type ${org.orgName} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" hint="They’ll be able to see billing and change owners, including you." />
          <div>
            <Button type="submit" busy={busy} busyLabel="Making them an owner…" disabled={!who || !matches}>
              Make owner
            </Button>
          </div>
          <p className="row__meta">
            Someone new? <Link to="../team">Invite them</Link> from Team and choose Owner.
          </p>
        </form>
      )}
    </section>
  )
}
