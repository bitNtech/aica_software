import { useCallback, useId, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError } from '../../auth/types'
import { SegFilter } from '../../components/console/ListTools'
import { StatusPill, type Tone } from '../../components/console/StatusPill'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import { useAsync } from '../../lib/useAsync'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { Deployment, DeploymentComponent } from '../../ops/types'
import { when } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'

type Filter = 'all' | 'agents' | 'platform'
const COMPONENT: Record<DeploymentComponent, string> = { agent: 'Agent', app: 'Web app', speech: 'ASR', language: 'LLM', voice: 'TTS', telephony: 'Telephony' }
const STATUS: Record<Deployment['status'], { tone: Tone; label: string }> = {
  live: { tone: 'ok', label: 'Live' },
  superseded: { tone: 'neutral', label: 'Replaced' },
  rolled_back: { tone: 'warn', label: 'Rolled back' },
  failed: { tone: 'danger', label: 'Failed' },
}

/** /ops/deployments: what was released, when and by whom: agent versions across organisations, and platform releases. */
export default function OpsDeploymentsPage() {
  const ops = useOpsData()
  const { user } = useAuth()
  const isMaster = user?.platformRole === 'master_admin'
  const id = useId()
  const load = useCallback(() => ops.listDeployments(), [ops])
  const [list, reload] = useAsync(load)
  const [filter, setFilter] = useState<Filter>('all')
  const [org, setOrg] = useState('')
  const all = list.state === 'ready' ? list.data : []
  const orgs = [...new Map(all.filter((d) => d.orgSlug).map((d) => [d.orgSlug!, d.orgName!])).entries()]
  const shown = all.filter((d) => (filter === 'all' ? true : filter === 'agents' ? d.component === 'agent' : d.component !== 'agent')).filter((d) => !org || d.orgSlug === org)
  const liveAgents = all.filter((d) => d.component === 'agent' && d.status === 'live')

  return (
    <OpsLayout
      kicker="Deployments"
      docTitle="Deployments"
      title="Deployments"
      demoData={ops.isDemo}
      lede={<p>Every agent version published to an organisation, and every platform release. {isMaster ? 'To roll an agent back, open its versions.' : 'Only the master admin publishes or rolls back.'}</p>}
    >
      {list.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading deployments…</span>
        </div>
      )}
      {list.state === 'error' && (
        <Alert tone="error" title="Couldn't load deployments">
          <p>{asAuthError(list.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {list.state === 'ready' && (
        <>
          <dl className="kpis ops-gap-b">
            <div className="kpi">
              <dt className="kpi__label">Agents live</dt>
              <dd className="kpi__value num">{liveAgents.length}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Published in the last 7 days</dt>
              <dd className="kpi__value num">{all.filter((d) => d.component === 'agent' && Date.now() - Date.parse(d.at) < 7 * 864e5).length}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Platform releases, 30 days</dt>
              <dd className="kpi__value num">{all.filter((d) => d.component !== 'agent' && Date.now() - Date.parse(d.at) < 30 * 864e5).length}</dd>
            </div>
          </dl>
          <div className="list-tools">
            <SegFilter<Filter>
              legend="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: all.length },
                { value: 'agents', label: 'Agent versions', count: all.filter((d) => d.component === 'agent').length },
                { value: 'platform', label: 'Platform', count: all.filter((d) => d.component !== 'agent').length },
              ]}
            />
            {filter !== 'platform' && (
              <div className="field ops-orgselect">
                <label className="field__label" htmlFor={`${id}-org`}>
                  Organisation
                </label>
                <select id={`${id}-org`} className="field__input" value={org} onChange={(e) => setOrg(e.target.value)}>
                  <option value="">Every organisation</option>
                  {orgs.map(([slug, name]) => (
                    <option key={slug} value={slug}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="empty-note">Nothing deployed yet.</p>
          ) : (
            <div className="ops-table" role="region" aria-label="Deployments" tabIndex={0}>
              <table className="op-table ops-left">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">What</th>
                    <th scope="col">Where</th>
                    <th scope="col">By</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.id}>
                      <th scope="row">{when(d.at)}</th>
                      <td>
                        {d.component === 'agent' && isMaster ? (
                          <Link className="row__link" to={`/ops/orgs/${d.orgSlug}/agents/${d.agentId}/versions`}>
                            {d.title}
                          </Link>
                        ) : (
                          d.title
                        )}
                        {d.note && <span className="ops-cell-sub">{d.note}</span>}
                      </td>
                      <td>{d.component === 'agent' ? d.orgName : `Platform · ${COMPONENT[d.component]}`}</td>
                      <td>{d.by}</td>
                      <td>
                        <StatusPill tone={STATUS[d.status].tone}>{STATUS[d.status].label}</StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </OpsLayout>
  )
}
