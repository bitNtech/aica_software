import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError, type OrgSummary } from '../../auth/types'
import { SegFilter } from '../../components/console/ListTools'
import { StatusPill } from '../../components/console/StatusPill'
import { WaitTimer } from '../../components/console/WaitTimer'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import type { ConsoleClient } from '../../console/types'
import { useNow } from '../../lib/useNow'
import { OrgFailures, useAcrossOrgs } from './acrossOrgs'
import { num, Panel, since, when } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'
import './overview/Overview.css'

const load = async (c: ConsoleClient, o: OrgSummary) => {
  const [handoffs, callbacks] = await Promise.all([c.listHandoffs(o.slug), c.listCallbacks(o.slug)])
  return { handoffs, callbacks }
}
type CbFilter = 'open' | 'overdue' | 'done'

/** /ops/handoffs: callers handed to a person, and the callbacks owed, across organisations. */
export default function OpsHandoffsPage() {
  const { user } = useAuth()
  const isMaster = user?.platformRole === 'master_admin'
  const now = useNow(60_000)
  const across = useAcrossOrgs(load, { statuses: ['active'], refreshMs: 30_000 })
  const [cb, setCb] = useState<CbFilter>('open')
  const rows = across.results ?? []
  const handoffs = rows.flatMap((r) => (r.data?.handoffs ?? []).map((h) => ({ ...h, org: r.org })))
  const waiting = handoffs.filter((h) => h.status === 'waiting').sort((a, b) => Number(b.emergency) - Number(a.emergency) || a.waitingSince.localeCompare(b.waitingSince))
  const recent = handoffs.filter((h) => h.status !== 'waiting').sort((a, b) => b.waitingSince.localeCompare(a.waitingSince))
  const callbacks = rows.flatMap((r) => (r.data?.callbacks ?? []).map((c) => ({ ...c, org: r.org })))
  const overdue = (c: (typeof callbacks)[number]) => c.status === 'open' && Date.parse(c.dueBy) < now
  const shown = callbacks
    .filter((c) => (cb === 'done' ? c.status !== 'open' : cb === 'overdue' ? overdue(c) : c.status === 'open'))
    .sort((a, b) => a.dueBy.localeCompare(b.dueBy))

  return (
    <OpsLayout
      kicker="Calls"
      docTitle="Handoffs and callbacks"
      title="Handoffs and callbacks"
      lede={<p>Callers the agents handed to a person, and the callbacks each organisation owes. Each organisation’s team works these; this page shows where they’re falling behind.</p>}
    >
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
          <span>Loading handoffs and callbacks…</span>
        </div>
      ) : (
        <>
          <OrgFailures results={rows} onRetry={across.reload} />
          <dl className="kpis ops-handoff-kpis">
            <div className="kpi">
              <dt className="kpi__label">Waiting for a person</dt>
              <dd className="kpi__value num">{num(waiting.length)}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Missed today</dt>
              <dd className="kpi__value num">{num(recent.filter((h) => h.status === 'missed' && now - Date.parse(h.waitingSince) < 864e5).length)}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Callbacks open</dt>
              <dd className="kpi__value num">{num(callbacks.filter((c) => c.status === 'open').length)}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Callbacks overdue</dt>
              <dd className="kpi__value num">{num(callbacks.filter(overdue).length)}</dd>
            </div>
          </dl>

          <div className="ov-grid ops-gap">
            <Panel title="Waiting for a person" note="Emergencies, then longest waiting">
              {waiting.length === 0 ? (
                <p className="ov-empty">No one is waiting.</p>
              ) : (
                <ul className="ov-list">
                  {waiting.map((h) => (
                    <li key={`${h.org.slug}/${h.id}`} className={`ov-item${h.emergency ? ' ov-item--critical' : ''}`}>
                      <div className="ov-item__main">
                        <span className="ov-item__title">
                          {h.emergency && <StatusPill tone="danger">Emergency</StatusPill>} {h.org.name}
                        </span>
                        <span className="ov-item__meta">
                          {h.agentName}: {h.reason}
                        </span>
                      </div>
                      <WaitTimer since={h.waitingSince} compact />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Recently handed over" note="Taken or missed, newest first">
              {recent.length === 0 ? (
                <p className="ov-empty">Nothing yet.</p>
              ) : (
                <ul className="ov-list">
                  {recent.slice(0, 10).map((h) => (
                    <li key={`${h.org.slug}/${h.id}`} className="ov-item">
                      <div className="ov-item__main">
                        <span className="ov-item__title">
                          {h.org.name} <span className="ov-muted">· {h.agentName}</span>
                        </span>
                        <span className="ov-item__meta">
                          {h.reason} · {when(h.waitingSince, now)}
                        </span>
                      </div>
                      {h.status === 'missed' ? <StatusPill tone="warn">Missed</StatusPill> : <StatusPill tone="ok">Taken by {h.takenBy ?? 'staff'}</StatusPill>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <section className="ops-section" aria-labelledby="cb-h">
            <div className="ops-section__head">
              <h2 id="cb-h" className="ops-section__title">
                Callbacks
              </h2>
              <p className="ops-section__note">Soonest due first</p>
            </div>
            <div className="list-tools">
              <SegFilter<CbFilter>
                legend="Show"
                value={cb}
                onChange={setCb}
                options={[
                  { value: 'open', label: 'Open', count: callbacks.filter((c) => c.status === 'open').length },
                  { value: 'overdue', label: 'Overdue', count: callbacks.filter(overdue).length },
                  { value: 'done', label: 'Done or unreachable', count: callbacks.filter((c) => c.status !== 'open').length },
                ]}
              />
            </div>
            {shown.length === 0 ? (
              <p className="empty-note">No callbacks here.</p>
            ) : (
              <div className="ops-table" role="region" aria-label="Callbacks" tabIndex={0}>
                <table className="op-table ops-left">
                  <thead>
                    <tr>
                      <th scope="col">Due</th>
                      <th scope="col">Organisation</th>
                      <th scope="col">Caller</th>
                      <th scope="col">Why</th>
                      <th scope="col">Who has it</th>
                      <th scope="col">Tries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={`${c.org.slug}/${c.id}`}>
                        <th scope="row">
                          {when(c.dueBy, now)}
                          {overdue(c) && <span className="ops-cell-sub ops-over">Overdue by {since(c.dueBy, now)}</span>}
                        </th>
                        <td>
                          {isMaster ? (
                            <Link className="row__link" to={`/ops/orgs/${c.org.slug}/callbacks`}>
                              {c.org.name}
                            </Link>
                          ) : (
                            c.org.name
                          )}
                        </td>
                        <td>{isMaster ? (c.callerName ? `${c.callerName} · ${c.callerPhone}` : c.callerPhone) : <span className="ops-muted">Hidden</span>}</td>
                        <td>{c.reason}</td>
                        <td>{c.assignedTo?.name ?? <span className="ops-over">Nobody yet</span>}</td>
                        <td className="num">{c.attempts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </OpsLayout>
  )
}
