import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ROLE_LABEL } from '../auth/roles'
import { asAuthError } from '../auth/types'
import { can, canOpen, PAGE_LABEL, type PageKey } from '../console/access'
import { useConsole } from '../console/ConsoleProvider'
import type { AgentSummary, Appointment, Callback, Handoff, LiveCall, Report, ReportQuery } from '../console/types'
import { useOrg } from '../console/useOrg'
import { BarList, ColumnChart, type Series } from '../components/charts/Charts'
import { ConsolePage } from '../components/console/ConsolePage'
import { SegFilter } from '../components/console/ListTools'
import { StatTile } from '../components/console/StatTile'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { SelectField } from '../components/ui/Field'
import { Spinner } from '../components/ui/Spinner'
import { localDay } from '../lib/time'
import { seconds } from './console/calls/TranscriptDialog'
import { StaleNote } from './console/operate/LiveBits'
import { duration, languageName, points, share, since, useLiveData, useNow } from './console/operate/shared'
import './console/operate/Operate.css'

type Days = ReportQuery['days']
const DAYS_LABEL: Record<Days, string> = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' }
const PERIOD: Record<Days, string> = { 1: 'yesterday by this time', 7: 'the 7 days before', 30: 'the 30 days before', 90: 'the 90 days before' }
const shortDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const longDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
const hourLabel = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`)
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '-')

interface Today {
  live: LiveCall[] | null
  handoffs: Handoff[] | null
  callbacks: Callback[] | null
  appointments: Appointment[] | null
}

export default function ConsoleHomePage() {
  const { user, org, access, base } = useOrg()
  const client = useConsole()
  const id = useId()
  const denied = (useLocation().state as { deniedPage?: PageKey } | null)?.deniedPage
  const may = (p: PageKey) => canOpen(access, p)

  // Attention data (live, handoffs, callbacks, appointments)
  const loadToday = useCallback(async (): Promise<Today> => {
    const today = localDay(0)
    const [live, handoffs, callbacks, appointments] = await Promise.all([
      may('live') ? client.listLiveCalls(org.orgSlug) : null,
      may('handoffs') ? client.listHandoffs(org.orgSlug) : null,
      may('callbacks') ? client.listCallbacks(org.orgSlug) : null,
      may('appointments') ? client.listAppointments(org.orgSlug, today, today) : null,
    ])
    return { live, handoffs, callbacks, appointments }
  }, [client, org.orgSlug, access])
  const today = useLiveData(loadToday, 15000)
  const now = useNow(15000)
  const t = today.data

  const ownCallbacks = access.perms.has('callbacks.assign') ? false : true
  const waiting = t?.handoffs?.filter((h) => h.status === 'waiting') ?? []
  const openCallbacks = t?.callbacks?.filter((c) => c.status === 'open' && (!ownCallbacks || c.assignedTo?.id === user.id || !c.assignedTo)) ?? []
  const overdue = openCallbacks.filter((c) => Date.parse(c.dueBy) < now)
  const toCheck = t?.appointments?.filter((a) => a.status === 'needs_check') ?? []

  // Reports data
  const [days, setDays] = useState<Days>(7)
  const [agentId, setAgentId] = useState('')
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [reportLoading, setReportLoading] = useState(true)
  const [reportError, setReportError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)
  const retry = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!may('reports')) return
    client.listAgents(org.orgSlug).then((a) => setAgents(a.filter((x) => !x.setupStep)), () => setAgents([]))
  }, [client, org.orgSlug])

  useEffect(() => {
    if (!may('reports')) return
    let live = true
    setReportLoading(true)
    setReportError(null)
    client.getReport(org.orgSlug, { days, agentId: agentId || undefined }).then(
      (r) => { if (!live) return; setReport(r); setReportLoading(false) },
      (err) => { if (!live) return; setReportError(err); setReportLoading(false) },
    )
    return () => { live = false }
  }, [client, org.orgSlug, days, agentId, tick])

  const r = report
  const outcomes: Series[] = r
    ? [
        { key: 'agent', label: 'Answered by the agents', slot: 1, values: r.byDay.map((d) => d.resolved) },
        { key: 'team', label: 'Handed to your team', slot: 2, values: r.byDay.map((d) => d.handedOver) },
        { key: 'dropped', label: 'Caller hung up', slot: 3, values: r.byDay.map((d) => d.dropped) },
      ]
    : []

  return (
    <ConsolePage
      kicker="Home"
      docTitle="Home"
      title={<>You're <em>in,</em> {user.name.split(' ')[0]}.</>}
      lede={
        <p>
          Signed in to <strong className="console__em">{org.orgName}</strong> as {ROLE_LABEL[org.role].toLowerCase()}.
        </p>
      }
    >
      {denied && denied in PAGE_LABEL && (
        <Alert tone="info" className="home-denied">
          {upperFirst(PAGE_LABEL[denied])} isn't part of the {ROLE_LABEL[org.role].toLowerCase()} role here. If you need it, ask an owner or admin of {org.orgName}.
        </Alert>
      )}

      {/* Attention section */}
      {!t && !today.error && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading today…</span>
        </div>
      )}
      {!t && today.error ? (
        <Alert tone="error" title="Couldn't load today">
          <p>{asAuthError(today.error).message}</p>
          <button type="button" className="btn-text" onClick={today.reload}>Try again</button>
        </Alert>
      ) : null}
      {t && today.error ? <StaleNote error={today.error} checkedAt={today.checkedAt} onRetry={today.reload} /> : null}

      {t && (t.handoffs || t.callbacks || t.appointments || t.live) && (
        <section className="op-section" aria-labelledby={`${id}-now`}>
          <h2 id={`${id}-now`} className="op-section__title">Needs a person</h2>
          <ul className="home-attn">
            {t.handoffs && (
              <AttnCard
                to={`${base}/handoffs`}
                label="Waiting in the handoff queue"
                count={waiting.length}
                urgent={waiting.length > 0}
                detail={waiting.length ? `Longest waiting ${since(waiting[0].waitingSince, now)}` : 'Nobody waiting'}
              />
            )}
            {t.live && (
              <AttnCard
                to={`${base}/live`}
                label="Calls in progress"
                count={t.live.length}
                urgent={t.live.some((c) => c.flagged && !c.takenBy)}
                detail={t.live.some((c) => c.flagged && !c.takenBy) ? 'A caller sounds upset' : 'The agents are handling them'}
              />
            )}
            {t.callbacks && (
              <AttnCard
                to={`${base}/callbacks`}
                label={ownCallbacks ? 'Callbacks for you or nobody yet' : 'Callbacks to make'}
                count={openCallbacks.length}
                urgent={overdue.length > 0}
                detail={overdue.length ? `${overdue.length} overdue` : 'None overdue'}
              />
            )}
            {t.appointments && (
              <AttnCard
                to={`${base}/appointments`}
                label="Today's appointments to check"
                count={toCheck.length}
                urgent={false}
                detail={`${t.appointments.filter((a) => a.status !== 'cancelled').length} appointments today`}
              />
            )}
          </ul>
        </section>
      )}

      {/* Reports section — embedded */}
      {may('reports') && (
        <section className="op-section" aria-labelledby={`${id}-reports`}>
          <div className="op-section__head">
            <h2 id={`${id}-reports`} className="op-section__title">Reports</h2>
            {r && can(access, 'export') && (
              <Button variant="line" onClick={() => downloadCsv(r, days, agents.find((a) => a.id === agentId)?.name)}>
                Download CSV
              </Button>
            )}
          </div>

          <div className="list-tools op-filters">
            <SegFilter<`${Days}`>
              legend="Period"
              value={`${days}`}
              onChange={(v) => setDays(Number(v) as Days)}
              options={([1, 7, 30, 90] as Days[]).map((d) => ({ value: `${d}`, label: DAYS_LABEL[d] }))}
            />
            {agents.length > 0 && (
              <div className="op-filters__agent">
                <SelectField
                  label="Agent"
                  value={agentId}
                  options={[{ value: '', label: 'All agents' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
                  onChange={(e) => setAgentId(e.target.value)}
                />
              </div>
            )}
          </div>

          <p className="sr-only" role="status">
            {reportLoading ? 'Loading the report…' : r ? `Showing ${DAYS_LABEL[days].toLowerCase()}: ${r.totals.calls.toLocaleString('en-IN')} calls.` : ''}
          </p>

          {reportError ? (
            <Alert tone="error" title="Couldn't load the report">
              <p>{asAuthError(reportError).message}</p>
              <button type="button" className="btn-text" onClick={retry}>Try again</button>
            </Alert>
          ) : !r ? (
            <div className="loading-row" role="status"><Spinner /><span>Loading the report…</span></div>
          ) : (
            <div className={`op-report${reportLoading ? ' is-loading' : ''}`} aria-busy={reportLoading || undefined}>

              <section className="op-section" aria-labelledby={`${id}-sum`}>
                <h3 id={`${id}-sum`} className="op-section__subtitle">{DAYS_LABEL[days]}</h3>
                <dl className="stats">
                  <StatTile label="Calls" value={r.totals.calls.toLocaleString('en-IN')} change={{ now: r.totals.calls, before: r.previous.calls, period: PERIOD[days], upIsGood: true }} />
                  <StatTile
                    label="Answered by the agents"
                    value={pct(r.totals.byAgent, r.totals.calls)}
                    sub={`${r.totals.byAgent.toLocaleString('en-IN')} calls, no person needed`}
                    change={{ now: share(r.totals.byAgent, r.totals.calls), before: share(r.previous.byAgent, r.previous.calls), period: PERIOD[days], upIsGood: true, format: points, words: ['higher', 'lower'] }}
                  />
                  <StatTile
                    label="Handed to your team"
                    value={r.totals.handedOver.toLocaleString('en-IN')}
                    sub={`${pct(r.totals.handedOver, r.totals.calls)} of calls`}
                    change={{ now: r.totals.handedOver, before: r.previous.handedOver, period: PERIOD[days], upIsGood: false }}
                  />
                  <StatTile
                    label="Caller hung up"
                    value={r.totals.dropped.toLocaleString('en-IN')}
                    sub={`${pct(r.totals.dropped, r.totals.calls)} of calls`}
                    change={{ now: r.totals.dropped, before: r.previous.dropped, period: PERIOD[days], upIsGood: false }}
                  />
                  <StatTile
                    label="Average call"
                    value={duration(r.totals.avgDurationSec)}
                    change={{ now: r.totals.avgDurationSec, before: r.previous.avgDurationSec, period: PERIOD[days], upIsGood: false, format: duration, words: ['longer', 'shorter'] }}
                  />
                </dl>
              </section>

              <section className="op-section" aria-labelledby={`${id}-q`}>
                <h3 id={`${id}-q`} className="op-section__subtitle">Quality</h3>
                <p className="op-section__sub">From each call's analysis and the voice servers' timings. Success is measured against each agent's own criteria.</p>
                <dl className="stats">
                  <StatTile label="Successful calls" value={pct(r.quality.success, r.totals.calls)} sub={`${r.quality.success.toLocaleString('en-IN')} met their agent's criteria`} />
                  <StatTile label="Callers pleased" value={pct(r.quality.sentiment.positive, r.totals.calls)} sub={`${pct(r.quality.sentiment.negative, r.totals.calls)} sounded unhappy`} />
                  <StatTile label="Typical reply" value={seconds(r.quality.replyP50Ms)} sub={`Slowest 1 in 20: ${seconds(r.quality.replyP95Ms)}`} />
                  <StatTile label="First words" value={seconds(r.quality.firstWordMs)} sub="From answering to the greeting" />
                  <StatTile label="Caller cut in" value={String(r.quality.interruptionsPerCall)} sub="Times per call, on average" />
                </dl>
                <div className="op-split">
                  <div>
                    <h4 className="op-section__subtitle">Where a reply's wait goes</h4>
                    <BarList
                      label="Typical time for each part of a reply, in milliseconds"
                      items={[
                        { label: 'Hearing the caller (speech recognition)', value: r.quality.speechMs },
                        { label: 'Working out the reply (language model)', value: r.quality.languageMs },
                        { label: 'Starting to speak (voice)', value: r.quality.voiceMs },
                      ]}
                    />
                  </div>
                  {!agentId && r.agents.length > 0 && (
                    <div>
                      <h4 className="op-section__subtitle">By agent</h4>
                      <table className="op-table">
                        <caption className="sr-only">Calls, success and reply time for each agent</caption>
                        <thead><tr><th scope="col">Agent</th><th scope="col">Calls</th><th scope="col">Successful</th><th scope="col">Typical reply</th></tr></thead>
                        <tbody>
                          {r.agents.map((a) => (
                            <tr key={a.agentId}>
                              <th scope="row">{a.name}</th>
                              <td>{a.calls.toLocaleString('en-IN')}</td>
                              <td>{pct(a.success, a.calls)}</td>
                              <td>{seconds(a.replyP50Ms)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>

              {days > 1 && (
                <section className="op-section" aria-labelledby={`${id}-days`}>
                  <h3 id={`${id}-days`} className="op-section__subtitle">Calls each day, by what happened</h3>
                  <ColumnChart title="Calls each day, by what happened" categories={r.byDay.map((d) => shortDay(d.date))} categoryName={(i) => longDay(r.byDay[i].date)} series={outcomes} />
                </section>
              )}

              <section className="op-section" aria-labelledby={`${id}-hours`}>
                <h3 id={`${id}-hours`} className="op-section__subtitle">When people call</h3>
                <p className="op-section__sub">All calls in the period, by the weekday and hour they came in.</p>
                <HourHeatmap data={r.byDayHour} dates={r.byDay.map((d) => d.date)} />
              </section>

              <div className="op-split">
                <section className="op-section" aria-labelledby={`${id}-want`}>
                  <h3 id={`${id}-want`} className="op-section__subtitle">What callers want</h3>
                  {r.intents.length === 0 ? (
                    <p className="empty-note">No calls in this period.</p>
                  ) : (
                    <table className="op-table">
                      <caption className="sr-only">What callers want, and how many the agents answered on their own</caption>
                      <thead><tr><th scope="col">Asked about</th><th scope="col">Calls</th><th scope="col">Agents answered</th></tr></thead>
                      <tbody>
                        {r.intents.map((it) => (
                          <tr key={it.label}><th scope="row">{it.label}</th><td>{it.calls.toLocaleString('en-IN')}</td><td>{pct(it.byAgent, it.calls)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
                <section className="op-section" aria-labelledby={`${id}-lang`}>
                  <h3 id={`${id}-lang`} className="op-section__subtitle">Languages</h3>
                  {r.languages.length === 0 ? (
                    <p className="empty-note">No calls in this period.</p>
                  ) : (
                    <BarList label="Calls by language" items={r.languages.map((l) => ({ label: languageName(l.language), value: l.calls }))} />
                  )}
                </section>
              </div>

              <section className="op-section" aria-labelledby={`${id}-drop`}>
                <h3 id={`${id}-drop`} className="op-section__subtitle">Where calls left the agent</h3>
                <p className="op-section__sub">The step where callers hung up or were handed to a person.</p>
                {r.dropOff.length === 0 ? <p className="empty-note">No calls left early in this period.</p> : <BarList label="Calls that left at each step" items={r.dropOff.map((d) => ({ label: d.step, value: d.calls }))} />}
              </section>
            </div>
          )}
        </section>
      )}
    </ConsolePage>
  )
}

function AttnCard({ to, label, count, detail, urgent }: { to: string; label: string; count: number; detail: string; urgent: boolean }) {
  return (
    <li>
      <Link to={to} className={`home-attn__card${urgent ? ' is-urgent' : ''}`} aria-label={`${count} ${label.toLowerCase()}. ${urgent ? 'Needs attention: ' : ''}${detail}.`}>
        <span className="home-attn__count">{count}</span>
        <span className="home-attn__label">{label}</span>
        <span className="home-attn__detail">{detail}</span>
      </Link>
    </li>
  )
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * Calls by weekday and hour. Only the weekdays the period actually covers get
 * a row, so "Today" is one row rather than six empty ones.
 */
function HourHeatmap({ data, dates }: { data: number[][]; dates: string[] }) {
  const [active, setActive] = useState<{ row: number; h: number } | null>(null)
  const covered = new Set(dates.map((d) => (new Date(`${d}T12:00:00`).getDay() + 6) % 7))
  const rows = WEEKDAYS.map((name, i) => ({ name, i })).filter((r) => covered.has(r.i))
  const shown = rows.length ? rows : WEEKDAYS.map((name, i) => ({ name, i }))
  const max = Math.max(...shown.flatMap((r) => data[r.i] ?? []), 1)
  const total = shown.reduce((s, r) => s + (data[r.i] ?? []).reduce((a, b) => a + b, 0), 0)
  const busiest = shown
    .flatMap((r) => (data[r.i] ?? []).map((count, h) => ({ count, h, day: r.name })))
    .reduce((a, b) => (b.count > a.count ? b : a), { count: 0, h: 0, day: '' })
  const num = (v: number) => v.toLocaleString('en-IN')
  const span = (h: number) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`

  const hovered = active ? { day: shown.find((r) => r.i === active.row)?.name ?? '', count: data[active.row]?.[active.h] ?? 0, h: active.h } : null

  return (
    <div className="heatmap">
      <p className="heatmap__summary">
        Busiest: <strong>{busiest.day}</strong> at <strong>{span(busiest.h)}</strong> — {num(busiest.count)} calls.
      </p>
      {/* Fixed-height readout, always in the layout: it never floats over a
          neighbouring weekday row the way a per-cell tooltip would in a
          7-row grid with only a few pixels between rows. */}
      <p className="heatmap__readout" aria-hidden="true">
        {hovered && total > 0 ? (
          <>
            <strong>{hovered.day}</strong>, {span(hovered.h)}: <strong>{num(hovered.count)}</strong> calls · {Math.round((hovered.count / total) * 100)}% of the period
          </>
        ) : (
          ' '
        )}
      </p>
      <div
        className="heatmap__rows"
        role="img"
        aria-label={`Calls by weekday and hour. Busiest: ${busiest.day} at ${hourLabel(busiest.h)}, ${num(busiest.count)} calls of ${num(total)}.`}
        onPointerLeave={() => setActive(null)}
      >
        {shown.map((r) => (
          <div key={r.i} className="heatmap__row">
            <span className="heatmap__day" aria-hidden="true">{r.name.slice(0, 3)}</span>
            <div className="heatmap__grid">
              {Array.from({ length: 24 }, (_, h) => {
                const count = data[r.i]?.[h] ?? 0
                const on = active?.row === r.i && active.h === h
                return (
                  <div
                    key={h}
                    className={`heatmap__cell${on ? ' is-active' : ''}`}
                    style={{ '--heat': count / max } as React.CSSProperties}
                    onPointerEnter={() => setActive({ row: r.i, h })}
                  />
                )
              })}
            </div>
          </div>
        ))}
        <div className="heatmap__row heatmap__row--axis" aria-hidden="true">
          <span className="heatmap__day" />
          <div className="heatmap__grid">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="heatmap__tick">{h % 3 === 0 ? hourLabel(h) : ''}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="heatmap__legend" aria-hidden="true">
        <span>Quiet</span>
        <span className="heatmap__legend-bar" />
        <span>Busy</span>
        <span className="heatmap__legend-max">Peak {num(max)} calls an hour</span>
      </div>
    </div>
  )
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function downloadCsv(r: Report, days: Days, agentName?: string) {
  const esc = (v: string | number) => {
    let t = String(v)
    if (typeof v === 'string' && /^[=+\-@]/.test(t)) t = `'${t}`
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const rows: (string | number)[][] = [
    ['AICA report', DAYS_LABEL[days], agentName ?? 'All agents'],
    [],
    ['Day', 'Answered by the agents', 'Handed to your team', 'Caller hung up'],
    ...r.byDay.map((d) => [d.date, d.resolved, d.handedOver, d.dropped]),
    [],
    ['Asked about', 'Calls', 'Answered by the agents'],
    ...r.intents.map((i) => [i.label, i.calls, i.byAgent]),
    [],
    ['Hour', 'Calls'],
    ...r.byHour.map((n, h) => [`${String(h).padStart(2, '0')}:00`, n]),
    [],
    ['Quality', 'Value'],
    ['Successful calls', r.quality.success],
    ['Callers pleased', r.quality.sentiment.positive],
    ['Callers neutral', r.quality.sentiment.neutral],
    ['Callers unhappy', r.quality.sentiment.negative],
    ['Typical reply (ms)', r.quality.replyP50Ms],
    ['Slowest 1 in 20 replies (ms)', r.quality.replyP95Ms],
    ['First words (ms)', r.quality.firstWordMs],
    ['Caller cut in, per call', r.quality.interruptionsPerCall],
    [],
    ['Agent', 'Calls', 'Answered by the agent', 'Successful', 'Typical reply (ms)'],
    ...r.agents.map((a) => [a.name, a.calls, a.byAgent, a.success, a.replyP50Ms]),
  ]
  const blob = new Blob([rows.map((row) => row.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `aica-report-${days}d.csv`
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}
