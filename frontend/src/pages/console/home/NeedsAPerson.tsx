import { useId } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { Skeleton } from '../../../components/console/Skeleton'
import { can, canOpen } from '../../../console/access'
import { useOrg } from '../../../console/useOrg'
import { since } from '../operate/shared'
import { StaleNote } from '../operate/LiveBits'
import { isOverdue, waitingCallers } from './shift'
import type { Slice, Today } from './useToday'
import { awaitsReview } from '../../../console/appointmentRecords'

/** Whether this person is shown anything about today at all. */
export function expectsToday(access: Parameters<typeof can>[0]): boolean {
  return canOpen(access, 'live') || can(access, 'call.takeOver') || canOpen(access, 'callbacks') || canOpen(access, 'appointments')
}

/**
 * "Needs a person": one card per thing waiting on someone, each a link to the
 * page where it is dealt with. Everyone who can see any of it gets these; for
 * people who read reports they are smaller (`compact`), so the report stays
 * in view. A card whose figures couldn't load says so on its own, with a
 * retry, and the rest carry on.
 */
export function NeedsAPerson({
  today,
  checkedAt,
  now,
  reload,
  compact,
}: {
  today: Today | null
  checkedAt: number | null
  now: number
  reload(): void
  compact?: boolean
}) {
  const { user, access, base } = useOrg()
  const id = useId()
  if (!expectsToday(access)) return null

  const slices = today ? [today.live, today.handoffs, today.callbacks, today.appointments] : []
  const stale = slices.find((s) => s?.data && s.error)

  const waiting = today?.handoffs?.data ? waitingCallers(today.handoffs.data) : []
  const ownCallbacks = !access.perms.has('callbacks.assign')
  const openCallbacks = (today?.callbacks?.data ?? []).filter((c) => c.status === 'open' && (!ownCallbacks || c.assignedTo?.id === user.id || !c.assignedTo))
  const overdue = openCallbacks.filter((c) => isOverdue(c, now))
  const toCheck = (today?.appointments?.data ?? []).filter(awaitsReview)
  const liveCalls = today?.live?.data ?? []
  const upset = liveCalls.some((c) => c.flagged && !c.takenBy)

  return (
    <section className="op-section" aria-labelledby={`${id}-now`} aria-busy={!today || undefined}>
      <h2 id={`${id}-now`} className="op-section__title">
        Needs a person
      </h2>
      {stale && <StaleNote error={stale.error} checkedAt={checkedAt} onRetry={reload} />}
      <ul className={`home-attn${compact ? ' home-attn--compact' : ''}`}>
        {!today && (
          <>
            <li className="home-attn__skeleton">
              <p role="status" className="sr-only">
                Loading today…
              </p>
              <Skeleton block height={compact ? '3rem' : '4rem'} />
            </li>
            <li className="home-attn__skeleton">
              <Skeleton block height={compact ? '3rem' : '4rem'} />
            </li>
          </>
        )}
        {today?.handoffs && (
          <Card
            slice={today.handoffs}
            retry={reload}
            to={`${base}/live`}
            label="Waiting for a person"
            count={waiting.length}
            urgent={waiting.length > 0}
            detail={waiting.length ? `Longest waiting ${since(waiting[0].waitingSince, now)}` : 'Nobody waiting'}
          />
        )}
        {today?.live && (
          <Card
            slice={today.live}
            retry={reload}
            to={`${base}/live`}
            label="Calls in progress"
            count={liveCalls.length}
            urgent={upset}
            detail={upset ? 'A caller sounds upset' : 'The agents are handling them'}
          />
        )}
        {today?.callbacks && (
          <Card
            slice={today.callbacks}
            retry={reload}
            to={`${base}/callbacks`}
            label={ownCallbacks ? 'Callbacks for you or nobody yet' : 'Callbacks to make'}
            count={openCallbacks.length}
            urgent={overdue.length > 0}
            detail={overdue.length ? `${overdue.length} overdue` : 'None overdue'}
          />
        )}
        {today?.appointments && (
          <Card
            slice={today.appointments}
            retry={reload}
            to={`${base}/appointments`}
            label="Today's appointment requests to review"
            count={toCheck.length}
            urgent={false}
            detail={`${(today.appointments.data ?? []).filter((a) => a.status !== 'cancelled' && a.status !== 'declined').length} appointments today`}
          />
        )}
      </ul>
    </section>
  )
}

function Card<T>({ slice, retry, to, label, count, detail, urgent }: { slice: Slice<T>; retry(): void; to: string; label: string; count: number; detail: string; urgent: boolean }) {
  if (!slice.data) {
    return (
      <li className="home-attn__card home-attn__card--failed">
        <span className="home-attn__count" aria-hidden="true">
          –
        </span>
        <span className="home-attn__label">{label}</span>
        <span className="home-attn__detail">
          Couldn’t load: {asAuthError(slice.error).message}{' '}
          <button type="button" className="btn-text" onClick={retry}>
            Try again
          </button>
        </span>
      </li>
    )
  }
  return (
    <li>
      <Link to={to} className={`home-attn__card${urgent ? ' is-urgent' : ''}`} aria-label={`${count} ${label.toLowerCase()}. ${urgent ? 'Needs attention: ' : ''}${detail}.`}>
        <span className="home-attn__count">{count}</span>
        <span className="home-attn__label">{label}</span>
        <span className="home-attn__detail">{detail}</span>
        {/* The card is a link whose name says everything; urgency also gets an icon-and-words mark for the eye. */}
        {urgent && (
          <span className="home-attn__flag" aria-hidden="true">
            ▲ Needs attention
          </span>
        )}
      </Link>
    </li>
  )
}
