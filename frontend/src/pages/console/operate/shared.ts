import { useCallback, useEffect, useState } from 'react'
import { LANGUAGE_LABEL } from '../../../auth/roles'
import type { Language } from '../../../auth/types'
import type { CallOutcome } from '../../../console/types'

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  resolved: 'Answered by the agent',
  booked: 'Booked',
  handed_over: 'Handed over',
  callback: 'Callback asked for',
  dropped: 'Caller hung up',
  emergency: 'Emergency',
}

export const languageName = (l: Language | 'mixed') => (l === 'mixed' ? 'Mixed' : LANGUAGE_LABEL[l])

/** The time now, updated every `ms` while the page shows something that ticks. */
export function useNow(ms = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms, active])
  return now
}

/** m:ss, e.g. "2:05". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "40 seconds", "3 minutes", "1 hour 5 minutes": how long since `iso`. */
export function since(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}${m % 60 ? ` ${m % 60} min` : ''}`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'}`
}

/** Time of day, e.g. "4:05 pm". */
export const timeOfDay = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** Check again `ms` after each reply while `active` (not on a fixed beat,
 * which a slow reply would never keep up with). `marker` changes with each
 * reply, e.g. the loaded data. */
export function usePoll(reload: () => void, active: boolean, marker: unknown, ms = 3000) {
  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(reload, ms)
    return () => window.clearTimeout(t)
  }, [reload, active, marker, ms])
}

/**
 * Data that keeps itself fresh: loads, then checks again `ms` after each
 * reply. A failed check keeps the last data on screen (with `error` set, so
 * the page can say it isn't updating) and retries more slowly; checks pause
 * while the browser tab is hidden. `setData` applies a local change at once.
 */
export function useLiveData<T>(load: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [pending, setPending] = useState(true)

  useEffect(() => {
    let live = true
    setPending(true)
    load().then(
      (d) => {
        if (!live) return
        setData(d)
        setError(null)
        setCheckedAt(Date.now())
        setPending(false)
      },
      (e) => {
        if (!live) return
        setError(e)
        setPending(false)
      },
    )
    return () => {
      live = false
    }
  }, [load, tick])

  useEffect(() => {
    if (pending) return
    const go = () => setTick((n) => n + 1)
    const onVisible = () => {
      if (document.hidden) return
      document.removeEventListener('visibilitychange', onVisible)
      go()
    }
    const t = window.setTimeout(
      () => {
        if (document.hidden) document.addEventListener('visibilitychange', onVisible)
        else go()
      },
      error ? ms * 3 : ms,
    )
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pending, error, ms])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, error, checkedAt, reload, setData }
}

/** "3 min 20 s", "45 seconds", "1 hour 5 min": a length of time, in words. */
export function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`
  return `${Math.floor(m / 60)} hour${Math.floor(m / 60) === 1 ? '' : 's'}${m % 60 ? ` ${m % 60} min` : ''}`
}

/** Whole-number percentage, for comparing a rate (not a count). */
export const share = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)
export const points = (n: number) => `${n} percentage point${n === 1 ? '' : 's'}`
