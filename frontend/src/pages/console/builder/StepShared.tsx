import { useEffect, useRef, type RefObject } from 'react'
import type { Membership } from '../../../auth/types'
import type { AgentDraft } from '../../../console/types'
import { Alert } from '../../../components/ui/Alert'

/** Field key → message. Empty when the step is complete. */
export type StepErrors = Record<string, string>

export interface StepProps {
  draft: AgentDraft
  org: Membership
  /** Every change goes through here, so it's saved. */
  update(change: (d: AgentDraft) => AgentDraft): void
  /** True once Next was pressed with something missing: show errors live. */
  showErrors: boolean
  /** Bumped on each failed Next, to move focus to the summary again. */
  attempt: number
  /** The step sets this to its own check; Next calls it. */
  validator: RefObject<() => StepErrors>
}

/** What's missing, at the top of the step, focused on a failed Next. */
export function ErrorSummary({ errors, attempt }: { errors: StepErrors; attempt: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const list = Object.values(errors)
  const has = list.length > 0

  useEffect(() => {
    if (attempt > 0 && has) ref.current?.focus()
    // Only on a new attempt: fixing errors one by one doesn't steal focus.
  }, [attempt])

  if (!has) return null
  return (
    // Not a live region: it takes focus on a failed Next, which reads it, and
    // live updates while fixing would read it again on every change.
    <Alert ref={ref} live={false} tone="error" title={list.length === 1 ? 'One thing to fix before going on' : `${list.length} things to fix before going on`} className="builder__errors">
      <ul className="builder__error-list">
        {list.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </Alert>
  )
}
