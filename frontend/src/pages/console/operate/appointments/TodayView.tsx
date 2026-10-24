import type { Appointment } from '../../../../console/types'
import { nowKey } from '../../../../console/appointmentRecords'
import { byStart, isOpen } from './model'
import { Agenda, type Shared } from './parts'

/**
 * Today at the front desk, in three columns: who is still to come, who has
 * been seen, and who was missed. Bookings whose time has passed without
 * being marked lead the missed column, so they get marked.
 */
export function TodayView({ shared, appts }: { shared: Shared; appts: Appointment[] }) {
  const now = nowKey(shared.now)
  const mine = [...appts].sort(byStart)
  const passed = (a: Appointment) => `${a.date} ${a.time}` <= now
  const upcoming = mine.filter((a) => isOpen(a) && !passed(a))
  const unmarked = mine.filter((a) => isOpen(a) && passed(a))
  const completed = mine.filter((a) => a.status === 'completed')
  const missed = mine.filter((a) => a.status === 'no_show')
  return (
    <div className="ap-today">
      <Agenda label="Still to come today" shared={shared} showDoctor groups={[{ key: 'up', title: `Upcoming (${upcoming.length})`, items: upcoming }]} />
      <Agenda label="Seen today" shared={shared} showDoctor groups={[{ key: 'done', title: `Completed (${completed.length})`, items: completed }]} />
      <Agenda
        label="Missed today"
        shared={shared}
        showDoctor
        groups={[
          ...(unmarked.length ? [{ key: 'unmarked', title: `Time passed, not marked (${unmarked.length})`, note: 'Mark each one completed or a no-show.', items: unmarked }] : []),
          { key: 'missed', title: `No-shows (${missed.length})`, items: missed },
        ]}
      />
    </div>
  )
}
