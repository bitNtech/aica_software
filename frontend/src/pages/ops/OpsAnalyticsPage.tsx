import { useEffect, useState } from 'react'
import { SegFilter } from '../../components/console/ListTools'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Button } from '../../components/ui/Button'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { OverviewDays, PlatformOverview } from '../../ops/types'
import { UsageReportView } from './OpsUsagePage'
import { Analytics } from './overview/Analytics'
import { Group } from './overview/bits'
import { PERIOD_LABEL } from './overview/Kpis'
import '../console/operate/Operate.css'
import './Ops.css'
import './overview/Overview.css'

/** Quotes a CSV cell when it needs it. */
const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The period's figures as a CSV: calls per period, by organisation, by agent. */
function downloadCsv(o: PlatformOverview) {
  const rows: unknown[][] = [
    ['Period', PERIOD_LABEL[o.days]],
    [],
    ['When', 'Succeeded', 'Dropped or failed', 'Typical reply (ms)', 'Slowest 1 in 20 (ms)'],
    ...o.buckets.map((b, i) => [b.name, o.succeeded[i], o.failed[i], o.replyP50ByBucket[i], o.replyP95ByBucket[i]]),
    [],
    ['Organisation', 'Status', 'Calls', 'Minutes', 'Success rate', 'Handoff rate'],
    ...o.orgs.map((x) => [x.name, x.status, x.calls, x.minutes, x.successRate, x.handoffRate]),
    [],
    ['Agent', 'Organisation', 'Status', 'Calls', 'Success rate', 'Handoff rate', 'Slowest 1 in 20 (ms)', 'Health'],
    ...o.agents.map((a) => [a.name, a.orgName, a.status, a.calls, a.successRate, a.handoffRate, a.replyP95Ms, a.health]),
  ]
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `aica-platform-${o.days}d.csv`
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/** /ops/analytics: how calls and agents are doing across the platform, and usage against plans. */
export default function OpsAnalyticsPage() {
  const ops = useOpsData()
  const [days, setDays] = useState<OverviewDays>(7)
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    setError(null)
    ops.getOverview(days).then(
      (o) => live && setOverview(o),
      (e) => live && setError(e),
    )
    return () => {
      live = false
    }
  }, [ops, days, tick])

  return (
    <OpsLayout kicker="Analytics" docTitle="Analytics and reports" title="Analytics and reports" demoData={ops.isDemo} lede={<p>Calls, outcomes, reply times and agents across every organisation, and each organisation’s minutes against its plan.</p>}>
      <div className="ov">
        <Group id="an-calls" title="Calls and agents">
          <div className="ov-toolbar">
            <SegFilter<`${OverviewDays}`>
              legend="Period"
              value={`${days}`}
              onChange={(v) => setDays(Number(v) as OverviewDays)}
              options={([1, 7, 30] as OverviewDays[]).map((d) => ({ value: `${d}`, label: PERIOD_LABEL[d] }))}
            />
            <Button variant="line" size="sm" disabled={!overview || overview.days !== days} onClick={() => overview && downloadCsv(overview)}>
              Download CSV
            </Button>
          </div>
          <Analytics overview={overview?.days === days ? overview : null} error={error} reload={() => setTick((t) => t + 1)} demo={false} />
        </Group>
        <Group id="an-usage" title="Minutes and plan usage">
          <UsageReportView />
        </Group>
      </div>
    </OpsLayout>
  )
}
