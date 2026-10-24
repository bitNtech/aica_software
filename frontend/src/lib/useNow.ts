import { useEffect, useState } from 'react'

/**
 * One timer per tick length, shared by everything that asks for it: a queue
 * of forty wait timers runs one setInterval, not forty. The timer starts with
 * the first subscriber and stops with the last.
 */
interface Clock {
  subscribers: Set<(now: number) => void>
  timer: ReturnType<typeof setInterval> | null
}
const clocks = new Map<number, Clock>()

function subscribe(everyMs: number, listener: (now: number) => void): () => void {
  let clock = clocks.get(everyMs)
  if (!clock) {
    clock = { subscribers: new Set(), timer: null }
    clocks.set(everyMs, clock)
  }
  const c = clock
  c.subscribers.add(listener)
  if (c.timer === null) {
    c.timer = setInterval(() => {
      const now = Date.now()
      c.subscribers.forEach((fn) => fn(now))
    }, everyMs)
  }
  return () => {
    c.subscribers.delete(listener)
    if (c.subscribers.size === 0 && c.timer !== null) {
      clearInterval(c.timer)
      c.timer = null
      clocks.delete(everyMs)
    }
  }
}

/** The current time in ms, refreshed every `everyMs` (one second by default)
 * from a timer shared with every other caller of the same length. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // Catch up at once: the first render may be a while old.
    setNow(Date.now())
    return subscribe(everyMs, setNow)
  }, [everyMs])
  return now
}

/** "just now", "12 s ago", "3 min ago", "2 h ago": short and compact for a
 * status line. Longer ago than a day falls back to days. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

/** A live "3 s ago" for a moment in the past (ticks every second under a
 * minute, then every 30 s would do, but one shared second timer is cheap). */
export function useRelativeTime(at: Date | number | string | null | undefined): string | null {
  const now = useNow(1000)
  if (at === null || at === undefined) return null
  const ms = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at)
  if (!Number.isFinite(ms)) return null
  return ago(ms, now)
}
