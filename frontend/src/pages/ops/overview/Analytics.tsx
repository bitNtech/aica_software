import { Link } from 'react-router'
import { BarList, ColumnChart } from '../../../components/charts/Charts'
import { computeDelta } from '../../../components/console/statDelta'
import { StatusPill } from '../../../components/console/StatusPill'
import type { AgentHealth, OverviewOutcome, PlatformOverview } from '../../../ops/types'
import { ms, num, Panel, PanelState, pct } from './bits'
import { PERIOD_LABEL, PREVIOUS_LABEL } from './Kpis'

const OUTCOME_LABEL: Record<OverviewOutcome, string> = {
  resolved: 'Answered by the agent',
  booked: 'Booked',
  callback: 'Callback arranged',
  handed_over: 'Handed to a person',
  emergency: 'Emergency, to a person',
  dropped: 'Caller hung up',
  failed: 'Technical failure',
}
const OUTCOME_ORDER: OverviewOutcome[] = ['resolved', 'booked', 'callback', 'handed_over', 'emergency', 'dropped', 'failed']

export const AGENT_HEALTH: Record<AgentHealth, { tone: 'ok' | 'warn' | 'danger'; label: string }> = {
  ok: { tone: 'ok', label: 'Healthy' },
  degraded: { tone: 'warn', label: 'Slow' },
  errors: { tone: 'danger', label: 'Errors' },
}

/** Every column label but the first, thinned to fit. */
const LABEL_STEP: Record<PlatformOverview['days'], number> = { 1: 3, 7: 1, 30: 5 }

