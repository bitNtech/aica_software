import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { can } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { LiveCall } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Spinner } from '../../../components/ui/Spinner'
import { TranscriptView } from '../calls/TranscriptDialog'
import { StaleNote, useAnnouncer } from './LiveBits'
import { clock, duration, languageName, useLiveData, useNow } from './shared'
import './Operate.css'

/** /o/:slug/live: calls the agents are on now. */
export default function LiveCallsPage() {
  const { org } = useOrg()
  const client = useConsole()
  const load = useCallback(() => client.listLiveCalls(org.orgSlug), [client, org.orgSlug])
  const live = useLiveData(load, 3000)
  const now = useNow()
  const [said, say] = useAnnouncer()
  const list = live.data ?? []

  // Say what matters, not every change: a caller newly flagged as upset at
  // once; the number of calls at most every 45 seconds.
  const flaggedSeen = useRef(new Set<string>())
  const lastCount = useRef<{ n: number; at: number } | null>(null)
  useEffect(() => {
    if (!live.data) return
    const fresh = live.data.filter((c) => c.flagged && !c.takenBy && !flaggedSeen.current.has(c.id))
    for (const c of fresh) flaggedSeen.current.add(c.id)
    if (fresh.length) {
      say(`A caller on ${fresh[0].agentName} sounds upset or stuck.`)
      return
    }
    const n = live.data.length
    const last = lastCount.current
    if (!last) lastCount.current = { n, at: Date.now() }
    else if (n !== last.n && Date.now() - last.at > 45000) {
      lastCount.current = { n, at: Date.now() }
      say(n ? `${n} ${n === 1 ? 'call' : 'calls'} in progress.` : 'No calls in progress.')
    }
  }, [live.data, say])

  return (
    <ConsolePage
      kicker="Operate"
      title="Live calls"
      docTitle="Live calls"
      lede={<p>Calls your agents are on right now. Put one through to yourself when a caller needs a person.</p>}
    >
      <p className="sr-only" role="status">
        {said}
      </p>
      {live.data && live.error ? <StaleNote error={live.error} checkedAt={live.checkedAt} onRetry={live.reload} /> : null}
      {!live.data && !live.error && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading live calls…</span>
        </div>
      )}
      {!live.data && live.error ? (
        <Alert tone="error" title="Couldn't load live calls">
          <p>{asAuthError(live.error).message}</p>
          <button type="button" className="btn-text" onClick={live.reload}>
            Try again
          </button>
        </Alert>
      ) : null}
      {live.data &&
        (list.length === 0 ? (
          <p className="empty-note">No calls right now. This page updates by itself.</p>
        ) : (
          <ul className="op-cards" aria-label="Calls in progress">
            {list.map((c) => (
              <LiveCard
                key={c.id}
                call={c}
                now={now}
                canTake={can(org.role, 'call.takeOver')}
                onTaken={(done) => {
                  say(done)
                  live.reload()
                }}
              />
            ))}
          </ul>
        ))}
    </ConsolePage>
  )
}

function LiveCard({ call: c, now, canTake, onTaken }: { call: LiveCall; now: number; canTake: boolean; onTaken(done: string): void }) {
  const client = useConsole()
  const { org, user } = useOrg()
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const elapsed = (now - Date.parse(c.startedAt)) / 1000
  const turns = all ? c.turns : c.turns.slice(-3)

  async function take() {
    setBusy(true)
    setError(null)
    try {
      await client.takeOverCall(org.orgSlug, c.id)
      onTaken(`Putting the caller on ${c.line} through to you.`)
      // The button goes: focus the call it was for.
      requestAnimationFrame(() => heading.current?.focus())
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`op-card${c.flagged ? ' op-card--flag' : ''}`} aria-labelledby={`${id}-h`}>
      <div className="op-card__head">
        <h2 className="op-card__title" id={`${id}-h`} ref={heading} tabIndex={-1}>
          {c.agentName} <span className="op-card__sub">{c.callerPhone}</span>
        </h2>
        <span className="op-card__time">
          <span className="op-live-dot" aria-hidden="true" />
          <span aria-hidden="true">{clock(elapsed)}</span>
          <span className="sr-only">On the call for {duration(elapsed)}</span>
        </span>
      </div>
      <p className="row__meta">
        {c.line} <i aria-hidden="true">·</i> {languageName(c.language)} <i aria-hidden="true">·</i> {c.intent ?? 'Finding out what they need'}
        {c.step && (
          <>
            {' '}
            <i aria-hidden="true">·</i> now: {c.step}
          </>
        )}
      </p>
      {c.flagged && <p className="op-card__flag">The caller sounds upset or stuck: a person may help.</p>}

      <div className="op-card__talk">
        {c.turns.length > 3 && (
          <button type="button" className="btn-text op-card__more" aria-expanded={all} onClick={() => setAll((x) => !x)}>
            {all ? 'Show the last few lines' : `Show all ${c.turns.length} lines`}
          </button>
        )}
        {/* Personal details stay hidden on a live call. */}
        <TranscriptView transcript={{ callId: c.id, turns }} redact />
      </div>

      <div className="op-card__actions">
        {c.takenBy ? (
          <p className="op-card__taken">{c.takenBy === user.name ? 'Put through to you: your desk phone rings. (In the demo nothing rings.)' : `Taken by ${c.takenBy}.`}</p>
        ) : (
          canTake && (
            <Button variant="plum" size="sm" busy={busy} busyLabel="Putting through…" onClick={() => void take()}>
              Put through to me
            </Button>
          )
        )}
        <Button variant="line" size="sm" className="btn--inactive" aria-disabled aria-describedby={`${id}-listen`}>
          Listen in
        </Button>
        <span className="field__hint" id={`${id}-listen`}>
          Listening needs AICA’s voice servers: not available yet.
        </span>
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}
