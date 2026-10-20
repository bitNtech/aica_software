import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import type { FaqEntry, KnowledgeKind, KnowledgeSource, NewKnowledge } from '../../../console/types'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ChoiceGroup } from '../../../components/ui/Choice'
import { ConfirmDialog, Modal } from '../../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field'
import { FileDrop } from '../../../components/ui/FileDrop'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { shortDate } from '../../../lib/time'
import { KNOWLEDGE_KIND_LABEL, isExpired } from '../builder/steps/StepContext'
import { FaqEditor } from './FaqEditor'

export const REFRESH_LABEL: Record<KnowledgeSource['refreshEvery'], string> = { never: 'Only when I ask', daily: 'Every day', weekly: 'Every week' }
const REFRESH = (Object.keys(REFRESH_LABEL) as KnowledgeSource['refreshEvery'][]).map((value) => ({ value, label: REFRESH_LABEL[value] }))
const FILE_ACCEPT: Record<'document' | 'table', string> = { document: '.pdf,.docx,.txt,.md', table: '.xlsx,.csv' }
const MAX_FILE = 50 * 1024 * 1024

/** yyyy-mm-dd for a date field, from an ISO timestamp. */
const toDay = (iso: string | null) => {
  if (!iso) return ''
  // Local date, matching fromDay: the UTC date would drift a day west of UTC.
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** The end of that day, as an ISO timestamp, or null when empty. */
const fromDay = (day: string) => (day ? new Date(`${day}T23:59:59`).toISOString() : null)

/** Add a document, table, web page or FAQ to the library. */
export function AddKnowledgeDialog({ orgSlug, open, onClose, onAdded }: { orgSlug: string; open: boolean; onClose(): void; onAdded(k: KnowledgeSource): void }) {
  const client = useConsole()
  const formId = useId()
  const [kind, setKind] = useState<KnowledgeKind>('document')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('https://')
  const [refreshEvery, setRefreshEvery] = useState<KnowledgeSource['refreshEvery']>('weekly')
  const [faq, setFaq] = useState<FaqEntry[]>([{ q: '', a: '' }])
  const [expires, setExpires] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each time it opens, it starts empty.
  useEffect(() => {
    if (!open) return
    setKind('document')
    setName('')
    setDescription('')
    setFile(null)
    setUrl('https://')
    setRefreshEvery('weekly')
    setFaq([{ q: '', a: '' }])
    setExpires('')
    setErrors({})
    setError(null)
  }, [open])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (name.trim().length < 3) next.name = 'Give it a name of at least 3 characters.'
    if ((kind === 'document' || kind === 'table') && !file) next.file = `Choose a ${kind === 'table' ? 'spreadsheet' : 'file'}.`
    else if (file && file.size > MAX_FILE) next.file = 'Choose a file of 50 MB or less.'
    if (kind === 'web' && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(url.trim())) next.url = 'Give the full address, starting with https://.'
    if (kind === 'faq' && !faq.some((f) => f.q.trim() && f.a.trim())) next.faq = 'Add at least one question with its answer.'
    setErrors(next)
    if (Object.keys(next).length) {
      // The first field with a problem gets focus, and is read with its error.
      requestAnimationFrame(() => (document.querySelector<HTMLElement>('dialog[open] [aria-invalid="true"]') ?? document.querySelector<HTMLElement>('dialog[open] .faq__add'))?.focus())
      return
    }
    const base = { name: name.trim(), description: description.trim(), expiresAt: fromDay(expires) }
    const input: NewKnowledge =
      kind === 'web'
        ? { ...base, kind, url: url.trim(), refreshEvery }
        : kind === 'faq'
          ? { ...base, kind, faq: faq.filter((f) => f.q.trim() && f.a.trim()) }
          : { ...base, kind, fileName: file!.name, size: file!.size, file: file! }
    setBusy(true)
    setError(null)
    try {
      onAdded(await client.addKnowledge(orgSlug, input))
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Add knowledge" onClose={() => !busy && onClose()} wide>
      <form className="lib-form" onSubmit={submit} noValidate>
        <ChoiceGroup
          legend="What is it?"
          type="radio"
          columns={4}
          options={(Object.keys(KNOWLEDGE_KIND_LABEL) as KnowledgeKind[]).map((k) => ({
            value: k,
            label: KNOWLEDGE_KIND_LABEL[k],
            hint: k === 'document' ? 'PDF, Word or text' : k === 'table' ? 'Excel or CSV' : k === 'web' ? 'A page on your site' : 'Write questions here',
          }))}
          value={[kind]}
          onChange={([v]) => {
            setKind(v)
            // A document isn't a table: choose the file again for the new kind.
            setFile(null)
          }}
        />
        <div className="step__grid">
          <TextField label="Name" hint="Shown to your team, e.g. “OPD timings”." value={name} maxLength={80} error={errors.name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Expires" hint="Optional. After this date agents warn that it may be out of date." type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
        <TextAreaField label="What it covers" hint="Optional. Helps your team pick it for an agent." rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />

        {(kind === 'document' || kind === 'table') && (
          <div className="field">
            <FileDrop
              label={file ? 'Choose another file' : kind === 'table' ? 'Choose a spreadsheet' : 'Choose a file'}
              invalid={!!errors.file}
              errorId={`${formId}-file`}
              accept={FILE_ACCEPT[kind]}
              hint={`${kind === 'table' ? 'Excel or CSV' : 'PDF, Word, text or Markdown'}, up to 50 MB.${client.isDemo && !client.isLive?.('knowledge') ? ' In this demo the file isn’t uploaded or read.' : ''}`}
              onFiles={([f]) => {
                setFile(f ?? null)
                setErrors((x) => ({ ...x, file: '' }))
              }}
            />
            {file && <p className="lib-form__file">Chosen: {file.name}</p>}
            {errors.file && (
              <p className="field__error" id={`${formId}-file`}>
                {errors.file}
              </p>
            )}
          </div>
        )}
        {kind === 'web' && (
          <div className="step__grid">
            <TextField label="Web address" type="url" value={url} error={errors.url} onChange={(e) => setUrl(e.target.value)} />
            <SelectField label="Read it again" value={refreshEvery} options={REFRESH} onChange={(e) => setRefreshEvery(e.target.value as KnowledgeSource['refreshEvery'])} />
          </div>
        )}
        {kind === 'faq' && <FaqEditor entries={faq} onChange={setFaq} error={errors.faq} />}

        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Adding…">
            Add knowledge
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** One source: what AICA read from it, and (for editors) changing it. */
export function KnowledgeDetailDialog({
  orgSlug,
  source,
  usedBy,
  canEdit,
  canDelete,
  onClose,
  onChanged,
  onDeleted,
}: {
  orgSlug: string
  source: KnowledgeSource | null
  usedBy: string[]
  canEdit: boolean
  canDelete: boolean
  onClose(): void
  onChanged(k: KnowledgeSource, done: string): void
  onDeleted(k: KnowledgeSource): void
}) {
  const client = useConsole()
  const id = useId()
  const k = source
  // The list behind refreshes while something is being read, handing over a
  // new copy each time: reload only when what was read actually changes.
  const readKey = k ? `${k.id}|${k.status}|${k.refreshedAt}` : ''
  const ready = k?.status === 'ready'
  const sourceId = k?.id
  const loadPassages = useCallback(
    () => (sourceId && ready ? client.listPassages(orgSlug, sourceId) : Promise.resolve([])),
    // readKey stands in for the parts of the source that matter here.
    [client, orgSlug, readKey],
  )
  const [passages] = useAsync(loadPassages)
  const nameRef = useRef<HTMLInputElement>(null)
  /** What the last action did, said inside the dialog (the page behind is inert). */
  const [done, setDone] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [expires, setExpires] = useState('')
  const [refreshEvery, setRefreshEvery] = useState<KnowledgeSource['refreshEvery']>('never')
  const [faq, setFaq] = useState<FaqEntry[]>([])
  const [busy, setBusy] = useState<'save' | 'refresh' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Opening another source resets the form; a fresh copy of the same one
  // (the list refreshing behind) leaves what's being typed alone.
  useEffect(() => {
    if (!source) return
    setName(source.name)
    setDescription(source.description)
    setExpires(toDay(source.expiresAt))
    setRefreshEvery(source.refreshEvery)
    setFaq(source.faq ?? [])
    setError(null)
    setNameError(null)
    setDone('')
  }, [sourceId])

  if (!k) return <Modal open={false} title="" onClose={onClose}>{null}</Modal>

  async function run(what: 'save' | 'refresh', fn: () => Promise<KnowledgeSource>, done: string) {
    setBusy(what)
    setError(null)
    setDone('')
    try {
      onChanged(await fn(), done)
      setDone(done)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    setError(null)
    try {
      await client.deleteKnowledge(orgSlug, k!.id)
      setConfirmDelete(false)
      onDeleted(k!)
    } catch (err) {
      setError(asAuthError(err).message)
      setConfirmDelete(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {/* The confirmation opens on top of this (native dialogs stack), so Cancel returns to Delete. */}
      <Modal open={!!k} title={k.name} onClose={() => !busy && onClose()} wide>
        <div className="lib-detail">
          <dl className="lib-facts">
            <div>
              <dt>Kind</dt>
              <dd>{KNOWLEDGE_KIND_LABEL[k.kind]}</dd>
            </div>
            <div>
              <dt>From</dt>
              <dd className="lib-facts__origin">{k.origin}</dd>
            </div>
            <div>
              <dt>Read</dt>
              <dd>{k.status === 'ready' ? `${shortDate(k.refreshedAt)}, ${k.passages} sections` : k.status === 'indexing' ? 'Being read now' : 'Couldn’t be read'}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{k.expiresAt ? `${shortDate(k.expiresAt)}${isExpired(k) ? ' (expired)' : ''}` : 'Never'}</dd>
            </div>
            <div>
              <dt>Used by</dt>
              <dd>{usedBy.length ? usedBy.join(', ') : 'No agent yet'}</dd>
            </div>
          </dl>
          {k.error && <Alert tone="error">{k.error}</Alert>}

          <section aria-labelledby={`${id}-sec`} className="lib-detail__section">
            <h3 id={`${id}-sec`} className="ws__subhead">
              What AICA read from it
            </h3>
            {k.status !== 'ready' ? (
              <p className="empty-note">{k.status === 'indexing' ? 'Still being read. Its sections show here when it’s done.' : 'Nothing: it couldn’t be read.'}</p>
            ) : passages.state === 'loading' ? (
              <div className="loading-row" role="status">
                <Spinner />
                <span>Loading sections…</span>
              </div>
            ) : passages.state === 'error' ? (
              <Alert tone="error">{asAuthError(passages.error).message}</Alert>
            ) : (
              <ol className="passages">
                {passages.data.map((p) => (
                  <li key={p.text}>{p.text}</li>
                ))}
              </ol>
            )}
            {k.status === 'ready' && passages.state === 'ready' && k.passages > passages.data.length && (
              <p className="field__hint">The first {passages.data.length} of {k.passages} sections.</p>
            )}
          </section>

          {canEdit && (
            <form
              className="lib-form"
              aria-labelledby={`${id}-edit`}
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim().length < 3) {
                  setNameError('Give it a name of at least 3 characters.')
                  nameRef.current?.focus()
                  return
                }
                setNameError(null)
                void run(
                  'save',
                  () =>
                    client.updateKnowledge(orgSlug, k.id, {
                      name,
                      description,
                      expiresAt: fromDay(expires),
                      ...(k.kind === 'web' ? { refreshEvery } : {}),
                      ...(k.kind === 'faq' ? { faq } : {}),
                    }),
                  `${name.trim()} saved.`,
                )
              }}
            >
              <h3 id={`${id}-edit`} className="ws__subhead">
                Change it
              </h3>
              <div className="step__grid">
                <TextField ref={nameRef} label="Name" value={name} maxLength={80} error={nameError} onChange={(e) => setName(e.target.value)} />
                <TextField label="Expires" hint="Leave empty for never." type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              </div>
              <TextAreaField label="What it covers" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
              {k.kind === 'web' && (
                <div className="step__narrow">
                  <SelectField label="Read it again" value={refreshEvery} options={REFRESH} onChange={(e) => setRefreshEvery(e.target.value as KnowledgeSource['refreshEvery'])} />
                </div>
              )}
              {k.kind === 'faq' && <FaqEditor entries={faq} onChange={setFaq} />}
              {error && (
                <p className="field__error" role="alert">
                  {error}
                </p>
              )}
              <p className="lib-form__done" role="status">
                {done}
              </p>
              <div className="dialog__actions lib-form__actions">
                <Button type="submit" variant="plum" size="sm" busy={busy === 'save'} busyLabel="Saving…">
                  Save changes
                </Button>
                {k.kind !== 'faq' && (
                  <Button
                    variant="line"
                    size="sm"
                    busy={busy === 'refresh'}
                    busyLabel="Starting…"
                    onClick={() => void run('refresh', () => client.refreshKnowledge(orgSlug, k.id), `${k.name} is being read again.`)}
                  >
                    Read it again now
                  </Button>
                )}
                {canDelete &&
                  (usedBy.length ? (
                    // Not offered when it would be refused: say why instead.
                    <p className="field__hint lib-form__delete">Can’t be deleted while {usedBy.join(', ')} {usedBy.length === 1 ? 'uses' : 'use'} it.</p>
                  ) : (
                    <button
                      type="button"
                      className="btn-text lib-row__remove lib-form__delete"
                      onClick={() => {
                        setError(null)
                        setConfirmDelete(true)
                      }}
                    >
                      Delete source
                    </button>
                  ))}
              </div>
            </form>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${k.name}?`}
        confirmLabel="Delete source"
        busyLabel="Deleting…"
        busy={busy === 'delete'}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>No agent uses it. This can’t be undone.</p>
      </ConfirmDialog>
    </>
  )
}
