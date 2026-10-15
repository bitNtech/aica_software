import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError } from '../../auth/types'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Spinner'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { OpsTemplate } from '../../ops/types'
import { useAsync } from '../../lib/useAsync'
import { timeAgo } from '../../lib/time'
import { useAnnouncer } from '../console/operate/LiveBits'
import '../console/library/Library.css'
import '../console/operate/Operate.css'
import './Ops.css'

/** /ops/templates: the starting agents builder step 1 offers. Master admin edits; staff read. */
export default function OpsTemplatesPage() {
  const { user } = useAuth()
  const ops = useOpsData()
  const isMaster = user?.platformRole === 'master_admin'
  const load = useCallback(() => ops.listTemplates(), [ops])
  const [list, reload, setList] = useAsync(load)
  /** The template being edited, or 'new'. */
  const [editing, setEditing] = useState<OpsTemplate | 'new' | null>(null)
  const [note, say] = useAnnouncer()

  const all = list.state === 'ready' ? list.data : []
  const industries = [...new Map(all.map((t) => [t.typeId, t.typeLabel])).entries()]
  const put = (t: OpsTemplate) =>
    setList((r) => (r.state === 'ready' ? { ...r, data: r.data.some((x) => x.typeId === t.typeId && x.id === t.id) ? r.data.map((x) => (x.typeId === t.typeId && x.id === t.id ? t : x)) : [...r.data, t] } : r))

  return (
    <OpsLayout
      kicker="Templates"
      docTitle="Template library"
      title="Template library"
      demoData
      lede={
        <p>
          The starting agents organisations choose from in builder step 1, by industry. Each lists what callers ask about, which the flow AICA reads from their calls starts from.{' '}
          {isMaster ? 'Hidden templates aren’t offered; agents already built from one keep working.' : 'Only the master admin changes them.'}
        </p>
      }
    >
      <p className="sr-only" role="status">
        {note}
      </p>
      {isMaster && list.state === 'ready' && (
        <div className="ops-toolbar">
          <Button variant="plum" onClick={() => setEditing('new')}>
            New template
          </Button>
        </div>
      )}
      {list.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading templates…</span>
        </div>
      )}
      {list.state === 'error' && (
        <Alert tone="error" title="Couldn't load templates">
          <p>{asAuthError(list.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {industries.map(([typeId, label]) => (
        <section key={typeId} className="ops-section" aria-labelledby={`tpl-${typeId}`}>
          <div className="ops-section__head">
            <h2 id={`tpl-${typeId}`} className="ops-section__title" tabIndex={-1}>
              {label}
            </h2>
            <p className="ops-section__note">
              {all.filter((t) => t.typeId === typeId && t.published).length} of {all.filter((t) => t.typeId === typeId).length} offered
            </p>
          </div>
          <ul className="lib-rows" aria-labelledby={`tpl-${typeId}`}>
            {all
              .filter((t) => t.typeId === typeId)
              .map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  isMaster={isMaster}
                  onEdit={() => setEditing(t)}
                  onChanged={(next, text) => {
                    put(next)
                    say(text)
                  }}
                />
              ))}
          </ul>
        </section>
      ))}
      <TemplateDialog
        editing={editing}
        industries={industries}
        onClose={() => setEditing(null)}
        onSaved={(t, isNew) => {
          setEditing(null)
          put(t)
          say(isNew ? `${t.label} added to ${t.typeLabel}, hidden until you show it.` : `${t.label} saved.`)
          if (isNew) window.setTimeout(() => document.getElementById(`tpl-row-${t.typeId}-${t.id}`)?.focus(), 0)
        }}
      />
    </OpsLayout>
  )
}

function TemplateRow({ template: t, isMaster, onEdit, onChanged }: { template: OpsTemplate; isMaster: boolean; onEdit(): void; onChanged(t: OpsTemplate, text: string): void }) {
  const ops = useOpsData()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await ops.setTemplatePublished(t.typeId, t.id, !t.published)
      onChanged(next, next.published ? `${t.label} is offered in the builder.` : `${t.label} is hidden from the builder.`)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="lib-row">
      <div className="lib-row__main">
        <h3 className="lib-row__name" id={`tpl-row-${t.typeId}-${t.id}`} tabIndex={-1}>
          {t.label}
          <span className={`status-chip ${t.published ? 'status-chip--live' : 'status-chip--draft'}`}>{t.published ? 'Offered' : 'Hidden'}</span>
        </h3>
        <p className="lib-row__used">{t.description}</p>
        <ul className="ops-chips" aria-label={`What callers ask about: ${t.label}`}>
          {t.covers.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="row__meta">
          Changed {timeAgo(t.updatedAt)} by {t.updatedBy}
        </p>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </div>
      {isMaster && (
        <div className="lib-row__actions">
          <button type="button" className="btn-text" aria-label={`Change ${t.label} (${t.typeLabel})`} onClick={onEdit}>
            Change
          </button>
          <button type="button" className="btn-text" aria-disabled={busy || undefined} aria-label={busy ? undefined : `${t.published ? 'Hide' : 'Offer'} ${t.label}`} onClick={() => void toggle()}>
            {busy ? 'Saving…' : t.published ? 'Hide' : 'Offer'}
          </button>
        </div>
      )}
    </li>
  )
}

function TemplateDialog({
  editing,
  industries,
  onClose,
  onSaved,
}: {
  editing: OpsTemplate | 'new' | null
  industries: [string, string][]
  onClose(): void
  onSaved(t: OpsTemplate, isNew: boolean): void
}) {
  const ops = useOpsData()
  const id = useId()
  const [typeId, setTypeId] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [covers, setCovers] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)
  const isNew = editing === 'new'

  useEffect(() => {
    if (!editing) return
    const t = editing === 'new' ? null : editing
    setTypeId(t?.typeId ?? industries[0]?.[0] ?? '')
    setLabel(t?.label ?? '')
    setDescription(t?.description ?? '')
    setCovers(t?.covers.join('\n') ?? '')
    setError(null)
    window.setTimeout(() => first.current?.focus(), 0)
    // Reset only when a different template opens.
  }, [editing])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy || !editing) return
    setBusy(true)
    setError(null)
    try {
      const t = await ops.saveTemplate({ typeId, id: isNew ? undefined : (editing as OpsTemplate).id, label, description, covers: covers.split('\n') })
      onSaved(t, isNew)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!editing} title={isNew ? 'New template' : `Change ${(editing as OpsTemplate | null)?.label ?? 'template'}`} onClose={() => !busy && onClose()}>
      <form className="op-form" onSubmit={save} noValidate>
        {isNew ? (
          <SelectField label="Industry" value={typeId} options={industries.map(([value, l]) => ({ value, label: l }))} onChange={(e) => setTypeId(e.target.value)} />
        ) : (
          <p className="row__meta">Industry: {(editing as OpsTemplate | null)?.typeLabel}. Agents already built from it keep their setup.</p>
        )}
        <TextField ref={first} label="Name" hint="What builders pick, e.g. “Appointments”." value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        <TextAreaField label="What it does" rows={2} value={description} maxLength={160} onChange={(e) => setDescription(e.target.value)} />
        <TextAreaField
          label="What callers ask about"
          hint="One per line, 2 to 8. The flow read from an organisation’s calls starts from these."
          rows={5}
          value={covers}
          onChange={(e) => setCovers(e.target.value)}
          aria-describedby={isNew ? `${id}-new` : undefined}
        />
        {isNew && (
          <p className="row__meta" id={`${id}-new`}>
            New templates start hidden, so you can check them before builders see them.
          </p>
        )}
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…">
            {isNew ? 'Add template' : 'Save'}
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
