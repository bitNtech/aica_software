import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../../auth/types'
import { ToneIcon } from '../../../../components/console/StatusPill'
import { Button } from '../../../../components/ui/Button'
import { Modal } from '../../../../components/ui/Dialog'
import { Checkbox, SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import type { Appointment, AppointmentType, NewAppointment } from '../../../../console/types'
import { proposalProblems, shortDay, suggestSlots, time12, TYPE_LABEL, type Ctx, type DoctorInfo } from './model'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

interface Props {
  open: boolean
  /** The bookings the page has loaded: for free times and clashes. */
  rows: Appointment[]
  ctx: Ctx
  today: string
  known: DoctorInfo[]
  /** A day to start on, e.g. the one being looked at. */
  startDate: string
  onClose(): void
  /** Saves it; throws with the API's own words if refused. */
  onCreate(input: NewAppointment): Promise<void>
}

/**
 * A booking made by hand: the patient, the doctor and a time (with that
 * doctor's free times to pick from, and warnings for clashes, closed days
 * and the doctor away), the type and reason for the visit, and how it was
 * booked. It starts pending unless the patient has already agreed to it.
 */
export function CreateDialog({ open, rows, ctx, today, known, startDate, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [doctor, setDoctor] = useState('')
  const [date, setDate] = useState(startDate)
  const [time, setTime] = useState('')
  const [type, setType] = useState<AppointmentType>('new_visit')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [onCall, setOnCall] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setPhone('')
    setDoctor(known[0]?.doctor ?? '')
    setDate(startDate < today ? today : startDate)
    setTime('')
    setType('new_visit')
    setReason('')
    setNote('')
    setOnCall(true)
    setConfirmed(false)
    setError(null)
    requestAnimationFrame(() => first.current?.focus())
    // Fresh each time it opens.
  }, [open])

  const department = known.find((d) => d.doctor === doctor)?.department ?? ''
  const valid = DATE.test(date) && TIME.test(time)
  const warnings = useMemo(() => (valid && doctor ? proposalProblems({ date, time, doctor }, rows, ctx) : []), [valid, date, time, doctor, rows, ctx])
  const free = useMemo(() => (doctor ? suggestSlots({ doctor, from: date >= today ? date : today, others: rows, ctx }) : []), [doctor, date, today, rows, ctx])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setError('Write the patient’s name.')
    if (phone.replace(/\D/g, '').length < 10) return setError('Write a 10-digit phone number.')
    if (!doctor) return setError('Choose a doctor.')
    if (!valid) return setError('Choose a date and a time.')
    setBusy(true)
    setError(null)
    try {
      await onCreate({ patientName: name, phone, doctor, department, date, time, type, visitReason: reason, note, source: onCall ? 'front_desk' : 'manual', confirmed })
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Add an appointment" onClose={() => !busy && onClose()}>
      <form className="op-form ap-change" onSubmit={save} noValidate>
        <div className="step__grid">
          <TextField ref={first} label="Patient’s name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <TextField label="Phone number" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
        </div>
        <SelectField label="Doctor" value={doctor} options={known.map((d) => ({ value: d.doctor, label: d.department ? `${d.doctor}, ${d.department}` : d.doctor }))} onChange={(e) => setDoctor(e.target.value)} />
        <div className="step__grid">
          <TextField label="Date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Time" type="time" step={ctx.slot * 60} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>

        <div role="group" aria-labelledby="ap-new-free" className="ap-free">
          <p className="ap-free__title" id="ap-new-free">
            Free times with {doctor || 'this doctor'}
          </p>
          {free.length === 0 ? (
            <p className="ap-hint">No free time found in the next 7 days.</p>
          ) : (
            <ul className="ap-free__list">
              {free.map((f) => (
                <li key={`${f.date}${f.time}`}>
                  <button
                    type="button"
                    className="ap-free__slot"
                    aria-pressed={f.date === date && f.time === time}
                    onClick={() => {
                      setDate(f.date)
                      setTime(f.time)
                    }}
                  >
                    {f.date === today ? 'Today' : shortDay(f.date)}, {time12(f.time)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {warnings.length > 0 && (
          <ul className="ap-problems ap-change__warn" role="status" aria-label="Things to check about this time">
            {warnings.map((p) => (
              <li key={p.kind} className={`ap-problems__item ap-problems__item--${p.tone}`}>
                <ToneIcon tone={p.tone === 'danger' ? 'danger' : 'warn'} size={14} />
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        )}

        <SelectField label="Type" value={type} options={(Object.keys(TYPE_LABEL) as AppointmentType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} onChange={(e) => setType(e.target.value as AppointmentType)} />
        <TextAreaField label="Reason for the visit" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} hint="In the patient’s words, if you have them." />
        <TextAreaField label="Note" hint="Optional, for your team." rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <Checkbox label="Booked on a phone call" hint="Recorded as booked by the front desk. Untick for a walk-in or anything else entered by hand." checked={onCall} onChange={(e) => setOnCall(e.target.checked)} />
        <Checkbox label="The patient has agreed to this time" hint="Saves it as confirmed. Otherwise it waits for confirmation." checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Adding…">
            Add appointment
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
