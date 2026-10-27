import { useLayoutEffect, useRef } from 'react'
import type { CallState } from '../../console/voice/callState'

const WHO = { caller: 'Caller', agent: 'Agent', staff: 'Staff' } as const

/**
 * What has been said on a call in the browser, newest at the bottom. A
 * `log` that isn't read out line by line (it would talk over the call);
 * status changes are announced separately. The agent's reply fills in as
 * it's generated, and a reply the caller cut off shows what they heard.
 */
export function CallTranscript({ state, callerLabel = 'You', empty }: { state: CallState; callerLabel?: string; empty: string }) {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.turns, state.partial])

  return (
    <div ref={box} className="vcall__log" role="log" aria-live="off" aria-label="Call transcript" tabIndex={0}>
      {state.turns.length === 0 && !state.partial ? (
        <p className="vcall__quiet">{empty}</p>
      ) : (
        <ol className="transcript">
          {state.turns.map((t) => (
            <li key={t.id} className={`transcript__turn transcript__turn--${t.speaker}`}>
              <span className="transcript__who">
                {t.speaker === 'caller' ? callerLabel : WHO[t.speaker]}
                {t.streaming && <span className="transcript__at"> · speaking…</span>}
                {t.interrupted && <span className="transcript__cut"> · cut off here</span>}
              </span>
              <p className="transcript__text">
                {t.text}
                {t.interrupted && '…'}
              </p>
            </li>
          ))}
          {state.partial && (
            <li className="transcript__turn transcript__turn--caller vcall__partial">
              <span className="transcript__who">{callerLabel} · still speaking</span>
              <p className="transcript__text">{state.partial}</p>
            </li>
          )}
        </ol>
      )}
    </div>
  )
}

/** A small level meter for the microphone. Decorative: the state says it in words. */
export function MicLevel({ level, muted }: { level: number; muted: boolean }) {
  return (
    <span className={`vcall__meter${muted ? ' is-muted' : ''}`} aria-hidden="true">
      <span style={{ transform: `scaleX(${muted ? 0 : Math.min(1, level * 1.6)})` }} />
    </span>
  )
}
