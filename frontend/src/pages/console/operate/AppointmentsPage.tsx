import { Fragment, useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Appointment, AppointmentStatus } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { SegFilter } from '../../../components/console/ListTools'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog, Modal } from '../../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { localDay as dayFrom } from '../../../lib/time'
import './Operate.css'

type Range = 'today' | 'tomorrow' | 'week' | 'check'
const RANGE_LABEL: Record<Range, string> = { today: 'Today', tomorrow: 'Tomorrow', week: 'This week', check: 'Needs a check' }
export const APPT_STATUS_LABEL: Record<AppointmentStatus, string> = { needs_check: 'Needs a check', booked: 'Booked', confirmed: 'Confirmed', cancelled: 'Cancelled' }
const DOCTORS: [string, string][] = [
  ['Cardiology', 'Dr. R. Ramachandran'],
  ['General medicine', 'Dr. S. Meenakshi'],
  ['Orthopaedics', 'Dr. K. Arvind'],
  ['Paediatrics', 'Dr. P. Lakshmi'],
  ['ENT', 'Dr. V. Senthil'],
]

/* ---- Timetable constants ---- */
const SLOT_START = 8 * 60 // 08:00
const SLOT_END = 19 * 60 + 30 // 19:30
const SLOT_STEP = 30

const TIME_SLOTS: string[] = (() => {
  const slots: string[] = []
  for (let m = SLOT_START; m <= SLOT_END; m += SLOT_STEP) {
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return slots
})()

const STATUS_PRIORITY: Record<AppointmentStatus, number> = { needs_check: 0, booked: 1, confirmed: 2, cancelled: 3 }

/** Round a time down to the nearest 30-min boundary for slot placement. */
function snapSlot(time: string): string {
  const [h, rawMin] = time.split(':').map(Number)
  return `${String(h).padStart(2, '0')}:${rawMin < 30 ? '00' : '30'}`
}

/** Last surname from a doctor string, e.g. "Dr. R. Ramachandran" → "Ramachandran". */
function doctorShort(doctor: string): string {
  const parts = doctor.split(' ')
  return parts[parts.length - 1]
}

/** "Today", "Tomorrow", or "Thu 16 Oct" for a yyyy-mm-dd date. */
function dayName(date: string): string {
  if (date === dayFrom(0)) return 'Today'
  if (date === dayFrom(1)) return 'Tomorrow'
  if (date === dayFrom(-1)) return 'Yesterday'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Short weekday label for a column header, e.g. "Mon" or "Today". */
function dayHeadPrimary(date: string): string {
  if (date === dayFrom(0)) return 'Today'
  if (date === dayFrom(1)) return 'Tomorrow'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })
}

