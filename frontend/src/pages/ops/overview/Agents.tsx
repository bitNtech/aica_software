import { Link } from 'react-router'
import { StatusPill } from '../../../components/console/StatusPill'
import { useNow } from '../../../lib/useNow'
import type { OverviewAgent, PlatformOverview } from '../../../ops/types'
import { AGENT_HEALTH } from './Analytics'
import { num, Panel, PanelState, since } from './bits'

const RECENT = 5

/** Where an agent opens in the organisation drill-down. */
const agentHref = (a: OverviewAgent) => (a.status === 'draft' ? `/ops/orgs/${a.orgSlug}/agents/drafts/${a.id}` : `/ops/orgs/${a.orgSlug}/agents/${a.id}`)

/** Published, draft or inactive: an agent is inactive when paused, or when its organisation is suspended (the line under it says which). */
function stateOf(a: OverviewAgent): { tone: 'ok' | 'neutral' | 'warn'; label: string } {
  if (a.status === 'draft') return { tone: 'neutral', label: 'Draft' }
  if (a.orgSuspended || a.status === 'paused') return { tone: 'warn', label: 'Inactive' }
  return { tone: 'ok', label: `Published${a.version ? `, v${a.version}` : ''}` }
}

export function Agents({ overview, error, reload, demo }: { overview: PlatformOverview | null; error: unknown; reload(): void; demo: boolean }) {
  const now = useNow(60_000)
  if (!overview)
    return (
      <div className="ov-grid ov-grid--3">
        {['By status', 'Errors or slow replies', 'Recently updated'].map((t) => (
          <Panel key={t} title={t} demo={demo}>
            <PanelState error={error} onRetry={reload} />
          </Panel>
        ))}
      </div>
    )

  const agents = overview.agents
  const published = agents.filter((a) => a.status === 'live' && !a.orgSuspended).length
  const drafts = agents.filter((a) => a.status === 'draft').length
  const inactive = agents.length - published - drafts
  const flagged = agents.filter((a) => a.health !== 'ok').sort((a, b) => (a.health === b.health ? 0 : a.health === 'errors' ? -1 : 1))
  const recent = [...agents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENT)

  return (
    <div className="ov-grid ov-grid--3">
      <Panel title="By status" demo={demo}>
        <dl className="ov-counts">
          <div className="ov-counts__item">
            <dt>Published</dt>
            <dd className="num">{num(published)}</dd>
            <dd className="ov-muted">answering calls</dd>
          </div>
          <div className="ov-counts__item">
            <dt>Draft</dt>
            <dd className="num">{num(drafts)}</dd>
            <dd className="ov-muted">being built</dd>
          </div>
          <div className="ov-counts__item">
            <dt>Inactive</dt>
            <dd className="num">{num(inactive)}</dd>
            <dd className="ov-muted">paused, or organisation suspended</dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Errors or slow replies" demo={demo} note="Judged on the last 7 days">
        {flagged.length === 0 ? (
          <p className="ov-empty">Every agent is healthy.</p>
        ) : (
          <ul className="ov-list">
            {flagged.map((a) => (
              <li key={`${a.orgSlug}/${a.id}`} className={`ov-item${a.health === 'errors' ? ' ov-item--critical' : ''}`}>
                <div className="ov-item__main">
                  <span className="ov-item__title">
                    <StatusPill tone={AGENT_HEALTH[a.health].tone}>{AGENT_HEALTH[a.health].label}</StatusPill>{' '}
                    <Link className="row__link" to={agentHref(a)} aria-label={`${a.name}, ${a.orgName}`}>
                      {a.name}
                    </Link>{' '}
                    <span className="ov-muted">· {a.orgName}</span>
                  </span>
                  <span className="ov-item__meta">{a.issue}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Recently updated" demo={demo} note="Newest first">
        {recent.length === 0 ? (
          <p className="ov-empty">No agents yet.</p>
        ) : (
          <ul className="ov-list">
            {recent.map((a) => {
              const s = stateOf(a)
              return (
                <li key={`${a.orgSlug}/${a.id}`} className="ov-item">
                  <div className="ov-item__main">
                    <span className="ov-item__title">
                      <Link className="row__link" to={agentHref(a)} aria-label={`${a.name}, ${a.orgName}`}>
                        {a.name}
                      </Link>{' '}
                      <span className="ov-muted">· {a.orgName}</span>
                    </span>
                    <span className="ov-item__meta">
                      Changed {since(a.updatedAt, now)} ago{a.orgSuspended ? ' · organisation suspended' : a.status === 'paused' ? ' · paused' : ''}
                    </span>
                  </div>
                  <StatusPill tone={s.tone}>{s.label}</StatusPill>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
