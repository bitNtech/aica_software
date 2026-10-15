import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { STATUS_LABEL } from '../../auth/roles'
import { asAuthError } from '../../auth/types'
import { ColumnChart, type Series } from '../../components/charts/Charts'
import { SegFilter } from '../../components/console/ListTools'
import { StatTile } from '../../components/console/StatTile'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { UsageDays, UsageReport } from '../../ops/types'
import '../console/operate/Operate.css'
import './Ops.css'

const DAYS_LABEL: Record<UsageDays, string> = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' }
const shortDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const longDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
const num = (n: number) => n.toLocaleString('en-IN')

/** /ops/usage: calls, minutes and processing per organisation. Staff and master admin. */
export default function OpsUsagePage() {
  const ops = useOpsData()
  const id = useId()
  const [days, setDays] = useState<UsageDays>(30)
  const [report, setReport] = useState<UsageReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    ops.getUsage(days).then(
      (r) => {
        if (!live) return
        setReport(r)
        setLoading(false)
      },
      (err) => {
        if (!live) return
        setError(err)
        setLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [ops, days, tick])

  const period = `the ${days} days before`
  // Up to three organisations in the chart, by minutes; any others together.
  const series: Series[] = report
    ? report.orgs.slice(0, 3).map((o, i) => ({ key: o.slug, label: o.name, slot: (i + 1) as 1 | 2 | 3, values: o.minutesByDay }))
    : []

  return (
    <OpsLayout kicker="Usage" docTitle="Usage" title="Usage" demoData lede={<p>Calls, call minutes and recordings processed, for each organisation. Times are days in India.</p>}>
      <div className="list-tools">
        <SegFilter<`${UsageDays}`> legend="Period" value={`${days}`} onChange={(v) => setDays(Number(v) as UsageDays)} options={([7, 30, 90] as UsageDays[]).map((d) => ({ value: `${d}`, label: DAYS_LABEL[d] }))} />
      </div>
      {error ? (
        <Alert tone="error" title="Couldn't load usage">
          <p>{asAuthError(error).message}</p>
          <button type="button" className="btn-text" onClick={() => setTick((t) => t + 1)}>
            Try again
          </button>
        </Alert>
      ) : !report ? (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading usage…</span>
        </div>
      ) : (
        <div className={loading ? 'op-report is-loading' : 'op-report'} aria-busy={loading || undefined}>
          <h2 className="ops-section__title ops-usage__period">{DAYS_LABEL[days]}</h2>
          <dl className="stats ops-stats">
            <StatTile label="Calls" value={num(report.totals.calls)} change={{ now: report.totals.calls, before: report.previous.calls, period, upIsGood: true }} />
            <StatTile label="Call minutes" value={num(report.totals.minutes)} change={{ now: report.totals.minutes, before: report.previous.minutes, period, upIsGood: true }} />
            <StatTile
              label="Recordings processed"
              value={`${report.totals.uploadHours} h`}
              change={{ now: report.totals.uploadHours, before: report.previous.uploadHours, period, upIsGood: true, format: (n) => `${Math.round(n * 10) / 10} h` }}
            />
          </dl>

          <section className="ops-section" aria-labelledby={`${id}-chart`}>
            <div className="ops-section__head">
              <h2 id={`${id}-chart`} className="ops-section__title">
                Call minutes each day
              </h2>
            </div>
            <ColumnChart
              title="Call minutes each day, by organisation"
              categories={report.days.map(shortDay)}
              categoryName={(i) => longDay(report.days[i])}
              series={series}
              valueName="minutes"
              labelStep={days === 7 ? 1 : days === 30 ? 5 : 15}
            />
          </section>

          <section className="ops-section" aria-labelledby={`${id}-orgs`}>
            <div className="ops-section__head">
              <h2 id={`${id}-orgs`} className="ops-section__title">
                By organisation
              </h2>
              <p className="ops-section__note">Most minutes first</p>
            </div>
            <div className="ops-table" role="region" aria-labelledby={`${id}-orgs`} tabIndex={0}>
              <table className="op-table">
                <thead>
                  <tr>
                    <th scope="col">Organisation</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Calls</th>
                    <th scope="col">Minutes</th>
                    <th scope="col">
                      Of plan <span className="sr-only">minutes for the period</span>
                    </th>
                    <th scope="col">Recordings</th>
                  </tr>
                </thead>
                <tbody>
                  {report.orgs.map((o) => {
                    // The plan's monthly minutes, for the same number of days.
                    const allowance = (o.planMinutes * days) / 30
                    return (
                      <tr key={o.slug}>
                        <th scope="row">
                          <Link className="link" to={`/ops/orgs/${o.slug}`}>
                            {o.name}
                          </Link>
                          {o.status !== 'active' && <span className="ops-muted"> ({STATUS_LABEL[o.status].toLowerCase()})</span>}
                        </th>
                        <td>{o.plan}</td>
                        <td>{num(o.calls)}</td>
                        <td>{num(o.minutes)}</td>
                        <td className={o.minutes > allowance ? 'ops-over' : undefined}>
                          {Math.round((o.minutes / allowance) * 100)}%{o.minutes > allowance && ' (over)'}
                        </td>
                        <td>{o.uploadHours} h</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="row__meta">“Of plan” compares minutes with the plan’s monthly minutes, scaled to the period. Organisations still in review aren’t listed.</p>
          </section>
        </div>
      )}
    </OpsLayout>
  )
}
