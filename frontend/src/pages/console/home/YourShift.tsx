import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { Skeleton } from '../../../components/console/Skeleton'
import { StatusPill } from '../../../components/console/StatusPill'
import { WaitTimer } from '../../../components/console/WaitTimer'
import { Alert } from '../../../components/ui/Alert'
import { canOpen } from '../../../console/access'
import { useOrg } from '../../../console/useOrg'
import { localDay } from '../../../lib/time'
import { languageName, timeOfDay } from '../operate/shared'
import { clockTime, inWords } from './format'
import { appointmentsToCheck, changesOn, isOverdue, myCallbacks, noticesNow, waitingCallers } from './shift'
import type { Slice, Today } from './useToday'

/** How many rows a block shows before it sends you to the page that has them all. */
const SHOWN = 5

const KIND: Record<string, { tone: 'warn' | 'info'; label: string }> = {
  away: { tone: 'warn', label: 'Away' },
  late: { tone: 'warn', label: 'Running late' },
  moved: { tone: 'info', label: 'Moved' },
}

interface ShiftProps {
  /** Null until the first load. */
  today: Today | null
  /** Refreshes about every 15 seconds: for "overdue" and "due in". */
  now: number
  reload(): void
}

/**
 * "Your shift": for people who take calls, the four things to do next, each
 * in its own block with its own loading, empty and error state, so one
 * source failing never blanks the others. It links to the pages that act
 * (Live calls, Callbacks, Appointments, the Bot desk) rather than repeating
 * their buttons.
 */
