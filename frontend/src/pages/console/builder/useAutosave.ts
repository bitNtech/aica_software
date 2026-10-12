import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

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
  const running = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)
  latest.current = value

  const run = useCallback(() => {
    window.clearTimeout(timer.current)
    running.current = running.current.then(async () => {
      if (cancelled.current || !dirty.current || latest.current === null) return
      dirty.current = false
      setState('saving')
      try {
        await save(latest.current)
        failed.current = false
        setState(dirty.current ? 'unsaved' : 'saved')
      } catch {
        dirty.current = true
        failed.current = true
        setState('error')
      }
    })
    return running.current
  }, [save])

  /** Call after every change made by the person. */
  const changed = useCallback(() => {
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

  // Leaving the page saves what's pending rather than dropping it.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (dirty.current) void run()
    },
    [run],
  )

  return { state, changed, flush, cancel, retry: run }
}
