import { useId, useState } from 'react'
import { Link } from 'react-router'
import { asAuthError, type OrgSummary } from '../../auth/types'
import { SegFilter } from '../../components/console/ListTools'
import { StatusPill } from '../../components/console/StatusPill'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import type { ConsoleClient } from '../../console/types'
import { OrgFailures, OrgSelect, useAcrossOrgs } from './acrossOrgs'
import { num, since } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'

const load = async (c: ConsoleClient, o: OrgSummary) => {
  const [tools, numbers, agents, credentials] = await Promise.all([
    c.listTools(o.slug),
    c.listNumbers(o.slug),
    c.listAgents(o.slug),
    // Secret names only; values never reach the browser. Staff may not see them.
    c.listCredentials(o.slug).catch(() => null),
  ])
  return { tools, numbers, agents, credentials }
}
type View = 'tools' | 'numbers'
/** A tool not tested for this long is worth testing again. */
const STALE_DAYS = 30

/** /ops/integrations: every organisation's tools (HTTP and built-in) and phone lines. */
export default function OpsIntegrationsPage() {
  const id = useId()
  const across = useAcrossOrgs(load)
  const [view, setView] = useState<View>('tools')
  const [org, setOrg] = useState('')
  const rows = (across.results ?? []).filter((r) => !org || r.org.slug === org)
  const tools = rows.flatMap((r) =>
    (r.data?.tools ?? []).map((t) => ({ ...t, org: r.org, secretSet: !t.credentialName || !r.data?.credentials || r.data.credentials.some((c) => c.name === t.credentialName), secretsKnown: !!r.data?.credentials })),
  )
  const numbers = rows.flatMap((r) => (r.data?.numbers ?? []).map((n) => ({ ...n, org: r.org, agent: r.data?.agents.find((a) => a.id === n.agentId) ?? null })))
  const stale = (at?: string | null) => !at || Date.now() - Date.parse(at) > STALE_DAYS * 864e5
  const problems = tools.filter((t) => t.kind === 'http' && t.enabled && (!t.secretSet || stale(t.lastTestedAt))).length

  return (
    <OpsLayout
      kicker="Integrations"
      docTitle="Integrations"
      title="Integrations"
      lede={<p>The tools agents call (booking systems, lookups, messages) and the phone lines they answer, across organisations. Open an organisation to add, test or change them.</p>}
    >
      <div className="list-tools">
        <SegFilter<View>
          legend="Show"
          value={view}
          onChange={setView}
          options={[
            { value: 'tools', label: 'Tools', count: tools.length },
            { value: 'numbers', label: 'Phone lines', count: numbers.length },
          ]}
        />
        {across.results && <OrgSelect id={`${id}-org`} orgs={across.results.map((r) => r.org)} value={org} onChange={setOrg} />}
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
          <span>Loading integrations…</span>
        </div>
      ) : (
        <>
          <OrgFailures results={across.results} onRetry={across.reload} />
          {view === 'tools' && (
            <>
              <p className="row__meta" role="status">
                {num(tools.length)} tools. {problems ? `${problems} need attention: a missing secret, or not tested in ${STALE_DAYS} days.` : 'None need attention.'}
              </p>
              {tools.length === 0 ? (
                <p className="empty-note">No tools set up.</p>
              ) : (
                <div className="ops-table" role="region" aria-label="Tools" tabIndex={0}>
                  <table className="op-table ops-left">
                    <thead>
                      <tr>
                        <th scope="col">Tool</th>
                        <th scope="col">Organisation</th>
                        <th scope="col">Kind</th>
                        <th scope="col">State</th>
                        <th scope="col">Last tested</th>
                        <th scope="col">Used by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tools.map((t) => (
                        <tr key={`${t.org.slug}/${t.id}`}>
                          <th scope="row">
                            {t.name}
                            <span className="ops-cell-sub">{t.description}</span>
                          </th>
                          <td>
                            <Link className="row__link" to={`/ops/orgs/${t.org.slug}/integrations`}>
                              {t.org.name}
                            </Link>
                          </td>
                          <td>{t.kind === 'http' ? `${t.method ?? 'GET'} request${t.acts ? ', changes things' : ''}` : 'Built in'}</td>
                          <td>
                            {!t.enabled ? (
                              <StatusPill tone="neutral">Off</StatusPill>
                            ) : !t.secretSet ? (
                              <StatusPill tone="danger">Secret missing</StatusPill>
                            ) : t.kind === 'http' && stale(t.lastTestedAt) ? (
                              <StatusPill tone="warn">Test again</StatusPill>
                            ) : (
                              <StatusPill tone="ok">On</StatusPill>
                            )}
                          </td>
                          <td>{t.kind === 'builtin' ? '—' : t.lastTestedAt ? `${since(t.lastTestedAt)} ago` : 'Never'}</td>
                          <td>{t.usedBy?.length ? t.usedBy.join(', ') : <span className="ops-muted">No agent</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {tools.some((t) => !t.secretsKnown) && <p className="row__meta">Secrets can be checked by the master admin only.</p>}
            </>
          )}
          {view === 'numbers' &&
            (numbers.length === 0 ? (
              <p className="empty-note">No phone lines.</p>
            ) : (
              <div className="ops-table" role="region" aria-label="Phone lines" tabIndex={0}>
                <table className="op-table ops-left">
                  <thead>
                    <tr>
                      <th scope="col">Number</th>
                      <th scope="col">Organisation</th>
                      <th scope="col">Answered by</th>
                      <th scope="col">Hours</th>
                      <th scope="col">After hours</th>
                      <th scope="col">Handoffs go to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {numbers.map((n) => (
                      <tr key={`${n.org.slug}/${n.id}`}>
                        <th scope="row">
                          {n.number}
                          <span className="ops-cell-sub">{n.label}</span>
                        </th>
                        <td>
                          <Link className="row__link" to={`/ops/orgs/${n.org.slug}/numbers`}>
                            {n.org.name}
                          </Link>
                        </td>
                        <td>{n.agent ? `${n.agent.name}${n.agent.status !== 'live' ? ` (${n.agent.status})` : ''}` : <StatusPill tone="warn">No agent</StatusPill>}</td>
                        <td>{n.hours}</td>
                        <td>{n.afterHours === 'agent' ? 'The agent' : n.afterHours === 'voicemail' ? 'Voicemail' : 'Transfer'}</td>
                        <td>{n.transferTo ?? <span className="ops-muted">Not set</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </>
      )}
    </OpsLayout>
  )
}
