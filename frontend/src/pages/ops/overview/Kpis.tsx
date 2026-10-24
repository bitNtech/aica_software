import type { OrgSummary } from '../../../auth/types'
import { KpiCard, KpiGrid } from '../../../components/console/KpiCard'
import { Skeleton } from '../../../components/console/Skeleton'
import type { LiveOps, OverviewDays, PlatformOverview } from '../../../ops/types'
import { num, pct, plural } from './bits'

export const PERIOD_LABEL: Record<OverviewDays, string> = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days' }
export const PREVIOUS_LABEL: Record<OverviewDays, string> = { 1: 'yesterday by this time', 7: 'the 7 days before', 30: 'the 30 days before' }

/** Shown before a source has answered: the label, and a placeholder figure. */
function Waiting({ label }: { label: string }) {
  return (
    <div className="kpi">
      <dt className="kpi__label">{label}</dt>
      <dd className="kpi__value">
        <Skeleton width="3.5rem" height="1.5rem" />
      </dd>
    </div>
  )
}

/** The eight headline figures. Each says where it can't be measured rather than showing 0. */
export function Kpis({
  orgs,
  orgsFailed,
  overview,
  overviewFailed,
  live,
  liveFailed,
}: {
  orgs: OrgSummary[] | null
  orgsFailed: boolean
  overview: PlatformOverview | null
  overviewFailed: boolean
  live: LiveOps | null
  liveFailed: boolean
}) {
  const failed = 'Couldn’t load'
  const count = (s: OrgSummary['status']) => orgs?.filter((o) => o.status === s).length ?? 0
  const oldestPending = orgs
    ?.filter((o) => o.status === 'pending_review')
    .map((o) => o.createdAt)
    .sort()[0]
  const waitingDays = oldestPending ? Math.floor((Date.now() - Date.parse(oldestPending)) / 864e5) : 0

  const agents = overview?.agents ?? []
  const published = agents.filter((a) => a.status === 'live')
  const answering = published.filter((a) => !a.orgSuspended)
  const agentOrgs = new Set(agents.map((a) => a.orgSlug)).size

  const rate = (o: PlatformOverview) => (o.totals.calls ? o.totals.succeeded / o.totals.calls : null)
  const prevRate = (o: PlatformOverview) => (o.previous.calls ? o.previous.succeeded / o.previous.calls : null)
  const rateByBucket = overview ? overview.succeeded.map((s, i) => (s + overview.failed[i] ? (s / (s + overview.failed[i])) * 100 : NaN)) : []

  return (
    <KpiGrid label="Headline figures">
      {orgs ? (
        <>
          <KpiCard label="Organisations" value={num(orgs.length)} sub={count('declined') ? `${count('declined')} declined` : 'Every sign-up so far'} />
          <KpiCard label="Active organisations" value={num(count('active'))} sub={orgs.length ? `${pct(count('active') / orgs.length)} of all · ${count('suspended')} suspended` : undefined} />
          <KpiCard
            label="Pending sign-ups"
            value={num(count('pending_review'))}
            sub={count('pending_review') ? (waitingDays ? `Oldest waiting ${plural(waitingDays, 'day')}` : 'Oldest arrived today') : 'Nothing to review'}
          />
        </>
      ) : orgsFailed ? (
        ['Organisations', 'Active organisations', 'Pending sign-ups'].map((l) => <KpiCard key={l} label={l} value={null} notMeasured={failed} />)
      ) : (
        ['Organisations', 'Active organisations', 'Pending sign-ups'].map((l) => <Waiting key={l} label={l} />)
      )}

      {overview ? (
        <>
          <KpiCard label="AI agents" value={num(agents.length)} sub={`Across ${plural(agentOrgs, 'organisation')}, drafts included`} />
          <KpiCard label="Published agents" value={num(published.length)} sub={`${num(answering.length)} answering calls now`} />
          <KpiCard
            label="Calls today"
            value={num(overview.today.calls)}
            change={{ now: overview.today.calls, before: overview.today.yesterdaySoFar, period: 'yesterday by this time', upIsGood: true }}
            series={overview.today.byHour}
            seriesLabel="Calls each hour today"
          />
          <KpiCard
            label={`Call success rate, ${PERIOD_LABEL[overview.days].toLowerCase()}`}
            value={rate(overview) === null ? null : pct(rate(overview), 1)}
            notMeasured="No calls in this period"
            sub="Not dropped and no technical failure"
            change={
              rate(overview) !== null && prevRate(overview) !== null
                ? {
                    now: Math.round(rate(overview)! * 1000) / 10,
                    before: Math.round(prevRate(overview)! * 1000) / 10,
                    period: PREVIOUS_LABEL[overview.days],
                    upIsGood: true,
                    format: (n) => `${n.toFixed(1)} points`,
                    words: ['higher', 'lower'],
                  }
                : undefined
            }
            series={rateByBucket}
            seriesLabel="Success rate per period, percent"
            seriesFormat={(n) => `${n.toFixed(1)}%`}
          />
        </>
      ) : (
        ['AI agents', 'Published agents', 'Calls today', 'Call success rate'].map((l) => (overviewFailed ? <KpiCard key={l} label={l} value={null} notMeasured={failed} /> : <Waiting key={l} label={l} />))
      )}

      {live ? (
        <KpiCard
          label="Active calls"
          value={num(live.calls.length)}
          sub={
            live.handoffs.length
              ? `${plural(live.handoffs.length, 'caller')} waiting for a person`
              : live.calls.some((c) => c.flagged)
                ? `${plural(live.calls.filter((c) => c.flagged).length, 'caller')} may need a person`
                : 'No one waiting for a person'
          }
        />
      ) : liveFailed ? (
        <KpiCard label="Active calls" value={null} notMeasured={failed} />
      ) : (
        <Waiting label="Active calls" />
      )}
    </KpiGrid>
  )
}
