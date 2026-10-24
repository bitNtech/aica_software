import type { Appointment, Callback, Desk, DoctorChange, Handoff, Notice } from '../../../console/types'

/**
 * What a person who takes calls needs from today's data, picked and ordered.
 * Pure, so the ordering rules are tested without a page.
 */

/** Callers waiting for a person: emergencies first, then whoever has waited longest. */
export function waitingCallers(handoffs: Handoff[]): Handoff[] {
  return handoffs
    .filter((h) => h.status === 'waiting')
    .sort((a, b) => Number(b.emergency) - Number(a.emergency) || Date.parse(a.waitingSince) - Date.parse(b.waitingSince))
}

/** Open callbacks that are this person's or nobody's yet, overdue first and then soonest due. */
export function myCallbacks(callbacks: Callback[], userId: string): Callback[] {
  return callbacks
    .filter((c) => c.status === 'open' && (!c.assignedTo || c.assignedTo.id === userId))
    .sort((a, b) => Date.parse(a.dueBy) - Date.parse(b.dueBy))
}

export const isOverdue = (c: Pick<Callback, 'dueBy'>, now: number) => Date.parse(c.dueBy) < now

/** Appointments waiting for someone to check them, earliest first. */
export function appointmentsToCheck(appointments: Appointment[]): Appointment[] {
  return appointments.filter((a) => a.status === 'needs_check').sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
}

/** Notices the agents are telling callers right now. */
export function noticesNow(desk: Desk, now: number): Notice[] {
  return desk.notices.filter((n) => Date.parse(n.from) <= now && now <= Date.parse(n.until)).sort((a, b) => Date.parse(a.until) - Date.parse(b.until))
}

/** Doctor changes for `day` (yyyy-mm-dd). */
export function changesOn(desk: Desk, day: string): DoctorChange[] {
  return desk.doctorChanges.filter((d) => d.date === day)
}
