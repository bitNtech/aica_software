import { StatusPill, type Tone } from '../../../../components/console/StatusPill'
import { formatWait, waitInWords } from '../../../../components/console/WaitTimer'
import { useNow } from '../../../../lib/useNow'
import { factsOf, type QueueItem } from './queue'

/** The words for a row's state, in the order they matter. Status is never colour alone: each pill has an icon and words. */
export function pillsFor(item: QueueItem, me: string): { key: string; tone: Tone; text: string }[] {
  const f = factsOf(item)
  const out: { key: string; tone: Tone; text: string }[] = []
  if (f.emergency && f.waiting) out.push({ key: 'emergency', tone: 'danger', text: 'Emergency' })
  if (f.waiting) out.push({ key: 'asking', tone: 'info', text: 'Asking for a person' })
  if (f.flagged) out.push({ key: 'upset', tone: 'warn', text: 'Sounds upset' })
  if (!item.ended && !f.takenBy && !f.waiting && !f.missed && item.call) out.push({ key: 'agent', tone: 'live', text: 'With the agent' })
  if (f.takenBy) out.push({ key: 'taken', tone: 'ok', text: `Taken by ${f.takenBy === me ? 'you' : f.takenBy}` })
  if (f.missed) out.push({ key: 'hung', tone: 'neutral', text: 'Caller hung up' })
  else if (item.ended) out.push({ key: 'ended', tone: 'neutral', text: 'Call ended' })
  return out
}

export function RowPills({ item, me }: { item: QueueItem; me: string }) {
  const pills = pillsFor(item, me)
  if (pills.length === 0) return null
  return (
    <span className="live-pills">
      {pills.map((p) => (
        <StatusPill key={p.key} tone={p.tone}>
          {p.text}
        </StatusPill>
      ))}
    </span>
  )
}

/**
 * How long a call has lasted, counting up (and stopped once it has ended).
 * Neutral: a long call isn't a warning, unlike a long wait. The ticking
 * figures are hidden from screen readers, which get the length in words,
 * changing by the minute.
 */
export function CallClock({ startedAt, endedAt, label = 'on the call for' }: { startedAt: string; endedAt?: number | null; label?: string }) {
  const now = useNow(1000)
  const start = Date.parse(startedAt)
  const seconds = Number.isFinite(start) ? Math.max(0, ((endedAt ?? now) - start) / 1000) : 0
  return (
    <span className="wait live-clock">
      <span className="wait__time num" aria-hidden="true">
        {formatWait(seconds)}
      </span>
      <span className="sr-only">
        {label} {waitInWords(Math.floor(seconds / 60) * 60)}
      </span>
    </span>
  )
}
