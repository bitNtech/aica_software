import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ToneIcon } from '../../../../components/console/StatusPill'
import type { Appointment } from '../../../../console/types'
import { useMediaQuery } from '../../../../lib/useMediaQuery'
import { byStartRank, pileOf, dayMonth, needsCheck, dayName, doctorShort, gridWindow, hourLabel, hueFor, isActive, longDay, mondayOf, neighbour, dateList, time12, toMin, weekdayName, hoursFor, type NavItem, type NavKey } from './model'
import { Agenda, AgentMark, pileStyle, RequestsMark, Avatar, describe, ProblemFlag, toneOf, type Shared } from './parts'

const NARROW = '(max-width: 719px)'
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

/**
 * The week, Monday to Sunday: a column for each day with a count of what is
 * booked and what needs a check, today marked, closed days shaded with their
 * reason, and rows by the hour. Each booking is a small chip with the
 * doctor's initials and hue, the time, the patient and a status icon; a
 * click or Enter opens it, and the arrow keys move between chips (one Tab
 * stop). On a phone it is a list for each day.
 */
export function WeekView({ shared, anchor, appts, all }: { shared: Shared; anchor: string; appts: Appointment[]; all: Appointment[] }) {
  const { today, settings, slot, known, sees } = shared
  const narrow = useMediaQuery(NARROW, false)
  const [tabId, setTabId] = useState<string | null>(null)
  const days = useMemo(() => dateList(mondayOf(anchor), 7), [anchor])

  const model = useMemo(() => {
    const byDay = new Map(days.map((d) => [d, appts.filter((a) => a.date === d).sort(byStartRank)]))
    const allDay = new Map(days.map((d) => [d, all.filter((a) => a.date === d)]))
    const wins = days.map((d) => gridWindow(d, settings, allDay.get(d)!, slot))
    // Rows run over the earliest start to the latest end of the week's days.
    const from = Math.min(...wins.map((w) => w.gridFrom))
    const to = Math.max(...wins.map((w) => w.gridTo))
    const hours: number[] = []
    for (let m = from; m < to; m += 60) hours.push(m)
    return { byDay, allDay, hours }
  }, [days, appts, all, settings, slot])

  if (all.length === 0) return <p className="empty-note">No appointments this week.</p>

  const items: NavItem[] = days.flatMap((d, i) => model.byDay.get(d)!.map((a) => ({ id: a.id, col: i, start: toMin(a.time) + (pileOf(a)?.index ?? 0) / 100 })))
  const first = [...items].sort((a, b) => a.col - b.col || a.start - b.start)[0]?.id ?? null
  const stop = tabId && items.some((i) => i.id === tabId) ? tabId : (shared.selectedId && items.some((i) => i.id === shared.selectedId) ? shared.selectedId : first)

  const dayHead = (d: string) => {
    const mine = model.allDay.get(d)!
    const active = mine.filter(isActive).length
    const check = mine.filter(needsCheck).length
    const h = hoursFor(d, settings)
    return { active, check, closed: !h.open && h.known ? h.reason : null }
  }

  if (narrow) {
    return (
      <Agenda
        label={`Appointments, week of ${longDay(days[0])}`}
        shared={shared}
        showDoctor
        groups={days.map((d) => {
          const h = dayHead(d)
          return {
            key: d,
            title: (
              <>
                {dayName(d, today)} <span className="ap-agenda__dept">{dayMonth(d)} · {h.active} booked{h.check ? `, ${h.check} to check` : ''}</span>
              </>
            ),
            note: h.closed ? <p className="ap-hint">Closed: {h.closed}.</p> : undefined,
            items: model.byDay.get(d)!,
          }
        })}
      />
    )
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-appt]')
    if (!el || !NAV_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return
    const to = neighbour(items, el.dataset.appt!, e.key as NavKey)
    e.preventDefault()
    if (!to) return
    setTabId(to)
    Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-appt]'))
      .find((b) => b.dataset.appt === to)
      ?.focus()
  }

  return (
    <>
      <div className="ap-week" tabIndex={0} role="region" aria-label={`Appointments, week of ${longDay(days[0])}, scrollable. Arrow keys move between appointments.`} onKeyDown={onKeyDown}>
        <table className="ap-week__table">
          <caption className="sr-only">Appointments by day and hour, {longDay(days[0])} to {longDay(days[6])}</caption>
          <thead>
            <tr>
              <th scope="col" className="ap-week__corner">
                <span className="sr-only">Hour</span>
              </th>
              {days.map((d) => {
                const h = dayHead(d)
                const isToday = d === today
                return (
                  <th key={d} scope="col" className={`ap-week__head${isToday ? ' is-today' : ''}${h.closed ? ' is-closed' : ''}`} aria-current={isToday ? 'date' : undefined}>
                    <span className="ap-week__day">{isToday ? 'Today' : weekdayName(d).slice(0, 3)}</span>
                    <span className="ap-week__date">{dayMonth(d)}</span>
                    <span className="ap-week__counts">
                      <span className="op-count" title={`${h.active} booked`}>
                        {h.active}<span className="sr-only"> booked</span>
                      </span>
                      {h.check > 0 && (
                        <span className="ap-week__check">
                          <ToneIcon tone="warn" size={12} /> {h.check}<span className="sr-only"> need a check</span>
                        </span>
                      )}
                    </span>
                    {h.closed && <span className="ap-week__closed">Closed: {h.closed}</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {model.hours.map((m) => (
              <tr key={m}>
                <th scope="row" className="ap-week__hour num">
                  {hourLabel(m)}
                </th>
                {days.map((d) => {
                  const here = model.byDay.get(d)!.filter((a) => toMin(a.time) >= m && toMin(a.time) < m + 60)
                  const h = dayHead(d)
                  return (
                    <td key={d} className={`ap-week__cell${d === today ? ' is-today' : ''}${h.closed ? ' is-closed' : ''}`}>
                      {here.map((a) => {
                        const who = sees.name ? a.patientName : 'A patient'
                        const problems = shared.problems.get(a.id)
                        const hue = hueFor(a.doctor, known)
                        const pile = pileStyle(a)
                        return (
                          <button
                            key={a.id}
                            type="button"
                            data-appt={a.id}
                            className={`ap-chip ap-chip--${a.status}${needsCheck(a) ? ' is-check' : ''}${shared.selectedId === a.id ? ' is-selected' : ''}${problems?.length ? ' has-problem' : ''}${pile?.className ?? ''}`}
                            style={{ '--ap-h': hue, ...(pile ? { '--pile-i': pile.index, zIndex: 3 + pile.size - pile.index } : {}) } as CSSProperties}
                            tabIndex={a.id === stop ? 0 : -1}
                            aria-haspopup="dialog"
                            aria-label={describe(a, who, problems)}
                            onFocus={() => setTabId(a.id)}
                            onClick={() => shared.onOpen(a)}
                          >
                            <span className="ap-chip__top" aria-hidden="true">
                              <Avatar doctor={a.doctor} hue={hue} />
                              <span className="ap-chip__time num">{time12(a.time)}</span>
                              <span className={`ap-chip__status ap-chip__status--${toneOf(a)}`}>
                                <ToneIcon tone={toneOf(a)} size={12} />
                              </span>
                              <AgentMark appt={a} compact />
                              <RequestsMark appt={a} />
                            </span>
                            <span className="ap-chip__who" aria-hidden="true">
                              {who}
                            </span>
                            <span className="ap-chip__sub" aria-hidden="true">
                              {doctorShort(a.doctor)}
                              <ProblemFlag problems={problems} />
                            </span>
                          </button>
                        )
                      })}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ap-hint">Arrow keys move between appointments; Enter opens one.</p>
    </>
  )
}
