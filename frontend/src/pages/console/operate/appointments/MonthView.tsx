import type { Appointment } from '../../../../console/types'
import { dateList, isActive, longDay, monthGrid, monthName, needsCheck } from './model'
import type { Shared } from './parts'

const HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * The month as a calendar: each day with how many are booked, how many wait
 * for confirmation, need a check or were cancelled. Choosing a day opens it
 * by doctor. Counts are written out; colour only marks today and the days
 * outside the month.
 */
export function MonthView({ shared, anchor, appts, onPickDay }: { shared: Shared; anchor: string; appts: Appointment[]; onPickDay(date: string): void }) {
  const days = monthGrid(anchor)
  const month = anchor.slice(0, 7)
  const byDay = new Map<string, Appointment[]>()
  for (const a of appts) byDay.set(a.date, [...(byDay.get(a.date) ?? []), a])
  const weeks = Array.from({ length: days.length / 7 }, (_, w) => dateList(days[w * 7], 7))
  return (
    <table className="ap-month" aria-label={`Appointments in ${monthName(anchor)}`}>
      <thead>
        <tr>
          {HEAD.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]}>
            {week.map((d) => {
              const mine = byDay.get(d) ?? []
              const booked = mine.filter(isActive).length
              const pending = mine.filter((a) => a.status === 'pending' || a.status === 'rescheduled').length
              const check = mine.filter(needsCheck).length
              const cancelled = mine.filter((a) => a.status === 'cancelled').length
              const words = [`${booked} booked`, pending ? `${pending} waiting for confirmation` : '', check ? `${check} need a check` : '', cancelled ? `${cancelled} cancelled` : ''].filter(Boolean).join(', ')
              return (
                <td key={d} className={`${d.slice(0, 7) !== month ? 'is-other' : ''}${d === shared.today ? ' is-today' : ''}`}>
                  <button type="button" className="ap-month__day" aria-label={`${longDay(d)}${d === shared.today ? ' (today)' : ''}: ${words}. Open the day.`} onClick={() => onPickDay(d)}>
                    <span className="ap-month__date num">{Number(d.slice(8))}</span>
                    {/* On a phone only the figures show; the button's name says them all. */}
                    {booked > 0 && (
                      <span className="ap-month__n" aria-hidden="true">
                        <span className="num">{booked}</span>
                        <span className="ap-month__w"> booked</span>
                      </span>
                    )}
                    {pending > 0 && (
                      <span className="ap-month__tag ap-month__tag--info" aria-hidden="true">
                        <span className="num">{pending}</span>
                        <span className="ap-month__w"> to confirm</span>
                      </span>
                    )}
                    {check > 0 && (
                      <span className="ap-month__tag ap-month__tag--warn" aria-hidden="true">
                        <span className="num">{check}</span>
                        <span className="ap-month__w"> to check</span>
                      </span>
                    )}
                    {cancelled > 0 && (
                      <span className="ap-month__tag" aria-hidden="true">
                        <span className="num">{cancelled}</span>
                        <span className="ap-month__w"> cancelled</span>
                      </span>
                    )}
                  </button>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
