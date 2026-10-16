import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { ROLE_LABEL } from '../../../auth/roles'
import { asAuthError, type Permission, type Role } from '../../../auth/types'
import { can, canGrant, defaultPermissions, PERMISSION_GROUP_LABEL, PERMISSIONS, permissionsFor, type PermissionGroup } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Member } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ChoiceGroup } from '../../../components/ui/Choice'
import { ConfirmDialog, Modal } from '../../../components/ui/Dialog'
import { Checkbox, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { shortDate, timeAgo } from '../../../lib/time'
import { useAnnouncer } from '../operate/LiveBits'
import '../library/Library.css'
import '../operate/Operate.css'
import './Manage.css'

const ROLES: Role[] = ['owner', 'admin', 'supervisor', 'front_desk', 'viewer']

/** What each role can do, in the words the Team page uses. */
export const ROLE_DOES: Record<Role, string> = {
  owner: 'Everything, including billing and who can sign in.',
  admin: 'Changes agents’ everyday settings and publishes them, asks bitNtech for new ones, manages the team. No billing.',
  supervisor: 'Tests agents, reviews calls and reports, takes over live calls. Can’t change an agent.',
  front_desk: 'Runs the Bot desk, takes the calls agents hand over, and callbacks.',
  viewer: 'Reads agents, calls and reports. Changes nothing.',
}

const INVITE_DAYS = 7
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** When an invitation's link stops working. */
function inviteState(m: Member, now: number): { expired: boolean; text: string } {
  if (!m.invitedAt) return { expired: false, text: '' }
  const left = Math.ceil((Date.parse(m.invitedAt) + INVITE_DAYS * 864e5 - now) / 864e5)
  return left <= 0 ? { expired: true, text: 'The link has expired. Send it again.' } : { expired: false, text: `The link works for ${left} more ${left === 1 ? 'day' : 'days'}.` }
}

/** /o/:slug/team: who can sign in, and their roles. Owners and admins. */
export default function TeamPage() {
  const { org, user, access } = useOrg()
  const client = useConsole()
  const id = useId()
  const load = useCallback(() => client.listMembers(org.orgSlug), [client, org.orgSlug])
  const [team, reload, setTeam] = useAsync(load)
  const [inviting, setInviting] = useState(false)
  const [changing, setChanging] = useState<Member | null>(null)
  const [permitting, setPermitting] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [note, say] = useAnnouncer()
  const membersHeading = useRef<HTMLHeadingElement>(null)
  const invitesHeading = useRef<HTMLHeadingElement>(null)
  const isOwner = can(access, 'team.manageOwners')
  const now = Date.now()

  const all = team.state === 'ready' ? team.data : []
  const order = (a: Member, b: Member) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name)
  const members = all.filter((m) => m.status !== 'invited').sort(order)
  const invites = all.filter((m) => m.status === 'invited').sort((a, b) => (b.invitedAt ?? '').localeCompare(a.invitedAt ?? ''))

  /** Why this person can't be changed by the signed-in user, or null. */
  const locked = (m: Member): string | null =>
    m.id === user.id ? 'This is you. Another owner can change your role.' : m.role === 'owner' && !isOwner ? 'Only an owner can change an owner.' : null

  const put = (m: Member) => setTeam((r) => (r.state === 'ready' ? { ...r, data: r.data.some((x) => x.id === m.id) ? r.data.map((x) => (x.id === m.id ? m : x)) : [...r.data, m] } : r))
  /** After a row goes: its list's heading takes focus (once the dialog has
   * handed focus back to the page). */
  const focusLater = (h: RefObject<HTMLHeadingElement | null>) => window.setTimeout(() => h.current?.focus(), 0)

  return (
    <ConsolePage
      kicker="Manage"
      title="Team"
      docTitle="Team"
      lede={<p>Who can sign in to {org.orgName}, and what each person can do.</p>}
      actions={
        team.state === 'ready' && (
          <Button variant="plum" onClick={() => setInviting(true)}>
            Invite someone
          </Button>
        )
      }
    >
      <p className="sr-only" role="status">
        {note}
      </p>
      {team.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading the team…</span>
        </div>
      )}
      {team.state === 'error' && (
        <Alert tone="error" title="Couldn't load the team">
          <p>{asAuthError(team.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {team.state === 'ready' && (
        <>
          <section className="lib__section" aria-labelledby={`${id}-m`}>
            <h2 className="lib__heading" id={`${id}-m`} ref={membersHeading} tabIndex={-1}>
              Members <span className="op-count">{members.length}</span>
            </h2>
            <ul className="lib-rows" aria-labelledby={`${id}-m`}>
              {members.map((m) => {
                const why = locked(m)
                return (
                  <li key={m.id} className="lib-row">
                    <div className="lib-row__main">
                      <h3 className="lib-row__name">
                        {m.name}
                        {m.id === user.id && <span className="lib-row__label">(you)</span>}
                        <span className={`status-chip team-role team-role--${m.role}`}>{ROLE_LABEL[m.role]}</span>
                        {m.permissions && <span className="status-chip team-custom">Custom permissions</span>}
                        {m.status === 'disabled' && <span className="status-chip">Can’t sign in</span>}
                      </h3>
                      <p className="row__meta">
                        <span className="lib-row__origin">{m.email}</span> <i aria-hidden="true">·</i> {m.lastActiveAt ? `Active ${timeAgo(m.lastActiveAt, now)}` : 'Never signed in'}
                      </p>
                      {why && <p className="team-why">{why}</p>}
                    </div>
                    {!why && (
                      <div className="lib-row__actions">
                        <button type="button" className="btn-text" aria-label={`Change ${m.name}’s role`} onClick={() => setChanging(m)}>
                          Change role
                        </button>
                        <button type="button" className="btn-text" aria-label={`Change what ${m.name} can do`} onClick={() => setPermitting(m)}>
                          Permissions
                        </button>
                        <button type="button" className="btn-text lib-row__remove" aria-label={`Remove ${m.name}`} onClick={() => setRemoving(m)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="lib__section" aria-labelledby={`${id}-i`}>
            <h2 className="lib__heading" id={`${id}-i`} ref={invitesHeading} tabIndex={-1}>
              Invitations <span className="op-count">{invites.length}</span>
            </h2>
            <p className="lib__sub">People who haven’t joined yet. Each gets an email with a link that works for {INVITE_DAYS} days.</p>
            {invites.length === 0 ? (
              <p className="empty-note">No invitations waiting.</p>
            ) : (
              <ul className="lib-rows" aria-labelledby={`${id}-i`}>
                {invites.map((m) => (
                  <InviteRow
                    key={m.id}
                    member={m}
                    now={now}
                    locked={locked(m)}
                    onChange={() => setChanging(m)}
                    onCancel={() => setRemoving(m)}
                    onSent={(next) => {
                      put(next)
                      say(`Invitation sent to ${next.email} again.`)
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          <details className="team-roles">
            <summary>What each role can do</summary>
            <p className="row__meta">Each role starts with these. Change what one person can do with Permissions on their row.</p>
            <dl>
              {ROLES.map((r) => (
                <div key={r}>
                  <dt>{ROLE_LABEL[r]}</dt>
                  <dd>{ROLE_DOES[r]}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}

      <InviteDialog
        open={inviting}
        isOwner={isOwner}
        onClose={() => setInviting(false)}
        onInvited={(m) => {
          setInviting(false)
          put(m)
          say(`Invitation sent to ${m.email}.`)
          focusLater(invitesHeading)
        }}
      />
      <RoleDialog
        member={changing}
        isOwner={isOwner}
        onClose={() => setChanging(null)}
        onSaved={(m, changed) => {
          setChanging(null)
          if (!changed) return
          put(m)
          say(`${m.status === 'invited' ? m.email : m.name} is now ${ROLE_LABEL[m.role]}.`)
        }}
      />
      <PermissionsDialog
        member={permitting}
        onClose={() => setPermitting(null)}
        onSaved={(m, changed) => {
          setPermitting(null)
          if (!changed) return
          put(m)
          say(m.permissions ? `Saved what ${m.name} can do.` : `${m.name} has the ${ROLE_LABEL[m.role].toLowerCase()} defaults again.`)
        }}
      />
      <RemoveDialog
        member={removing}
        orgName={org.orgName}
        onClose={() => setRemoving(null)}
        onRemoved={(m) => {
          setRemoving(null)
          setTeam((r) => (r.state === 'ready' ? { ...r, data: r.data.filter((x) => x.id !== m.id) } : r))
          say(m.status === 'invited' ? `Invitation for ${m.email} cancelled.` : `${m.name} removed.`)
          focusLater(m.status === 'invited' ? invitesHeading : membersHeading)
        }}
      />
    </ConsolePage>
  )
}

function InviteRow({ member: m, now, locked, onChange, onCancel, onSent }: { member: Member; now: number; locked: string | null; onChange(): void; onCancel(): void; onSent(m: Member): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const link = inviteState(m, now)

  async function resend() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onSent(await client.resendInvite(org.orgSlug, m.id))
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="lib-row">
      <div className="lib-row__main">
        <h3 className="lib-row__name">
          <span className="lib-row__origin">{m.email}</span>
          <span className={`status-chip team-role team-role--${m.role}`}>{ROLE_LABEL[m.role]}</span>
        </h3>
        <p className="row__meta">
          {m.invitedAt ? `Sent ${timeAgo(m.invitedAt, now)}${m.invitedBy ? ` by ${m.invitedBy}` : ''}.` : 'Sent.'}{' '}
          <span className={link.expired ? 'lib-row__warn' : undefined}>{link.text}</span>
        </p>
        {locked && <p className="team-why">{locked}</p>}
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!locked && (
        <div className="lib-row__actions">
          <button type="button" className="btn-text" aria-label={`Send the invitation to ${m.email} again`} aria-disabled={busy || undefined} onClick={() => void resend()}>
            {busy ? 'Sending…' : 'Send again'}
          </button>
          <button type="button" className="btn-text" aria-label={`Change the role ${m.email} is invited as`} onClick={onChange}>
            Change role
          </button>
          <button type="button" className="btn-text lib-row__remove" aria-label={`Cancel the invitation for ${m.email}`} onClick={onCancel}>
            Cancel invitation
          </button>
        </div>
      )}
    </li>
  )
}

/** The roles the signed-in person may give: admins can't make owners. */
const roleOptions = (isOwner: boolean) => ROLES.filter((r) => isOwner || r !== 'owner').map((r) => ({ value: r, label: ROLE_LABEL[r], hint: ROLE_DOES[r] }))

function InviteDialog({ open, isOwner, onClose, onInvited }: { open: boolean; isOwner: boolean; onClose(): void; onInvited(m: Member): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('front_desk')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setEmail('')
    setRole('front_desk')
    setEmailError(null)
    setError(null)
    // After the dialog's own focus (its Close button): start in the field.
    window.setTimeout(() => emailRef.current?.focus(), 0)
  }, [open])

  async function send(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!EMAIL.test(email.trim())) {
      setEmailError('Enter an email address like name@hospital.in.')
      emailRef.current?.focus()
      return
    }
    setEmailError(null)
    setBusy(true)
    setError(null)
    try {
      onInvited(await client.inviteMember(org.orgSlug, { email, role }))
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Invite someone" onClose={() => !busy && onClose()}>
      <form className="op-form" onSubmit={send} noValidate>
        <TextField
          ref={emailRef}
          label="Their email"
          type="email"
          autoComplete="off"
          spellCheck={false}
          value={email}
          error={emailError}
          hint="They get a link to set a password and join."
          onChange={(e) => setEmail(e.target.value)}
        />
        <ChoiceGroup<Role> legend="Their role" type="radio" columns={2} options={roleOptions(isOwner)} value={[role]} onChange={([r]) => setRole(r)} />
        {!isOwner && <p className="row__meta">Only an owner can invite another owner.</p>}
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Sending…">
            Send invitation
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function RoleDialog({ member, isOwner, onClose, onSaved }: { member: Member | null; isOwner: boolean; onClose(): void; onSaved(m: Member, changed: boolean): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const [role, setRole] = useState<Role>('viewer')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!member) return
    setRole(member.role)
    setError(null)
  }, [member])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!member || busy) return
    if (role === member.role) return onSaved(member, false)
    setBusy(true)
    setError(null)
    try {
      onSaved(await client.changeRole(org.orgSlug, member.id, role), true)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const who = member?.status === 'invited' ? member.email : member?.name
  return (
    <Modal open={!!member} title={`Change ${who ?? 'their'}’s role`} onClose={() => !busy && onClose()}>
      <form className="op-form" onSubmit={save} noValidate>
        <ChoiceGroup<Role> legend="Role" type="radio" columns={2} options={roleOptions(isOwner)} value={[role]} onChange={([r]) => setRole(r)} />
        {member && role !== member.role && (
          <p className="row__meta" role="status">
            {role === 'viewer' && member.role !== 'viewer' ? 'Callbacks given to them go back to nobody: viewers don’t make calls. ' : ''}
            {member.permissions ? 'Their custom permissions are replaced by the new role’s defaults. ' : ''}
            {member.status === 'active' ? 'It applies the next time a page loads for them.' : 'They join with the new role.'}
          </p>
        )}
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…">
            Save
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function RemoveDialog({ member, orgName, onClose, onRemoved }: { member: Member | null; orgName: string; onClose(): void; onRemoved(m: Member): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const invited = member?.status === 'invited'

  useEffect(() => {
    if (member) setError(null)
  }, [member])

  async function remove() {
    if (!member || busy) return
    setBusy(true)
    setError(null)
    try {
      await client.removeMember(org.orgSlug, member.id)
      onRemoved(member)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open={!!member}
      title={invited ? `Cancel the invitation for ${member?.email}?` : `Remove ${member?.name}?`}
      confirmLabel={invited ? 'Cancel invitation' : 'Remove'}
      cancelLabel={invited ? 'Keep it' : 'Cancel'}
      busyLabel={invited ? 'Cancelling…' : 'Removing…'}
      busy={busy}
      danger
      error={error}
      onConfirm={() => void remove()}
      onCancel={onClose}
    >
      {invited ? (
        <p>The link in their email stops working. You can invite them again later.</p>
      ) : (
        <>
          <p>
            They can’t sign in to {orgName} any more, and are signed out of it now. Calls they handled and notes they wrote stay.
          </p>
          <p>Callbacks given to them go back to nobody, so someone else can take them.</p>
          {member?.lastActiveAt && <p className="row__meta">Last active {shortDate(member.lastActiveAt)}.</p>}
        </>
      )}
    </ConfirmDialog>
  )
}

const GROUPS = Object.keys(PERMISSION_GROUP_LABEL) as PermissionGroup[]

/** What one person may do, starting from their role's defaults. Only what
 * the role may hold is offered: viewers never change anything, and the team
 * and settings stay with owners and admins. */
function PermissionsDialog({ member, onClose, onSaved }: { member: Member | null; onClose(): void; onSaved(m: Member, changed: boolean): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const [chosen, setChosen] = useState<Set<Permission>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, say] = useAnnouncer()

  useEffect(() => {
    if (!member) return
    setChosen(new Set(permissionsFor(member.role, member.permissions)))
    setError(null)
  }, [member])

  if (!member) return <Modal open={false} title="Permissions" onClose={onClose}>{null}</Modal>
  const role = member.role
  const defaults = new Set(defaultPermissions(role))
  const isDefault = defaults.size === chosen.size && [...defaults].every((p) => chosen.has(p))
  const offered = (g: PermissionGroup) => (Object.keys(PERMISSIONS) as Permission[]).filter((p) => PERMISSIONS[p].group === g && canGrant(role, p))
  const notOffered = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => !canGrant(role, p))
  const toggle = (p: Permission, on: boolean) =>
    setChosen((c) => {
      const next = new Set(c)
      if (on) next.add(p)
      else next.delete(p)
      return next
    })

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!member || busy) return
    const before = new Set(permissionsFor(member.role, member.permissions))
    if (before.size === chosen.size && [...before].every((p) => chosen.has(p))) return onSaved(member, false)
    setBusy(true)
    setError(null)
    try {
      onSaved(await client.setPermissions(org.orgSlug, member.id, isDefault ? null : [...chosen]), true)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={`What ${member.name} can do`} onClose={() => !busy && onClose()} wide>
      <form className="op-form" onSubmit={save} noValidate>
        <p className="sr-only" role="status">
          {said}
        </p>
        <p>
          {ROLE_LABEL[role]} · {isDefault ? `the ${ROLE_LABEL[role].toLowerCase()} defaults` : 'changed from the defaults'}.{' '}
          {!isDefault && (
            <button
              type="button"
              className="btn-text"
              onClick={() => {
                setChosen(new Set(defaults))
                say(`Back to the ${ROLE_LABEL[role].toLowerCase()} defaults. Save to keep it.`)
              }}
            >
              Use the defaults
            </button>
          )}
        </p>
        <div className="perm__groups">
          {GROUPS.map((g) => {
            const list = offered(g)
            if (!list.length) return null
            return (
              <fieldset key={g} className="perm__group">
                <legend className="perm__legend">{PERMISSION_GROUP_LABEL[g]}</legend>
                {list.map((p) => (
                  <Checkbox
                    key={p}
                    label={
                      <>
                        {PERMISSIONS[p].label}
                        {defaults.has(p) !== chosen.has(p) && (
                          <>
                            {' '}
                            <span className="perm__changed">(changed)</span>
                          </>
                        )}
                      </>
                    }
                    hint={PERMISSIONS[p].description}
                    checked={chosen.has(p)}
                    onChange={(e) => toggle(p, e.target.checked)}
                  />
                ))}
              </fieldset>
            )
          })}
        </div>
        {notOffered.length > 0 && (
          <p className="row__meta">
            Not for {ROLE_LABEL[role].toLowerCase()}s: {notOffered.map((p) => PERMISSIONS[p].label.toLowerCase()).join(', ')}. Change their role for these.
          </p>
        )}
        <p className="row__meta">{member.status === 'active' ? 'It applies the next time a page loads for them.' : 'They join with these permissions.'} Billing stays with owners.</p>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…">
            Save
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
