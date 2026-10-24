import { useId } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../../auth/types'
import type { ActivityEntry } from '../../../../console/types'
import { Skeleton } from '../../../../components/console/Skeleton'
import { Timeline, type TimelineItem } from '../../../../components/console/Timeline'
import { Alert } from '../../../../components/ui/Alert'

const SHOWN = 8

const KIND: Record<ActivityEntry['actorKind'], TimelineItem['kind']> = { member: 'person', bitntech: 'system', aica: 'agent' }

/**
 * Who did what on the desk lately, from the organisation's activity log:
 * lines sent to staff and back, notices, doctor changes and flagged answers.
 * Its own loading, empty and error states; "See all activity" where the
 * person may open the log.
 */
export function DeskActivity({
  entries,
  error,
  onRetry,
  seeAll,
}: {
  /** Null until the first read. */
  entries: ActivityEntry[] | null
  error: unknown
  onRetry(): void
  /** The Activity page's path, when this person may open it. */
  seeAll: string | null
}) {
  const id = useId()
  const items: TimelineItem[] = (entries ?? []).slice(0, SHOWN).map((e) => ({ id: e.id, at: e.at, who: e.actor, kind: KIND[e.actorKind], title: e.text, body: e.detail }))
  const loading = entries === null && !error

  return (
    <section className="desk-panel desk-activity" aria-labelledby={`${id}-a`} aria-busy={loading}>
      <div className="op-section__head">
        <h2 id={`${id}-a`} className="op-section__title">
          Desk activity
        </h2>
        {seeAll && <Link to={seeAll}>See all activity</Link>}
      </div>
      {loading ? (
        <>
          <p className="sr-only" role="status">
            Loading the desk’s activity…
          </p>
          <Skeleton lines={4} />
        </>
      ) : entries === null ? (
        <Alert tone="error" title="Couldn't load the activity">
          <p>{asAuthError(error).message}</p>
          <button type="button" className="btn-text" onClick={onRetry}>
            Try again
          </button>
        </Alert>
      ) : (
        <>
          {error ? (
            <p className="op-stale" role="status">
              <strong>Not updating.</strong> {asAuthError(error).message}{' '}
              <button type="button" className="btn-text" onClick={onRetry}>
                Try now
              </button>
            </p>
          ) : null}
          {items.length === 0 ? <p className="empty-note">Nothing yet. Lines switched, notices and doctor changes made here show up with who did them.</p> : <Timeline items={items} label="Desk activity" />}
        </>
      )}
    </section>
  )
}
