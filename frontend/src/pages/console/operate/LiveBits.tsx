import { useCallback, useEffect, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { timeOfDay } from './shared'

/**
 * A polite announcement that's said again even when the words repeat
 * ("Note added." twice), and clears itself, so a later message isn't
 * blocked by an old one. Render `text` in a role="status" element.
 */
export function useAnnouncer(clearAfter = 6000) {
  const [text, setText] = useState('')
  const say = useCallback((t: string) => {
    setText('')
    // Emptied first, then filled: a change screen readers notice.
    window.setTimeout(() => setText(t), 50)
  }, [])
  useEffect(() => {
    if (!text) return
    const t = window.setTimeout(() => setText(''), clearAfter)
    return () => window.clearTimeout(t)
  }, [text, clearAfter])
  return [text, say] as const
}

/** Shown over data that couldn't be refreshed: it's still there, but old. */
export function StaleNote({ error, checkedAt, onRetry }: { error: unknown; checkedAt: number | null; onRetry(): void }) {
  return (
    <p className="op-stale" role="status">
      <strong>Not updating.</strong> {asAuthError(error).message}
      {checkedAt && ` Last checked at ${timeOfDay(new Date(checkedAt).toISOString())}.`} Trying again by itself.{' '}
      <button type="button" className="btn-text" onClick={onRetry}>
        Try now
      </button>
    </p>
  )
}
