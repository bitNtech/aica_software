import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ToneIcon } from '../../../../components/console/StatusPill'
import { Checkbox } from '../../../../components/ui/Field'
import type { Appointment } from '../../../../console/types'
import { useMediaQuery } from '../../../../lib/useMediaQuery'
import { clockOf, needsCheck, pileOf, doctorColumns, fromMin, gridWindow, hourLabel, isActive, longDay, neighbour, norm, time12, weekdayName, type DoctorColumn, type Filters, type NavItem, type NavKey } from './model'
import { Agenda, AgentMark, pileStyle, RequestsMark, ApptStatus, Avatar, describe, NotePill, ProblemFlag, type Shared } from './parts'

/** Pixels per minute: an hour is 96px, enough for a 15-minute booking to be read. */
const PPM = 1.6
const NARROW = '(max-width: 719px)'
/** How far each card in a pile of requests sits from the one in front (px). */
const PILE_STEP = 14
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

interface Props {
  shared: Shared
  date: string
  /** The day's bookings that pass the filters. */
  appts: Appointment[]
  /** Every booking that day, before the filters: what the grid's hours and "empty" are judged by. */
  all: Appointment[]
  filters: Filters
  filtering: boolean
  onClearFilters(): void
}

/**
 * The day by doctor: one column for each doctor, rows by time through the
 * organisation's opening hours (widened for any booking outside them). A
 * line marks now on today. A doctor away, late or moved is shaded and says
 * so; a closed day or holiday shades the whole day with its reason. Bookings
 * that overlap sit side by side and are flagged. Each block says time,
 * patient, status and whether an agent booked it; Enter or a click opens it,
 * and the arrow keys move between blocks (one Tab stop for all of them).
 * On a phone it becomes a list for each doctor, with nothing to scroll sideways.
 */