export function YourShift({ today, now, reload }: ShiftProps) {
  const { user, access, base } = useOrg()
  const id = useId()
  const day = localDay(0)
  return (
    <section className="op-section shift" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="op-section__title">
        Your shift
      </h2>
      <div className="shift__grid">
        <Block title="Callers waiting for a person" expected today={today} slice={today?.handoffs} retry={reload}>
          {(handoffs) => {
            const list = waitingCallers(handoffs)
            if (list.length === 0) return <p className="empty-note">Nobody is waiting for a person. The agents have it covered.</p>
            return (
              <>
                <ul className="shift__list">
                  {list.slice(0, SHOWN).map((h) => (
                    <li key={h.id} className={`shift__row${h.emergency ? ' is-emergency' : ''}`}>
                      <div className="shift__body">
                        <p className="shift__line">
                          {h.emergency && <StatusPill tone="danger">Emergency</StatusPill>}
                          <span className="shift__strong">{h.reason}</span>
                        </p>
                        <p className="shift__meta">
                          {h.callerPhone} <i aria-hidden="true">·</i> {h.line} <i aria-hidden="true">·</i> {languageName(h.language)}
                        </p>
                      </div>
                      <WaitTimer since={h.waitingSince} />
                    </li>
                  ))}
                </ul>
                <p className="shift__foot">
                  <Link className="btn-text" to={`${base}/live`}>
                    {list.length > SHOWN ? `Open in Live calls to see all ${list.length}` : 'Open in Live calls'}
                  </Link>
                </p>
              </>
            )
          }}
        </Block>

        <Block title="My next callbacks" expected={canOpen(access, 'callbacks')} today={today} slice={today?.callbacks} retry={reload}>
          {(callbacks) => {
            const list = myCallbacks(callbacks, user.id)
            if (list.length === 0) return <p className="empty-note">No callbacks due. Nice.</p>
            return (
              <>
                <p className="shift__note">Yours, or not given to anyone yet. Overdue first.</p>
                <ul className="shift__list">
                  {list.slice(0, SHOWN).map((c) => {
                    const late = isOverdue(c, now)
                    return (
                      <li key={c.id} className={`shift__row${late ? ' is-late' : ''}`}>
                        <div className="shift__body">
                          <p className="shift__line">
                            <span className="shift__strong">{c.callerName ?? 'Caller not named'}</span>
                            <a className="link num" href={`tel:${c.callerPhone.replace(/\s/g, '')}`} aria-label={`Call ${c.callerName ?? 'the caller'} on ${c.callerPhone}`}>
                              {c.callerPhone}
                            </a>
                          </p>
                          <p className="shift__meta">{c.reason}</p>
                        </div>
                        <div className="shift__side">
                          {late && <StatusPill tone="warn">Overdue</StatusPill>}
                          <span className="shift__due">
                            {late ? `${inWords(now - Date.parse(c.dueBy))} late` : `Due in ${inWords(Date.parse(c.dueBy) - now)}`}
                            {c.attempts > 0 && ` · tried ${c.attempts} time${c.attempts === 1 ? '' : 's'}`}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <p className="shift__foot">
                  <Link className="btn-text" to={`${base}/callbacks`}>
                    {list.length > SHOWN ? `See all ${list.length} callbacks` : 'Open Callbacks'}
                  </Link>
                </p>
              </>
            )
          }}
        </Block>

        <Block title="Today’s appointments to check" expected={canOpen(access, 'appointments')} today={today} slice={today?.appointments} retry={reload}>
          {(appointments) => {
            const list = appointmentsToCheck(appointments)
            if (list.length === 0) return <p className="empty-note">Nothing to check today.</p>
            return (
              <>
                <ul className="shift__list">
                  {list.slice(0, SHOWN).map((a) => (
                    <li key={a.id} className="shift__row">
                      <div className="shift__body">
                        <p className="shift__line">
                          <span className="shift__strong num">{clockTime(a.time)}</span>
                          <span className="shift__strong">{a.patientName}</span>
                        </p>
                        <p className="shift__meta">
                          {a.doctor}, {a.department}
                          {a.checkReason && ` · ${a.checkReason}`}
                        </p>
                      </div>
                      <StatusPill tone="warn">Needs a check</StatusPill>
                    </li>
                  ))}
                </ul>
                <p className="shift__foot">
                  <Link className="btn-text" to={`${base}/appointments`}>
                    {list.length > SHOWN ? `See all ${list.length} to check` : 'Open Appointments'}
                  </Link>
                </p>
              </>
            )
          }}
        </Block>

        <Block title="Today’s notices and doctor changes" expected={canOpen(access, 'desk')} today={today} slice={today?.desk} retry={reload}>
          {(desk) => {
            const notices = noticesNow(desk, now)
            const changes = changesOn(desk, day)
            if (notices.length === 0 && changes.length === 0) return <p className="empty-note">No notices or doctor changes for today.</p>
            return (
              <>
                {notices.length > 0 && (
                  <ul className="shift__list" aria-label="Notices the agents are telling callers">
                    {notices.map((n) => (
                      <li key={n.id} className="shift__row">
                        <div className="shift__body">
                          <p className="shift__strong">{n.text}</p>
                          <p className="shift__meta">Until {timeOfDay(n.until)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {changes.length > 0 && (
                  <ul className="shift__list" aria-label="Doctor changes today">
                    {changes.map((d) => (
                      <li key={d.id} className="shift__row">
                        <div className="shift__body">
                          <p className="shift__line">
                            <span className="shift__strong">{d.doctor}</span>
                            <span className="shift__meta">{d.department}</span>
                          </p>
                          <p className="shift__meta">{d.detail}</p>
                        </div>
                        <StatusPill tone={KIND[d.kind]?.tone ?? 'info'}>{KIND[d.kind]?.label ?? d.kind}</StatusPill>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="shift__foot">
                  <Link className="btn-text" to={`${base}/desk`}>
                    Open the Bot desk
                  </Link>
                </p>
              </>
            )
          }}
        </Block>
      </div>
    </section>
  )
}

/**
 * A block of the shift: a titled card that shows a skeleton until the first
 * load, its content once it has data (with a small "couldn't refresh" line
 * when a later check failed), or an error with Try again when it never
 * loaded. Not rendered at all when this person can't see the source.
 */
function Block<T>({
  title,
  expected,
  today,
  slice,
  retry,
  children,
}: {
  title: string
  expected: boolean
  today: Today | null
  slice: Slice<T> | null | undefined
  retry(): void
  children(data: T): ReactNode
}) {
  const id = useId()
  if (!expected) return null
  // After the first load, a source that was never asked for has nothing to show.
  if (today && !slice) return null
  return (
    <section className="shift__block" aria-labelledby={id} aria-busy={!today || undefined}>
      <h3 id={id} className="shift__title">
        {title}
      </h3>
      {!slice ? (
        <>
          <p role="status" className="sr-only">
            Loading {title.toLowerCase()}…
          </p>
          <Skeleton lines={3} />
        </>
      ) : slice.data ? (
        <>
          {slice.error ? <StaleLine error={slice.error} retry={retry} /> : null}
          {children(slice.data)}
        </>
      ) : (
        <Alert tone="error" title="Couldn’t load this">
          <p>{asAuthError(slice.error).message}</p>
          <button type="button" className="btn-text" onClick={retry}>
            Try again
          </button>
        </Alert>
      )}
    </section>
  )
}

function StaleLine({ error, retry }: { error: unknown; retry(): void }) {
  return (
    <p className="shift__stale" role="status">
      <strong>Couldn’t refresh.</strong> {asAuthError(error).message} This is what it said a moment ago.{' '}
      <button type="button" className="btn-text" onClick={retry}>
        Try again
      </button>
    </p>
  )
}

/**
 * For people who take calls and also read reports: the same shift in one
 * compact line above the dashboard. Counts, with a link to where each is
 * done, not the full blocks.
 */
export function ShiftStrip({ today, now, reload }: ShiftProps) {
  const { user, access, base } = useOrg()
  const id = useId()
  const handoffs = today?.handoffs ?? null
  const callbacks = today?.callbacks ?? null
  const waiting = handoffs?.data ? waitingCallers(handoffs.data) : null
  const overdue = callbacks?.data ? myCallbacks(callbacks.data, user.id).filter((c) => isOverdue(c, now)).length : null
  const wantCallbacks = canOpen(access, 'callbacks')
  const failed = handoffs?.error || (wantCallbacks && callbacks?.error)
  const loading = !today

  return (
    <section className="shift-strip" aria-labelledby={`${id}-h`} aria-busy={loading || undefined}>
      <h2 id={`${id}-h`} className="shift-strip__title">
        Your shift
      </h2>
      {loading ? (
        <>
          <p role="status" className="sr-only">
            Loading your shift…
          </p>
          <Skeleton width="14rem" />
        </>
      ) : (
        <ul className="shift-strip__items">
          <li>
            {waiting === null ? (
              <span>Callers waiting: not loaded</span>
            ) : waiting.length === 0 ? (
              <span>Nobody waiting for a person</span>
            ) : (
              <>
                {waiting.some((h) => h.emergency) && <StatusPill tone="danger">Emergency</StatusPill>}
                <strong className="num">{waiting.length}</strong> {waiting.length === 1 ? 'caller' : 'callers'} waiting, longest <WaitTimer since={waiting.reduce((a, b) => (Date.parse(b.waitingSince) < Date.parse(a.waitingSince) ? b : a)).waitingSince} compact />
              </>
            )}
            <Link className="btn-text" to={`${base}/live`}>
              Open in Live calls
            </Link>
          </li>
          {wantCallbacks && (
            <li>
              {overdue === null ? (
                <span>Callbacks: not loaded</span>
              ) : overdue === 0 ? (
                <span>No callbacks overdue for you</span>
              ) : (
                <>
                  <StatusPill tone="warn">Overdue</StatusPill>
                  <strong className="num">{overdue}</strong> {overdue === 1 ? 'callback' : 'callbacks'} overdue, yours or nobody’s yet
                </>
              )}
              <Link className="btn-text" to={`${base}/callbacks`}>
                Open Callbacks
              </Link>
            </li>
          )}
        </ul>
      )}
      {failed ? (
        <p className="shift__stale" role="status">
          <strong>Couldn’t refresh.</strong> {asAuthError(failed).message}{' '}
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </p>
      ) : null}
    </section>
  )
}
