import { useCallback, useId, useState, type FormEvent } from 'react'
import { asAuthError } from '../../auth/types'
import type { TestCallTranscript, TranscriptTurn, VoiceTicket } from '../../console/types'
import { useVoiceCall } from '../../console/voice/useVoiceCall'
import { TranscriptView } from '../../pages/console/calls/TranscriptDialog'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ChoiceGroup } from '../ui/Choice'
import { TextField } from '../ui/Field'
import { CallTranscript, MicLevel } from './CallTranscript'
import './Voice.css'

export interface CallTarget<T extends string> {
  value: T
  label: string
  hint?: string
}

interface Props<T extends string> {
  /** What the call talks to, when there's a choice (saved changes or live). */
  targets?: CallTarget<T>[]
  defaultTarget?: T
  getTicket(target: T): Promise<VoiceTicket>
  /** What the agent stored, read after the call. */
  getTranscript?(callId: string): Promise<TestCallTranscript>
  /** Runs before the ticket, e.g. saving what's on screen. */
  onBeforeStart?(target: T): Promise<void>
}

const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`)

/**
 * A call with an agent in the browser, as a caller would have it: the
 * microphone (with echo cancellation), the agent's voice, and the
 * conversation as text. Typing a line works too. It never holds a key:
 * the AICA API gives it a ten-minute token for this one call.
 */
export function VoiceCallPanel<T extends string>({ targets, defaultTarget, getTicket, getTranscript, onBeforeStart }: Props<T>) {
  const id = useId()
  const [target, setTarget] = useState<T>((defaultTarget ?? targets?.[0]?.value) as T)
  const [text, setText] = useState('')
  const [stored, setStored] = useState<{ turns?: TranscriptTurn[]; error?: string; busy?: boolean } | null>(null)
  const ticket = useCallback(async () => {
    await onBeforeStart?.(target)
    return getTicket(target)
  }, [getTicket, onBeforeStart, target])
  const call = useVoiceCall(ticket)
  const { state } = call
  const live = state.status === 'live'
  const busy = state.status === 'connecting' || state.status === 'ending'
  const over = state.status === 'ended' || state.status === 'failed'

  function send(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    call.say(text)
    setText('')
  }

  async function loadStored() {
    if (!getTranscript || !state.sessionId) return
    setStored({ busy: true })
    try {
      const t = await getTranscript(state.sessionId)
      setStored({ turns: t.turns })
    } catch (err) {
      setStored({ error: asAuthError(err).message })
    }
  }

  const statusText =
    state.status === 'connecting'
      ? 'Connecting…'
      : state.status === 'live'
        ? state.handoff === 'requested'
          ? 'The agent is passing the call to a person.'
          : state.handoff === 'accepted'
            ? 'A person has joined the call.'
            : call.muted
              ? 'On the call. Your microphone is off.'
              : state.listening
                ? 'Listening to you…'
                : state.speaking
                  ? 'The agent is speaking.'
                  : 'On the call. Speak, or type below.'
        : state.status === 'ending'
          ? 'Ending the call…'
          : state.status === 'ended'
            ? state.ended
            : state.status === 'failed'
              ? 'The call couldn’t continue.'
              : 'Not on a call.'

  if (!call.supported) {
    return (
      <div className="ws__unavailable">
        <p>Test calls need a microphone and a secure (https) page. Open the console over https in a recent browser to talk to the agent.</p>
      </div>
    )
  }

  return (
    <div className={`vcall vcall--${state.status}`}>
      {targets && targets.length > 1 && !live && !busy && (
        <ChoiceGroup legend="Talk to" type="radio" value={[target]} onChange={([v]) => setTarget(v as T)} options={targets} />
      )}
      <div className="vcall__bar">
        <p className="vcall__status" role="status">
          <span className={`vcall__dot vcall__dot--${live ? (state.listening ? 'listening' : state.speaking ? 'speaking' : 'live') : 'off'}`} aria-hidden="true" />
          {statusText}
        </p>
        {live && <MicLevel level={call.level} muted={call.muted} />}
        <div className="vcall__actions">
          {!live && !busy && (
            <Button variant="orange" size="sm" onClick={() => { setStored(null); void call.start() }}>
              {over ? 'Call again' : 'Start a test call'}
            </Button>
          )}
          {busy && (
            <Button variant="orange" size="sm" busy busyLabel={state.status === 'connecting' ? 'Connecting…' : 'Ending…'}>
              Start a test call
            </Button>
          )}
          {live && (
            <>
              <Button variant="line" size="sm" aria-pressed={call.muted} onClick={() => call.setMuted(!call.muted)}>
                {call.muted ? 'Unmute' : 'Mute'}
              </Button>
              <Button variant="line" size="sm" disabled={!state.speaking} onClick={call.interrupt}>
                Stop the agent
              </Button>
              <Button variant="danger" size="sm" onClick={call.hangUp}>
                End call
              </Button>
            </>
          )}
        </div>
      </div>

      {call.warnings.length > 0 && (live || busy || over) && (
        <Alert tone="info" title="On the voice server">
          <ul className="vcall__list">
            {call.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.notice && live && <Alert tone="warn">{state.notice}</Alert>}

      {(live || state.turns.length > 0) && <CallTranscript state={state} empty="The agent will greet you in a moment." />}

      {live && (
        <form className="vcall__type" onSubmit={send}>
          <TextField label="Type instead of speaking" hint="Sent as if you’d said it. It interrupts the agent, as speaking would." value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" variant="line" size="sm" disabled={!text.trim()}>
            Send
          </Button>
        </form>
      )}

      {state.metrics && (
        <dl className="vcall__metrics" aria-label="How fast the last reply was">
          <div>
            <dt>First sound after you stopped</dt>
            <dd>{seconds(state.metrics.firstAudioMs)}</dd>
          </div>
          <div>
            <dt>Speech recognition</dt>
            <dd>{seconds(state.metrics.asrMs)}</dd>
          </div>
          <div>
            <dt>First words from the model</dt>
            <dd>{seconds(state.metrics.llmFirstTextMs)}</dd>
          </div>
          <div>
            <dt>Voice started</dt>
            <dd>{seconds(state.metrics.ttsFirstAudioMs)}</dd>
          </div>
        </dl>
      )}

      {over && getTranscript && state.sessionId && (
        <div className="vcall__after" aria-labelledby={`${id}-stored`}>
          {!stored?.turns && (
            <Button variant="line" size="sm" busy={stored?.busy} busyLabel="Loading…" onClick={() => void loadStored()}>
              Show what the agent heard
            </Button>
          )}
          {stored?.error && <Alert tone="error">{stored.error}</Alert>}
          {stored?.turns && (
            <>
              <h3 className="step__heading" id={`${id}-stored`}>
                What the agent heard and said
              </h3>
              <p className="step__sub">As the voice server recorded it. Test calls stay out of Call history and reports.</p>
              <TranscriptView transcript={{ callId: state.sessionId, turns: stored.turns }} redact={false} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
