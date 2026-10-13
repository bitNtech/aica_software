import { useCallback, useEffect, useRef, useState } from 'react'
import { LANGUAGE_LABEL } from '../../../../auth/roles'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { AgentDraft, SourceCall } from '../../../../console/types'
import { Alert } from '../../../../components/ui/Alert'
import { Checkbox } from '../../../../components/ui/Field'
import { FileDrop } from '../../../../components/ui/FileDrop'
import { Spinner } from '../../../../components/ui/Spinner'
import { Switch } from '../../../../components/ui/Switch'
import { useAsync } from '../../../../lib/useAsync'
import { TranscriptDialog } from '../../calls/TranscriptDialog'
import { ErrorSummary, type StepErrors, type StepProps } from '../StepShared'

export const MIN_CALLS = 3
const MAX_BYTES = 200 * 1024 * 1024
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm)$/i
export const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus'

export const CALL_STATUS_LABEL: Record<SourceCall['status'], string> = {
  queued: 'Queued',
  transcribing: 'Transcribing',
  extracting: 'Finding flows',
  ready: 'Ready',
  failed: 'Failed',
}

export const isProcessing = (c: SourceCall) => c.status === 'queued' || c.status === 'transcribing' || c.status === 'extracting'

export function duration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function callLanguage(c: SourceCall): string {
  return c.language === 'mixed' ? 'Mixed' : LANGUAGE_LABEL[c.language]
}

/** Checks files before upload: audio only, not too large. Returns the
 * files to send and a message per file that was turned away. */
export function checkRecordings(files: File[]): { ok: File[]; rejected: string[] } {
  const ok: File[] = []
  const rejected: string[] = []
  for (const f of files) {
    if (!(f.type.startsWith('audio/') || AUDIO_EXT.test(f.name))) rejected.push(`${f.name}: not an audio file.`)
    else if (f.size > MAX_BYTES) rejected.push(`${f.name}: larger than 200 MB.`)
    else ok.push(f)
  }
  return { ok, rejected }
}

export function checkCalls(draft: AgentDraft, library: SourceCall[]): StepErrors {
  const e: StepErrors = {}
  const chosen = library.filter((c) => draft.sourceCallIds.includes(c.id))
  const ready = chosen.filter((c) => c.status === 'ready').length
  const waiting = chosen.filter(isProcessing).length
  if (ready < MIN_CALLS) e.calls = `Choose at least ${MIN_CALLS} ready calls. More calls give a better first draft.`
  else if (waiting > 0) e.calls = `Wait for ${waiting} chosen ${waiting === 1 ? 'call' : 'calls'} to finish processing, or untick ${waiting === 1 ? 'it' : 'them'}.`
  if (!draft.consent) e.consent = 'Confirm the callers agreed to these recordings being used.'
  return e
}