export function DayView({ shared, date, appts, all, filters, filtering, onClearFilters }: Props) {
  const { settings, changes, known, slot, now, today } = shared
  const narrow = useMediaQuery(NARROW, false)
  const [busyChoice, setBusyChoice] = useState<boolean | null>(null)
  const [tabId, setTabId] = useState<string | null>(null)

  const win = useMemo(() => gridWindow(date, settings, all, slot), [date, settings, all, slot])
  const busyNames = useMemo(() => new Set(all.map((a) => norm(a.doctor))), [all])
  // A hospital with many doctors would make the grid very wide: by default, only those with something that day.
  const onlyBusy = busyChoice ?? known.length > 8
  const cols = useMemo<DoctorColumn[]>(
    () => doctorColumns(date, appts, known, changes, slot, { doctor: filters.doctor, department: filters.department }).filter((c) => !onlyBusy || busyNames.has(norm(c.doctor)) || c.note),
    [date, appts, known, changes, slot, filters.doctor, filters.department, onlyBusy, busyNames],
  )

  const weekday = weekdayName(date)
  const closedBanner =
    !win.open && win.known ? (
      <p className="ap-banner ap-banner--closed" role="status">
        <ToneIcon tone="warn" size={16} />
        <span>
          <strong>Closed on {longDay(date)}:</strong> {win.reason}.{all.some(isActive) ? ' The bookings below were made for a closed day.' : ''}
        </span>
      </p>
    ) : null

  if (all.length === 0) {
    return (
      <>
        {closedBanner}
        <p className="empty-note">No appointments on {weekday}.</p>
      </>
    )
  }
  if (appts.length === 0 && filtering) {
    return (
      <>
        {closedBanner}
        <p className="empty-note">
          No appointments on {weekday} match these filters.{' '}
          <button type="button" className="btn-text" onClick={onClearFilters}>
            Clear the filters
          </button>
        </p>
      </>
    )
  }

  const hoursNote = !settings ? (
    <p className="ap-hint">Showing {time12(fromMin(win.gridFrom))} to {time12(fromMin(win.gridTo))}: your role can't read the organisation's opening hours, so out-of-hours checks are off.</p>
  ) : win.widened ? (
    <p className="ap-hint">The timetable is wider than opening hours ({time12(fromMin(win.from))} to {time12(fromMin(win.to))}) because of bookings outside them.</p>
  ) : null

  const hiddenCount = known.filter((d) => (!filters.doctor || norm(d.doctor) === norm(filters.doctor)) && (!filters.department || d.department === filters.department)).length - cols.length
  const doctorToggle =
    known.length > 8 ? (
      <Checkbox label="Only doctors with something on this day" checked={onlyBusy} onChange={(e) => setBusyChoice(e.target.checked)} hint={!onlyBusy || hiddenCount <= 0 ? undefined : `${hiddenCount} left out`} />
    ) : null

  // ---- phone: a list for each doctor
  if (narrow) {
    return (
      <>
        {closedBanner}
        {hoursNote}
        {doctorToggle}
        <Agenda
          label={`Appointments by doctor, ${longDay(date)}`}
          shared={shared}
          showDoctor={false}
          groups={cols.map((c) => ({
            key: `d${known.findIndex((d) => norm(d.doctor) === norm(c.doctor))}`,
            title: (
              <>
                <Avatar doctor={c.doctor} hue={c.hue} /> {c.doctor} <span className="ap-agenda__dept">{c.department}</span>
              </>
            ),
            note: c.note ? <NotePill note={c.note} /> : undefined,
            items: c.appts,
          }))}
        />
      </>
    )
  }

  // ---- wide: the timetable
  const height = (win.gridTo - win.gridFrom) * PPM
  const top = (m: number) => (m - win.gridFrom) * PPM
  const hours: number[] = []
  for (let m = win.gridFrom; m < win.gridTo; m += 60) hours.push(m)
  const t = clockOf(now)
  const showNow = date === today && t.minutes >= win.gridFrom && t.minutes <= win.gridTo

  const items: NavItem[] = cols.flatMap((c, i) => c.placed.map((p) => ({ id: p.appt.id, col: i, start: p.start + (pileOf(p.appt)?.index ?? 0) / 100 })))
  const first = [...items].sort((a, b) => a.col - b.col || a.start - b.start)[0]?.id ?? null
  const stop = tabId && items.some((i) => i.id === tabId) ? tabId : (shared.selectedId && items.some((i) => i.id === shared.selectedId) ? shared.selectedId : first)

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
      {closedBanner}
      {hoursNote}
      {doctorToggle}
      {/* The box scrolls on its own (sideways with many doctors); it is a tab stop so the keyboard can scroll it. */}
      <div className="ap-day" tabIndex={0} role="region" aria-label={`Appointments by doctor, ${longDay(date)}, scrollable. Arrow keys move between appointments.`} onKeyDown={onKeyDown}>
        <div className="ap-day__grid" style={{ '--ap-cols': cols.length, '--ap-h-px': `${height}px`, '--ap-hour': `${60 * PPM}px` } as CSSProperties}>
          <div className="ap-day__corner" aria-hidden="true" />
          {cols.map((c) => (
            <div key={c.doctor} className="ap-day__head" id={`ap-col-${known.findIndex((d) => norm(d.doctor) === norm(c.doctor))}`} style={{ '--ap-h': c.hue } as CSSProperties}>
              <div className="ap-day__who">
                <Avatar doctor={c.doctor} hue={c.hue} />
                <span className="ap-day__name">{c.doctor}</span>
              </div>
              <p className="ap-day__dept">
                {c.department} · <span className="num">{c.appts.filter(isActive).length}</span> booked
              </p>
              {c.note && <NotePill note={c.note} />}
            </div>
          ))}

          <div className="ap-day__rail" style={{ height }} aria-hidden="true">
            {hours.map((m) => (
              <span key={m} className="ap-day__hour num" style={{ top: top(m) }}>
                {hourLabel(m)}
              </span>
            ))}
          </div>

          {cols.map((c, ci) => (
            <ul key={c.doctor} className="ap-day__col" style={{ height }} aria-labelledby={`ap-col-${known.findIndex((d) => norm(d.doctor) === norm(c.doctor))}`}>
              {/* A doctor away, or not in until a time: shaded (the header says why). */}
              {c.note && (c.note.kind === 'away' || (c.note.kind === 'late' && c.note.until > win.gridFrom)) && (
                <li className={`ap-shade ap-shade--${c.note.kind}`} style={{ top: 0, height: c.note.kind === 'away' ? height : Math.min(height, top(c.note.until)) }} aria-hidden="true">
                  <span className="ap-shade__label">{c.note.kind === 'away' ? 'Away' : `Not in until ${time12(fromMin(c.note.until))}`}</span>
                </li>
              )}
              {c.placed.map((p) => {
                const a = p.appt
                const who = shared.sees.name ? a.patientName : 'A patient'
                const problems = shared.problems.get(a.id)
                // The agent's requests for one time overlap, each a step down and across by its rank, the best-ranked in front.
                const pile = pileStyle(a)
                const step = pile ? pile.index * PILE_STEP : 0
                const shrink = pile ? (pile.size - 1) * PILE_STEP : 0
                return (
                  <li
                    key={a.id}
                    className={`ap-slot${pile ? ' is-piled' : ''}`}
                    style={{
                      top: top(p.start) + step,
                      height: Math.max(pile ? 52 : 34, (p.end - p.start) * PPM),
                      left: pile ? `calc(${(p.lane / p.lanes) * 100}% + ${step}px)` : `${(p.lane / p.lanes) * 100}%`,
                      width: pile ? `calc(${100 / p.lanes}% - ${shrink}px)` : `${100 / p.lanes}%`,
                      ...(pile ? { zIndex: 3 + pile.size - pile.index } : {}),
                    }}
                  >
                    <button
                      type="button"
                      data-appt={a.id}
                      data-col={ci}
                      className={`ap-block ap-block--${a.status}${needsCheck(a) ? ' is-check' : ''}${problems?.length ? ' has-problem' : ''}${p.lanes > 1 ? ' is-shared' : ''}${pile?.className ?? ''}${shared.selectedId === a.id ? ' is-selected' : ''}`}
                      style={{ '--ap-h': c.hue } as CSSProperties}
                      tabIndex={a.id === stop ? 0 : -1}
                      aria-haspopup="dialog"
                      aria-label={describe(a, who, problems)}
                      onFocus={() => setTabId(a.id)}
                      onClick={() => shared.onOpen(a)}
                    >
                      <span className="ap-block__top">
                        <span className="ap-block__time num">{time12(a.time)}</span>
                        <span className="ap-block__who">{who}</span>
                      </span>
                      <span className="ap-block__tags" aria-hidden="true">
                        <RequestsMark appt={a} />
                        <ApptStatus appt={a} />
                        <AgentMark appt={a} compact />
                        <ProblemFlag problems={problems} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ))}

          {/* One layer over every column: the closed day, hours outside opening, and the line for now. */}
          <div className="ap-day__layer">
            {!win.open && win.known && (
              <div className="ap-shade ap-shade--closed" aria-hidden="true">
                <span className="ap-shade__label">Closed: {win.reason}</span>
              </div>
            )}
            {win.open && win.known && win.gridFrom < win.from && <div className="ap-shade ap-shade--after" style={{ top: 0, height: top(win.from) }} aria-hidden="true" />}
            {win.open && win.known && win.gridTo > win.to && <div className="ap-shade ap-shade--after" style={{ top: top(win.to), height: height - top(win.to) }} aria-hidden="true" />}
            {showNow && (
              <div className="ap-now" style={{ top: top(t.minutes) }} role="separator" aria-label={`Now, ${time12(fromMin(t.minutes))}`}>
                <span className="ap-now__label num" aria-hidden="true">
                  {time12(fromMin(t.minutes))}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="ap-hint">Arrow keys move between appointments; Enter opens one.</p>
    </>
  )
}
