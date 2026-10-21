import { useCallback, useEffect, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import type { SourceCall, Transcript, TranscriptTurn } from '../../../console/types'
import { Alert } from '../../../components/ui/Alert'
import { Modal } from '../../../components/ui/Dialog'
import { Spinner } from '../../../components/ui/Spinner'

const SPEAKER: Record<TranscriptTurn['speaker'], string> = { caller: 'Caller', staff: 'Staff', agent: 'AICA' }

/** Personal details are marked {{kind:value}} in transcripts. Redacted,
 * they read as "[name]", "[phone]"…; otherwise the value shows. */
export function renderTurnText(text: string, redact: boolean): string {
  return text.replace(/\{\{(\w+):([^}]*)\}\}/g, (_, kind: string, value: string) => (redact ? `[${kind.replace('_', ' ')}]` : value))
}

export function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** 820 → "0.8 s". */
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** One call's transcript, turn by turn. Agent turns show how long the
 * caller waited for them, when the call has timings. */
export function TranscriptView({ transcript, redact }: { transcript: Transcript; redact: boolean }) {
  return (
    <ol className="transcript">
      {transcript.turns.map((t, i) => (
        <li key={i} className={`transcript__turn transcript__turn--${t.speaker}`}>
          <span className="transcript__who">
            {SPEAKER[t.speaker]} <time className="transcript__at">{clock(t.at)}</time>
            {t.latencyMs !== undefined && <> <span className="transcript__at">· replied in {seconds(t.latencyMs)}</span></>}
            {t.interrupted && <> <span className="transcript__cut">· caller cut in</span></>}
          </span>
          <p className="transcript__text">{renderTurnText(t.text, redact)}</p>
        </li>
      ))}
    </ol>
  )
}

/** A call's transcript in a dialog; `call` null means closed. */
export function TranscriptDialog({ orgSlug, call, redact, onClose }: { orgSlug: string; call: SourceCall | null; redact: boolean; onClose(): void }) {
  const client = useConsole()
  const [state, setState] = useState<{ t?: Transcript; error?: unknown }>({})

  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!call) return
    // A late answer for a call that's no longer open is ignored.
    let live = true
    setState({})
    client.getTranscript(orgSlug, call.id).then(
      (t) => live && setState({ t }),
      (error) => live && setState({ error }),
    )
    return () => {
      live = false
    }
  }, [client, orgSlug, call, tick])
  const load = useCallback(() => setTick((n) => n + 1), [])
  // Uploaded in demo mode: nothing was transcribed, so it's a stand-in.
  const sample = client.isDemo && !client.isLive?.('uploads') && call?.size !== undefined

  return (
    <Modal open={!!call} title={call ? `Transcript: ${call.name}` : 'Transcript'} onClose={onClose} wide>
      {sample && (
        <p className="transcript__note transcript__note--sample">
          Sample transcript: in this demo your file isn’t processed, so this shows what a transcript looks like.
        </p>
      )}
      {redact && <p className="transcript__note">Personal details are hidden.</p>}
      {state.error ? (
        <Alert tone="error" title="Couldn't load the transcript">
          <p>{asAuthError(state.error).message}</p>
          <button type="button" className="btn-text" onClick={load}>
            Try again
          </button>
        </Alert>
      ) : state.t ? (
        <TranscriptView transcript={state.t} redact={redact} />
      ) : (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading the transcript…</span>
        </div>
      )}
    </Modal>
  )
}
