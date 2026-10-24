import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../../../../components/ui/Dialog'
import { TextAreaField } from '../../../../components/ui/Field'
import type { Appointment, BookingSettings } from '../../../../console/types'
import { dayName, howTold, sourceOf, time12 } from './model'

const QUICK = ['The doctor is fully booked that day.', 'The time went to a patient who needed it more.', 'This needs a different department.']

interface Props {
  appt: Appointment | null
  who: string
  today: string
  booking: BookingSettings | null
  busy: boolean
  error: string | null
  onConfirm(reason: string): void
  onCancel(): void
}

/** Turning a request down: why (required, kept in the history), and how the patient will hear of it. */
export function DeclineDialog({ appt: a, who, today, booking, busy, error, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('')
  const [own, setOwn] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!a) return
    setReason('')
    setOwn(null)
  }, [a])
  const told = a && sourceOf(a) === 'ai_call' ? howTold(booking) : null

  return (
    <ConfirmDialog
      open={!!a}
      title={`Decline ${who === 'A patient' ? 'this' : `${who}'s`} request?`}
      confirmLabel="Decline request"
      cancelLabel="Keep it"
      busyLabel="Declining…"
      busy={busy}
      danger
      error={own ?? error}
      initialFocus={field}
      onConfirm={() => {
        if (reason.trim().length < 3) {
          setOwn('Say why it’s declined. The patient is told.')
          field.current?.focus()
          return
        }
        setOwn(null)
        onConfirm(reason.trim())
      }}
      onCancel={onCancel}
    >
      {a && (
        <p>
          {dayName(a.date, today)} at {time12(a.time)} with {a.doctor}.{' '}
          {told ? `Once declined, ${told} with the reason.` : sourceOf(a) === 'ai_call' ? 'Patient updates are off: let the patient know yourself.' : 'Let the patient know: AICA doesn’t contact them about bookings made by the desk.'}
        </p>
      )}
      <div className="ap-quick" role="group" aria-label="Common reasons">
        {QUICK.map((q) => (
          <button key={q} type="button" className="ap-free__slot" aria-pressed={reason === q} onClick={() => setReason(q)}>
            {q}
          </button>
        ))}
      </div>
      <TextAreaField ref={field} label="Why it’s declined" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} hint="Kept in the history, and told to the patient." />
    </ConfirmDialog>
  )
}
