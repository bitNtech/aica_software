import { useCallback, useEffect, useId, useRef } from 'react'
import { asAuthError } from '../../auth/types'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { Health, ServiceHealth } from '../../ops/types'
import { StaleNote, useAnnouncer } from '../console/operate/LiveBits'
import { timeOfDay, useLiveData } from '../console/operate/shared'
import '../console/library/Library.css'
import '../console/operate/Operate.css'
import './Ops.css'

const HEALTH_LABEL: Record<Health, string> = { ok: 'Working', degraded: 'Slow', down: 'Down' }
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`)
const pct = (r: number) => `${(r * 100).toFixed(r < 0.01 ? 2 : 1)}%`
const REFRESH = 15_000

/** /ops/status: the external speech, voice and language services, and the processing queue. */
export default function OpsStatusPage() {
  const ops = useOpsData()
  const id = useId()
  const load = useCallback(() => ops.getServiceStatus(), [ops])
  const live = useLiveData(load, REFRESH)
  const [note, say] = useAnnouncer()
  const s = live.data
  const problems = s ? [...s.services.filter((x) => x.health !== 'ok').map((x) => x.name), ...(s.queue.health !== 'ok' ? ['Processing queue'] : [])] : []
  const summary = problems.length === 0 ? 'Everything is working.' : `${problems.join(' and ')} ${problems.length === 1 ? 'is' : 'are'} having problems.`

  // Said out loud only when the overall picture changes, not on every check.
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (!s) return
    if (last.current !== null && last.current !== summary) say(summary)
    last.current = summary
  }, [s, summary, say])

  return (
    <OpsLayout
      kicker="Service status"
      docTitle="Service status"
      title="Service status"
      demoData
      lede={<p>The speech, voice and language services run on separate servers; this page shows how they’re answering AICA, and how the processing queue is keeping up. It checks again every 15 seconds.</p>}
    >
      <p className="sr-only" role="status">
        {note}
      </p>
      {s && live.error ? <StaleNote error={live.error} checkedAt={live.checkedAt} onRetry={live.reload} /> : null}
      {!s && !live.error && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Checking the services…</span>
        </div>
      )}
      {!s && live.error ? (
        <Alert tone="error" title="Couldn't check the services">
          <p>{asAuthError(live.error).message}</p>
          <button type="button" className="btn-text" onClick={live.reload}>
            Try again
          </button>
        </Alert>
      ) : null}
      {s && (
        <>
          <div className={`ops-health-banner ops-health-banner--${problems.length ? 'degraded' : 'ok'}`}>
            <p className="ops-health-banner__text">{summary}</p>
            <p className="row__meta">
              Checked at {new Date(s.checkedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}.{' '}
              <button type="button" className="btn-text" onClick={live.reload}>
                Check now
              </button>
            </p>
          </div>

          <section className="ops-section" aria-labelledby={`${id}-svc`}>
            <div className="ops-section__head">
              <h2 id={`${id}-svc`} className="ops-section__title">
                Services
              </h2>
              <p className="ops-section__note">Last 15 minutes</p>
            </div>
            <ul className="ops-services" aria-labelledby={`${id}-svc`}>
              {s.services.map((x) => (
                <ServiceCard key={x.id} service={x} />
              ))}
            </ul>
          </section>

          <section className="ops-section" aria-labelledby={`${id}-q`}>
            <div className="ops-section__head">
              <h2 id={`${id}-q`} className="ops-section__title">
                Processing queue
              </h2>
              <span className={`status-chip ops-health--${s.queue.health}`}>{HEALTH_LABEL[s.queue.health]}</span>
            </div>
            <p className="lib__sub ops-sub">Uploaded recordings and knowledge waiting to be transcribed, read or indexed.</p>
            <dl className="stats ops-stats">
              <div className="stat">
                <dt className="stat__label">Waiting now</dt>
                <dd className="stat__value">{s.queue.waiting}</dd>
                <dd className="stat__sub">{s.queue.waiting ? `oldest for ${Math.round(s.queue.oldestWaitSec / 60) || 1} min` : 'nothing waiting'}</dd>
              </div>
              <div className="stat">
                <dt className="stat__label">Done, last hour</dt>
                <dd className="stat__value">{s.queue.processedLastHour}</dd>
              </div>
              <div className="stat">
                <dt className="stat__label">Failed, last hour</dt>
                <dd className="stat__value">{s.queue.failedLastHour}</dd>
              </div>
            </dl>
          </section>

          <section className="ops-section" aria-labelledby={`${id}-fail`}>
            <div className="ops-section__head">
              <h2 id={`${id}-fail`} className="ops-section__title">
                Recent failures
              </h2>
              <p className="ops-section__note">Last 24 hours, newest first</p>
            </div>
            {s.failures.length === 0 ? (
              <p className="empty-note">No failures in the last 24 hours.</p>
            ) : (
              <div className="ops-table" role="region" aria-labelledby={`${id}-fail`} tabIndex={0}>
                <table className="op-table ops-left">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Service</th>
                      <th scope="col">Organisation</th>
                      <th scope="col">What happened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.failures.map((f) => (
                      <tr key={f.id}>
                        <th scope="row">{timeOfDay(f.at)}</th>
                        <td>{f.service}</td>
                        <td>{f.org}</td>
                        <td>{f.what}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="row__meta">Failures name the organisation and what went wrong, never what the caller said.</p>
          </section>
        </>
      )}
    </OpsLayout>
  )
}

function ServiceCard({ service: x }: { service: ServiceHealth }) {
  const lo = Math.min(...x.p95ByMinute)
  const hi = Math.max(...x.p95ByMinute)
  return (
    <li className={`ops-service${x.health !== 'ok' ? ' ops-service--flag' : ''}`}>
      <div className="ops-service__head">
        <h3 className="ops-service__name">{x.name}</h3>
        <span className={`status-chip ops-health--${x.health}`}>{HEALTH_LABEL[x.health]}</span>
      </div>
      <p className="row__meta">{x.role}</p>
      {x.note && <p className="ops-service__note">{x.note}</p>}
      <dl className="lib-facts ops-service__facts">
        <div>
          <dt>Typical reply</dt>
          <dd>{ms(x.p50)}</dd>
        </div>
        <div>
          <dt>Slowest 5%</dt>
          <dd>{ms(x.p95)}</dd>
        </div>
        <div>
          <dt>Failed, last hour</dt>
          <dd>{pct(x.errorRate)}</dd>
        </div>
        <div>
          <dt>Requests, last hour</dt>
          <dd>{x.requestsLastHour.toLocaleString('en-IN')}</dd>
        </div>
      </dl>
      <Sparkline values={x.p95ByMinute} />
      <p className="row__meta">
        Slowest 5% over the last 30 minutes: {ms(lo)} to {ms(hi)}.
      </p>
    </li>
  )
}

/** The last 30 minutes at a glance; the line under it says the same in words. */
function Sparkline({ values }: { values: number[] }) {
  const w = 240
  const h = 36
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ')
  return (
    <svg className="ops-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
