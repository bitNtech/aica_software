import { useEffect, useRef, useState } from 'react'
import type { SaveState } from './useAutosave'

/** Saving, saved, or failed. Only a failure, and the recovery after it,
 * is announced: the always-present status region gets text just then. */
export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry(): void }) {
  const [recovered, setRecovered] = useState(false)
  // Error → saving → saved: remember the error across the retry.
  const hadError = useRef(false)
  useEffect(() => {
    if (state === 'error') {
      hadError.current = true
      setRecovered(false)
    } else if (state === 'saved' && hadError.current) {
      hadError.current = false
      setRecovered(true)
    }
  }, [state])

  return (
    <div className="save-status-wrap">
      <p className={`save-status${state === 'error' || state === 'conflict' ? ' save-status--error' : ''}`}>
        {state === 'conflict' ? (
          <>
            Someone else saved changes, so yours weren’t saved.{' '}
            <button type="button" className="btn-text" onClick={() => window.location.reload()}>
              Reload
            </button>
          </>
        ) : state === 'error' ? (
          <>
            Couldn’t save.{' '}
            <button type="button" className="btn-text" onClick={onRetry}>
              Retry
            </button>
          </>
        ) : state === 'saving' ? (
          'Saving draft…'
        ) : state === 'unsaved' ? (
          'Not saved yet'
        ) : (
          // "Draft", not "changes": saved isn't the same as live.
          'Draft saved'
        )}
      </p>
      <p className="sr-only" role="status">
        {state === 'conflict' ? 'Someone else saved changes. Reload to see them.' : state === 'error' ? 'Couldn’t save your changes.' : recovered && state === 'saved' ? 'Your changes are saved now.' : ''}
      </p>
    </div>
  )
}
