import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { BUSINESS_LABEL, STATUS_LABEL } from '../../auth/roles'
import { asAuthError, type OrgStatus } from '../../auth/types'
import { SegFilter } from '../../components/console/ListTools'
import { StatusPill } from '../../components/console/StatusPill'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { TextField } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Spinner'
import { useAsync } from '../../lib/useAsync'
import { shortDate } from '../../lib/time'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { PlatformOverview } from '../../ops/types'
import { num, pct } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'

type Filter = 'all' | OrgStatus
type Sort = 'attention' | 'calls' | 'newest' | 'name'
const ORDER: Record<OrgStatus, number> = { suspended: 0, pending_review: 1, declined: 2, active: 3 }
const SORT_LABEL: Record<Sort, string> = { attention: 'Needs attention first', calls: 'Most calls', newest: 'Newest first', name: 'Name' }

/** /ops/orgs: every organisation as a table to search, filter and sort; each opens its detail. */
export default function OpsOrgsPage() {
  const { client } = useAuth()
  const ops = useOpsData()
  const id = useId()
  const loadOrgs = useCallback(() => client.listOrgs(), [client])
  const [orgs, reload] = useAsync(loadOrgs)
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('attention')

  useEffect(() => {
    let live = true
    // Calls and agents are extra: the table works without them.
    ops.getOverview(30).then(
      (o) => live && setOverview(o),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [ops])

  const all = orgs.state === 'ready' ? orgs.data : []
  const usage = new Map(overview?.orgs.map((o) => [o.slug, o]))
  const agentsOf = (slug: string) => overview?.agents.filter((a) => a.orgSlug === slug) ?? []
  const flagsOf = (slug: string) => overview?.attention.filter((a) => a.slug === slug) ?? []
  const q = query.trim().toLowerCase()
  const rows = all
    .filter((o) => filter === 'all' || o.status === filter)
    .filter((o) => !q || [o.name, o.city, o.ownerEmail, BUSINESS_LABEL[o.businessType]].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort === 'calls') return (usage.get(b.slug)?.calls ?? 0) - (usage.get(a.slug)?.calls ?? 0)
      if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt)
      if (sort === 'name') return a.name.localeCompare(b.name)
      return flagsOf(b.slug).length - flagsOf(a.slug).length || ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)
    })
  const count = (f: Filter) => (f === 'all' ? all.length : all.filter((o) => o.status === f).length)

  return (
    <OpsLayout kicker="Organisations" docTitle="Organisations" title="Organisations" lede={<p>Every organisation on AICA. Open one to manage its agents, calls, team, settings and billing.</p>}>
      {orgs.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading organisations…</span>
        </div>
      )}
      {orgs.state === 'error' && (
        <Alert tone="error" title="Couldn't load organisations">
          <p>{asAuthError(orgs.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {orgs.state === 'ready' && (
        <>
          <div className="list-tools">
            <TextField label="Search organisations" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, city, owner's email" autoComplete="off" className="list-tools__search" />
            <SegFilter<Filter>
              legend="Status"
              value={filter}
              onChange={setFilter}
              options={(['all', 'active', 'pending_review', 'suspended', 'declined'] as Filter[]).map((f) => ({ value: f, label: f === 'all' ? 'All' : STATUS_LABEL[f], count: count(f) }))}
            />
            <div className="field">
              <label className="field__label" htmlFor={`${id}-sort`}>
                Sort
              </label>
              <select id={`${id}-sort`} className="field__input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="sr-only" role="status">
            {rows.length} of {all.length} organisations shown
          </p>
          {rows.length === 0 ? (
            <p className="empty-note">{all.length === 0 ? 'No organisations have signed up yet.' : 'No organisation matches. Try another search or status.'}</p>
          ) : (
            <div className="ops-table" role="region" aria-label="Organisations" tabIndex={0}>
              <table className="op-table ops-left">
                <thead>
                  <tr>
                    <th scope="col">Organisation</th>
                    <th scope="col">Status</th>
                    <th scope="col">Agents</th>
                    <th scope="col">Calls, 30 days</th>
                    <th scope="col">Succeeded</th>
                    <th scope="col">Needs attention</th>
                    <th scope="col">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => {
                    const u = usage.get(o.slug)
                    const agents = agentsOf(o.slug)
                    const flags = flagsOf(o.slug)
                    return (
                      <tr key={o.slug}>
                        <th scope="row">
                          <Link className="row__link" to={`/ops/orgs/${o.slug}`}>
                            {o.name}
                          </Link>
                          <span className="ops-cell-sub">
                            {BUSINESS_LABEL[o.businessType]} · {o.city} · {o.ownerEmail}
                          </span>
                        </th>
                        <td>
                          <span className={`status-chip status-chip--${o.status}`}>{STATUS_LABEL[o.status]}</span>
                        </td>
                        <td className="num">{overview ? `${agents.filter((a) => a.status === 'live').length} live of ${agents.length}` : '—'}</td>
                        <td className="num">{u ? num(u.calls) : '—'}</td>
                        <td className="num">{u ? pct(u.successRate, 1) : '—'}</td>
                        <td>
                          {flags.length === 0 ? (
                            <span className="ops-muted">{overview ? 'Nothing' : '—'}</span>
                          ) : (
                            <>
                              <StatusPill tone={flags.some((f) => f.tone === 'danger') ? 'danger' : 'warn'}>
                                {flags.length} {flags.length === 1 ? 'thing' : 'things'}
                              </StatusPill>
                              <span className="ops-cell-sub">{flags.map((f) => f.reason).join(' ')}</span>
                            </>
                          )}
                        </td>
                        <td>{shortDate(o.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {overview && ops.isDemo && <p className="row__meta">Calls, agents and attention flags are demo data until the Ops API exists.</p>}
        </>
      )}
    </OpsLayout>
  )
}
