import { useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../../auth/types'
import { Skeleton } from '../../../../components/console/Skeleton'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { CallRecord, CallSummary } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { Alert } from '../../../../components/ui/Alert'
import { useAsync } from '../../../../lib/useAsync'
import { SPEAKER, clock as turnClock, renderTurnText } from '../../calls/TranscriptDialog'
import { duration, languageName } from '../shared'
import { firstTurns } from './logic'
import { callerLabel, OutcomePill, shortWhen, SentimentTag, SuccessTag } from './parts'

/** How much of the conversation the preview shows. */
const PREVIEW_TURNS = 4

interface Props {
  callId: string
  /** The row from the list, for the header while the call loads. */
  summary?: CallSummary
  /** Callers' names, numbers and personal details are hidden. */
  redact: boolean
  /** Shown beside the list (the Drawer has its own Close). */
  onClose?(): void
  /** The record, once read: the page keeps its sentiment and success. */
  onRecord(r: CallRecord): void
}

/**
 * A call at a glance, beside the list: what happened, how it ended, the
 * details collected, the path it took, the start of the conversation and
 * the notes. Everything here is also on the full call, one link away.
 */
export function CallPreview({ callId, summary, redact, onClose, onRecord }: Props) {
  const { org, base } = useOrg()
  const client = useConsole()
  const load = useCallback(() => client.getCallRecord(org.orgSlug, callId), [client, org.orgSlug, callId])
  const [record, reload] = useAsync(load)
  const heading = useRef<HTMLHeadingElement>(null)
  const keep = useRef(onRecord)
  keep.current = onRecord
  useEffect(() => {
    if (record.state === 'ready') keep.current(record.data)
  }, [record])

  const c = record.state === 'ready' ? record.data : summary
  const to = `${base}/calls/${callId}`
  const name = c ? callerLabel(c, !redact) : 'Call'

  return (
    <article className="cp" aria-label="Selected call" aria-busy={record.state === 'loading' || undefined}>
      <header className="cp__head">
        <h2 ref={heading} tabIndex={-1} className="cp__name">
          {name}
          {c && !redact && <span className="cp__phone">{c.callerPhone}</span>}
        </h2>
        {c && <OutcomePill outcome={c.outcome} />}
      </header>
      {c && (
        <p className="cp__meta">
          <time dateTime={c.startedAt}>{shortWhen(c.startedAt)}</time> <i aria-hidden="true">·</i> {duration(c.durationSec)} <i aria-hidden="true">·</i> {c.agentName} <i aria-hidden="true">·</i>{' '}
          {languageName(c.language)}
          {c.handledBy && (
            <>
              {' '}
              <i aria-hidden="true">·</i> taken by {c.handledBy}
            </>
          )}
        </p>
      )}
      <div className="cp__actions">
        <Link className="btn btn--plum btn--sm" to={to}>
          <span>Open full call</span>
        </Link>
        {onClose && (
          <button type="button" className="btn btn--line btn--sm" onClick={onClose}>
            <span>Close preview</span>
          </button>
        )}
      </div>

      {record.state === 'loading' && (
        <div role="status">
          <span className="sr-only">Loading the call…</span>
          <Skeleton lines={3} />
          <Skeleton lines={2} />
        </div>
      )}
      {record.state === 'error' && (
        <Alert tone="error" title="Couldn't open this call">
          <p>{asAuthError(record.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {record.state === 'ready' && <PreviewBody call={record.data} redact={redact} to={to} />}
    </article>
  )
}

function PreviewBody({ call: c, redact, to }: { call: CallRecord; redact: boolean; to: string }) {
  const turns = firstTurns(c.transcript, PREVIEW_TURNS)
  return (
    <>
      <section className="cp__sec" aria-label="Summary of the call">
        <h3 className="cp__title">What happened</h3>
        <p className="cp__summary">{redact && c.callerName ? c.summary.split(c.callerName).join('A caller') : c.summary}</p>
      </section>

      <section className="cp__sec" aria-label="After the call">
        <h3 className="cp__title">After the call</h3>
        <dl className="cp__facts">
          <div>
            <dt>Outcome</dt>
            <dd>
              <SuccessTag success={c.analysis.success} />
              {c.analysis.successReason && <span className="cp__reason">{c.analysis.successReason}</span>}
            </dd>
          </div>
          <div>
            <dt>How the caller sounded</dt>
            <dd>
              <SentimentTag sentiment={c.analysis.sentiment} />
            </dd>
          </div>
          {c.details.map((d) => (
            <div key={d.label}>
              <dt>{d.label}</dt>
              <dd>{redact && d.personal ? 'Hidden' : d.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="cp__sec" aria-label="Path through the flow">
        <h3 className="cp__title">Path through the flow</h3>
        {c.path.length === 0 ? (
          <p className="cp__quiet">No steps were recorded.</p>
        ) : (
          <ol className="cp__path">
            {c.path.map((step, i) => (
              <li key={step + i}>{step}</li>
            ))}
          </ol>
        )}
      </section>

      <section className="cp__sec" aria-label="Start of the conversation">
        <h3 className="cp__title">Start of the conversation</h3>
        {redact && <p className="transcript__note">Personal details are hidden.</p>}
        {turns.length === 0 ? (
          <p className="cp__quiet">Nothing was said.</p>
        ) : (
          <ol className="cp__turns">
            {turns.map((t, i) => (
              <li key={i} className={`cp__turn cp__turn--${t.speaker}`}>
                <span className="cp__who">
                  {SPEAKER[t.speaker]} <time className="transcript__at">{turnClock(t.at)}</time>
                </span>
                <span className="cp__say">{renderTurnText(t.text, redact)}</span>
              </li>
            ))}
          </ol>
        )}
        {c.transcript.length > turns.length && (
          <p className="cp__quiet">
            {c.transcript.length - turns.length} more {c.transcript.length - turns.length === 1 ? 'turn' : 'turns'} on the{' '}
            <Link className="link" to={to}>
              full call
            </Link>
            .
          </p>
        )}
      </section>

      <p className="cp__notes">
        {c.notes.length === 0 ? 'No notes yet.' : `${c.notes.length} ${c.notes.length === 1 ? 'note' : 'notes'}`}
        {c.notes.length > 0 && <span className="cp__quiet"> · latest by {c.notes[c.notes.length - 1].by}</span>}
      </p>
    </>
  )
}
