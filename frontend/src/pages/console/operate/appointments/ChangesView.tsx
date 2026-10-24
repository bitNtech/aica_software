import type { ReactNode } from 'react'
import { DataTable, type Column } from '../../../../components/console/DataTable'
import type { Appointment } from '../../../../console/types'
import { timeAgo } from '../../../../lib/time'
import { byStart, dayName, time12 } from './model'
import { ApptStatus, type Shared } from './parts'

/** The latest move or cancellation, with its reason. */
function lastChange(a: Appointment) {
  return (a.history ?? []).find((h) => h.kind === (a.status === 'cancelled' ? 'cancelled' : 'rescheduled')) ?? a.history?.[0] ?? null
}

/**
 * Cancelled and rescheduled bookings: what changed, why, who did it and
 * when, from each booking's history. A row opens the booking.
 */
export function ChangesView({ shared, appts, empty }: { shared: Shared; appts: Appointment[]; empty: ReactNode }) {
  const { sees, today } = shared
  const who = (a: Appointment) => (sees.name ? a.patientName : 'A patient')
  const rows = appts.filter((a) => a.status === 'cancelled' || a.status === 'rescheduled').sort(byStart)
  const columns: Column<Appointment>[] = [
    { key: 'when', header: 'Appointment', cell: (a) => `${dayName(a.date, today)}, ${time12(a.time)}`, sortValue: (a) => `${a.date} ${a.time}`, width: '11rem' },
    { key: 'patient', header: 'Patient', cell: who, sortValue: who },
    { key: 'doctor', header: 'Doctor', cell: (a) => a.doctor, sortValue: (a) => a.doctor },
    { key: 'status', header: 'Status', cell: (a) => <ApptStatus appt={a} />, sortValue: (a) => a.status, width: '9rem' },
    { key: 'what', header: 'What changed', cell: (a) => lastChange(a)?.text ?? <span className="ap-none">Not recorded</span> },
    { key: 'why', header: 'Why', cell: (a) => (a.status === 'cancelled' ? a.cancelReason : lastChange(a)?.reason) ?? <span className="ap-none">Not given</span> },
    {
      key: 'by',
      header: 'By',
      cell: (a) => {
        const c = lastChange(a)
        return c ? `${c.by}, ${timeAgo(c.at)}` : <span className="ap-none">Unknown</span>
      },
      sortValue: (a) => lastChange(a)?.at ?? '',
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      caption="Cancelled and rescheduled appointments"
      onSelect={(a) => shared.onOpen(a)}
      selectedKey={shared.selectedId}
      defaultSort={{ key: 'when', dir: 'ascending' }}
      empty={empty}
      maxHeight="68dvh"
      densityKey="aica.appointments.density"
      defaultDensity="compact"
    />
  )
}
