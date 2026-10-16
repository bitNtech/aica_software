import { useEffect, useRef, type RefObject } from 'react'
import type { Membership } from '../../../auth/types'
import type { AgentDraft } from '../../../console/types'
import { Alert } from '../../../components/ui/Alert'

/** Field key → message. Empty when the step is complete. */
export type StepErrors = Record<string, string>

export interface StepProps {
  draft: AgentDraft
  org: Membership
  /** Where the organisation's pages live (`/ops/orgs/:slug` for bitNtech). */
  base: string
  /** Every change goes through here, so it's saved. */
  update(change: (d: AgentDraft) => AgentDraft): void
  /** True once Next was pressed with something missing: show errors live. */
  showErrors: boolean
  /** Bumped on each failed Next, to move focus to the summary again. */
  attempt: number
  /** The step sets this to its own check; Next calls it. */
  validator: RefObject<() => StepErrors>
  /** Saves pending changes now (e.g. before publishing). Rejects on failure. */
  save(): Promise<void>
  /** The draft is gone (published): no more saves. */
  done(): void
}

/** What's missing, at the top of the step, focused on a failed Next. */
export function ErrorSummary({ errors, attempt, hrefFor }: { errors: StepErrors; attempt: number; hrefFor?(key: string): string | undefined }) {
  const ref = useRef<HTMLDivElement>(null)
  const list = Object.entries(errors)
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
        {list.map(([key, m]) => {
          const href = hrefFor?.(key)
          return (
            <li key={key}>
              {href ? (
                <a
                  className="link"
                  href={href}
                  onClick={(e) => {
                    // Focus the row rather than jumping the URL's hash.
                    const el = document.querySelector<HTMLElement>(href)
                    if (!el) return
                    e.preventDefault()
                    el.focus()
                    el.scrollIntoView?.({ block: 'center' })
                  }}
                >
                  {m}
                </a>
              ) : (
                m
              )}
            </li>
          )
        })}
      </ul>
    </Alert>
  )
}