export function Analytics({ overview, error, reload, demo }: { overview: PlatformOverview | null; error: unknown; reload(): void; demo: boolean }) {
  if (!overview)
    return (
      <div className="ov-grid">
        {['Call volume', 'Successful and failed calls', 'How calls ended', 'Reply time', 'Usage by organisation', 'Agent performance'].map((t) => (
          <Panel key={t} title={t} demo={demo}>
            <PanelState error={error} onRetry={reload} height="12rem" />
          </Panel>
        ))}
      </div>
    )

  const o = overview
  const period = PERIOD_LABEL[o.days]
  const categories = o.buckets.map((b) => b.label)
  const name = (i: number) => o.buckets[i]?.name ?? ''
  const total = o.totals.calls
  const handoffs = o.outcomes.handed_over + o.outcomes.emergency
  const failedTotal = o.outcomes.dropped + o.outcomes.failed
  const callsDelta = computeDelta({ now: total, before: o.previous.calls, period: PREVIOUS_LABEL[o.days], upIsGood: true })
  const slowDelta =
    o.totals.replyP95Ms !== null && o.previous.replyP95Ms !== null
      ? computeDelta({ now: o.totals.replyP95Ms, before: o.previous.replyP95Ms, period: PREVIOUS_LABEL[o.days], upIsGood: false, format: (n) => `${n} ms`, words: ['slower', 'faster'] })
      : null
  const agents = o.agents.filter((a) => a.calls > 0 || (a.status === 'live' && !a.orgSuspended)).sort((a, b) => b.calls - a.calls)
  const busiest = Math.max(...o.orgs.map((x) => x.calls), 1)

  return (
    <div className="ov-grid">
      <Panel title="Call volume" demo={demo} note={period}>
        <p className="ov-figure">
          <span className="ov-figure__num num">{num(total)}</span> calls
          <span className={`ov-delta ov-delta--${callsDelta.tone}`}>
            {callsDelta.arrow && <span aria-hidden="true">{callsDelta.arrow} </span>}
            {callsDelta.text}
          </span>
        </p>
        {total === 0 ? (
          <p className="ov-empty">No calls in this period.</p>
        ) : (
          <ColumnChart
            title={`Calls, ${period.toLowerCase()}, succeeded and failed`}
            categories={categories}
            categoryName={name}
            labelStep={LABEL_STEP[o.days]}
            height={200}
            series={[
              { key: 'ok', label: 'Succeeded', slot: 1, values: o.succeeded },
              { key: 'failed', label: 'Dropped or failed', slot: 2, values: o.failed },
            ]}
          />
        )}
      </Panel>

      <Panel title="Successful and failed calls" demo={demo} note={period}>
        {total === 0 ? (
          <p className="ov-empty">No calls in this period.</p>
        ) : (
          <>
            <div className="ov-split" aria-hidden="true">
              <span className="ov-split__ok" style={{ flexGrow: o.totals.succeeded }} />
              {o.outcomes.dropped > 0 && <span className="ov-split__dropped" style={{ flexGrow: o.outcomes.dropped }} />}
              {o.outcomes.failed > 0 && <span className="ov-split__failed" style={{ flexGrow: o.outcomes.failed }} />}
            </div>
            <dl className="ov-facts">
              <div>
                <dt>
                  <span className="ov-key ov-key--ok" aria-hidden="true" />
                  Succeeded
                </dt>
                <dd className="num">
                  {num(o.totals.succeeded)} <span className="ov-muted">({pct(o.totals.succeeded / total, 1)})</span>
                </dd>
              </div>
              <div>
                <dt>
                  <span className="ov-key ov-key--dropped" aria-hidden="true" />
                  Caller hung up first
                </dt>
                <dd className="num">
                  {num(o.outcomes.dropped)} <span className="ov-muted">({pct(o.outcomes.dropped / total, 1)})</span>
                </dd>
              </div>
              <div>
                <dt>
                  <span className="ov-key ov-key--failed" aria-hidden="true" />
                  Technical failure
                </dt>
                <dd className="num">
                  {num(o.outcomes.failed)} <span className="ov-muted">({pct(o.outcomes.failed / total, 1)})</span>
                </dd>
              </div>
              <div>
                <dt>Before ({PREVIOUS_LABEL[o.days]})</dt>
                <dd className="num">{o.previous.calls ? `${pct(o.previous.succeeded / o.previous.calls, 1)} succeeded` : 'No calls'}</dd>
              </div>
            </dl>
            <p className="ov-foot">
              {num(failedTotal)} of {num(total)} calls didn’t succeed. Technical failures are counted against AICA; hang-ups often aren’t.
            </p>
          </>
        )}
      </Panel>

      <Panel title="How calls ended" demo={demo} note={period}>
        {total === 0 ? (
          <p className="ov-empty">No calls in this period.</p>
        ) : (
          <>
            <p className="ov-figure">
              <span className="ov-figure__num num">{pct(handoffs / total, 1)}</span> handed to a person
              <span className="ov-muted"> · {num(handoffs)} calls, emergencies included</span>
            </p>
            <BarList
              label="How calls ended"
              showShare
              items={OUTCOME_ORDER.map((k) => ({ label: OUTCOME_LABEL[k], value: o.outcomes[k] }))}
            />
          </>
        )}
      </Panel>

      <Panel title="Reply time" demo={demo} note={`${period}, caller stops → agent starts`}>
        <dl className="ov-facts ov-facts--2">
          <div>
            <dt>Typical reply</dt>
            <dd className="ov-figure__num num">{ms(o.totals.replyP50Ms)}</dd>
          </div>
          <div>
            <dt>Slowest 1 in 20</dt>
            <dd className="ov-figure__num num">{ms(o.totals.replyP95Ms)}</dd>
            {slowDelta && (
              <dd className={`ov-delta ov-delta--${slowDelta.tone}`}>
                {slowDelta.arrow && <span aria-hidden="true">{slowDelta.arrow} </span>}
                {slowDelta.text}
              </dd>
            )}
          </div>
        </dl>
        {total > 0 && (
          <ColumnChart
            title={`Typical reply time, ${period.toLowerCase()}`}
            categories={categories}
            categoryName={name}
            labelStep={LABEL_STEP[o.days]}
            height={160}
            valueName="ms"
            series={[{ key: 'p50', label: 'Typical reply, ms', slot: 1, values: o.replyP50ByBucket.map((v) => v ?? 0) }]}
          />
        )}
      </Panel>

      <Panel title="Usage by organisation" wide demo={demo} note={`${period}, busiest first`} action={<Link to="/ops/analytics">Analytics</Link>}>
        {o.orgs.length === 0 ? (
          <p className="ov-empty">No active organisations yet.</p>
        ) : (
          <div className="ops-table" role="region" aria-label="Usage by organisation" tabIndex={0}>
            <table className="op-table ops-left ov-table">
              <thead>
                <tr>
                  <th scope="col">Organisation</th>
                  <th scope="col" className="ov-num">
                    Calls
                  </th>
                  <th scope="col" className="ov-num">
                    Minutes
                  </th>
                  <th scope="col" className="ov-num">
                    Succeeded
                  </th>
                  <th scope="col" className="ov-num">
                    To a person
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.orgs.map((x) => (
                  <tr key={x.slug}>
                    <th scope="row">
                      <span className="ov-cell-name">{x.name}</span>
                      {x.status === 'suspended' && <span className="ov-muted"> · suspended</span>}
                      <span className="ov-bar" aria-hidden="true">
                        <span style={{ width: `${(x.calls / busiest) * 100}%` }} />
                      </span>
                    </th>
                    <td className="ov-num num">{num(x.calls)}</td>
                    <td className="ov-num num">{num(x.minutes)}</td>
                    <td className="ov-num num">{pct(x.successRate, 1)}</td>
                    <td className="ov-num num">{pct(x.handoffRate, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Agent performance" wide demo={demo} note={`${period}, busiest first`}>
        {agents.length === 0 ? (
          <p className="ov-empty">No published agents yet.</p>
        ) : (
          <div className="ops-table" role="region" aria-label="Agent performance" tabIndex={0}>
            <table className="op-table ops-left ov-table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col" className="ov-num">
                    Calls
                  </th>
                  <th scope="col" className="ov-num">
                    Succeeded
                  </th>
                  <th scope="col" className="ov-num">
                    To a person
                  </th>
                  <th scope="col" className="ov-num">
                    Slowest 1 in 20
                  </th>
                  <th scope="col">Health</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={`${a.orgSlug}/${a.id}`}>
                    <th scope="row">
                      <span className="ov-cell-name">{a.name}</span>
                      <span className="ov-cell-sub">{a.orgName}</span>
                    </th>
                    <td className="ov-num num">{num(a.calls)}</td>
                    <td className="ov-num num">{pct(a.successRate, 1)}</td>
                    <td className="ov-num num">{pct(a.handoffRate, 1)}</td>
                    <td className="ov-num num">{ms(a.replyP95Ms)}</td>
                    <td>
                      <StatusPill tone={AGENT_HEALTH[a.health].tone}>{AGENT_HEALTH[a.health].label}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
