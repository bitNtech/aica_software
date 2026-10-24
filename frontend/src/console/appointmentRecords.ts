import { AuthError } from '../auth/types'
import type { Appointment, AppointmentPatch, BookingSource } from './types'

/** Statuses as older records (and the current API) store them. */
type LegacyStatus = 'needs_check' | 'booked'

/**
 * An appointment as the page reads it, from any record: the current API and
 * demo data saved before Oct 2026 still say "booked" or "needs_check" (now
 * pending, with the check kept as a flag) and have no booking source.
 */
export function fromRecord(a: Appointment): Appointment {
  const status = a.status as Appointment['status'] | LegacyStatus
  const source: BookingSource = a.source ?? (a.bookedBy === 'agent' ? 'ai_call' : 'front_desk')
  return { ...a, status: status === 'booked' || status === 'needs_check' ? 'pending' : status, source }
}

/**
 * A change the current API can make: it knows pending (as "booked"),
 * confirmed and cancelled, and stores no reasons, types or history yet.
 * Completed and no-show, and new bookings, wait for the API update.
 */
export function toApiPatch(patch: AppointmentPatch): Record<string, string> {
  if (patch.status === 'completed' || patch.status === 'no_show') throw new AuthError('invalid_input', 'Marking an appointment completed or a no-show needs the AICA server to be updated first.')
  if (patch.status === 'declined') throw new AuthError('invalid_input', 'Declining a request needs the AICA server to be updated first.')
  const out: Record<string, string> = {}
  if (patch.status) out.status = patch.status === 'pending' || patch.status === 'rescheduled' ? 'booked' : patch.status
  for (const k of ['date', 'time', 'department', 'doctor', 'note'] as const) if (patch[k] !== undefined) out[k] = patch[k]!
  return out
}

/** When the appointment starts, as a local yyyy-mm-dd HH:mm string, for comparing with now. */
export const startsAt = (a: Pick<Appointment, 'date' | 'time'>) => `${a.date} ${a.time}`
/** Now, in the same form. */
export function nowKey(now = Date.now()): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
/** Still to come or under way: can be confirmed, moved, cancelled. */
export const isOpen = (a: Pick<Appointment, 'status'>) => a.status === 'pending' || a.status === 'confirmed' || a.status === 'rescheduled'
/** The agent flagged it and nobody has confirmed it since. */
export const needsCheck = (a: Pick<Appointment, 'status' | 'checkReason'>) => !!a.checkReason && (a.status === 'pending' || a.status === 'rescheduled')
/** Waiting for the hospital to decide: a request not yet confirmed or declined, or one the agent flagged. */
export const awaitsReview = (a: Pick<Appointment, 'status' | 'checkReason'>) => a.status === 'pending' || needsCheck(a)
