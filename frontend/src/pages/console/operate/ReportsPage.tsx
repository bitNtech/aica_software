import { useCallback, useEffect, useId, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { can } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AgentSummary, Report, ReportQuery } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { BarList, ColumnChart, type Series } from '../../../components/charts/Charts'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { SegFilter } from '../../../components/console/ListTools'
import { StatTile } from '../../../components/console/StatTile'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { SelectField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { duration, languageName, points, share } from './shared'
import { seconds } from '../calls/TranscriptDialog'
import './Operate.css'

type Days = ReportQuery['days']
const DAYS_LABEL: Record<Days, string> = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' }
/** What each period is compared with: the same span before, to the same time of day. */
const PERIOD: Record<Days, string> = { 1: 'yesterday by this time', 7: 'the 7 days before', 30: 'the 30 days before', 90: 'the 90 days before' }

const shortDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const longDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
const hourLabel = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`)
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')

/** /o/:slug/reports: how the agents are doing, over a period. */
export default function ReportsPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const id = useId()
  const [days, setDays] = useState<Days>(7)
  const [agentId, setAgentId] = useState('')
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    client.listAgents(org.orgSlug).then((a) => setAgents(a.filter((x) => !x.setupStep)), () => setAgents([]))
  }, [client, org.orgSlug])

  // A new period or agent keeps the last report on screen, dimmed, until the
  // new one arrives: no jump, no flash.
  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    client.getReport(org.orgSlug, { days, agentId: agentId || undefined }).then(
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
  }, [client, org.orgSlug, days, agentId, tick])
  const retry = useCallback(() => setTick((t) => t + 1), [])

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
      kicker="Operate"
      title="Reports"
      docTitle="Reports"
      lede={<p>How many people called, how many the agents answered on their own, and where callers needed your team.</p>}
      actions={
        r &&
        can(access, 'export') && (
          <Button variant="line" onClick={() => downloadCsv(r, days, agents.find((a) => a.id === agentId)?.name)}>
            Download as CSV
          </Button>
        )
      }
    >
      <div className="list-tools op-filters">
        <SegFilter<`${Days}`>
          legend="Period"
          value={`${days}`}
          onChange={(v) => setDays(Number(v) as Days)}
          options={([1, 7, 30, 90] as Days[]).map((d) => ({ value: `${d}`, label: DAYS_LABEL[d] }))}
        />
        <div className="op-filters__agent">
          <SelectField label="Agent" value={agentId} options={[{ value: '', label: 'All agents' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => setAgentId(e.target.value)} />
        </div>
      </div>
      <p className="sr-only" role="status">
        {loading ? 'Loading the report…' : r ? `Showing ${DAYS_LABEL[days].toLowerCase()}${agentId ? ` for ${agents.find((a) => a.id === agentId)?.name}` : ''}: ${r.totals.calls.toLocaleString('en-IN')} calls.` : ''}
      </p>

      {error ? (
        <Alert tone="error" title="Couldn't load the report">
          <p>{asAuthError(error).message}</p>
          <button type="button" className="btn-text" onClick={retry}>
            Try again
          </button>
        </Alert>
      ) : !r ? (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading the report…</span>
        </div>
      ) : (
        <div className={`op-report${loading ? ' is-loading' : ''}`} aria-busy={loading || undefined}>
          <section className="op-section" aria-labelledby={`${id}-sum`}>
            <h2 id={`${id}-sum`} className="op-section__title">
              {DAYS_LABEL[days]}
            </h2>
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
            <h2 id={`${id}-q`} className="op-section__title">
              Quality
            </h2>
            <p className="op-section__sub">From each call’s analysis and the voice servers’ timings. Success is measured against each agent’s own criteria.</p>
            <dl className="stats">
              <StatTile label="Successful calls" value={pct(r.quality.success, r.totals.calls)} sub={`${r.quality.success.toLocaleString('en-IN')} met their agent’s criteria`} />
              <StatTile
                label="Callers pleased"
                value={pct(r.quality.sentiment.positive, r.totals.calls)}
                sub={`${pct(r.quality.sentiment.negative, r.totals.calls)} sounded unhappy`}
              />
              <StatTile label="Typical reply" value={seconds(r.quality.replyP50Ms)} sub={`Slowest 1 in 20: ${seconds(r.quality.replyP95Ms)}`} />
              <StatTile label="First words" value={seconds(r.quality.firstWordMs)} sub="From answering to the greeting" />
              <StatTile label="Caller cut in" value={String(r.quality.interruptionsPerCall)} sub="Times per call, on average" />
            </dl>
            <div className="op-split">
              <div>
                <h3 className="op-section__subtitle">Where a reply’s wait goes</h3>
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
                  <h3 className="op-section__subtitle">By agent</h3>
                  <table className="op-table">
                    <caption className="sr-only">Calls, success and reply time for each agent</caption>
                    <thead>
                      <tr>
                        <th scope="col">Agent</th>
                        <th scope="col">Calls</th>
                        <th scope="col">Successful</th>
                        <th scope="col">Typical reply</th>
                      </tr>
                    </thead>
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
              <h2 id={`${id}-days`} className="op-section__title">
                Calls each day, by what happened
              </h2>
              <ColumnChart title="Calls each day, by what happened" categories={r.byDay.map((d) => shortDay(d.date))} categoryName={(i) => longDay(r.byDay[i].date)} series={outcomes} />
            </section>
          )}

          <section className="op-section" aria-labelledby={`${id}-hours`}>
            <h2 id={`${id}-hours`} className="op-section__title">
              When people call
            </h2>
            <p className="op-section__sub">All calls in the period, by the hour they came in. Staff the desk for the busy hours.</p>
            <ColumnChart
              title="Calls by hour of the day"
              categories={r.byHour.map((_, h) => hourLabel(h))}
              labelStep={3}
              categoryName={(h) => `${hourLabel(h)} to ${hourLabel((h + 1) % 24)}`}
              series={[{ key: 'calls', label: 'Calls', slot: 1, values: r.byHour }]}
              height={180}
            />
          </section>

          <div className="op-split">
            <section className="op-section" aria-labelledby={`${id}-want`}>
              <h2 id={`${id}-want`} className="op-section__title">
                What callers want
              </h2>
              {r.intents.length === 0 ? (
                <p className="empty-note">No calls in this period.</p>
              ) : (
                <table className="op-table">
                  <caption className="sr-only">What callers want, and how many the agents answered on their own</caption>
                  <thead>
                    <tr>
                      <th scope="col">Asked about</th>
                      <th scope="col">Calls</th>
                      <th scope="col">Agents answered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.intents.map((it) => (
                      <tr key={it.label}>
                        <th scope="row">{it.label}</th>
                        <td>{it.calls.toLocaleString('en-IN')}</td>
                        <td>{pct(it.byAgent, it.calls)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="op-section" aria-labelledby={`${id}-lang`}>
              <h2 id={`${id}-lang`} className="op-section__title">
                Languages
              </h2>
              {r.languages.length === 0 ? (
                <p className="empty-note">No calls in this period.</p>
              ) : (
                <BarList label="Calls by language" items={r.languages.map((l) => ({ label: languageName(l.language), value: l.calls }))} />
              )}
            </section>
          </div>

          <section className="op-section" aria-labelledby={`${id}-drop`}>
            <h2 id={`${id}-drop`} className="op-section__title">
              Where calls left the agent
            </h2>
            <p className="op-section__sub">The step where callers hung up or were handed to a person. A step near the top may need clearer wording, or more in the agent’s knowledge.</p>
            {r.dropOff.length === 0 ? <p className="empty-note">No calls left early in this period.</p> : <BarList label="Calls that left at each step" items={r.dropOff.map((d) => ({ label: d.step, value: d.calls }))} />}
          </section>
        </div>
      )}
    </ConsolePage>
  )
}

/** The report as a CSV file: one section per table, made in the browser. */
function downloadCsv(r: Report, days: Days, agentName?: string) {
  const esc = (v: string | number) => {
    // A cell starting = + - @ would run as a formula in a spreadsheet.
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
  // In the page while clicked, and the address kept a moment: some browsers
  // drop a download from a detached link or a revoked address.
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}
