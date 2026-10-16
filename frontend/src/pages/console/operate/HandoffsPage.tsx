import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { canOpen } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Handoff } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Spinner } from '../../../components/ui/Spinner'
import { StaleNote, useAnnouncer } from './LiveBits'
import { languageName, since, timeOfDay, useLiveData, useNow } from './shared'
import './Operate.css'

/** /o/:slug/handoffs: callers the agents passed to a person, waiting now. */
export default function HandoffsPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const id = useId()
  const load = useCallback(() => client.listHandoffs(org.orgSlug), [client, org.orgSlug])
  const live = useLiveData(load, 5000)
  const now = useNow()
  const [note, say] = useAnnouncer()
  const [urgent, setUrgent] = useState('')
  const waitingHeading = useRef<HTMLHeadingElement>(null)
  /** After acting on one: focus this handover next (or the heading). */
  const [focusNext, setFocusNext] = useState<string | null | undefined>(undefined)

  const all = live.data ?? []
  // Emergencies first, then whoever has waited longest.
  const waiting = all.filter((h) => h.status === 'waiting').sort((a, b) => Number(b.emergency) - Number(a.emergency) || a.waitingSince.localeCompare(b.waitingSince))
  const recent = all.filter((h) => h.status !== 'waiting').sort((a, b) => (b.takenAt ?? b.waitingSince).localeCompare(a.takenAt ?? a.waitingSince))

  // A new caller waiting is said out loud: politely, or at once for an emergency.
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!live.data) return
    const ids = live.data.filter((h) => h.status === 'waiting')
    if (seen.current) {
      const fresh = ids.filter((h) => !seen.current!.has(h.id))
      if (fresh.some((h) => h.emergency)) setUrgent(`Emergency caller waiting on ${fresh.find((h) => h.emergency)!.agentName}.`)
      else if (fresh.length) say(`New caller waiting: ${ids.length} waiting now.`)
    }
    seen.current = new Set(live.data.map((h) => h.id))
  }, [live.data, say])

  // Focus moves after the list has re-rendered, once the native dialog (if
  // any) has put focus back.
  useEffect(() => {
    if (focusNext === undefined) return
    const t = window.setTimeout(() => {
      ;((focusNext && document.querySelector<HTMLElement>(`[data-handoff-heading="${focusNext}"]`)) || waitingHeading.current)?.focus()
    }, 0)
    setFocusNext(undefined)
    return () => window.clearTimeout(t)
  }, [focusNext, live.data])

  const done = (h: Handoff, text: string) => {
    const i = waiting.findIndex((x) => x.id === h.id)
    const next = waiting[i + 1] ?? waiting[i - 1]
    say(text)
    live.setData((d) => (d ? d.map((x) => (x.id === h.id ? h : x)) : d))
    // A fresh read, which also drops any reply already on its way: it can't put the caller back.
    live.reload()
    setFocusNext(next?.id ?? null)
  }

  return (
    <ConsolePage kicker="Operate" title="Handoff queue" docTitle="Handoff queue" lede={<p>Callers an agent passed to a person, with what the agent learned. Emergencies come first, then whoever has waited longest.</p>}>
      <p className="sr-only" role="status">
        {note}
      </p>
      <p className="sr-only" role="alert">
        {urgent}
      </p>
      {live.data && live.error ? <StaleNote error={live.error} checkedAt={live.checkedAt} onRetry={live.reload} /> : null}
      {!live.data && !live.error && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading the queue…</span>
        </div>
      )}
      {!live.data && live.error ? (
        <Alert tone="error" title="Couldn't load the queue">
          <p>{asAuthError(live.error).message}</p>
          <button type="button" className="btn-text" onClick={live.reload}>
            Try again
          </button>
        </Alert>
      ) : null}
      {live.data && (
        <>
          <section className="op-section" aria-labelledby={`${id}-wait`}>
            <h2 id={`${id}-wait`} ref={waitingHeading} tabIndex={-1} className="op-section__title">
              Waiting now <span className="op-count">{waiting.length}</span>
            </h2>
            {waiting.length === 0 ? (
              <p className="empty-note">Nobody is waiting. New handovers appear here by themselves.</p>
            ) : (
              <ul className="op-cards" aria-labelledby={`${id}-wait`}>
                {waiting.map((h) => (
                  <WaitingCard key={h.id} handoff={h} now={now} onDone={done} />
                ))}
              </ul>
            )}
          </section>

          <section className="op-section" aria-labelledby={`${id}-recent`}>
            <h2 id={`${id}-recent`} className="op-section__title">
              Recently
            </h2>
            {recent.length === 0 ? (
              <p className="empty-note">Nothing yet today.</p>
            ) : (
              <ul className="op-rows" aria-labelledby={`${id}-recent`}>
                {recent.map((h) => (
                  <li key={h.id} className="op-row">
                    <div className="op-row__main">
                      <p className="op-row__title">
                        {h.details.find((d) => d.label === 'Patient name')?.value ?? h.callerPhone} <span className="op-card__sub">{h.agentName}</span>
                      </p>
                      <p className="row__meta">{h.summary}</p>
                    </div>
                    <p className="op-row__state">
                      {h.status === 'taken' ? `Taken by ${h.takenBy} at ${timeOfDay(h.takenAt!)}` : 'Caller hung up before anyone answered'}
                      {h.status === 'missed' && canOpen(access, 'callbacks') && (
                        <>
                          {' '}
                          <Link className="link" to={`/o/${org.orgSlug}/callbacks`}>
                            Callbacks
                          </Link>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </ConsolePage>
  )
}

function WaitingCard({ handoff: h, now, onDone }: { handoff: Handoff; now: number; onDone(h: Handoff, text: string): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const id = useId()
  const [busy, setBusy] = useState<'take' | 'callback' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = h.details.find((d) => d.label === 'Patient name')?.value

  async function act(what: 'take' | 'callback') {
    setBusy(what)
    setError(null)
    try {
      if (what === 'take') {
        const next = await client.takeHandoff(org.orgSlug, h.id)
        onDone(next, `You took the call${name ? ` from ${name}` : ''}. Your desk phone rings.`)
      } else {
        await client.handoffToCallback(org.orgSlug, h.id)
        onDone({ ...h, status: 'missed' }, `A callback was made${name ? ` for ${name}` : ''}, assigned to you.`)
      }
    } catch (err) {
      setError(asAuthError(err).message)
      setBusy(null)
    }
  }

  return (
    <li className={`op-card${h.emergency ? ' op-card--flag' : ''}`} aria-labelledby={`${id}-h`}>
      <div className="op-card__head">
        <h3 className="op-card__title" id={`${id}-h`} tabIndex={-1} data-handoff-heading={h.id}>
          {name ?? 'A caller'} <span className="op-card__sub">{h.callerPhone}</span>
          {/* Said in words, not only by the card's border. */}
          {h.emergency && <span className="op-badge">Emergency</span>}
        </h3>
        <span className="op-card__time">Waiting {since(h.waitingSince, now)}</span>
      </div>
      <p className="row__meta">
        {h.agentName} <i aria-hidden="true">·</i> {h.line} <i aria-hidden="true">·</i> {languageName(h.language)}
      </p>
      <p className="op-card__reason">{h.reason}</p>
      <p className="op-card__summary">{h.summary}</p>
      {h.details.length > 0 && (
        <dl className="op-facts">
          {h.details.map((d) => (
            <div key={d.label}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="op-card__actions">
        <Button variant="orange" size="sm" busy={busy === 'take'} busyLabel="Taking…" disabled={!!busy} onClick={() => void act('take')}>
          Take this call
        </Button>
        <Button variant="line" size="sm" busy={busy === 'callback'} busyLabel="Making a callback…" disabled={!!busy} onClick={() => void act('callback')}>
          Caller hung up: call back later
        </Button>
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}
