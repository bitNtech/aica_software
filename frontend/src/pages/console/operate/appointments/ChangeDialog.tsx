import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../../auth/types'
import { ToneIcon } from '../../../../components/console/StatusPill'
import { Button } from '../../../../components/ui/Button'
import { Modal } from '../../../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Appointment, AppointmentPatch } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { addDays, mergeById, norm, proposalProblems, shortDay, suggestSlots, time12, type Ctx, type DoctorInfo } from './model'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

interface Props {
  appointment: Appointment | null
  /** The bookings the page has loaded, and the days they cover. */
  rows: Appointment[]
  loaded: { from: string; to: string }
  ctx: Ctx
  today: string
  known: DoctorInfo[]
  onClose(): void
  /** Saves the change; throws with the API's own words if it is refused. */
  onSave(patch: AppointmentPatch): Promise<void>
}

/**
 * Move a booking: a new date, time or doctor, with the first free times for
 * that doctor to pick from, and warnings (not blocks) for what would be
 * wrong: an overlap, outside opening hours, a closed day, the doctor away or
 * late, a time that has passed. Only the API's own refusal stops a save.
 * Saving confirms the booking, as it always has.
 */
export function ChangeDialog({ appointment, rows, loaded, ctx, today, known, onClose, onSave }: Props) {
  const client = useConsole()
  const { org } = useOrg()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [doctor, setDoctor] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Days beyond what the page loaded, read as the dialog needs them, so a suggestion or warning is never based on a blank.
  const [extra, setExtra] = useState<{ covered: { from: string; to: string }[]; rows: Appointment[] }>({ covered: [], rows: [] })

  useEffect(() => {
    if (!appointment) return
    setDate(appointment.date)
    setTime(appointment.time)
    setDoctor(appointment.doctor)
    setText(appointment.note ?? '')
    setError(null)
    setExtra({ covered: [], rows: [] })
    // Keyed on the booking, not the object: a refresh of the list hands over a new copy, and must not wipe what is being typed.
  }, [appointment?.id])

  const isCovered = (d: string) => (d >= loaded.from && d <= loaded.to) || extra.covered.some((c) => d >= c.from && d <= c.to)

  /** Reads days we don't have: the week ahead (for suggestions) and the chosen day (for the clash check). */
  const need = appointment ? [{ from: today, to: addDays(today, 7) }, ...(DATE.test(date) ? [{ from: date, to: date }] : [])].filter((r) => !(isCovered(r.from) && isCovered(r.to))) : []
  const wanted = need.map((r) => `${r.from}:${r.to}`).join('|')
  useEffect(() => {
    if (!appointment || need.length === 0) return
    let live = true
    const r = need[0]
    client.listAppointments(org.orgSlug, r.from, r.to).then(
      (got) => live && setExtra((e) => ({ covered: [...e.covered, r], rows: mergeById(e.rows, got) })),
      // Couldn't read: suggestions use what the page has, and the dialog says nothing more.
      () => live && setExtra((e) => ({ covered: [...e.covered, r], rows: e.rows })),
    )
    return () => {
      live = false
    }
    // `wanted` stands for `need`.
  }, [wanted, appointment, client, org.orgSlug])

  const others = useMemo(() => mergeById(rows, extra.rows).filter((b) => b.id !== appointment?.id), [rows, extra.rows, appointment?.id])
  const valid = DATE.test(date) && TIME.test(time)
  const warnings = useMemo(() => (valid && doctor ? proposalProblems({ date, time, doctor }, others, ctx) : []), [valid, date, time, doctor, others, ctx])
  const free = useMemo(() => (doctor ? suggestSlots({ doctor, from: today, others, ctx }) : []), [doctor, today, others, ctx])

  const doctors = known.some((d) => norm(d.doctor) === norm(doctor)) || !doctor ? known : [...known, { doctor, department: appointment?.department ?? '' }]

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!appointment) return
    setBusy(true)
    setError(null)
    try {
      const department = doctors.find((d) => d.doctor === doctor)?.department || undefined
      await onSave({ date, time, department, doctor, note: text.trim(), status: 'confirmed' })
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!appointment} title={`Change ${appointment ? (ctx.who(appointment) === 'A patient' ? 'the' : `${ctx.who(appointment)}'s`) : ''} appointment`} onClose={() => !busy && onClose()}>
      <form className="op-form ap-change" onSubmit={save} noValidate>
        <div className="step__grid">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Time" type="time" step={ctx.slot * 60} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <SelectField label="Doctor" value={doctor} options={doctors.map((d) => ({ value: d.doctor, label: d.department ? `${d.doctor}, ${d.department}` : d.doctor }))} onChange={(e) => setDoctor(e.target.value)} />

        <div role="group" aria-labelledby="ap-free-h" className="ap-free">
          <p className="ap-free__title" id="ap-free-h">
            Free times with {doctor || 'this doctor'}, next 7 days
          </p>
          {free.length === 0 ? (
            <p className="ap-hint">No free time found in the next 7 days.</p>
          ) : (
            <ul className="ap-free__list">
              {free.map((f) => (
                <li key={`${f.date}${f.time}`}>
                  <button type="button" className="ap-free__slot" aria-pressed={f.date === date && f.time === time} onClick={() => { setDate(f.date); setTime(f.time) }}>
                    {f.date === today ? 'Today' : shortDay(f.date)}, {time12(f.time)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!ctx.settings && <p className="ap-hint">Opening hours aren't available to your role, so these assume 8 am to 8 pm. Check them.</p>}
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
        {warnings.length > 0 && <p className="ap-hint">You can still save: these are warnings.</p>}

        <TextAreaField label="Note" hint="Optional, for your team." rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
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
