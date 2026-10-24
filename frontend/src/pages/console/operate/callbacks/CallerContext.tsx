import { useCallback } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../../auth/types'
import { Skeleton } from '../../../../components/console/Skeleton'
import { StatusPill } from '../../../../components/console/StatusPill'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Callback, CallSummary } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { useAsync, type Async } from '../../../../lib/useAsync'
import { TranscriptView } from '../../calls/TranscriptDialog'
import { clock as duration, OUTCOME_LABEL } from '../shared'
import { callsFromNumber, dayTime, lastFive, nameOf, numberKey } from './queue'
import { STATUS } from './parts'

/** How far back, and how many, past calls from the caller's number are read. */
const HISTORY_DAYS = 90
const HISTORY_LIMIT = 10

export interface CallerCalls {
  calls: CallSummary[]
  /** All the log found, of which `calls` is the newest few. */
  found: number
}

/**
 * Past calls from this callback's number. The call log keeps numbers masked
 * (only the last five digits show) and matches a typed number on those
 * five, so the search is for the last five and every result is checked
 * against them again here: only calls that genuinely end the same way are
 * shown. Someone who may see only the calls they handled gets only those.
 */
export function useCallerCalls(callback: Callback) {
  const client = useConsole()
  const { org } = useOrg()
  const tail = lastFive(callback.callerPhone)
  const load = useCallback(async (): Promise<CallerCalls> => {
    if (tail.length < 5) return { calls: [], found: 0 }
    const page = await client.listCallLog(org.orgSlug, { days: HISTORY_DAYS, q: tail, limit: HISTORY_LIMIT })
    return { calls: callsFromNumber(callback, page.calls), found: page.total }
    // The callback object changes on every poll; its number does not.
  }, [client, org.orgSlug, tail])
  return useAsync(load)
}

/** Other callbacks for the same number (any state), and past calls from it, each part with its own loading, empty and error state. */
export function CallerHistory({
  callback,
  all,
  calls,
  reloadCalls,
  ownOnly,
  now,
  onOpen,
}: {
  callback: Callback
  all: Callback[]
  calls: Async<CallerCalls>
  reloadCalls(): void
  /** They see only the calls they handled. */
  ownOnly: boolean
  now: number
  onOpen(id: string): void
}) {
  const { base } = useOrg()
  const key = numberKey(callback.callerPhone)
  const others = all.filter((x) => x.id !== callback.id && numberKey(x.callerPhone) === key).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
  return (
    <div className="cb-history">
      <div>
        <h4 className="cb-sub">Other callbacks for this number</h4>
        {others.length === 0 ? (
          <p className="cb-quiet">None.</p>
        ) : (
          <ul className="cb-plain" aria-label="Other callbacks for this number">
            {others.map((o) => (
              <li key={o.id}>
                <button type="button" className="btn-text" onClick={() => onOpen(o.id)}>
                  {nameOf(o)}, asked {dayTime(o.requestedAt, now)}
                </button>{' '}
                <StatusPill tone={STATUS[o.status].tone}>{STATUS[o.status].text}</StatusPill>
                <span className="cb-plain__reason">{o.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div aria-busy={calls.state === 'loading'}>
        <h4 className="cb-sub">Past calls from this number</h4>
        <p className="cb-quiet cb-quiet--tight">
          Matched on the last five digits ({lastFive(callback.callerPhone)}), the part call history shows. Last {HISTORY_DAYS} days.
          {ownOnly ? ' You see the calls you handled.' : ''}
        </p>
        {calls.state === 'loading' && (
          <>
            <p role="status" className="sr-only">
              Looking for past calls…
            </p>
            <Skeleton lines={3} />
          </>
        )}
        {calls.state === 'error' && (
          <p className="cb-problem" role="alert">
            Couldn’t look for past calls: {asAuthError(calls.error).message}{' '}
            <button type="button" className="btn-text" onClick={reloadCalls}>
              Try again
            </button>
          </p>
        )}
        {calls.state === 'ready' && calls.data.calls.length === 0 && <p className="cb-quiet">No calls from this number in the last {HISTORY_DAYS} days.</p>}
        {calls.state === 'ready' && calls.data.calls.length > 0 && (
          <>
            <ul className="cb-plain" aria-label="Past calls from this number">
              {calls.data.calls.map((c) => (
                <li key={c.id}>
                  <Link className="link" to={`${base}/calls/${c.id}`}>
                    {dayTime(c.startedAt, now)}: {c.intent}
                  </Link>
                  <span className="cb-plain__reason">
                    {OUTCOME_LABEL[c.outcome]} · {c.agentName} · {duration(c.durationSec)}
                    {c.id === callback.callId ? ' · This callback began here' : ''}
                  </span>
                </li>
              ))}
            </ul>
            {calls.data.found > calls.data.calls.length && <p className="cb-quiet cb-quiet--tight">The latest {calls.data.calls.length} of {calls.data.found} found.</p>}
          </>
        )}
      </div>
    </div>
  )
}

/** The call a callback was made from: its summary, the start of the conversation and a link; or, plainly, that there is none. */
export function SourceCall({ callback, redact }: { callback: Callback; redact: boolean }) {
  const client = useConsole()
  const { org, base } = useOrg()
  const callId = callback.callId
  const load = useCallback(() => (callId ? client.getCallRecord(org.orgSlug, callId) : Promise.resolve(null)), [client, org.orgSlug, callId])
  const [record, reload] = useAsync(load)

  if (!callId) return <p className="cb-quiet">No call is linked to this callback, so there is no conversation to show. It may have been added by hand.</p>
  if (record.state === 'loading') {
    return (
      <div aria-busy="true">
        <p role="status" className="sr-only">
          Loading the call…
        </p>
        <Skeleton lines={3} />
      </div>
    )
  }
  if (record.state === 'error') {
    return (
      <p className="cb-problem" role="alert">
        Couldn’t open the call this came from: {asAuthError(record.error).message}{' '}
        <button type="button" className="btn-text" onClick={reload}>
          Try again
        </button>
      </p>
    )
  }
  const c = record.data
  if (!c) return null
  const excerpt = c.transcript.slice(0, 4)
  return (
    <div className="cb-source">
      <p className="cb-source__summary">{c.summary}</p>
      <p className="cb-quiet cb-quiet--tight">
        {dayTime(c.startedAt, Date.now())} · {c.agentName} · {c.intent} · {OUTCOME_LABEL[c.outcome]} · {duration(c.durationSec)}
      </p>
      {excerpt.length > 0 && (
        <div className="cb-source__excerpt">
          {redact && <p className="transcript__note">Personal details are hidden.</p>}
          <TranscriptView transcript={{ callId: c.id, turns: excerpt }} redact={redact} />
          {c.transcript.length > excerpt.length && <p className="cb-quiet cb-quiet--tight">The first {excerpt.length} of {c.transcript.length} lines.</p>}
        </div>
      )}
      <Link className="link" to={`${base}/calls/${c.id}`}>
        Open the whole call in Call history
      </Link>
    </div>
  )
}
