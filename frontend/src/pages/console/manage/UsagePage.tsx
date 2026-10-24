import { useCallback, useId } from 'react'
import { Link } from 'react-router'
import { ROLE_LABEL } from '../../../auth/roles'
import { asAuthError } from '../../../auth/types'
import { ColumnChart } from '../../../components/charts/Charts'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { StatusPill } from '../../../components/console/StatusPill'
import { Alert } from '../../../components/ui/Alert'
import { Spinner } from '../../../components/ui/Spinner'
import { canOpen } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import { useOrg } from '../../../console/useOrg'
import { useAsync } from '../../../lib/useAsync'
import { shortDate } from '../../../lib/time'
import '../library/Library.css'
import '../operate/Operate.css'
import './Manage.css'

const DAY = 864e5
const num = (n: number) => n.toLocaleString('en-IN')
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

/** One limit: what's used of what the plan allows, as words and a bar. */
function Meter({ label, used, limit, unit, note }: { label: string; used: number; limit: number | null; unit: string; note?: string }) {
  const share = limit ? used / limit : 0
  const tone = !limit ? 'neutral' : share > 1 ? 'danger' : share >= 0.8 ? 'warn' : 'ok'
  return (
    <div className="use-meter">
      <dt className="use-meter__label">{label}</dt>
      <dd className="use-meter__value num">
        {num(used)}
        {limit !== null && <span className="ops-muted"> of {num(limit)}</span>} {unit}
      </dd>
      {limit !== null && (
        <dd className="use-meter__bar" aria-hidden="true">
          <span className={`use-meter__fill use-meter__fill--${tone}`} style={{ width: `${Math.min(share, 1) * 100}%` }} />
        </dd>
      )}
      <dd className="row__meta">{limit === null ? (note ?? 'No limit on your plan') : share > 1 ? <StatusPill tone="danger">Over the plan</StatusPill> : `${Math.round(share * 100)}% used${note ? ` · ${note}` : ''}`}</dd>
    </div>
  )
}

/**
 * /o/:slug/usage: this period's use against the plan, how it's going by
 * day, where the month is heading, and when owners are warned. Owners (and
 * bitNtech's master admin).
 */