/** Date sub-label for a column header, e.g. "17 Oct". */
const dayHeadSecondary = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** 24-hour "16:30" as "4:30 pm". */
const time12 = (t: string) => new Date(`2000-01-01T${t}:00`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** /o/:slug/appointments: bookings made on calls, to confirm or correct. */
export default function AppointmentsPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const canEdit = pageAccess(access, 'appointments') === 'edit'
  // The next week, and a couple of days back for late corrections.
  const load = useCallback(() => client.listAppointments(org.orgSlug, dayFrom(-2), dayFrom(7)), [client, org.orgSlug])
  const [list, reload, setList] = useAsync(load)
  const [range, setRange] = useState<Range>('today')
  const [changing, setChanging] = useState<Appointment | null>(null)
  const [cancelling, setCancelling] = useState<Appointment | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  /** After an action: the appointment to focus (its status), if it's still
   * shown; otherwise its day's heading, or the first one. Done in an effect,
   * after the list has re-rendered. */
  const [focusAfter, setFocusAfter] = useState<{ id: string; date: string } | null>(null)

  const all = list.state === 'ready' ? list.data : []
  const inRange = (a: Appointment, r: Range) =>
    r === 'today' ? a.date === dayFrom(0) : r === 'tomorrow' ? a.date === dayFrom(1) : r === 'week' ? a.date >= dayFrom(0) && a.date <= dayFrom(6) : a.status === 'needs_check'
  const shown = all.filter((a) => inRange(a, range))
  const days = [...new Set(shown.map((a) => a.date))]

  // Timetable: fixed day columns (even if some have no appointments)
  const timetableDays = useMemo<string[]>(() => {
    if (range === 'today') return [dayFrom(0)]
    if (range === 'tomorrow') return [dayFrom(1)]
    if (range === 'week') return Array.from({ length: 7 }, (_, i) => dayFrom(i))
    return []
  }, [range])

  useEffect(() => {
    if (!focusAfter) return
    const target =
      document.querySelector<HTMLElement>(`[data-appt-status="${focusAfter.id}"]`) ??
      document.querySelector<HTMLElement>(`[data-day="${focusAfter.date}"]`) ??
      document.querySelector<HTMLElement>('[data-day]')
    const t = window.setTimeout(() => target?.focus(), 0)
    setFocusAfter(null)
    return () => window.clearTimeout(t)
  }, [focusAfter, list])

  const replace = (a: Appointment, text: string) => {
    setFocusAfter({ id: a.id, date: a.date })
    setList((r) => (r.state === 'ready' ? { ...r, data: r.data.map((x) => (x.id === a.id ? a : x)).sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time)) } : r))
    setNote(text)
  }

  async function confirmCancel() {
    if (!cancelling) return
    setCancelBusy(true)
    setCancelError(null)
    try {
      replace(await client.updateAppointment(org.orgSlug, cancelling.id, { status: 'cancelled' }), `${cancelling.patientName}'s appointment is cancelled.`)
      setCancelling(null)
    } catch (err) {
      setCancelError(asAuthError(err).message)
    } finally {
      setCancelBusy(false)
    }
  }

  const handleConfirm = async (a: Appointment) =>
    replace(await client.updateAppointment(org.orgSlug, a.id, { status: 'confirmed' }), `${a.patientName}'s appointment is confirmed.`)

  const handleCancel = (a: Appointment) => {
    setCancelError(null)
    setCancelling(a)
  }

  return (
    <ConsolePage
      kicker="Operate"
      title="Appointments"
      docTitle="Appointments"
      lede={<p>Bookings made on calls. Check the ones flagged, and confirm or correct them. {canEdit ? '' : 'You can look; the front desk and above make changes.'}</p>}
    >
      <p className="sr-only" role="status">
        {note}
      </p>
      {list.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading appointments…</span>
        </div>
      )}
      {list.state === 'error' && (
        <Alert tone="error" title="Couldn't load appointments">
          <p>{asAuthError(list.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {list.state === 'ready' && (
        <>
          <div className="list-tools">
            <SegFilter<Range>
              legend="Show"
              value={range}
              onChange={setRange}
              options={(Object.keys(RANGE_LABEL) as Range[]).map((r) => ({ value: r, label: RANGE_LABEL[r], count: all.filter((a) => inRange(a, r)).length }))}
            />
          </div>

          {range !== 'check' ? (
            <TimetableView
              days={timetableDays}
              appointments={shown}
              canEdit={canEdit}
              onConfirm={handleConfirm}
              onChange={setChanging}
              onCancel={handleCancel}
            />
          ) : shown.length === 0 ? (
            <p className="empty-note">Nothing needs a check.</p>
          ) : (
            days.map((date) => (
              <DayGroup
                key={date}
                date={date}
                items={shown.filter((a) => a.date === date)}
                canEdit={canEdit}
                onConfirm={handleConfirm}
                onChange={setChanging}
                onCancel={handleCancel}
              />
            ))
          )}
        </>
      )}

      <ChangeDialog
        orgSlug={org.orgSlug}
        appointment={changing}
        onClose={() => setChanging(null)}
        onSaved={(a) => {
          setChanging(null)
          replace(a, `${a.patientName}'s appointment is now ${dayName(a.date).toLowerCase()} at ${time12(a.time)}.`)
        }}
      />
      <ConfirmDialog
        open={!!cancelling}
        title={`Cancel ${cancelling?.patientName ?? ''}'s appointment?`}
        confirmLabel="Cancel appointment"
        cancelLabel="Keep it"
        busyLabel="Cancelling…"
        busy={cancelBusy}
        danger
        error={cancelError}
        onConfirm={() => void confirmCancel()}
        onCancel={() => setCancelling(null)}
      >
        <p>
          {cancelling && `${dayName(cancelling.date)} at ${time12(cancelling.time)} with ${cancelling.doctor}.`} Let the patient know: AICA doesn't call them about it.
        </p>
      </ConfirmDialog>
    </ConsolePage>
  )
}

/* ---- Timetable ---- */

function TimetableView({
  days,
  appointments,
  canEdit,
  onConfirm,
  onChange,
  onCancel,
}: {
  days: string[]
  appointments: Appointment[]
  canEdit: boolean
  onConfirm(a: Appointment): Promise<void>
  onChange(a: Appointment): void
  onCancel(a: Appointment): void
}) {
  const [activeSlot, setActiveSlot] = useState<{ day: string; slot: string } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const today = dayFrom(0)

  useEffect(() => {
    if (!isFullscreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setIsFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [isFullscreen])

  const slotMap = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      const key = `${a.date}:${snapSlot(a.time)}`
      const arr = map.get(key) ?? []
      arr.push(a)
      map.set(key, arr)
    }
    for (const [key, appts] of map) {
      map.set(key, [...appts].sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]))
    }
    return map
  }, [appointments])

  // Only render the time window that has appointments, plus one buffer slot each side.
  const visibleSlots = useMemo(() => {
    if (appointments.length === 0) return TIME_SLOTS
    const usedIndices = [...new Set(appointments.map((a) => snapSlot(a.time)))]
      .map((s) => TIME_SLOTS.indexOf(s))
      .filter((i) => i >= 0)
    if (usedIndices.length === 0) return TIME_SLOTS
    const first = Math.max(0, Math.min(...usedIndices) - 1)
    const last = Math.min(TIME_SLOTS.length - 1, Math.max(...usedIndices) + 1)
    return TIME_SLOTS.slice(first, last + 1)
  }, [appointments])

  const activeAppts = useMemo(
    () => (activeSlot ? (slotMap.get(`${activeSlot.day}:${activeSlot.slot}`) ?? []) : []),
    [activeSlot, slotMap],
  )

  if (appointments.length === 0) {
    return <p className="empty-note">No appointments scheduled.</p>
  }

  function toggleSlot(day: string, slot: string) {
    setActiveSlot((prev) => (prev?.day === day && prev?.slot === slot ? null : { day, slot }))
  }

  const grid = (
    <div className={`tt-wrap${isFullscreen ? ' tt-wrap--fullscreen' : ''}`} role="region" aria-label="Appointments timetable">
      <div className="tt-grid" style={{ '--tt-days': days.length } as React.CSSProperties}>
        {/* Sticky top-left corner */}
        <div className="tt-corner" aria-hidden="true" />

        {/* Day column headers */}
        {days.map((day) => {
          const activeCount = appointments.filter((a) => a.date === day && a.status !== 'cancelled').length
          const checkCount = appointments.filter((a) => a.date === day && a.status === 'needs_check').length
          return (
            <div key={day} className={`tt-day-head${day === today ? ' tt-day-head--today' : ''}`}>
              <div className="tt-day-head__info">
                <span className="tt-day-name">{dayHeadPrimary(day)}</span>
                <span className="tt-day-date">{dayHeadSecondary(day)}</span>
              </div>
              <div className="tt-day-head__counts">
                <span className="op-count" title={`${activeCount} active appointment${activeCount !== 1 ? 's' : ''}`}>
                  {activeCount}
                </span>
                {checkCount > 0 && (
                  <span className="op-count tt-count--check" title={`${checkCount} need${checkCount !== 1 ? '' : 's'} a check`}>
                    {checkCount}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {/* Time slot rows */}
        {visibleSlots.map((slot) => {
          const isHour = slot.endsWith(':00')
          return (
            <Fragment key={slot}>
              <div className={`tt-time${isHour ? ' tt-time--hour' : ''}`} aria-hidden="true">
                {time12(slot)}
              </div>
              {days.map((day) => {
                const appts = slotMap.get(`${day}:${slot}`) ?? []
                const isActive = activeSlot?.day === day && activeSlot?.slot === slot
                const hasCheck = appts.some((a) => a.status === 'needs_check')
                return (
                  <div
                    key={day}
                    className={[
                      'tt-cell',
                      day === today ? 'tt-cell--today' : '',
                      appts.length > 0 ? 'tt-cell--filled' : '',
                      isActive ? 'tt-cell--active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    role={appts.length > 0 ? 'button' : undefined}
                    tabIndex={appts.length > 0 ? 0 : undefined}
                    aria-label={
                      appts.length > 0
                        ? `${time12(slot)}, ${dayName(day)}: ${appts.length} appointment${appts.length !== 1 ? 's' : ''}${hasCheck ? ', needs check' : ''}`
                        : undefined
                    }
                    aria-expanded={appts.length > 0 ? isActive : undefined}
                    onClick={() => appts.length > 0 && toggleSlot(day, slot)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && appts.length > 0) {
                        e.preventDefault()
                        toggleSlot(day, slot)
                      }
                    }}
                  >
                    {appts.map((a) => (
                      <div key={a.id} className={`tt-appt tt-appt--${a.status}`}>
                        {a.status === 'needs_check' && <span className="tt-appt__badge">Needs check</span>}
                        <span className="tt-appt__name">{a.patientName}</span>
                        <span className="tt-appt__sub">{doctorShort(a.doctor)} · {a.department}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </Fragment>
          )
        })}
      </div>
    </div>
  )

  return (
    <>
      {!isFullscreen && (
        <div className="tt-toolbar">
          <button
            type="button"
            className="btn-text tt-toolbar__expand"
            onClick={() => setIsFullscreen(true)}
            aria-label="Expand timetable to fullscreen"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" focusable="false">
              <path d="M1 4.5V1h3.5M8.5 1H12v3.5M12 8.5V12H8.5M4.5 12H1V8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Expand
          </button>
        </div>
      )}

      {isFullscreen ? (
        <div className="tt-fullscreen" role="dialog" aria-modal="true" aria-label="Appointments timetable, fullscreen">
          <div className="tt-fullscreen__header">
            <button
              type="button"
              className="btn-text tt-fullscreen__back"
              onClick={() => setIsFullscreen(false)}
              aria-label="Exit fullscreen"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
                <path d="M9 1L5 7l4 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
            <span className="tt-fullscreen__title">Appointments</span>
            <button
              type="button"
              className="btn-text tt-fullscreen__collapse"
              onClick={() => setIsFullscreen(false)}
              aria-label="Exit fullscreen"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" focusable="false">
                <path d="M4.5 1v3.5H1M8.5 4.5V1H12M8.5 12v-3.5H12M1 8.5h3.5V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {grid}
        </div>
      ) : (
        grid
      )}

      {/* Slot detail panel */}
      <Modal
        open={!!activeSlot && activeAppts.length > 0}
        title={activeSlot ? `${time12(activeSlot.slot)} · ${dayName(activeSlot.day)}` : ''}
        onClose={() => setActiveSlot(null)}
      >
        {activeAppts.length > 1 && (
          <p className="tt-slot-meta">{activeAppts.length} appointments at this time</p>
        )}
        <ul className="op-rows tt-slot-rows">
          {activeAppts.map((a) => (
            <AppointmentRow
              key={a.id}
              appointment={a}
              canEdit={canEdit}
              onConfirm={onConfirm}
              onChange={(appt) => {
                setActiveSlot(null)
                onChange(appt)
              }}
              onCancel={(appt) => {
                setActiveSlot(null)
                onCancel(appt)
              }}
            />
          ))}
        </ul>
      </Modal>
    </>
  )
}

/* ---- Legacy list view (used for "Needs a check" range) ---- */

function DayGroup({
  date,
  items,
  canEdit,
  onConfirm,
  onChange,
  onCancel,
}: {
  date: string
  items: Appointment[]
  canEdit: boolean
  onConfirm(a: Appointment): Promise<void>
  onChange(a: Appointment): void
  onCancel(a: Appointment): void
}) {
  const id = useId()
  return (
    <section className="op-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="op-section__title" tabIndex={-1} data-day={date}>
        {dayName(date)} <span className="op-count">{items.length}</span>
      </h2>
      <ul className="op-rows" aria-labelledby={`${id}-h`}>
        {items.map((a) => (
          <AppointmentRow key={a.id} appointment={a} canEdit={canEdit} onConfirm={onConfirm} onChange={onChange} onCancel={onCancel} />
        ))}
      </ul>
    </section>
  )
}

function AppointmentRow({
  appointment: a,
  canEdit,
  onConfirm,
  onChange,
  onCancel,
}: {
  appointment: Appointment
  canEdit: boolean
  onConfirm(a: Appointment): Promise<void>
  onChange(a: Appointment): void
  onCancel(a: Appointment): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(a)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`op-row op-row--appt${a.status === 'cancelled' ? ' is-cancelled' : ''}`}>
      <p className="op-row__time">{time12(a.time)}</p>
      <div className="op-row__main">
        <p className="op-row__title">
          {a.patientName} {canEdit && <span className="op-card__sub">{a.phone}</span>}
        </p>
        <p className="op-row__doctor">
          {a.doctor} <span className="op-card__sub">{a.department}</span>
        </p>
        <p className="row__meta">
          {a.bookedBy === 'agent' ? `Booked by ${a.agentName ?? 'agent'}` : 'Booked by staff'}
        </p>
        {a.checkReason && <p className="op-row__check">{a.checkReason}</p>}
        {a.note && <p className="row__meta">Note: {a.note}</p>}
      </div>
      <span tabIndex={-1} data-appt-status={a.id} className={`status-chip status-chip--appt-${a.status}`}>
        {APPT_STATUS_LABEL[a.status]}
      </span>
      {canEdit && a.status !== 'cancelled' && (
        <div className="op-row__actions">
          {a.status !== 'confirmed' && (
            <button type="button" className="btn-text" disabled={busy} aria-label={`Confirm ${a.patientName} at ${time12(a.time)}`} onClick={() => void confirm()}>
              Confirm
            </button>
          )}
          <button type="button" className="btn-text" aria-label={`Change ${a.patientName} at ${time12(a.time)}`} onClick={() => onChange(a)}>
            Change
          </button>
          <button type="button" className="btn-text op-row__cancel" aria-label={`Cancel ${a.patientName} at ${time12(a.time)}`} onClick={() => onCancel(a)}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p className="field__error op-row__error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

function ChangeDialog({ orgSlug, appointment, onClose, onSaved }: { orgSlug: string; appointment: Appointment | null; onClose(): void; onSaved(a: Appointment): void }) {
  const client = useConsole()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [doctor, setDoctor] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!appointment) return
    setDate(appointment.date)
    setTime(appointment.time)
    setDoctor(appointment.doctor)
    setText(appointment.note ?? '')
    setError(null)
  }, [appointment])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!appointment) return
    setBusy(true)
    setError(null)
    try {
      const department = DOCTORS.find(([, d]) => d === doctor)?.[0]
      onSaved(await client.updateAppointment(orgSlug, appointment.id, { date, time, department, doctor, note: text.trim(), status: 'confirmed' }))
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!appointment} title={`Change ${appointment?.patientName ?? ''}'s appointment`} onClose={() => !busy && onClose()}>
      <form className="op-form" onSubmit={save} noValidate>
        <div className="step__grid">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Time" type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} />
        </div>
        <SelectField label="Doctor" value={doctor} options={DOCTORS.map(([dept, d]) => ({ value: d, label: `${d}, ${dept}` }))} onChange={(e) => setDoctor(e.target.value)} />
        <TextAreaField label="Note" hint="Optional, for your team." rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="field__hint">Saving confirms it. Let the patient know about the change: AICA doesn't call them.</p>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…">
            Save and confirm
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Keep as it was
          </Button>
        </div>
      </form>
    </Modal>
  )
}
