import { useCallback, useState, type FormEvent } from 'react'
import type { OperatorTicket } from '../../console/types'
import { useOperatorCall } from '../../console/voice/useVoiceCall'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { TextField } from '../ui/Field'
import { CallTranscript, MicLevel } from './CallTranscript'
import './Voice.css'

interface Props {
  getTicket(mode: 'listen' | 'takeover'): Promise<OperatorTicket>
  /** Join in this mode as soon as it's shown (after "Take the call"). */
  autoJoin?: 'listen' | 'takeover'
  onLeft?(): void
}

/**
 * Being on a live call from the browser. Listening: you hear the caller
 * and the agent, and they don't hear you. Taking over: the agent pauses,
 * your microphone goes to the caller, and you can also type lines the
 * agent's voice says. Giving it back lets the agent carry on with
 * everything that was said while you had it.
 */
export function OperatorPanel({ getTicket, autoJoin, onLeft }: Props) {
  const op = useOperatorCall(getTicket)
  const { state } = op
  const [text, setText] = useState('')
  const [started, setStarted] = useState(false)
  const on = state.status === 'live'
  const busy = state.status === 'connecting' || state.status === 'ending'

  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && autoJoin && !started) {
        setStarted(true)
        void op.join(autoJoin)
      }
    },
    [autoJoin, op, started],
  )

  function send(e: FormEvent) {
    e.preventDefault()
    op.say(text)
    setText('')
  }

  if (!op.supported) {
    return <p className="field__hint">Listening in needs a microphone and a secure (https) page.</p>
  }

  const status = busy
    ? state.status === 'connecting'
      ? 'Joining the call…'
      : 'Ending the call…'
    : on
      ? op.mode === 'takeover'
        ? op.muted
          ? 'You have the call. Your microphone is off.'
          : 'You have the call: the caller hears you, the agent is paused.'
        : 'Listening in. The caller can’t hear you.'
      : state.status === 'ended'
        ? 'You’ve left the call.'
        : state.status === 'failed'
          ? 'Couldn’t stay on the call.'
          : 'Listen in to hear the caller and the agent, or take over to speak to the caller yourself.'

  return (
    <div className="vcall vcall--operator" ref={ref}>
      <div className="vcall__bar">
        <p className="vcall__status" role="status">
          <span className={`vcall__dot vcall__dot--${on ? (op.mode === 'takeover' ? 'speaking' : 'live') : 'off'}`} aria-hidden="true" />
          {status}
        </p>
        {on && op.mode === 'takeover' && <MicLevel level={op.level} muted={op.muted} />}
        <div className="vcall__actions">
          {!on && !busy && (
            <>
              <Button variant="line" size="sm" onClick={() => void op.join('listen')}>
                Listen in
              </Button>
              <Button variant="plum" size="sm" onClick={() => void op.join('takeover')}>
                Take over the call
              </Button>
            </>
          )}
          {busy && (
            <Button variant="line" size="sm" busy busyLabel="Connecting…">
              Listen in
            </Button>
          )}
          {on && op.mode === 'listen' && (
            <Button variant="plum" size="sm" onClick={() => void op.takeOver()}>
              Take over
            </Button>
          )}
          {on && op.mode === 'takeover' && (
            <>
              <Button variant="line" size="sm" aria-pressed={op.muted} onClick={() => op.setMuted(!op.muted)}>
                {op.muted ? 'Unmute' : 'Mute'}
              </Button>
              <Button variant="line" size="sm" onClick={() => op.release(true)}>
                Give back to the agent
              </Button>
            </>
          )}
          {on && (
            <>
              <Button
                variant="line"
                size="sm"
                onClick={() => {
                  op.leave()
                  onLeft?.()
                }}
              >
                Leave
              </Button>
              <Button variant="danger" size="sm" onClick={op.hangUp}>
                End the call
              </Button>
            </>
          )}
        </div>
      </div>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.notice && on && <Alert tone="warn">{state.notice}</Alert>}
      {on && <CallTranscript state={state} callerLabel="Caller" empty="Nothing said since you joined." />}
      {on && op.mode === 'takeover' && (
        <form className="vcall__type" onSubmit={send}>
          <TextField label="Say in the agent’s voice" hint="The caller hears this in the agent’s voice, instead of yours." value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" variant="line" size="sm" disabled={!text.trim()}>
            Say it
          </Button>
        </form>
      )}
    </div>
  )
}