/** Step 0: pick past calls to learn from, or add recordings. */
export function StepCalls({ draft, org, update, showErrors, attempt, validator }: StepProps) {
  const client = useConsole()
  const load = useCallback(() => client.listCalls(org.orgSlug), [client, org.orgSlug])
  const [calls, reload] = useAsync(load)
  const [uploading, setUploading] = useState(false)
  const [rejected, setRejected] = useState<string[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SourceCall | null>(null)
  /** Announced politely: what an upload did. */
  const [uploadNote, setUploadNote] = useState('')
  const all = useRef<HTMLInputElement>(null)

  const list = calls.state === 'ready' ? calls.data : []
  const processing = list.some(isProcessing)

  // Check on processing calls every couple of seconds until they're done.
  useEffect(() => {
    if (!processing) return
    const t = window.setInterval(reload, 2000)
    return () => window.clearInterval(t)
  }, [processing, reload])

  const selected = new Set(draft.sourceCallIds)
  const chosen = list.filter((c) => selected.has(c.id))
  const readyChosen = chosen.filter((c) => c.status === 'ready').length
  const ready = list.filter((c) => c.status === 'ready')
  const allReadyChosen = ready.length > 0 && ready.every((c) => selected.has(c.id))
  const someReadyChosen = ready.some((c) => selected.has(c.id))
  const stillProcessing = list.filter(isProcessing).length

  // "Choose all" shows when only some are chosen.
  useEffect(() => {
    if (all.current) all.current.indeterminate = someReadyChosen && !allReadyChosen
  }, [someReadyChosen, allReadyChosen])

  const check = (): StepErrors => (calls.state !== 'ready' ? { calls: 'Wait for your calls to load.' } : checkCalls(draft, list))
  validator.current = check
  const errors = showErrors ? check() : {}

  const toggle = (id: string, on: boolean) =>
    update((d) => ({ ...d, sourceCallIds: on ? [...d.sourceCallIds, id] : d.sourceCallIds.filter((x) => x !== id) }))

  async function upload(files: File[]) {
    const { ok, rejected } = checkRecordings(files)
    setRejected(rejected)
    setUploadError(null)
    if (!ok.length) return
    setUploading(true)
    setUploadNote(`Adding ${ok.length} ${ok.length === 1 ? 'recording' : 'recordings'}…`)
    try {
      const added = await client.addRecordings(
        org.orgSlug,
        ok.map((f) => ({ name: f.name, size: f.size, type: f.type, file: f })),
      )
      // New recordings are chosen for this agent straight away.
      const usable = added.filter((c) => c.status !== 'failed').map((c) => c.id)
      update((d) => ({ ...d, sourceCallIds: [...d.sourceCallIds, ...usable] }))
      reload()
      const bad = added.length - usable.length
      setUploadNote(
        `${usable.length} ${usable.length === 1 ? 'recording' : 'recordings'} added and chosen, now being processed.` +
          (bad ? ` ${bad} couldn't be used: see the list.` : ''),
      )
    } catch (err) {
      setUploadError(asAuthError(err).message)
      setUploadNote('')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="step">
      <ErrorSummary errors={errors} attempt={attempt} />

      <section className="step__section" aria-labelledby="add-h">
        <h2 id="add-h" className="step__heading">
          Add recordings
        </h2>
        <FileDrop
          label={uploading ? 'Adding…' : 'Choose recordings'}
          accept={AUDIO_ACCEPT}
          multiple
          disabled={uploading}
          hint={
            client.isDemo
              ? 'MP3, WAV, M4A, OGG or FLAC, up to 200 MB each. In this demo nothing is uploaded: added files become sample calls with sample transcripts.'
              : 'MP3, WAV, M4A, OGG or FLAC, up to 200 MB each.'
          }
          onFiles={(f) => void upload(f)}
        />
        <p className="sr-only" role="status">
          {uploadNote}
        </p>
        {rejected.length > 0 && (
          <Alert tone="warn" title="Some files weren't added" className="step__note">
            <ul className="builder__error-list">
              {rejected.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Alert>
        )}
        {uploadError && (
          <Alert tone="error" className="step__note">
            {uploadError}
          </Alert>
        )}
      </section>

      <section className="step__section" aria-labelledby="library-h">
        <div className="step__head-row">
          <h2 id="library-h" className="step__heading">
            Your call library
          </h2>
          {calls.state === 'ready' && list.length > 0 && (
            <p className="step__count" aria-live="polite">
              {readyChosen} of {ready.length} ready calls chosen
              {stillProcessing > 0 ? `, ${stillProcessing} still processing` : ''}
            </p>
          )}
        </div>

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
        {calls.state === 'ready' && list.length === 0 && (
          <p className="empty-note">No calls yet. Add recordings of real calls above: AICA learns your conversations from them.</p>
        )}

        {calls.state === 'ready' && list.length > 0 && (
          <fieldset
            className={['call-pick', errors.calls && 'call-pick--error'].filter(Boolean).join(' ')}
            aria-labelledby="library-h"
            aria-describedby={errors.calls ? 'calls-err' : undefined}
          >
            <div className="call-pick__all">
              <Checkbox
                ref={all}
                label="Choose all ready calls"
                checked={allReadyChosen}
                onChange={(e) =>
                  update((d) => {
                    const ids = new Set(d.sourceCallIds)
                    for (const c of ready) {
                      if (e.target.checked) ids.add(c.id)
                      else ids.delete(c.id)
                    }
                    return { ...d, sourceCallIds: [...ids] }
                  })
                }
              />
            </div>
            <ul className="call-pick__list">
              {list.map((c) => (
                <li key={c.id} className="call-pick__row">
                  <Checkbox
                    className="call-pick__check"
                    label={<span className="call-pick__name">{c.name}</span>}
                    hint={
                      <>
                        {c.topic ? (client.isDemo && c.size !== undefined ? `Sample topic: ${c.topic}` : c.topic) : 'Not processed yet'}{' '}
                        <i aria-hidden="true">·</i> {callLanguage(c)} <i aria-hidden="true">·</i> {duration(c.durationSec)}
                      </>
                    }
                    checked={selected.has(c.id)}
                    disabled={c.status === 'failed'}
                    aria-invalid={errors.calls && isProcessing(c) && selected.has(c.id) ? true : undefined}
                    aria-describedby={c.error ? `err-${c.id}` : undefined}
                    onChange={(e) => toggle(c.id, e.target.checked)}
                  />
                  <div className="call-pick__side">
                    <span className={`status-chip status-chip--call-${c.status}`}>{CALL_STATUS_LABEL[c.status]}</span>
                    {c.status === 'ready' && (
                      <button type="button" className="btn-text" onClick={() => setPreview(c)} aria-label={`Read transcript: ${c.name}`}>
                        Transcript
                      </button>
                    )}
                  </div>
                  {c.error && (
                    <p className="call-pick__error" id={`err-${c.id}`}>
                      {c.error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        {errors.calls && (
          <p className="field__error" id="calls-err">
            {errors.calls}
          </p>
        )}
      </section>

      <section className="step__section" aria-labelledby="privacy-h">
        <h2 id="privacy-h" className="step__heading">
          Callers’ privacy
        </h2>
        <div className="step__stack">
          <Checkbox
            label="The callers agreed to these calls being recorded and used to improve our service."
            hint="Required. Only use recordings you're allowed to use."
            checked={draft.consent}
            error={errors.consent}
            onChange={(e) => update((d) => ({ ...d, consent: e.target.checked }))}
          />
          <Switch
            label="Hide personal details in transcripts"
            hint="Names, phone numbers and patient IDs show as [name], [phone] and so on, here and in the flows AICA extracts."
            checked={draft.redact}
            onChange={(v) => update((d) => ({ ...d, redact: v }))}
          />
        </div>
      </section>

      <TranscriptDialog orgSlug={org.orgSlug} call={preview} redact={draft.redact} onClose={() => setPreview(null)} />
    </div>
  )
}
