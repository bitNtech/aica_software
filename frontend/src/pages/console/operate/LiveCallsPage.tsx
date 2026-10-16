import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { can } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { LiveCall, Member } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ChoiceGroup } from '../../../components/ui/Choice'
import { Modal } from '../../../components/ui/Dialog'
import { SelectField, TextField } from '../../../components/ui/Field'
import { useAsync } from '../../../lib/useAsync'
import { Spinner } from '../../../components/ui/Spinner'
import { TranscriptView } from '../calls/TranscriptDialog'
import { StaleNote, useAnnouncer } from './LiveBits'
import { clock, duration, languageName, useLiveData, useNow } from './shared'
import './Operate.css'

/** /o/:slug/live: calls the agents are on now. */
export default function LiveCallsPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const load = useCallback(() => client.listLiveCalls(org.orgSlug), [client, org.orgSlug])
  const live = useLiveData(load, 3000)
  const now = useNow()
  const [said, say] = useAnnouncer()
  const list = live.data ?? []
  const canTake = can(access, 'call.takeOver')
  // Colleagues a call can be handed to: people who take calls.
  const loadTeam = useCallback(() => (canTake ? client.listMembers(org.orgSlug) : Promise.resolve([] as Member[])), [client, org.orgSlug, canTake])
  const [team] = useAsync(loadTeam)

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
      lede={<p>Calls your agents are on right now. Guide the agent with a note only it hears, hand the call to a colleague, or put it through to yourself.</p>}
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
                canTake={canTake}
                team={team.state === 'ready' ? team.data : []}
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

function LiveCard({ call: c, now, canTake, team, onTaken }: { call: LiveCall; now: number; canTake: boolean; team: Member[]; onTaken(done: string): void }) {
  const client = useConsole()
  const { org, user } = useOrg()
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guiding, setGuiding] = useState(false)
  const [handing, setHanding] = useState(false)
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
      {c.whispers.length > 0 && (
        <ul className="op-whispers" aria-label="Notes to the agent">
          {c.whispers.map((w) => (
            <li key={w.at}>
              <span className="op-whispers__by">{w.by} to the agent:</span> {w.text}
            </li>
          ))}
        </ul>
      )}
      {guiding && !c.takenBy && (
        <WhisperForm
          callId={c.id}
          onDone={(done) => {
            setGuiding(false)
            if (done) onTaken(done)
          }}
        />
      )}

      <div className="op-card__actions">
        {c.takenBy ? (
          <p className="op-card__taken">
            {c.transferredTo
              ? `Handed to ${c.transferredTo.name}${c.transferredTo.warm ? ': the agent told them about the call first' : ''}. (In the demo nothing rings.)`
              : c.takenBy === user.name
                ? 'Put through to you: your desk phone rings. (In the demo nothing rings.)'
                : `Taken by ${c.takenBy}.`}
          </p>
        ) : (
          canTake && (
            <>
              <Button variant="plum" size="sm" busy={busy} busyLabel="Putting through…" onClick={() => void take()}>
                Put through to me
              </Button>
              {!guiding && (
                <Button variant="line" size="sm" onClick={() => setGuiding(true)}>
                  Guide the agent
                </Button>
              )}
              <Button variant="line" size="sm" onClick={() => setHanding(true)}>
                Hand to a colleague
              </Button>
            </>
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
      <Modal open={handing} title="Hand the call to a colleague" onClose={() => setHanding(false)}>
        {handing && (
          <TransferForm
            call={c}
            team={team.filter((m) => m.status === 'active' && m.role !== 'viewer' && m.id !== user.id)}
            onCancel={() => setHanding(false)}
            onDone={(done) => {
              setHanding(false)
              onTaken(done)
              requestAnimationFrame(() => heading.current?.focus())
            }}
          />
        )}
      </Modal>
    </li>
  )
}

/** A note only the agent hears, mid-call, e.g. "Offer Saturday with Dr. Arvind". */
function WhisperForm({ callId, onDone }: { callId: string; onDone(done: string | null): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) {
      setError('Write what the agent should know.')
      field.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await client.whisperToAgent(org.orgSlug, callId, text)
      onDone('Sent to the agent. The caller doesn’t hear it.')
    } catch (err) {
      setError(asAuthError(err).message)
      setBusy(false)
      field.current?.focus()
    }
  }

  return (
    <form className="op-form op-whisper" onSubmit={send} noValidate>
      <TextField ref={field} label="Note to the agent" hint="Only the agent hears it, e.g. “Offer Saturday 10 AM with Dr. Arvind”." maxLength={200} value={text} error={error} onChange={(e) => setText(e.target.value)} />
      <div className="op-card__actions">
        <Button type="submit" variant="line" size="sm" busy={busy} busyLabel="Sending…">
          Send to the agent
        </Button>
        <button type="button" className="btn-text" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function TransferForm({ call, team, onCancel, onDone }: { call: LiveCall; team: Member[]; onCancel(): void; onDone(done: string): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const [to, setTo] = useState('')
  const [warm, setWarm] = useState<'warm' | 'cold'>('warm')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const select = useRef<HTMLSelectElement>(null)

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!to) {
      setError('Choose who takes the call.')
      select.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const out = await client.transferCall(org.orgSlug, call.id, to, warm === 'warm')
      onDone(`Handed to ${out.transferredTo?.name ?? 'your colleague'}.`)
    } catch (err) {
      setError(asAuthError(err).message)
      setBusy(false)
    }
  }

  return (
    <form className="op-form" onSubmit={send} noValidate>
      <p>
        {call.agentName}, {call.callerPhone}: {call.intent ?? 'still finding out what they need'}.
      </p>
      <SelectField
        ref={select}
        label="Who takes it"
        value={to}
        error={error}
        options={[{ value: '', label: team.length ? 'Choose a colleague' : 'Nobody else takes calls' }, ...team.map((m) => ({ value: m.id, label: m.name }))]}
        onChange={(e) => setTo(e.target.value)}
      />
      <ChoiceGroup
        legend="How"
        type="radio"
        value={[warm]}
        onChange={([v]) => setWarm(v)}
        options={[
          { value: 'warm', label: 'Warm', hint: 'The agent tells them who’s calling and why, then connects the caller.' },
          { value: 'cold', label: 'Straight through', hint: 'The caller is put through at once.' },
        ]}
      />
      <div className="dialog__actions">
        <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Handing over…">
          Hand over
        </Button>
        <Button variant="line" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
