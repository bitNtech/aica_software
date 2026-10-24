import { useNow } from '../../lib/useNow'
import { ToneIcon, type Tone } from './StatusPill'
import './Workspace.css'

export type WaitState = 'ok' | 'warn' | 'danger'

/** "2:14" under an hour, "1h 05m" after. */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** "3 minutes", "1 hour 5 minutes": the wait in words, for a screen reader. */
export function waitInWords(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  if (h > 0) return m > 0 ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour')
  if (m > 0) return plural(m, 'minute')
  return 'under a minute'
}

const STATE: Record<WaitState, { tone: Tone; text: string }> = {
  ok: { tone: 'neutral', text: 'Waiting' },
  warn: { tone: 'warn', text: 'Getting long' },
  danger: { tone: 'danger', text: 'Too long' },
}

/**
 * How long someone has waited, counting up. Past `warn` seconds it says
 * "Getting long" with a triangle, past `alert` seconds "Too long" with a
 * diamond: the words and shape change with the colour. Every timer on the
 * page ticks from one shared interval (lib/useNow). The ticking figures are
 * aria-hidden, so a screen reader isn't read the seconds; it gets a static
 * "waiting 3 minutes" that only changes when the wait does, minute by minute.
 */
export function WaitTimer({
  since,
  warn = 120,
  alert = 300,
  compact,
}: {
  since: Date | string | number
  /** Seconds after which the wait is "getting long". */
  warn?: number
  /** Seconds after which it is "too long". */
  alert?: number
  /** Icon and figures only; the state words are still said to screen readers. */
  compact?: boolean
}) {
  const now = useNow(1000)
  const start = since instanceof Date ? since.getTime() : typeof since === 'number' ? since : Date.parse(since)
  const seconds = Number.isFinite(start) ? Math.max(0, (now - start) / 1000) : 0
  const state: WaitState = seconds >= alert ? 'danger' : seconds >= warn ? 'warn' : 'ok'
  const { tone, text } = STATE[state]
  return (
    <span className={`wait wait--${state}`}>
      <ToneIcon tone={tone} />
      <span className="wait__time num" aria-hidden="true">
        {formatWait(seconds)}
      </span>
      {!compact && (
        <span className="wait__state" aria-hidden="true">
          {text}
        </span>
      )}
      {/* Static: changes by the minute, and is not a live region. */}
      <span className="sr-only">
        waiting {waitInWords(Math.floor(seconds / 60) * 60)}
        {state === 'ok' ? '' : `, ${text.toLowerCase()}`}
      </span>
    </span>
  )
}
