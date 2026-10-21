import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthError } from '../../../auth/types'

/** conflict: someone else saved since this page loaded; saving stops until a reload. */
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict'

/**
 * Saves `value` shortly after it stops changing, one save at a time, and
 * `flush()` saves at once (before moving on). Only changes made through the
 * page mark it dirty: loading the value doesn't trigger a save.
 */
export function useAutosave<T>(value: T | null, save: (v: T) => Promise<unknown>, delay = 800) {
  const [state, setState] = useState<SaveState>('saved')
  const latest = useRef(value)
  const dirty = useRef(false)
  /** The last save failed (not just "changed since"). */
  const failed = useRef(false)
  const cancelled = useRef(false)
  /** Saving again would overwrite someone else's work. */
  const conflicted = useRef(false)
  /** The page has gone: late changes (say, a slow reply) aren't saved. */
  const gone = useRef(false)
  const running = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)
  latest.current = value

  const run = useCallback(() => {
    window.clearTimeout(timer.current)
    running.current = running.current.then(async () => {
      if (cancelled.current || conflicted.current || !dirty.current || latest.current === null) return
      dirty.current = false
      setState('saving')
      try {
        await save(latest.current)
        failed.current = false
        setState(dirty.current ? 'unsaved' : 'saved')
      } catch (err) {
        failed.current = true
        if (err instanceof AuthError && err.code === 'conflict') {
          conflicted.current = true
          dirty.current = false
          setState('conflict')
          return
        }
        dirty.current = true
        setState('error')
      }
    })
    return running.current
  }, [save])

  /** Call after every change made by the person. */
  const changed = useCallback(() => {
    if (gone.current) return
    dirty.current = true
    setState('unsaved')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void run(), delay)
  }, [run, delay])

  /** Saves now (`next`, if given, instead of the current value); resolves
   * when saved, rejects if the save failed. */
  const flush = useCallback(async (next?: T) => {
    if (next !== undefined) {
      latest.current = next
      dirty.current = true
    }
    await run()
    if (failed.current) throw new Error('save failed')
  }, [run])

  /** Drops pending and future saves, e.g. before deleting the draft. */
  const cancel = useCallback(() => {
    cancelled.current = true
    window.clearTimeout(timer.current)
  }, [])

  useEffect(() => {
    gone.current = false
    return () => {
      gone.current = true
    }
  }, [])

  // Leaving the page saves what's pending rather than dropping it.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (dirty.current) void run()
    },
    [run],
  )

  /** The value was replaced from the server (discard, rollback): nothing
   * is pending any more, and a past failure no longer applies. */
  const reset = useCallback(() => {
    window.clearTimeout(timer.current)
    dirty.current = false
    failed.current = false
    conflicted.current = false
    setState('saved')
  }, [])

  return { state, changed, flush, cancel, reset, retry: run }
}
