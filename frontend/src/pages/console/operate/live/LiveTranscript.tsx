import { useLayoutEffect, useRef, useState } from 'react'
import type { TranscriptTurn } from '../../../../console/types'
import { TranscriptView } from '../../calls/TranscriptDialog'

/** Within this many pixels of the bottom counts as "following the newest". */
const NEAR_BOTTOM = 24

/**
 * The conversation so far, newest at the bottom. It follows the newest line
 * while you are at the bottom; the moment you scroll up to read, it stops
 * moving, and a "Jump to latest" button appears. It is a `log` for assistive
 * technology but deliberately silent (aria-live off): reading every line
 * aloud as it arrives would drown out the person's own work, so nothing is
 * announced per line; they read it when they choose to.
 */
export function LiveTranscript({ callId, turns, redact }: { callId: string; turns: TranscriptTurn[]; redact: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [behind, setBehind] = useState(0)
  const seen = useRef(turns.length)

  // New lines: stay at the bottom if following; otherwise count what is waiting below.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    if (following) {
      el.scrollTop = el.scrollHeight
      seen.current = turns.length
      setBehind(0)
    } else {
      setBehind(Math.max(0, turns.length - seen.current))
    }
  }, [turns.length, following])

  function onScroll() {
    const el = box.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM
    setFollowing(atBottom)
  }

  function jump() {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
    seen.current = turns.length
    setBehind(0)
    setFollowing(true)
    el?.focus()
  }

  return (
    <div className="live-log-wrap">
      {/* Focusable so the keyboard can scroll it; read by choice, never announced per line. */}
      <div ref={box} className="live-log" role="log" aria-live="off" aria-label="Live transcript" tabIndex={0} onScroll={onScroll}>
        <TranscriptView transcript={{ callId, turns }} redact={redact} />
      </div>
      {!following && (
        <button type="button" className="live-log__jump" onClick={jump}>
          Jump to latest{behind > 0 ? ` (${behind} new)` : ''}
        </button>
      )}
    </div>
  )
}
