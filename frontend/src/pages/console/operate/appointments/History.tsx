import { Timeline, type TimelineItem } from '../../../../components/console/Timeline'
import type { Appointment, AppointmentChange } from '../../../../console/types'

const KIND_TITLE: Record<AppointmentChange['kind'], string> = {
  created: 'Booked',
  confirmed: 'Confirmed',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No-show',
  restored: 'Booked again',
  edited: 'Changed',
  undone: 'Undone',
  declined: 'Declined',
  notified: 'Patient told',
}

/**
 * Everything that happened to a booking, newest first: who booked it and
 * how, each confirmation, move (old and new slot) and cancellation, with the
 * reason given. Records from before the history was kept say so.
 */
export function History({ appt: a }: { appt: Appointment }) {
  const list = a.history ?? []
  if (list.length === 0) return <p className="ap-muted">No history is kept for this booking yet: it was made before changes were recorded.</p>
  const items: TimelineItem[] = list.map((h, i) => ({
    id: `${a.id}-${i}`,
    at: h.at,
    who: h.by,
    kind: (h.kind === 'created' || h.kind === 'notified') && a.source === 'ai_call' ? 'agent' : h.kind === 'cancelled' || h.kind === 'no_show' || h.kind === 'declined' ? 'alert' : 'person',
    title: h.text || KIND_TITLE[h.kind],
    body: h.reason ? `Why: ${h.reason}` : undefined,
  }))
  return <Timeline label="What happened to this appointment" items={items} />
}
