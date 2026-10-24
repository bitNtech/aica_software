import { useId, useState } from 'react'
import { ToneIcon } from '../../../../components/console/StatusPill'
import type { Appointment } from '../../../../console/types'
import { useMediaQuery } from '../../../../lib/useMediaQuery'
import { byStart, dayName, needsCheck, doctorShort, noteLabel, time12, type Counts, type DoctorLoad, type Problem } from './model'
import { ApptStatus, ProblemFlag, type Shared } from './parts'

/**
 * How full the visible days are: for each doctor, booked against capacity
 * (the open hours over the length of one appointment) as a small bar with
 * the numbers beside it, and one line of counts: needing a check, confirmed,
 * cancelled and booked by the agents. The bar is never the only carrier:
 * "7 of 16" is written, and "Full" or "Over" when it is.
 */
export function Summary({ loads, counts, label, slot }: { loads: DoctorLoad[]; counts: Counts; label: string; slot: number }) {
  const id = useId()
  return (
    <section className="ap-summary" aria-labelledby={`${id}-h`}>
      <h2 className="ap-summary__title" id={`${id}-h`}>
        {label}
      </h2>
      <p className="ap-summary__counts">
        <span>
          <ToneIcon tone="warn" size={13} /> <strong className="num">{counts.needsCheck}</strong> need a check
        </span>
        <span>
          <strong className="num">{counts.confirmed}</strong> confirmed
        </span>
        <span>
          <strong className="num">{counts.cancelled}</strong> cancelled
        </span>
        <span>
          <strong className="num">{counts.byAgent}</strong> booked by the agents
        </span>
      </p>
      {loads.length > 0 && (
        <ul className="ap-summary__loads" aria-label={`Booked against capacity, by doctor (one appointment takes about ${slot} minutes)`}>
          {loads.map((l) => {
            const full = l.capacity > 0 && l.booked >= l.capacity
            const over = l.booked > l.capacity
            const pct = l.capacity === 0 ? (l.booked > 0 ? 100 : 0) : Math.min(100, Math.round((l.booked / l.capacity) * 100))
            return (
              <li key={l.doctor} className="ap-load">
                <span className="ap-load__name">{doctorShort(l.doctor)}</span>
                <span className="ap-load__bar" role="img" aria-label={`${pct}% of the day booked`}>
                  <span className={`ap-load__fill${over ? ' is-over' : full ? ' is-full' : ''}`} style={{ width: `${pct}%` }} />
                </span>
                <span className="ap-load__n num">
                  {l.booked} of {l.capacity}
                  {l.approximate ? '*' : ''}
                  {(over || full) && <span className="ap-load__state">{over ? ' Over' : ' Full'}</span>}
                </span>
                {l.note && <span className="ap-load__note">{noteLabel(l.note)}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {loads.some((l) => l.approximate) && <p className="ap-hint">* Counted over 8 am to 8 pm: your role can't read the organisation's opening hours.</p>}
    </section>
  )
}

/**
 * The bookings that need someone to look: flagged by the agent for a check,
 * or with something wrong (a clash, outside hours, a doctor away…). In
 * every view, whatever the filters; each opens its detail. On a phone it
 * folds away behind its heading.
 */
export function CheckPanel({ items, shared }: { items: Appointment[]; shared: Shared }) {
  const wide = useMediaQuery('(min-width: 1100px)', true)
  const [choice, setChoice] = useState<boolean | null>(null)
  const open = choice ?? wide
  const id = useId()
  const { sees, today, problems } = shared
  return (
    <aside className="ap-check" aria-labelledby={`${id}-h`}>
      <h2 className="ap-check__title" id={`${id}-h`}>
        <button type="button" className="ap-check__toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setChoice(!open)}>
          <svg className="ap-check__chev" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3.5 1.5 3.5 3.5-3.5 3.5" />
          </svg>
          Needs a check <span className="op-count">{items.length}</span>
        </button>
      </h2>
      <div id={`${id}-body`} hidden={!open} className="ap-check__body">
        {items.length === 0 ? (
          <p className="ap-check__none">Nothing needs a check.</p>
        ) : (
          <ul className="ap-check__list">
            {[...items].sort(byStart).map((a) => {
              const p: Problem[] = problems.get(a.id) ?? []
              return (
                <li key={a.id}>
                  <button type="button" className={`ap-check__item${shared.selectedId === a.id ? ' is-selected' : ''}`} aria-haspopup="dialog" onClick={() => shared.onOpen(a)}>
                    <span className="ap-check__when num">
                      {dayName(a.date, today)}, {time12(a.time)}
                    </span>
                    <span className="ap-check__who">
                      {sees.name ? a.patientName : 'A patient'} <span className="ap-check__sub">{doctorShort(a.doctor)}</span>
                    </span>
                    <span className="ap-check__why">
                      <ApptStatus appt={a} />
                      <ProblemFlag problems={p} />
                    </span>
                    {needsCheck(a) && <span className="ap-check__reason">{a.checkReason}</span>}
                    {p[0] && <span className="ap-check__reason">{p[0].text}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
