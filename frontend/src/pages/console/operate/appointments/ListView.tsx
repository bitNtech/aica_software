import type { ReactNode } from 'react'
import { DataTable, type Column } from '../../../../components/console/DataTable'
import type { Appointment } from '../../../../console/types'
import { APPT_STATUS_LABEL, byStart, dayName, time12 } from './model'
import { AgentMark, ApptStatus, ProblemFlag, type Shared } from './parts'

/**
 * The agenda: every booking in the days chosen, one row each, sortable by
 * any column (date and time by default). The phone column is there only for
 * people who manage appointments. A row opens the detail on Enter or click.
 */
export function ListView({ shared, appts, empty, loading }: { shared: Shared; appts: Appointment[]; empty: ReactNode; loading: boolean }) {
  const { sees, today, problems } = shared
  const who = (a: Appointment) => (sees.name ? a.patientName : 'A patient')
  const columns: Column<Appointment>[] = [
    { key: 'date', header: 'Date', cell: (a) => dayName(a.date, today), sortValue: (a) => `${a.date} ${a.time}`, width: '7.5rem' },
    { key: 'time', header: 'Time', cell: (a) => <span className="num">{time12(a.time)}</span>, sortValue: (a) => a.time, width: '6rem' },
    { key: 'patient', header: 'Patient', cell: (a) => <span className={a.status === 'cancelled' ? 'ap-struck' : undefined}>{who(a)}</span>, sortValue: who },
    ...(sees.phone ? [{ key: 'phone', header: 'Phone', cell: (a: Appointment) => <span className="num">{a.phone}</span>, width: '9rem' } satisfies Column<Appointment>] : []),
    { key: 'doctor', header: 'Doctor', cell: (a) => a.doctor, sortValue: (a) => a.doctor },
    { key: 'department', header: 'Department', cell: (a) => a.department, sortValue: (a) => a.department },
    { key: 'status', header: 'Status', cell: (a) => <ApptStatus status={a.status} />, sortValue: (a) => APPT_STATUS_LABEL[a.status], width: '10rem' },
    {
      key: 'by',
      header: 'Booked by',
      cell: (a) => (a.bookedBy === 'agent' ? <AgentMark appt={a} /> : 'Staff'),
      sortValue: (a) => (a.bookedBy === 'agent' ? (a.agentName ?? 'Agent') : 'Staff'),
    },
    {
      key: 'problems',
      header: 'Problems',
      cell: (a) => {
        const p = problems.get(a.id)
        return p?.length || a.checkReason ? (
          <span className="ap-problem-cell">
            <ProblemFlag problems={p} />
            {a.status === 'needs_check' && a.checkReason && <span className="ap-problem-cell__why">{a.checkReason}</span>}
          </span>
        ) : (
          <span className="ap-none">None</span>
        )
      },
      sortValue: (a) => problems.get(a.id)?.length ?? 0,
    },
    { key: 'note', header: 'Note', cell: (a) => (a.note ? <span className="ap-note">{a.note}</span> : <span className="ap-none">None</span>) },
  ]
  return (
    <DataTable
      columns={columns}
      rows={[...appts].sort(byStart)}
      rowKey={(a) => a.id}
      caption="Appointments"
      onSelect={(a) => shared.onOpen(a)}
      selectedKey={shared.selectedId}
      defaultSort={{ key: 'date', dir: 'ascending' }}
      loading={loading}
      empty={empty}
      maxHeight="68dvh"
      densityKey="aica.appointments.density"
      defaultDensity="compact"
    />
  )
}
