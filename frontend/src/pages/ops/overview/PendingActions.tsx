import { Link } from 'react-router'
import { BUSINESS_LABEL } from '../../../auth/roles'
import type { OrgSummary } from '../../../auth/types'
import { StatusPill } from '../../../components/console/StatusPill'
import { useNow } from '../../../lib/useNow'
import type { LiveOps, PlatformOverview } from '../../../ops/types'
import { Panel, PanelState, since, when } from './bits'

/**
 * What's waiting on bitNtech: sign-ups to decide, organisations to look at,
 * and alerts. Worst first in each; each item links to where it's dealt with.
 */
export function PendingActions({
  orgs,
  orgsError,
  reloadOrgs,
  overview,
  overviewError,
  reloadOverview,
  live,
  liveError,
  reloadLive,
  demo,
}: {
  orgs: OrgSummary[] | null
  orgsError: unknown
  reloadOrgs(): void
  overview: PlatformOverview | null
  overviewError: unknown
  reloadOverview(): void
  live: LiveOps | null
  liveError: unknown
  reloadLive(): void
  demo: boolean
}) {
  const now = useNow(60_000)
  const pending = (orgs ?? []).filter((o) => o.status === 'pending_review').sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return (
    <div className="ov-grid ov-grid--3">
      <Panel title="Sign-ups awaiting approval" note="Oldest first" action={<Link to="/ops/requests">All requests</Link>}>
        {!orgs ? (
          <PanelState error={orgsError} onRetry={reloadOrgs} height="5rem" />
        ) : pending.length === 0 ? (
          <p className="ov-empty">No sign-ups waiting.</p>
        ) : (
          <ul className="ov-list">
            {pending.map((o) => (
              <li key={o.slug} className="ov-item">
                <div className="ov-item__main">
                  <span className="ov-item__title">{o.name}</span>
                  <span className="ov-item__meta">
                    {BUSINESS_LABEL[o.businessType]} in {o.city} · waiting {since(o.createdAt, now)}
                  </span>
                </div>
                <Link className="btn btn--line btn--sm" to="/ops/requests" aria-label={`Review the sign-up from ${o.name}`}>
                  <span>Review</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Organisations needing attention" demo={demo} note="Most serious first">
        {!overview ? (
          <PanelState error={overviewError} onRetry={reloadOverview} height="5rem" />
        ) : overview.attention.length === 0 ? (
          <p className="ov-empty">Every organisation looks fine.</p>
        ) : (
          <ul className="ov-list">
            {overview.attention.map((a, i) => (
              <li key={`${a.slug}-${i}`} className="ov-item">
                <div className="ov-item__main">
                  <span className="ov-item__title">
                    <StatusPill tone={a.tone}>{a.tone === 'danger' ? 'Act now' : 'Check'}</StatusPill> {a.name}
                  </span>
                  <span className="ov-item__meta">{a.reason}</span>
                </div>
                <Link className="btn btn--line btn--sm" to={`/ops/orgs/${a.slug}`} aria-label={`Open ${a.name}: ${a.reason}`}>
                  <span>Open</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Critical alerts" demo={demo} note="Agents and platform, now">
        {!live ? (
          <PanelState error={liveError} onRetry={reloadLive} height="5rem" />
        ) : live.alerts.length === 0 ? (
          <p className="ov-empty">No alerts. Every service is working.</p>
        ) : (
          <ul className="ov-list">
            {live.alerts.map((a) => (
              <li key={a.id} className={`ov-item ov-item--${a.severity}`}>
                <div className="ov-item__main">
                  <span className="ov-item__title">
                    <StatusPill tone={a.severity === 'critical' ? 'danger' : 'warn'}>{a.severity === 'critical' ? 'Critical' : 'Warning'}</StatusPill> {a.title}
                  </span>
                  <span className="ov-item__meta">
                    {a.detail} · since {when(a.at, now)}
                  </span>
                </div>
                {a.href && (
                  <Link className="btn btn--line btn--sm" to={a.href} aria-label={`Look into: ${a.title}`}>
                    <span>Look</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
