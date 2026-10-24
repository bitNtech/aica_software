import { Link } from 'react-router'
import { StatusPill } from '../../../components/console/StatusPill'
import { WaitTimer } from '../../../components/console/WaitTimer'
import { useNow } from '../../../lib/useNow'
import type { LiveOps } from '../../../ops/types'
import { Panel, PanelState, plural, since, when } from './bits'

const FAILURES_SHOWN = 8

/**
 * Calls in progress, callers waiting for a person, and what failed lately,
 * across every organisation. No transcripts or caller numbers: only what
 * staff need to see that the platform is coping.
 */
export function LiveOperations({ live, error, reload, demo }: { live: LiveOps | null; error: unknown; reload(): void; demo: boolean }) {
  const now = useNow(15_000)
  if (!live)
    return (
      <div className="ov-grid ov-grid--3">
        {['Calls in progress', 'Waiting for a person', 'Recent call failures'].map((t) => (
          <Panel key={t} title={t} demo={demo}>
            <PanelState error={error} onRetry={reload} />
          </Panel>
        ))}
      </div>
    )

  const failures = live.failures.slice(0, FAILURES_SHOWN)
  return (
    <div className="ov-grid ov-grid--3">
      <Panel title="Calls in progress" demo={demo} note={plural(live.calls.length, 'call')}>
        {live.calls.length === 0 ? (
          <p className="ov-empty">No calls in progress.</p>
        ) : (
          <ul className="ov-list">
            {live.calls.map((c) => (
              <li key={c.id} className="ov-item">
                <div className="ov-item__main">
                  <span className="ov-item__title">
                    {c.agentName} <span className="ov-muted">· {c.orgName}</span>
                  </span>
                  <span className="ov-item__meta">
                    {c.intent ?? 'Finding out what the caller wants'} · for {since(c.startedAt, now)}
                  </span>
                </div>
                {c.takenBy ? <StatusPill tone="info">With {c.takenBy}</StatusPill> : c.flagged ? <StatusPill tone="warn">May need a person</StatusPill> : <StatusPill tone="live">Agent</StatusPill>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Waiting for a person" demo={demo} note="Emergencies, then longest waiting">
        {live.handoffs.length === 0 ? (
          <p className="ov-empty">No one is waiting for a person.</p>
        ) : (
          <ul className="ov-list">
            {live.handoffs.map((h) => (
              <li key={`${h.orgSlug}-${h.id}`} className={`ov-item${h.emergency ? ' ov-item--critical' : ''}`}>
                <div className="ov-item__main">
                  <span className="ov-item__title">
                    {h.emergency && <StatusPill tone="danger">Emergency</StatusPill>} {h.orgName}
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
        <p className="ov-foot">The organisation’s own team takes these, from its Live calls page.</p>
      </Panel>

      <Panel title="Recent call failures" demo={demo} note="Last 2 hours" action={<Link to="/ops/status">Service status</Link>}>
        {failures.length === 0 ? (
          <p className="ov-empty">No failures in the last 2 hours.</p>
        ) : (
          <ul className="ov-list">
            {failures.map((f) => (
              <li key={f.id} className="ov-item">
                <div className="ov-item__main">
                  <span className="ov-item__title">{f.what}</span>
                  <span className="ov-item__meta">
                    {f.service} · {f.org} · {when(f.at, now)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {live.failures.length > FAILURES_SHOWN && <p className="ov-foot">{plural(live.failures.length - FAILURES_SHOWN, 'more failure')} in the last 2 hours.</p>}
      </Panel>
    </div>
  )
}
