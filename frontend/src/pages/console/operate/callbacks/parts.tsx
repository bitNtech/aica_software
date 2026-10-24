import { StatusPill, ToneIcon, type Tone } from '../../../../components/console/StatusPill'
import type { Callback } from '../../../../console/types'
import { dueText, initials, type QueueItem } from './queue'

/** A person's initials in a circle. Decorative: the name is always written beside it. */
export function Avatar({ name }: { name: string | null }) {
  return (
    <span className={`cb-avatar${name ? '' : ' cb-avatar--none'}`} aria-hidden="true">
      {name ? initials(name) : ''}
    </span>
  )
}

export const STATUS: Record<Callback['status'], { tone: Tone; text: string }> = {
  open: { tone: 'neutral', text: 'To call' },
  done: { tone: 'ok', text: 'Done' },
  unreachable: { tone: 'warn', text: 'Couldn’t reach' },
}

/** The callback's state in an icon and words (never colour alone); an open one past its time says "Overdue". */
export function StatePill({ callback, overdue }: { callback: Callback; overdue: boolean }) {
  const s = callback.status === 'open' && overdue ? { tone: 'danger' as Tone, text: 'Overdue' } : STATUS[callback.status]
  return <StatusPill tone={s.tone}>{s.text}</StatusPill>
}

/**
 * When it is due, in words, with a small icon so lateness is not told by
 * colour alone: a diamond when overdue, a triangle within the hour, a plain
 * circle otherwise. A neutral clock, not a ticking timer: it changes only
 * when the page's own minute clock does.
 */
export function DueLabel({ item, now }: { item: QueueItem; now: number }) {
  const tone: Tone = item.overdue ? 'danger' : item.group === 'hour' ? 'warn' : 'neutral'
  return (
    <span className={`cb-due cb-due--${tone}`}>
      <ToneIcon tone={tone} size={13} />
      <span>{dueText(item, now)}</span>
    </span>
  )
}
