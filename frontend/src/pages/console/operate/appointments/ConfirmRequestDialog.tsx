import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../../auth/types'
import { Button } from '../../../../components/ui/Button'
import { Modal } from '../../../../components/ui/Dialog'
import { SelectField, TextField } from '../../../../components/ui/Field'
import type { Appointment, BookingSettings } from '../../../../console/types'
import { dayName, howTold, patientLabel, rivalsOf, suggestSlots, time12, type Ctx, type Sees } from './model'
import { PriorityPill, type RivalChoice } from './parts'

const LOST = 'The requested time went to a patient who needed it more.'

interface Props {
  winner: Appointment | null
  rows: Appointment[]
  ctx: Ctx
  sees: Sees
  today: string
  booking: BookingSettings | null
  onClose(): void
  onConfirm(winner: Appointment, others: RivalChoice[]): Promise<void>
}

type Draft = { action: 'offer' | 'decline'; slot: string; reason: string }

/**
 * Confirming one of several requests for a time: the others are each
 * offered another of the doctor's free times, or declined with a reason,
 * before anything is saved. What the settings say happens to them is the
 * starting choice.
 */
export function ConfirmRequestDialog({ winner, rows, ctx, sees, today, booking, onClose, onConfirm }: Props) {
  const rivals = useMemo(() => (winner ? rivalsOf(winner, rows) : []), [winner, rows])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Free times for each rival: the doctor's, around the winner (who now holds this time); the other rivals are moving, so they hold nothing.
  const free = useMemo(() => {
    const moving = new Set(rivals.map((r) => r.id))
    const others = rows.filter((o) => !moving.has(o.id))
    return Object.fromEntries(rivals.map((r) => [r.id, suggestSlots({ doctor: r.doctor, from: r.date < today ? today : r.date, count: 6, others, ctx })]))
  }, [rivals, rows, today, ctx])

  useEffect(() => {
    if (!winner) return
    setError(null)
    setDrafts(
      Object.fromEntries(
        rivals.map((r, i) => {
          const slots = free[r.id] ?? []
          // Spread the starting offers so two patients aren't offered the same time.
          const s = slots[Math.min(i, slots.length - 1)]
          const offer = booking?.others !== 'decline' && !!s
          return [r.id, { action: offer ? 'offer' : 'decline', slot: s ? `${s.date} ${s.time}` : '', reason: LOST }]
        }),
      ),
    )
    // Fresh each time it opens.
  }, [winner?.id])

  const set = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))
  const told = howTold(booking)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!winner) return
    const choices: RivalChoice[] = []
    const offered = new Set<string>()
    for (const r of rivals) {
      const d = drafts[r.id]
      if (!d) continue
      if (d.action === 'offer') {
        if (!d.slot) return setError(`Choose a time to offer ${patientLabel(r, sees)}, or decline the request.`)
        if (offered.has(d.slot)) return setError('Two patients are offered the same time. Choose another for one of them.')
        offered.add(d.slot)
        const [date, time] = d.slot.split(' ')
        choices.push({ appt: r, action: 'offer', date, time })
      } else {
        if (d.reason.trim().length < 3) return setError('Say why each declined request is declined.')
        choices.push({ appt: r, action: 'decline', reason: d.reason.trim() })
      }
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(winner, choices)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!winner} wide title={winner ? `Confirm ${patientLabel(winner, sees) === 'A patient' ? 'this request' : `${patientLabel(winner, sees)}'s request`}` : 'Confirm'} onClose={() => !busy && onClose()}>
      {winner && (
        <form className="op-form ap-change" onSubmit={save} noValidate>
          <p>
            {dayName(winner.date, today)} at {time12(winner.time)} with {winner.doctor}.{' '}
            {rivals.length === 1 ? 'One other patient asked for this time.' : `${rivals.length} other patients asked for this time.`} Choose what happens to {rivals.length === 1 ? 'them' : 'each'}.
          </p>
          <ul className="ap-rivals">
            {rivals.map((r) => {
              const d = drafts[r.id]
              const slots = free[r.id] ?? []
              if (!d) return null
              return (
                <li key={r.id} className="ap-rival">
                  <div className="ap-rival__who">
                    <strong>{patientLabel(r, sees)}</strong>
                    {r.rank && <PriorityPill level={r.rank.level} />}
                    {r.rank && (
                      <span className="ap-muted num">
                        Ranked {r.rank.position} of {r.rank.of}
                      </span>
                    )}
                  </div>
                  {r.visitReason && <p className="ap-rival__why">{r.visitReason}</p>}
                  <div className="ap-views" role="group" aria-label={`What happens to ${patientLabel(r, sees)}`}>
                    <button type="button" className="ap-views__btn" aria-pressed={d.action === 'offer'} disabled={slots.length === 0} onClick={() => set(r.id, { action: 'offer' })}>
                      Offer another time
                    </button>
                    <button type="button" className="ap-views__btn" aria-pressed={d.action === 'decline'} onClick={() => set(r.id, { action: 'decline' })}>
                      Decline
                    </button>
                  </div>
                  {d.action === 'offer' ? (
                    <SelectField
                      label="Time to offer"
                      value={d.slot}
                      options={slots.map((s) => ({ value: `${s.date} ${s.time}`, label: `${dayName(s.date, today)}, ${time12(s.time)}` }))}
                      onChange={(e) => set(r.id, { slot: e.target.value })}
                      hint="The doctor’s free times. It waits for the patient to agree."
                    />
                  ) : (
                    <TextField label="Why it’s declined" value={d.reason} maxLength={300} onChange={(e) => set(r.id, { reason: e.target.value })} />
                  )}
                  {slots.length === 0 && <p className="ap-hint">No free time with {r.doctor} in the next 7 days.</p>}
                </li>
              )
            })}
          </ul>
          <p className="ap-hint">{told ? `Then ${told}, to each patient: the confirmation, the new time offered, or the reason.` : 'Patient updates are off: let each patient know yourself.'}</p>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog__actions">
            <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Confirming…">
              Confirm and settle the others
            </Button>
            <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
