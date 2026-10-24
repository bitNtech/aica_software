import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError, type OrgSummary } from '../../auth/types'
import { StatusPill } from '../../components/console/StatusPill'
import { UpdatedAgo } from '../../components/console/UpdatedAgo'
import { WaitTimer } from '../../components/console/WaitTimer'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import type { ConsoleClient } from '../../console/types'
import { useNow } from '../../lib/useNow'
import { OrgFailures, useAcrossOrgs } from './acrossOrgs'
import { num, Panel, since } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'
import './overview/Overview.css'

const REFRESH = 15_000
const load = async (c: ConsoleClient, o: OrgSummary) => {
  const [calls, handoffs] = await Promise.all([c.listLiveCalls(o.slug), c.listHandoffs(o.slug)])
  return { calls, handoffs: handoffs.filter((h) => h.status === 'waiting') }
}
const ACTIVE = ['active'] as const

/** /ops/calls/live: every call in progress and everyone waiting for a person, across organisations. */
export default function OpsLiveCallsPage() {
  const { user } = useAuth()
  const isMaster = user?.platformRole === 'master_admin'
  const now = useNow(15_000)
  const across = useAcrossOrgs(load, { statuses: [...ACTIVE], refreshMs: REFRESH })
  const rows = across.results ?? []
  const calls = rows.flatMap((r) => (r.data?.calls ?? []).map((c) => ({ ...c, org: r.org }))).sort((a, b) => Number(b.flagged) - Number(a.flagged) || a.startedAt.localeCompare(b.startedAt))
  const waiting = rows
    .flatMap((r) => (r.data?.handoffs ?? []).map((h) => ({ ...h, org: r.org })))
    .sort((a, b) => Number(b.emergency) - Number(a.emergency) || a.waitingSince.localeCompare(b.waitingSince))

  return (
    <OpsLayout
      kicker="Calls"
      docTitle={waiting.length ? `(${waiting.length}) Live calls` : 'Live calls'}
      title="Live calls"
      lede={
        <p>
          Every call in progress, across organisations. It checks again every 15 seconds.{' '}
          {isMaster ? 'To take over, guide or transfer a call, open it in its organisation.' : 'Only the master admin can open calls; each organisation’s team takes its own callers.'}
        </p>
      }
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
          <span>Loading live calls…</span>
        </div>
      ) : (
        <>
          <p className="row__meta">
            <UpdatedAgo at={across.checkedAt} /> ·{' '}
            <button type="button" className="btn-text" onClick={across.reload}>
              Check now
            </button>
          </p>
          <OrgFailures results={rows} onRetry={across.reload} />
          <p className="sr-only" role="status">
            {num(calls.length)} calls in progress, {num(waiting.length)} waiting for a person
          </p>
          <div className="ov-grid">
            <Panel title="Waiting for a person" note="Emergencies, then longest waiting">
              {waiting.length === 0 ? (
                <p className="ov-empty">No one is waiting for a person.</p>
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
                      {isMaster && (
                        <Link className="btn btn--line btn--sm" to={`/ops/orgs/${h.org.slug}/live`} aria-label={`Open ${h.org.name}'s live calls`}>
                          <span>Open</span>
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="In progress" note={`${num(calls.length)} ${calls.length === 1 ? 'call' : 'calls'}`}>
              {calls.length === 0 ? (
                <p className="ov-empty">No calls in progress.</p>
              ) : (
                <ul className="ov-list">
                  {calls.map((c) => (
                    <li key={`${c.org.slug}/${c.id}`} className="ov-item">
                      <div className="ov-item__main">
                        <span className="ov-item__title">
                          {c.agentName} <span className="ov-muted">· {c.org.name}</span>
                        </span>
                        <span className="ov-item__meta">
                          {c.intent ?? 'Finding out what the caller wants'}
                          {c.step ? ` · at “${c.step}”` : ''} · for {since(c.startedAt, now)}
                        </span>
                      </div>
                      {c.takenBy ? <StatusPill tone="info">With {c.takenBy}</StatusPill> : c.flagged ? <StatusPill tone="warn">May need a person</StatusPill> : <StatusPill tone="live">Agent</StatusPill>}
                      {isMaster && (
                        <Link className="btn btn--line btn--sm" to={`/ops/orgs/${c.org.slug}/live`} aria-label={`Open ${c.agentName} at ${c.org.name}`}>
                          <span>Open</span>
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <h2 className="ops-section__title ops-usage__period">By organisation</h2>
          <div className="ops-table" role="region" aria-label="Live calls by organisation" tabIndex={0}>
            <table className="op-table ops-left">
              <thead>
                <tr>
                  <th scope="col">Organisation</th>
                  <th scope="col">In progress</th>
                  <th scope="col">May need a person</th>
                  <th scope="col">Waiting for a person</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.org.slug}>
                    <th scope="row">{r.org.name}</th>
                    <td className="num">{r.data ? num(r.data.calls.length) : '—'}</td>
                    <td className="num">{r.data ? num(r.data.calls.filter((c) => c.flagged && !c.takenBy).length) : '—'}</td>
                    <td className="num">{r.data ? num(r.data.handoffs.length) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </OpsLayout>
  )
}