export default function UsagePage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const id = useId()
  const load = useCallback(async () => {
    const [billing, agents, numbers, report, alerts] = await Promise.all([
      client.getBilling(org.orgSlug),
      client.listAgents(org.orgSlug),
      client.listNumbers(org.orgSlug),
      client.getReport(org.orgSlug, { days: 30 }).catch(() => null),
      client.getAlertSettings(org.orgSlug).catch(() => null),
    ])
    return { billing, agents, numbers, report, alerts }
  }, [client, org.orgSlug])
  const [data, reload] = useAsync(load)

  return (
    <ConsolePage kicker="Manage" title="Usage and limits" docTitle="Usage and limits" lede={<p>This billing period’s use against your plan, where the month is heading, and when you’re warned.</p>}>
      {data.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading usage…</span>
        </div>
      )}
      {data.state === 'error' && (
        <Alert tone="error" title="Couldn't load usage">
          <p>{asAuthError(data.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {data.state === 'ready' &&
        (() => {
          const { billing: b, agents, numbers, report, alerts } = data.data
          const plan = b.plans.find((p) => p.id === b.plan)!
          const end = Date.parse(b.renewsOn)
          const startDate = new Date(end)
          startDate.setMonth(startDate.getMonth() - 1)
          const start = startDate.getTime()
          const total = Math.max(1, Math.round((end - start) / DAY))
          const elapsed = Math.min(total, Math.max(1, Math.ceil((Date.now() - start) / DAY)))
          const forecast = Math.round((b.usage.minutes / elapsed) * total)
          const extra = Math.max(0, forecast - plan.minutes)
          const live = agents.filter((a) => a.status === 'live').length
          const days = (report?.byDay ?? []).filter((d) => Date.parse(`${d.date}T12:00:00`) >= start)
          const threshold = alerts?.rules.find((r) => r.key === 'usage_threshold')
          return (
            <>
              <section className="lib__section" aria-labelledby={`${id}-now`}>
                <h2 className="lib__heading" id={`${id}-now`}>
                  {plan.name} plan · {shortDate(new Date(start).toISOString())} to {shortDate(b.renewsOn)}
                </h2>
                <dl className="use-meters">
                  <Meter label="Call minutes" used={b.usage.minutes} limit={plan.minutes} unit="minutes" note={`day ${elapsed} of ${total}`} />
                  <Meter label="Live agents" used={live} limit={plan.agents} unit={plan.agents === 1 ? 'agent' : 'agents'} />
                  <Meter label="Phone lines" used={numbers.length} limit={plan.numbers} unit={plan.numbers === 1 ? 'line' : 'lines'} />
                  <Meter label="Calls" used={b.usage.calls} limit={null} unit="calls" note="Counted in minutes, not calls" />
                  <Meter label="Recordings processed" used={b.usage.uploadHours} limit={null} unit="hours" note="Included in every plan" />
                </dl>
              </section>

              <section className="lib__section" aria-labelledby={`${id}-fc`}>
                <h2 className="lib__heading" id={`${id}-fc`}>
                  Where the month is heading
                </h2>
                <div className="set-card">
                  <p className="use-forecast">
                    At this rate, about <strong className="num">{num(forecast)}</strong> of {num(plan.minutes)} minutes by {shortDate(b.renewsOn)}.
                  </p>
                  {extra > 0 ? (
                    <Alert tone="info" live={false}>
                      That’s about {num(extra)} minutes over, at {rupees(plan.extraMinute)} each: roughly {rupees(extra * plan.extraMinute)} plus GST on the next invoice.{' '}
                      {canOpen(access, 'billing') && (
                        <Link className="link" to="../billing">
                          Compare plans
                        </Link>
                      )}
                    </Alert>
                  ) : (
                    <p className="row__meta">That’s within the plan: no extra minutes expected.</p>
                  )}
                  <p className="row__meta">A forecast from the days so far; busy days ahead change it.</p>
                </div>
              </section>

              <section className="lib__section" aria-labelledby={`${id}-days`}>
                <h2 className="lib__heading" id={`${id}-days`}>
                  Calls each day this period
                </h2>
                {days.length === 0 ? (
                  <p className="empty-note">No calls yet this period.</p>
                ) : (
                  <ColumnChart
                    title="Calls each day this period, by how they ended"
                    categories={days.map((d) => shortDay(d.date))}
                    categoryName={(i) => longDay(days[i].date)}
                    labelStep={days.length > 14 ? 5 : 1}
                    series={[
                      { key: 'resolved', label: 'Handled by the agent', slot: 1, values: days.map((d) => d.resolved) },
                      { key: 'handed', label: 'Handed to a person', slot: 2, values: days.map((d) => d.handedOver) },
                      { key: 'dropped', label: 'Caller hung up', slot: 3, values: days.map((d) => d.dropped) },
                    ]}
                  />
                )}
              </section>

              <section className="lib__section" aria-labelledby={`${id}-warn`}>
                <h2 className="lib__heading" id={`${id}-warn`}>
                  When you’re warned
                </h2>
                <p className="row__meta">
                  {threshold && threshold.enabled
                    ? `An email goes to ${[...threshold.roles.map((r) => `${ROLE_LABEL[r].toLowerCase()}s`), ...(threshold.memberIds.length ? [`${threshold.memberIds.length} more ${threshold.memberIds.length === 1 ? 'person' : 'people'}`] : [])].join(', ')} when minutes reach ${threshold.threshold ?? 80}% of the plan.`
                    : 'Nobody is emailed when minutes run low.'}{' '}
                  {canOpen(access, 'notifications') && (
                    <Link className="link" to="../notifications">
                      Change this in Notifications
                    </Link>
                  )}
                </p>
              </section>
            </>
          )
        })()}
    </ConsolePage>
  )
}
