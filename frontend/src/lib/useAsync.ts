import { useCallback, useEffect, useState } from 'react'

export type Async<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'error'; error: unknown }

/** Runs `load` on mount (and on reload()), ignoring results that arrive
 * after unmount. Keeps the last data on screen while reloading. */
export function useAsync<T>(load: () => Promise<T>) {
  const [result, setResult] = useState<Async<T>>({ state: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    load().then(
      (data) => live && setResult({ state: 'ready', data }),
      (error) => live && setResult({ state: 'error', error }),
    )
    return () => {
      live = false
    }
    // `load` is expected to be stable (useCallback); tick forces a re-run.
  }, [load, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return [result, reload, setResult] as const
}
