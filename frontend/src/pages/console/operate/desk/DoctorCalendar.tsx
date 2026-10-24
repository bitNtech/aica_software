import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../../auth/types'
import { canOpen } from '../../../../console/access'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Appointment, Desk, DoctorChange } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { StatusPill } from '../../../../components/console/StatusPill'
import { useToast } from '../../../../components/console/Toast'
import { Button } from '../../../../components/ui/Button'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { Modal } from '../../../../components/ui/Dialog'
import { SelectField, TextField } from '../../../../components/ui/Field'
import { dayName, parseDay, shortDay } from '../appointments/model'
import type { Say } from './LineBoard'
import { affectedAppointments, calendarDays, calendarRows, cellSpeech, CHANGE_WORD, changeAt, CHANGE_LONG, existingChange } from './logic'

/** Whether the appointments could be read: not allowed, still loading, read, or failed. */
export type ApptState = 'off' | 'loading' | 'ready' | 'error'

const draft = (doctor: string, department: string, date: string, kind: DoctorChange['kind']): DoctorChange => ({ id: '', doctor, department, date, kind, detail: '', createdBy: '', createdAt: '' })

/** A small shape per kind, so a change is never told by colour alone: the word goes beside it. */
function ChangeIcon({ kind }: { kind: DoctorChange['kind'] }) {
  const shape = {
    away: <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />,
    late: <path d="M8 4.6V8l2.2 1.4" />,
    moved: <path d="M3.5 8h8M8.6 5l3 3-3 3" />,
  }[kind]
  return (
    <svg className={`desk-cal__icon desk-cal__icon--${kind}`} viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {kind !== 'away' && <circle cx="8" cy="8" r="6.2" />}
      {shape}
    </svg>
  )
}

/**
 * Doctor availability for the next fortnight: a table of doctors by day. A
 * cell with a change says what it is (an icon and a word: Away, Late, Moved)
 * and how many booked appointments it touches. Whoever may change doctors
 * moves between cells with the arrow keys, and presses Enter on one to add
 * or change that doctor's day. The changes are also listed underneath, each
 * with who added it and the appointments it affects.
 */
