import { useCallback, useId, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError, type OrgSummary } from '../../auth/types'
import { SegFilter } from '../../components/console/ListTools'
import { StatusPill, type Tone } from '../../components/console/StatusPill'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import type { AppointmentStatus, ConsoleClient } from '../../console/types'
import { awaitsReview, needsCheck } from '../../console/appointmentRecords'
import { OrgFailures, OrgSelect, useAcrossOrgs } from './acrossOrgs'
import { num } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'

type Range = 'today' | 'week'
const STATUS: Record<AppointmentStatus, { tone: Tone; label: string }> = {
  pending: { tone: 'info', label: 'Pending' },
  confirmed: { tone: 'ok', label: 'Confirmed' },
  rescheduled: { tone: 'info', label: 'Rescheduled' },
  completed: { tone: 'ok', label: 'Completed' },
  no_show: { tone: 'warn', label: 'No-show' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  declined: { tone: 'neutral', label: 'Declined' },
}
/** yyyy-mm-dd in India. */
const istDate = (ms: number) => new Date(ms + 5.5 * 36e5).toISOString().slice(0, 10)
const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

/** /ops/appointments: what the agents booked across organisations, and what needs a check. */
export default function OpsAppointmentsPage() {
  const { user } = useAuth()
  const isMaster = user?.platformRole === 'master_admin'
  const id = useId()
  const [range, setRange] = useState<Range>('today')
  const [org, setOrg] = useState('')
  const [onlyCheck, setOnlyCheck] = useState(false)
  const from = istDate(Date.now())
  const to = range === 'today' ? from : istDate(Date.now() + 6 * 864e5)
  const load = useCallback((c: ConsoleClient, o: OrgSummary) => c.listAppointments(o.slug, from, to), [from, to])
  const across = useAcrossOrgs(load, { statuses: ['active'] })
  const rows = across.results ?? []
  const all = rows.filter((r) => !org || r.org.slug === org).flatMap((r) => (r.data ?? []).map((a) => ({ ...a, org: r.org })))
  const shown = all.filter((a) => !onlyCheck || needsCheck(a)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  const count = (s: AppointmentStatus) => all.filter((a) => a.status === s).length

  return (
    <OpsLayout
      kicker="Calls"
      docTitle="Appointments"
      title="Appointments"
      lede={<p>Appointments booked by agents and staff across organisations. The agents’ requests wait for each organisation to confirm them (or for its automatic confirmation); those the agent wasn’t sure about need a person to check. {isMaster ? '' : 'Patients’ names and numbers are shown to the master admin only.'}</p>}
    >
      <div className="list-tools">
        <SegFilter<Range> legend="When" value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Next 7 days' }]} />
        {across.results && <OrgSelect id={`${id}-org`} orgs={rows.map((r) => r.org)} value={org} onChange={setOrg} />}
        <label className="ops-check">
          <input type="checkbox" checked={onlyCheck} onChange={(e) => setOnlyCheck(e.target.checked)} /> Only those needing a check
        </label>
      </div>
      {across.error ? (
        <Alert tone="error" title="Couldn't load organisations">
          <p>{asAuthError(across.error).message}</p>
          <button type="button" className="btn-text" onClick={across.reload}>
            Try again
          </button>
        </Alert>
      ) : !across.results ? (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading appointments…</span>
        </div>
      ) : (
        <div className={across.loading ? 'op-report is-loading' : undefined} aria-busy={across.loading || undefined}>
          <OrgFailures results={rows} onRetry={across.reload} />
          <dl className="kpis ops-gap-b">
            {(['confirmed', 'completed', 'cancelled', 'declined'] as AppointmentStatus[]).map((s) => (
              <div key={s} className="kpi">
                <dt className="kpi__label">{STATUS[s].label}</dt>
                <dd className="kpi__value num">{num(count(s))}</dd>
              </div>
            ))}
            <div className="kpi">
              <dt className="kpi__label">Requests waiting</dt>
              <dd className="kpi__value num">{num(all.filter(awaitsReview).length)}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Times with several requests</dt>
              <dd className="kpi__value num">{num(new Set(all.filter((a) => a.status === 'pending' && a.rank && a.rank.of > 1).map((a) => `${a.org.slug}|${a.doctor}|${a.date}|${a.time}`)).size)}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Needs a check</dt>
              <dd className="kpi__value num">{num(all.filter(needsCheck).length)}</dd>
            </div>
          </dl>
          {shown.length === 0 ? (
            <p className="empty-note">{onlyCheck ? 'Nothing needs a check.' : 'No appointments in this period.'}</p>
          ) : (
            <div className="ops-table" role="region" aria-label="Appointments" tabIndex={0}>
              <table className="op-table ops-left">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Organisation</th>
                    <th scope="col">Doctor</th>
                    <th scope="col">Patient</th>
                    <th scope="col">Status</th>
                    <th scope="col">Booked by</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={`${a.org.slug}/${a.id}`}>
                      <th scope="row">
                        {range === 'week' && `${dayName(a.date)}, `}
                        {a.time}
                      </th>
                      <td>
                        {isMaster ? (
                          <Link className="row__link" to={`/ops/orgs/${a.org.slug}/appointments`}>
                            {a.org.name}
                          </Link>
                        ) : (
                          a.org.name
                        )}
                      </td>
                      <td>
                        {a.doctor}
                        <span className="ops-cell-sub">{a.department}</span>
                      </td>
                      <td>{isMaster ? `${a.patientName} · ${a.phone}` : <span className="ops-muted">Hidden</span>}</td>
                      <td>
                        <StatusPill tone={STATUS[a.status].tone}>{STATUS[a.status].label}</StatusPill>
                        {needsCheck(a) && <span className="ops-cell-sub">Needs a check: {a.checkReason}</span>}
                        {a.status === 'pending' && a.rank && a.rank.of > 1 && <span className="ops-cell-sub">Ranked {a.rank.position} of {a.rank.of} for this time</span>}
                      </td>
                      <td>{a.source === 'ai_call' || (!a.source && a.bookedBy === 'agent') ? (a.agentName ?? 'An agent') : a.source === 'manual' ? 'By hand' : 'Front desk'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </OpsLayout>
  )
}
