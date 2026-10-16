import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { can, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { SourceCall } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { SegFilter, useSettled } from '../../../components/console/ListTools'
import { Alert } from '../../../components/ui/Alert'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField } from '../../../components/ui/Field'
import { FileDrop } from '../../../components/ui/FileDrop'
import { Spinner } from '../../../components/ui/Spinner'
import { Switch } from '../../../components/ui/Switch'
import { useAsync } from '../../../lib/useAsync'
import { shortDate } from '../../../lib/time'
import { AUDIO_ACCEPT, CALL_STATUS_LABEL, callLanguage, checkRecordings, duration, isProcessing } from '../builder/steps/StepCalls'
import { TranscriptDialog } from '../calls/TranscriptDialog'
import '../builder/Builder.css'
import './Library.css'

type Filter = 'all' | 'ready' | 'processing' | 'failed'
const FILTER_LABEL: Record<Filter, string> = { all: 'All', ready: 'Ready', processing: 'Processing', failed: 'Failed' }
const matches = (c: SourceCall, f: Filter) => f === 'all' || (f === 'processing' ? isProcessing(c) : c.status === f)

/** /o/:slug/uploads: the recordings of past calls agents learn from. */
export default function UploadsPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const id = useId()
  const canEdit = pageAccess(access, 'uploads') === 'edit'
  const canDelete = can(access, 'upload.delete')
  const load = useCallback(() => client.listCalls(org.orgSlug), [client, org.orgSlug])
  const [calls, reload] = useAsync(load)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [redact, setRedact] = useState(true)
  const [preview, setPreview] = useState<SourceCall | null>(null)
  const [uploading, setUploading] = useState(false)
  const [rejected, setRejected] = useState<string[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  /** What the last action did: announced, and shown. */
  const [note, setNote] = useState('')
  const [removing, setRemoving] = useState<SourceCall | null>(null)
  const [busy, setBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const listHeading = useRef<HTMLHeadingElement>(null)

  const all = calls.state === 'ready' ? calls.data : []
  const processing = all.some(isProcessing)
  // Check again a while after each reply (not on a fixed beat, which a slow
  // reply would never keep up with) until every call is processed.
  useEffect(() => {
    if (!processing) return
    const t = window.setTimeout(reload, 2000)
    return () => window.clearTimeout(t)
  }, [processing, calls, reload])

  const q = query.trim().toLowerCase()
  const shown = all.filter((c) => matches(c, filter) && (!q || [c.name, c.topic ?? '', ...(c.usedBy ?? [])].some((v) => v.toLowerCase().includes(q))))
  const said = useSettled(shown.length === all.length ? `${all.length} calls` : `${shown.length} of ${all.length} calls shown`, calls.state === 'ready')

  async function upload(files: File[]) {
    const { ok, rejected } = checkRecordings(files)
    setRejected(rejected)
    setUploadError(null)
    if (!ok.length) return
    setUploading(true)
    setNote(`Adding ${ok.length} ${ok.length === 1 ? 'recording' : 'recordings'}…`)
    try {
      const added = await client.addRecordings(
        org.orgSlug,
        ok.map((f) => ({ name: f.name, size: f.size, type: f.type, file: f })),
      )
      const bad = added.filter((c) => c.status === 'failed').length
      setNote(`${added.length - bad} ${added.length - bad === 1 ? 'recording' : 'recordings'} added, now being processed.${bad ? ` ${bad} couldn't be used: see the list.` : ''}`)
      reload()
    } catch (err) {
      setUploadError(asAuthError(err).message)
      setNote('')
    } finally {
      setUploading(false)
    }
  }

  async function confirmRemove() {
    if (!removing) return
    setBusy(true)
    setRemoveError(null)
    try {
      await client.deleteCall(org.orgSlug, removing.id)
      setNote(`${removing.name} removed.`)
      setRemoving(null)
      reload()
      // Its row has gone: carry on from the search field, once the dialog
      // has closed (while it's open the page behind can't take focus).
      requestAnimationFrame(() => requestAnimationFrame(() => (search.current ?? listHeading.current)?.focus()))
    } catch (err) {
      setRemoveError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConsolePage
      kicker="Agents"
      title="Call uploads"
      docTitle="Call uploads"
      lede={<p>Recordings of your past calls. AICA transcribes them and learns your conversations from them when you build an agent.</p>}
    >
      <p className="sr-only" role="status">
        {note}
      </p>

      {!canEdit && <p className="lib__ro-note">You can look. Owners and admins add and remove recordings.</p>}
      {canEdit && (
        <section className="lib__section" aria-labelledby={`${id}-add`}>
          <h2 id={`${id}-add`} className="lib__heading">
            Add recordings
          </h2>
          <FileDrop
            label={uploading ? 'Adding…' : 'Choose recordings'}
            accept={AUDIO_ACCEPT}
            multiple
            disabled={uploading}
            hint={
              client.isDemo
                ? 'MP3, WAV, M4A, OGG or FLAC, up to 200 MB each. Only calls whose callers agreed to recording. In this demo nothing is uploaded: added files become sample calls.'
                : 'MP3, WAV, M4A, OGG or FLAC, up to 200 MB each. Only calls whose callers agreed to recording.'
            }
            onFiles={(f) => void upload(f)}
          />
          {rejected.length > 0 && (
            <Alert tone="warn" title="Some files weren't added">
              <ul className="builder__error-list">
                {rejected.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Alert>
          )}
          {uploadError && <Alert tone="error">{uploadError}</Alert>}
        </section>
      )}

      <section className="lib__section" aria-labelledby={`${id}-list`}>
        <h2 id={`${id}-list`} ref={listHeading} tabIndex={-1} className="lib__heading">
          Your call library
        </h2>

        {calls.state === 'loading' && (
          <div className="loading-row" role="status">
            <Spinner />
            <span>Loading your calls…</span>
          </div>
        )}
        {calls.state === 'error' && (
          <Alert tone="error" title="Couldn't load your calls">
            <p>{asAuthError(calls.error).message}</p>
            <button type="button" className="btn-text" onClick={reload}>
              Try again
            </button>
          </Alert>
        )}
        {calls.state === 'ready' && all.length === 0 && (
          <EmptyState title="No calls yet">
            <p>{canEdit ? 'Add recordings of real calls above. Agents are built from them.' : 'When an owner or admin adds recordings, they appear here.'}</p>
          </EmptyState>
        )}

        {calls.state === 'ready' && all.length > 0 && (
          <>
            <div className="list-tools">
              <TextField
                ref={search}
                label="Search calls"
                type="search"
                value={query}
                placeholder="Name, topic or agent"
                autoComplete="off"
                className="list-tools__search"
                onChange={(e) => setQuery(e.target.value)}
              />
              <SegFilter<Filter>
                legend="Status"
                value={filter}
                onChange={setFilter}
                options={(Object.keys(FILTER_LABEL) as Filter[]).map((f) => ({ value: f, label: FILTER_LABEL[f], count: all.filter((c) => matches(c, f)).length }))}
              />
            </div>
            {/* Only owners and admins may see personal details. (A real server
                redacts by role; here it's how the page shows them.) */}
            {canEdit && (
              <div className="lib__bar">
                <Switch label="Hide personal details in transcripts" checked={redact} onChange={setRedact} />
              </div>
            )}
            <p className="sr-only" aria-live="polite">
              {said}
            </p>

            {shown.length === 0 ? (
              <p className="empty-note">
                No calls match.{' '}
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                    search.current?.focus()
                  }}
                >
                  Clear search and filter
                </button>
              </p>
            ) : (
              <ul className="lib-rows" aria-label="Calls">
                {shown.map((c) => (
                  <li key={c.id} className="lib-row">
                    <div className="lib-row__main">
                      <h3 className="lib-row__name">{c.name}</h3>
                      <p className="row__meta">
                        {c.topic ?? 'Not processed yet'} <i aria-hidden="true">·</i> {callLanguage(c)} <i aria-hidden="true">·</i> {duration(c.durationSec)}{' '}
                        <i aria-hidden="true">·</i> added {shortDate(c.addedAt)}
                      </p>
                      <p className="lib-row__used">{c.usedBy?.length ? `Used by ${c.usedBy.join(', ')}` : 'Not used by an agent yet'}</p>
                      {c.error && <p className="field__error">{c.error}</p>}
                    </div>
                    <span className={`status-chip status-chip--call-${c.status}`}>{CALL_STATUS_LABEL[c.status]}</span>
                    <div className="lib-row__actions">
                      {c.status === 'ready' && (
                        <button type="button" className="btn-text" aria-label={`Read transcript: ${c.name}`} onClick={() => setPreview(c)}>
                          Transcript
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          className="btn-text lib-row__remove"
                          aria-label={`Remove ${c.name}`}
                          onClick={() => {
                            setRemoveError(null)
                            setRemoving(c)
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <TranscriptDialog orgSlug={org.orgSlug} call={preview} redact={redact || !canEdit} onClose={() => setPreview(null)} />
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name ?? 'this call'}?`}
        confirmLabel="Remove"
        busyLabel="Removing…"
        busy={busy}
        danger
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      >
        <p>
          The recording and its transcript are deleted.
          {removing?.usedBy?.length ? ` ${removing.usedBy.join(', ')} ${removing.usedBy.length === 1 ? 'keeps' : 'keep'} the flows already read from it.` : ''}
        </p>
      </ConfirmDialog>
    </ConsolePage>
  )
}
