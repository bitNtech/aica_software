import { useCallback, useId, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError } from '../../auth/types'
import { useConsole } from '../../console/ConsoleProvider'
import type { ChangeRequest } from '../../console/types'
import { SegFilter } from '../../components/console/ListTools'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import { useAsync } from '../../lib/useAsync'
import { timeAgo } from '../../lib/time'
import { KIND_LABEL, STATUS_LABEL, URGENCY_LABEL } from '../console/RequestsPage'
import '../console/operate/Operate.css'
import '../console/Requests.css'
import './Ops.css'

type Row = ChangeRequest & { orgName: string }
type Filter = 'open' | 'all'
const URGENCY_ORDER = { urgent: 0, soon: 1, normal: 2 } as const

/** /ops/changes: what every organisation has asked bitNtech for, most urgent
 * first. Each opens in the organisation's Requests page to reply and act. */
export default function OpsChangesPage() {
  const { client } = useAuth()
  const consoleClient = useConsole()
  const id = useId()
  const [filter, setFilter] = useState<Filter>('open')
  const load = useCallback(async (): Promise<Row[]> => {
    // One call when the API serves requests; otherwise each organisation in turn.
    if (consoleClient.listAllChangeRequests) return consoleClient.listAllChangeRequests()
    const orgs = (await client.listOrgs()).filter((o) => o.status === 'active')
    const lists = await Promise.all(orgs.map(async (o) => (await consoleClient.listChangeRequests(o.slug)).map((r) => ({ ...r, orgName: o.name }))))
    return lists.flat()
  }, [client, consoleClient])
  const [rows, reload] = useAsync(load)

  const all = rows.state === 'ready' ? rows.data : []
  const open = (r: Row) => r.status === 'open' || r.status === 'in_progress'
  const shown = all
    .filter((r) => filter === 'all' || open(r))
    .sort((a, b) => Number(open(b)) - Number(open(a)) || URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || a.createdAt.localeCompare(b.createdAt))

  return (
    <OpsLayout kicker="Change requests" docTitle="Change requests" title="Change requests" demoData lede={<p>New agents and flow changes organisations have asked for. Open one to reply, build it from the organisation’s Agents page, then mark it done.</p>}>
      {rows.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading requests…</span>
        </div>
      )}
      {rows.state === 'error' && (
        <Alert tone="error" title="Couldn't load the requests">
          <p>{asAuthError(rows.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {rows.state === 'ready' && (
        <section aria-labelledby={`${id}-h`}>
          <h2 id={`${id}-h`} className="sr-only">
            Change requests
          </h2>
          <div className="list-tools">
            <SegFilter<Filter>
              legend="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: 'Open', count: all.filter(open).length },
                { value: 'all', label: 'All', count: all.length },
              ]}
            />
          </div>
          {shown.length === 0 ? (
            <p className="empty-note">{filter === 'open' ? 'Nothing waiting. Every request has been dealt with.' : 'No organisation has asked for anything yet.'}</p>
          ) : (
            <div className="ops-table" role="region" aria-labelledby={`${id}-h`} tabIndex={0}>
              <table className="op-table ops-left">
                <caption className="sr-only">Change requests, most urgent first</caption>
                <thead>
                  <tr>
                    <th scope="col">Request</th>
                    <th scope="col">Organisation</th>
                    <th scope="col">How soon</th>
                    <th scope="col">Status</th>
                    <th scope="col">Asked</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={`${r.orgSlug}:${r.id}`}>
                      <th scope="row">
                        <Link className="link" to={`/ops/orgs/${r.orgSlug}/requests#${r.id}`}>
                          {r.title}
                        </Link>
                        <span className="row__meta">
                          {' '}
                          {KIND_LABEL[r.kind]}
                          {r.agentName && ` · ${r.agentName}`}
                        </span>
                      </th>
                      <td>{r.orgName}</td>
                      <td>{URGENCY_LABEL[r.urgency]}</td>
                      <td>
                        <span className={`status-chip req__status req__status--${r.status}`}>{STATUS_LABEL[r.status]}</span>
                      </td>
                      <td>
                        {timeAgo(r.createdAt)} by {r.createdBy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </OpsLayout>
  )
}
