import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
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
const RANGE_LABEL: Record<Range, string> = { today: 'Today', tomorrow: 'Tomorrow', week: 'Next 7 days', check: 'Needs a check' }
export const APPT_STATUS_LABEL: Record<AppointmentStatus, string> = { needs_check: 'Needs a check', booked: 'Booked', confirmed: 'Confirmed', cancelled: 'Cancelled' }
const DOCTORS: [string, string][] = [
  ['Cardiology', 'Dr. R. Ramachandran'],
  ['General medicine', 'Dr. S. Meenakshi'],
  ['Orthopaedics', 'Dr. K. Arvind'],
  ['Paediatrics', 'Dr. P. Lakshmi'],
  ['ENT', 'Dr. V. Senthil'],
]

/** "Today", "Tomorrow", or "Thu 16 Oct" for a yyyy-mm-dd date. */
function dayName(date: string): string {
  if (date === dayFrom(0)) return 'Today'
  if (date === dayFrom(1)) return 'Tomorrow'
  if (date === dayFrom(-1)) return 'Yesterday'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}
/** 24-hour "16:30" as "4:30 pm". */
const time12 = (t: string) => new Date(`2000-01-01T${t}:00`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** /o/:slug/appointments: bookings made on calls, to confirm or correct. */
export default function AppointmentsPage() {
  const { org } = useOrg()
  const client = useConsole()
  const canEdit = pageAccess(org.role, 'appointments') === 'edit'
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

  useEffect(() => {
    if (!focusAfter) return
    const target =
      document.querySelector<HTMLElement>(`[data-appt-status="${focusAfter.id}"]`) ??
      document.querySelector<HTMLElement>(`[data-day="${focusAfter.date}"]`) ??
      document.querySelector<HTMLElement>('[data-day]')
    // The native dialog returns focus to its opener first: go after that.
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
      replace(await client.updateAppointment(org.orgSlug, cancelling.id, { status: 'cancelled' }), `${cancelling.patientName}’s appointment is cancelled.`)
      setCancelling(null)
    } catch (err) {
      setCancelError(asAuthError(err).message)
    } finally {
      setCancelBusy(false)
    }
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
          {shown.length === 0 ? (
            <p className="empty-note">{range === 'check' ? 'Nothing needs a check.' : 'No appointments.'}</p>
          ) : (
            days.map((date) => (
              <DayGroup
                key={date}
                date={date}
                items={shown.filter((a) => a.date === date)}
                canEdit={canEdit}
                onConfirm={async (a) => replace(await client.updateAppointment(org.orgSlug, a.id, { status: 'confirmed' }), `${a.patientName}’s appointment is confirmed.`)}
                onChange={setChanging}
                onCancel={(a) => {
                  setCancelError(null)
                  setCancelling(a)
                }}
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
          replace(a, `${a.patientName}’s appointment is now ${dayName(a.date).toLowerCase()} at ${time12(a.time)}.`)
        }}
      />
      <ConfirmDialog
        open={!!cancelling}
        title={`Cancel ${cancelling?.patientName ?? ''}’s appointment?`}
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
          {cancelling && `${dayName(cancelling.date)} at ${time12(cancelling.time)} with ${cancelling.doctor}.`} Let the patient know: AICA doesn’t call them about it.
        </p>
      </ConfirmDialog>
    </ConsolePage>
  )
}

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
      // The page moves focus once the list has updated.
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
        <p className="row__meta">
          {a.department} <i aria-hidden="true">·</i> {a.doctor} <i aria-hidden="true">·</i> {a.bookedBy === 'agent' ? `booked by ${a.agentName ?? 'an agent'}` : 'booked by staff'}
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
      // A change by staff is checked: it's confirmed.
      onSaved(await client.updateAppointment(orgSlug, appointment.id, { date, time, department, doctor, note: text.trim(), status: 'confirmed' }))
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!appointment} title={`Change ${appointment?.patientName ?? ''}’s appointment`} onClose={() => !busy && onClose()}>
      <form className="op-form" onSubmit={save} noValidate>
        <div className="step__grid">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Time" type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} />
        </div>
        <SelectField label="Doctor" value={doctor} options={DOCTORS.map(([dept, d]) => ({ value: d, label: `${d}, ${dept}` }))} onChange={(e) => setDoctor(e.target.value)} />
        <TextAreaField label="Note" hint="Optional, for your team." rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="field__hint">Saving confirms it. Let the patient know about the change: AICA doesn’t call them.</p>
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