export function DoctorCalendar({
  desk,
  canEdit,
  today,
  appointments,
  apptState,
  onDesk,
  say,
  adding,
  onAdding,
}: {
  desk: Desk
  canEdit: boolean
  today: string
  appointments: Appointment[]
  apptState: ApptState
  onDesk(d: Desk): void
  say: Say
  adding: boolean
  onAdding(on: boolean): void
}) {
  const { org, access } = useOrg()
  const client = useConsole()
  const toast = useToast()
  const id = useId()
  const days = useMemo(() => calendarDays(today), [today])
  const rows = useMemo(() => calendarRows(desk.doctors, desk.doctorChanges, days), [desk.doctors, desk.doctorChanges, days])
  const changes = useMemo(() => desk.doctorChanges.filter((c) => days.includes(c.date)), [desk.doctorChanges, days])
  const known = apptState === 'ready'
  const [form, setForm] = useState<{ doctor: string; date: string; change: DoctorChange | null } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canSeeAppts = canOpen(access, 'appointments')

  // ---- one tab stop in the grid; arrows move within it
  const [at, setAt] = useState<[number, number]>([0, 0])
  const cells = useRef(new Map<string, HTMLButtonElement>())
  const key = (r: number, c: number) => `${r}:${c}`
  const row0 = Math.min(at[0], Math.max(0, rows.length - 1))
  function move(e: KeyboardEvent, r: number, c: number) {
    let nr = r
    let nc = c
    if (e.key === 'ArrowRight') nc = Math.min(days.length - 1, c + 1)
    else if (e.key === 'ArrowLeft') nc = Math.max(0, c - 1)
    else if (e.key === 'ArrowDown') nr = Math.min(rows.length - 1, r + 1)
    else if (e.key === 'ArrowUp') nr = Math.max(0, r - 1)
    else if (e.key === 'Home') nc = 0
    else if (e.key === 'End') nc = days.length - 1
    else return
    e.preventDefault()
    setAt([nr, nc])
    cells.current.get(key(nr, nc))?.focus()
  }

  const count = (c: DoctorChange) => affectedAppointments(c, appointments).length

  /** A saved change, with an undo that puts things back as they were. */
  function saved(d: Desk, doctor: string, date: string, previous: DoctorChange | null) {
    onDesk(d)
    setForm(null)
    onAdding(false)
    const words = `Saved. The agents know about ${doctor}.`
    say(words)
    toast.show({
      message: words,
      tone: 'ok',
      action: {
        label: 'Undo',
        onClick: () => {
          const created = d.doctorChanges.find((c) => c.doctor === doctor && c.date === date)
          const undo = previous
            ? client.saveDoctorChange(org.orgSlug, { id: previous.id, doctor: previous.doctor, department: previous.department, date: previous.date, kind: previous.kind, detail: previous.detail })
            : created
              ? client.removeDoctorChange(org.orgSlug, created.id)
              : null
          void undo?.then(
            (back) => {
              onDesk(back)
              toast.show({ message: 'Undone.', tone: 'ok' })
            },
            (err) => toast.show({ message: asAuthError(err).message, tone: 'danger' }),
          )
        },
      },
    })
  }

  async function remove(c: DoctorChange) {
    setBusyId(c.id)
    setError(null)
    try {
      onDesk(await client.removeDoctorChange(org.orgSlug, c.id))
      say(`Removed ${c.doctor}’s change.`)
      toast.show({
        message: `Removed ${c.doctor}’s change on ${dayName(c.date, today)}.`,
        tone: 'ok',
        action: {
          label: 'Undo',
          onClick: () =>
            void client.saveDoctorChange(org.orgSlug, { doctor: c.doctor, department: c.department, date: c.date, kind: c.kind, detail: c.detail }).then(
              (back) => {
                onDesk(back)
                toast.show({ message: 'Undone.', tone: 'ok' })
              },
              (err) => toast.show({ message: asAuthError(err).message, tone: 'danger' }),
            ),
        },
      })
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="desk-panel desk-cal" aria-labelledby={`${id}-d`}>
      <div className="op-section__head">
        <h2 id={`${id}-d`} className="op-section__title">
          Doctor changes
        </h2>
        {canEdit && (
          <Button variant="line" size="sm" onClick={() => onAdding(true)}>
            Mark a doctor away or late
          </Button>
        )}
      </div>
      <p className="row__meta">The agents won’t offer slots with a doctor who’s away, and tell callers when one is late or in another room.</p>

      {!canEdit && <p className="row__meta">Changing a doctor’s day needs the “Post notices” permission, which you don’t have.</p>}
      {rows.length === 0 ? (
        <p className="empty-note">No doctors in the Knowledge library yet, so there’s no one to show. Add a doctor schedule there first.</p>
      ) : (
        <div className="desk-cal__scroll" role="region" aria-label="Doctor availability, next 14 days" tabIndex={0}>
          <table className="desk-cal__table">
            <caption className="sr-only">
              Doctors by day for the next 14 days. A cell says if the doctor is away, late or in another room{known ? ' and how many booked appointments that touches' : ''}.
              {canEdit ? ' Use the arrow keys to move between days and Enter to add or change a day.' : ''}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="desk-cal__corner">
                  Doctor
                </th>
                {days.map((d) => (
                  <th key={d} scope="col" className={`desk-cal__day${d === today ? ' desk-cal__day--today' : ''}`} abbr={shortDay(d)}>
                    <span className="desk-cal__dow">{d === today ? 'Today' : parseDay(d).toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                    <span className="desk-cal__date num">{parseDay(d).getDate()}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={r.doctor}>
                  <th scope="row" className="desk-cal__doctor">
                    <span>{r.doctor}</span>
                    <span className="desk-cal__dept">
                      {r.department}
                      {!r.inLibrary && ' · not in the library'}
                    </span>
                  </th>
                  {days.map((d, ci) => {
                    const c = changeAt(r.doctor, d, desk.doctorChanges)
                    const n = c && known ? count(c) : null
                    const marker = c && (
                      <>
                        <span className="desk-cal__mark">
                          <ChangeIcon kind={c.kind} />
                          <span>{CHANGE_WORD[c.kind]}</span>
                        </span>
                        {n !== null && n > 0 && <span className="desk-cal__booked num">{n} booked</span>}
                      </>
                    )
                    return (
                      <td key={d} className={`desk-cal__cell${c ? ` desk-cal__cell--${c.kind}` : ''}${d === today ? ' desk-cal__cell--today' : ''}`}>
                        {canEdit ? (
                          <button
                            ref={(el) => {
                              if (el) cells.current.set(key(ri, ci), el)
                              else cells.current.delete(key(ri, ci))
                            }}
                            type="button"
                            className="desk-cal__btn"
                            tabIndex={row0 === ri && at[1] === ci ? 0 : -1}
                            aria-label={cellSpeech(r.doctor, d, today, c, n, true)}
                            title={c?.detail || undefined}
                            onFocus={() => setAt([ri, ci])}
                            onKeyDown={(e) => move(e, ri, ci)}
                            onClick={() => setForm({ doctor: r.doctor, date: d, change: c })}
                          >
                            {marker || <span className="desk-cal__plus" aria-hidden="true">+</span>}
                          </button>
                        ) : c ? (
                          <span className="desk-cal__static" title={c.detail || undefined}>
                            {marker}
                            <span className="sr-only">{cellSpeech(r.doctor, d, today, c, n, false)}</span>
                          </span>
                        ) : (
                          <span className="sr-only">No change</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {changes.length === 0 ? (
        <p className="empty-note">Every doctor is in as usual.</p>
      ) : (
        <ul className="desk-changes" aria-label="Doctor changes">
          {changes.map((c) => {
            const hit = known ? affectedAppointments(c, appointments) : null
            return (
              <li key={c.id} className="desk-change">
                <p className="desk-change__head">
                  <strong>{c.doctor}</strong> <span className="row__meta">{c.department}</span>{' '}
                  <StatusPill tone={c.kind === 'away' ? 'warn' : 'info'}>{CHANGE_LONG[c.kind]}</StatusPill> <span className="row__meta">{dayName(c.date, today)}</span>
                </p>
                {c.detail && <p className="row__meta">{c.detail}</p>}
                <p className="row__meta">Added by {c.createdBy}</p>
                {hit && (
                  <p className="desk-change__affects">
                    {hit.length === 0 ? (
                      'No appointments are booked for this.'
                    ) : (
                      <>
                        <strong className="num">
                          {hit.length} {hit.length === 1 ? 'appointment' : 'appointments'} affected.
                        </strong>{' '}
                        <span className="row__meta">{hit.length === 1 ? 'That patient needs' : 'Those patients need'} telling.</span>
                      </>
                    )}{' '}
                    {canSeeAppts && hit.length > 0 && (
                      <Link to={`/o/${org.orgSlug}/appointments`} aria-label={`See appointments for ${c.doctor} on ${dayName(c.date, today)}`}>
                        See appointments
                      </Link>
                    )}
                  </p>
                )}
                {apptState === 'error' && <p className="row__meta">Couldn’t check the appointments just now.</p>}
                {canEdit && (
                  <div className="desk-notice__actions">
                    <button type="button" className="btn-text" onClick={() => setForm({ doctor: c.doctor, date: c.date, change: c })} aria-label={`Change ${c.doctor}’s change on ${dayName(c.date, today)}`}>
                      Change
                    </button>
                    <Button variant="line" size="sm" busy={busyId === c.id} busyLabel="Removing…" onClick={() => void remove(c)} aria-label={`Remove ${c.doctor}’s change on ${dayName(c.date, today)}`}>
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Modal open={adding || form !== null} title={form?.change ? 'Change a doctor’s day' : 'Mark a doctor away or late'} onClose={() => (setForm(null), onAdding(false))}>
        <ChangeForm
          key={form ? `${form.doctor}|${form.date}` : 'new'}
          doctors={desk.doctors}
          changes={desk.doctorChanges}
          initial={form}
          today={today}
          appointments={apptState === 'ready' ? appointments : null}
          onCancel={() => (setForm(null), onAdding(false))}
          onSaved={saved}
        />
      </Modal>
    </section>
  )
}

/** Add or change a doctor's day: who, which day, what's different and where or from when. */
function ChangeForm({
  doctors,
  changes,
  initial,
  today,
  appointments,
  onCancel,
  onSaved,
}: {
  doctors: Desk['doctors']
  changes: DoctorChange[]
  initial: { doctor: string; date: string; change: DoctorChange | null } | null
  today: string
  /** Null when they couldn't be read: no count is told. */
  appointments: Appointment[] | null
  onCancel(): void
  onSaved(d: Desk, doctor: string, date: string, previous: DoctorChange | null): void
}) {
  const { org } = useOrg()
  const client = useConsole()
  const start = initial?.change ?? null
  const [doctor, setDoctor] = useState(initial?.doctor ?? '')
  const [date, setDate] = useState(initial?.date ?? today)
  const [kind, setKind] = useState<DoctorChange['kind']>(start?.kind ?? 'away')
  const [detail, setDetail] = useState(start?.detail ?? '')
  const [errors, setErrors] = useState<{ doctor?: string; detail?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const docRef = useRef<HTMLSelectElement>(null)
  const detailRef = useRef<HTMLInputElement>(null)
  // A doctor named in a change but not in the library is still choosable while that change is open.
  const options = start && !doctors.some((d) => d.doctor === start.doctor) ? [...doctors, { doctor: start.doctor, department: start.department }] : doctors
  const existing = doctor && date ? existingChange(doctor, date, changes) : null
  const target = start ?? existing
  const info = options.find((d) => d.doctor === doctor)
  const touched = appointments && doctor && date && info ? affectedAppointments(draft(doctor, info.department, date, kind), appointments).length : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!doctor) next.doctor = 'Choose the doctor.'
    if (kind !== 'away' && !detail.trim()) next.detail = kind === 'late' ? 'Say from when they’re seeing patients.' : 'Say where they’re seeing patients.'
    setErrors(next)
    if (next.doctor) return docRef.current?.focus()
    if (next.detail) return detailRef.current?.focus()
    setBusy(true)
    try {
      const d = await client.saveDoctorChange(org.orgSlug, { id: target?.id, doctor, department: info!.department, date, kind, detail })
      onSaved(d, doctor, date, target)
    } catch (err) {
      setErrors({ form: asAuthError(err).message })
      setBusy(false)
    }
  }

  return (
    <form className="op-form" onSubmit={(e) => void submit(e)} noValidate>
      <SelectField
        ref={docRef}
        label="Doctor"
        value={doctor}
        error={errors.doctor}
        disabled={!!start}
        options={[{ value: '', label: 'Choose a doctor' }, ...options.map((d) => ({ value: d.doctor, label: `${d.doctor}, ${d.department}` }))]}
        onChange={(e) => setDoctor(e.target.value)}
      />
      <TextField label="Day" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
      <ChoiceGroup
        legend="What’s different"
        type="radio"
        columns={3}
        value={[kind]}
        onChange={([v]) => setKind(v)}
        options={[
          { value: 'away', label: 'Away all day' },
          { value: 'late', label: 'Starting late' },
          { value: 'moved', label: 'In another room' },
        ]}
      />
      <TextField
        ref={detailRef}
        label={kind === 'away' ? 'Who covers (optional)' : kind === 'late' ? 'From when' : 'Where'}
        placeholder={kind === 'away' ? 'e.g. Dr. Kavitha sees ENT patients in room 12' : kind === 'late' ? 'e.g. From 11 AM, after surgery' : 'e.g. OPD room 4'}
        maxLength={200}
        value={detail}
        error={errors.detail}
        onChange={(e) => setDetail(e.target.value)}
      />
      {existing && !start && (
        <p className="row__meta" role="status">
          {doctor} already has a change on that day ({CHANGE_LONG[existing.kind].toLowerCase()}). Saving replaces it.
        </p>
      )}
      {touched !== null && touched > 0 && (
        <p className="desk-change__affects" role="status">
          <strong className="num">
            {touched} booked {touched === 1 ? 'appointment is' : 'appointments are'} affected.
          </strong>{' '}
          <span className="row__meta">{touched === 1 ? 'That patient needs' : 'Those patients need'} telling.</span>
        </p>
      )}
      {errors.form && (
        <p className="field__error" role="alert">
          {errors.form}
        </p>
      )}
      <div className="dialog__actions">
        <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Saving…">
          Save
        </Button>
        <Button variant="line" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
