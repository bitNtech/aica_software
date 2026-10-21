import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { can, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AgentTool, Credential } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { PasswordField, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { Switch } from '../../../components/ui/Switch'
import { useAsync } from '../../../lib/useAsync'
import { shortDate, timeAgo } from '../../../lib/time'
import { ToolFormDialog, ToolTestDialog, blankTool, host } from './ToolDialogs'
import '../builder/Builder.css'
import './Library.css'

/** /o/:slug/integrations: what agents can do during a call. */
export default function ToolsPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const id = useId()
  // Tools and connected systems are set up by bitNtech; a hospital can
  // replace the secrets its own systems use.
  const canEdit = can(access, 'tools.manage')
  const canSecrets = can(access, 'tools.credentials') && pageAccess(access, 'integrations') === 'edit'
  const load = useCallback(async () => {
    const [tools, credentials] = await Promise.all([client.listTools(org.orgSlug), client.listCredentials(org.orgSlug)])
    return { tools, credentials }
  }, [client, org.orgSlug])
  const [lib, reload, setLib] = useAsync(load)
  const [editing, setEditing] = useState<AgentTool | null>(null)
  const [testing, setTesting] = useState<AgentTool | null>(null)
  const [note, setNote] = useState('')
  const [toggleError, setToggleError] = useState<string | null>(null)
  /** Switches being saved, with the value they're moving to. */
  const [pending, setPending] = useState<Record<string, boolean>>({})
  /** A tool agents use, about to be switched off: asked first. */
  const [switchingOff, setSwitchingOff] = useState<AgentTool | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)

  async function toggle(t: AgentTool, enabled: boolean) {
    if (t.id in pending) return
    setToggleError(null)
    // Shows the new position straight away; a failure puts it back.
    setPending((p) => ({ ...p, [t.id]: enabled }))
    try {
      const saved = await client.saveTool(org.orgSlug, { ...t, enabled })
      // Into the list at once, so the switch doesn't flick back while it reloads.
      setLib((r) => (r.state === 'ready' ? { ...r, data: { ...r.data, tools: r.data.tools.map((x) => (x.id === saved.id ? saved : x)) } } : r))
      setNote(`${t.name} switched ${enabled ? 'on' : 'off'}.`)
    } catch (err) {
      setToggleError(asAuthError(err).message)
    } finally {
      setPending(({ [t.id]: _, ...rest }) => rest)
    }
  }

  const askToggle = (t: AgentTool, enabled: boolean) => {
    if (!enabled && t.usedBy?.length) setSwitchingOff(t)
    else void toggle(t, enabled)
  }

  const tools = lib.state === 'ready' ? lib.data.tools : []
  const builtins = tools.filter((t) => t.kind === 'builtin')
  const systems = tools.filter((t) => t.kind === 'http')

  return (
    <ConsolePage section="tools"
      kicker="Agents"
      title="Tools and integrations"
      docTitle="Tools and integrations"
      lede={<p>What agents can do during a call: hand over, send a message, or look up and book things in your own systems. Each agent uses the tools chosen for it.</p>}
    >
      <p className="sr-only" role="status">
        {note}
      </p>
      {lib.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading your tools…</span>
        </div>
      )}
      {lib.state === 'error' && (
        <Alert tone="error" title="Couldn't load your tools">
          <p>{asAuthError(lib.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}

      {lib.state === 'ready' && (
        <>
          {!canEdit && <p className="lib__ro-note">bitNtech sets up tools and connects your systems. To change them, send a request to bitNtech.</p>}
          <section className="lib__section" aria-labelledby={`${id}-built`}>
            <h2 id={`${id}-built`} className="lib__heading">
              Built in
            </h2>
            {toggleError && <Alert tone="error">{toggleError}</Alert>}
            <ul className="lib-rows" aria-labelledby={`${id}-built`}>
              {builtins.map((t) => (
                <li key={t.id} className="lib-row lib-row--switch">
                  <div className="lib-row__main">
                    {canEdit ? (
                      <Switch label={t.name} hint={t.description} checked={pending[t.id] ?? t.enabled} onChange={(on) => askToggle(t, on)} />
                    ) : (
                      <>
                        <h3 className="lib-row__name">
                          {t.name} <span className={`flag${t.enabled ? '' : ' flag--quiet'}`}>{t.enabled ? 'On' : 'Off'}</span>
                        </h3>
                        <p className="row__meta">{t.description}</p>
                      </>
                    )}
                    <UsedBy tool={t} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="lib__section" aria-labelledby={`${id}-sys`}>
            <div className="lib__head-row">
              <h2 id={`${id}-sys`} className="lib__heading">
                Your systems
              </h2>
              {canEdit && (
                <Button ref={addButton} variant="plum" size="sm" onClick={() => setEditing(blankTool())}>
                  Connect a system
                </Button>
              )}
            </div>
            <p className="lib__sub">Tools that look things up or book in your hospital or lab system, e.g. find free slots or check a report.</p>
            {systems.length === 0 ? (
              <p className="empty-note">None yet.{canEdit ? ' Connect a system to let agents look things up or book.' : ''}</p>
            ) : (
              <ul className="lib-rows" aria-labelledby={`${id}-sys`}>
                {systems.map((t) => (
                  <li key={t.id} className="lib-row">
                    <div className="lib-row__main">
                      <h3 className="lib-row__name">
                        {t.name} {!t.enabled && <span className="flag flag--quiet">Off</span>}
                        {t.acts && <span className="flag flag--warn">Books or sends</span>}
                      </h3>
                      <p className="row__meta">
                        <span className="lib-row__origin">Connected to {host(t.url)}</span>
                        {t.credentialName && (
                          <>
                            {' '}
                            <i aria-hidden="true">·</i> sends {t.credentialName}
                          </>
                        )}
                      </p>
                      <p className={t.lastTestedAt ? 'lib-row__used' : 'lib-row__soon'}>{t.lastTestedAt ? `Last tested ${timeAgo(t.lastTestedAt)}` : 'Not tested since it was last changed'}</p>
                      <UsedBy tool={t} />
                    </div>
                    {canEdit && (
                      <div className="lib-row__actions">
                        <button type="button" className="btn-text" aria-label={`Test ${t.name}`} onClick={() => setTesting(t)}>
                          Test
                        </button>
                        <button type="button" className="btn-text" aria-label={`Change ${t.name}`} onClick={() => setEditing(t)}>
                          Change
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Secrets
            orgSlug={org.orgSlug}
            credentials={lib.data.credentials}
            tools={tools}
            canEdit={canSecrets}
            onChanged={(done) => {
              setNote(done)
              reload()
            }}
          />
        </>
      )}

      <ToolFormDialog
        orgSlug={org.orgSlug}
        tool={editing}
        tools={tools}
        credentials={lib.state === 'ready' ? lib.data.credentials : []}
        onClose={() => setEditing(null)}
        onSaved={(t, isNew) => {
          setEditing(null)
          setNote(isNew ? `${t.name} added. Test it before an agent uses it.` : `${t.name} saved.`)
          reload()
        }}
        onDeleted={(t) => {
          setEditing(null)
          setNote(`${t.name} deleted.`)
          reload()
          requestAnimationFrame(() => addButton.current?.focus())
        }}
      />
      <ToolTestDialog orgSlug={org.orgSlug} tool={testing} onClose={() => setTesting(null)} onTested={reload} />
      <ConfirmDialog
        open={!!switchingOff}
        title={`Switch off ${switchingOff?.name ?? 'this tool'}?`}
        confirmLabel="Switch off"
        danger
        onConfirm={() => {
          const t = switchingOff!
          setSwitchingOff(null)
          void toggle(t, false)
        }}
        onCancel={() => setSwitchingOff(null)}
      >
        <p>
          {switchingOff?.usedBy?.join(', ')} {switchingOff?.usedBy?.length === 1 ? 'uses' : 'use'} it on live calls, and can’t from the moment it’s off.
          {switchingOff?.builtin === 'transfer' && ' Callers won’t be able to reach your team through them.'}
        </p>
      </ConfirmDialog>
    </ConsolePage>
  )
}

function UsedBy({ tool }: { tool: AgentTool }) {
  return <p className="lib-row__used">{tool.usedBy?.length ? `Used by ${tool.usedBy.join(', ')}` : 'Not used by an agent'}</p>
}

/** Secrets tools send, by name. A value can be replaced, never read back. */
function Secrets({ orgSlug, credentials, tools, canEdit, onChanged }: { orgSlug: string; credentials: Credential[]; tools: AgentTool[]; canEdit: boolean; onChanged(done: string): void }) {
  const client = useConsole()
  const id = useId()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [errors, setErrors] = useState<{ name?: string; value?: string }>({})
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<Credential | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef<HTMLInputElement>(null)
  const usedBy = (c: Credential) => tools.filter((t) => t.credentialName === c.name).map((t) => t.name)
  const key = name.trim().toUpperCase()
  const replacing = credentials.some((c) => c.name === key)

  async function save(e: FormEvent) {
    e.preventDefault()
    const next = {
      name: /^[A-Z][A-Z0-9_]{2,39}$/.test(key) ? undefined : 'Use 3 to 40 capital letters, digits and underscores, starting with a letter, e.g. HIS_API_KEY.',
      value: value.trim() ? undefined : 'Paste the value.',
    }
    setErrors(next)
    if (next.name || next.value) {
      ;(next.name ? nameRef : valueRef).current?.focus()
      return
    }
    setBusy(true)
    try {
      await client.setCredential(orgSlug, key, value)
      // The value leaves the page as soon as it's saved.
      setValue('')
      setName('')
      onChanged(replacing ? `${key} replaced.` : `${key} added.`)
    } catch (err) {
      setErrors({ value: asAuthError(err).message })
      valueRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!removing) return
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      await client.deleteCredential(orgSlug, removing.name)
      onChanged(`${removing.name} deleted.`)
      setRemoving(null)
      // Its row has gone: focus the form once the dialog has closed.
      requestAnimationFrame(() => requestAnimationFrame(() => nameRef.current?.focus()))
    } catch (err) {
      setRemoveError(asAuthError(err).message)
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <section className="lib__section" aria-labelledby={`${id}-sec`}>
      <h2 id={`${id}-sec`} className="lib__heading">
        Keys for your systems
      </h2>
      <p className="lib__sub">Keys and passwords your systems ask for. They’re kept on AICA’s servers: once saved, nobody can see a value here, only replace it.</p>
      {credentials.length === 0 ? (
        <p className="empty-note">No secrets yet.</p>
      ) : (
        <ul className="lib-rows" aria-labelledby={`${id}-sec`}>
          {credentials.map((c) => {
            const users = usedBy(c)
            return (
              <li key={c.name} className="lib-row">
                <div className="lib-row__main">
                  <h3 className="lib-row__name lib-row__mono">{c.name}</h3>
                  <p className="row__meta">
                    Set {shortDate(c.setAt)} by {c.setBy}
                  </p>
                  <p className="lib-row__used">{users.length ? `Sent by ${users.join(', ')}` : 'Not sent by any tool'}</p>
                </div>
                {canEdit && (
                  <div className="lib-row__actions">
                    <button
                      type="button"
                      className="btn-text"
                      aria-label={`Replace the value of ${c.name}`}
                      onClick={() => {
                        setName(c.name)
                        setErrors({})
                        valueRef.current?.focus()
                      }}
                    >
                      Replace value
                    </button>
                    {/* Not offered while a tool sends it: the row already says which. */}
                    {users.length === 0 && (
                      <button
                        type="button"
                        className="btn-text lib-row__remove"
                        aria-label={`Delete ${c.name}`}
                        onClick={() => {
                          setRemoveError(null)
                          setRemoving(c)
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {canEdit && (
        <form className="lib-secret" onSubmit={save} noValidate aria-label="Add or replace a key">
          <TextField
            ref={nameRef}
            label="Name"
            hint="Capital letters, e.g. HIS_API_KEY."
            value={name}
            maxLength={40}
            error={errors.name}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
          {/* Not a login: keep browsers and password managers from offering
              to save it, or to make one up. */}
          <PasswordField
            ref={valueRef}
            label={replacing ? `New value for ${key}` : 'Value'}
            hint={replacing ? 'The old value stops working when you save.' : 'Saved straight to AICA’s servers.'}
            capsWarning={false}
            value={value}
            error={errors.value}
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" variant="line" busy={busy} busyLabel="Saving…" className="rules__button">
            {replacing ? 'Replace key' : 'Save key'}
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Delete ${removing?.name ?? 'secret'}?`}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={removeBusy}
        danger
        error={removeError}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        <p>Tools that send it stop working until it’s added again.</p>
      </ConfirmDialog>
    </section>
  )
}
