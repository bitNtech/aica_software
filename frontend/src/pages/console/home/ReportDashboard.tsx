import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { BarList, ColumnChart, type Series } from '../../../components/charts/Charts'
import { SegFilter } from '../../../components/console/ListTools'
import { DataTable, type Column } from '../../../components/console/DataTable'
import { KpiCard, KpiGrid } from '../../../components/console/KpiCard'
import { Skeleton } from '../../../components/console/Skeleton'
import { ToneIcon } from '../../../components/console/StatusPill'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { SelectField } from '../../../components/ui/Field'
import { can, canOpen } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AgentSummary, Report } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { duration, languageName, points, share } from '../operate/shared'
import { findings, GAP_POINTS, percent, SECTION, topicGap, MIN_TOPIC_COMPARE } from './findings'
import { DAYS_LABEL, longDay, ms, num, PERIOD, PERIODS, pct, pctOrNull, secs, shortDay, type Days } from './format'
import { HourHeatmap } from './HourHeatmap'
import { downloadReportCsv } from './reportCsv'
import { WhatChanged } from './WhatChanged'

/** A report with the period and agent it was asked for, so a failed refresh can say what is still on screen. */
interface Shown {
  report: Report
  days: Days
  agentId: string
}

/**
 * The report readers' dashboard: the period and agent filters, then the
 * cards. At wide widths a 12-column grid gives each card the room its
 * importance earns; on a phone it is one column and tables scroll inside
 * their own box. A refresh keeps the last report on screen, dimmed; one that
 * fails says so with a Retry and leaves the figures in place.
 */
export function ReportDashboard() {
  const { org, access, base } = useOrg()
  const client = useConsole()
  const id = useId()
  const [days, setDays] = useState<Days>(7)
  const [agentId, setAgentId] = useState('')
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [shown, setShown] = useState<Shown | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)
  const retry = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    client.listAgents(org.orgSlug).then((a) => setAgents(a.filter((x) => !x.setupStep)), () => setAgents([]))
  }, [client, org.orgSlug])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    client.getReport(org.orgSlug, { days, agentId: agentId || undefined }).then(
      (report) => {
        if (!live) return
        setShown({ report, days, agentId })
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

  const r = shown?.report ?? null
  const agentName = agents.find((a) => a.id === agentId)?.name
  const onScreen = shown ? `${DAYS_LABEL[shown.days]}${shown.days !== days || shown.agentId !== agentId ? ' (not the period you picked)' : ''}` : ''

  return (
    <section className="op-section hd" aria-labelledby={`${id}-reports`}>
      <div className="op-section__head">
        <h2 id={`${id}-reports`} className="op-section__title">
          Reports
        </h2>
        {r && can(access, 'export') && (
          <Button variant="line" onClick={() => downloadReportCsv(r, days, agentName)}>
            Download CSV
          </Button>
        )}
      </div>

      <div className="list-tools op-filters">
        <SegFilter<`${Days}`> legend="Period" value={`${days}`} onChange={(v) => setDays(Number(v) as Days)} options={PERIODS.map((d) => ({ value: `${d}`, label: DAYS_LABEL[d] }))} />
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
        {loading ? 'Loading the report…' : r ? `Showing ${DAYS_LABEL[shown!.days].toLowerCase()}: ${r.totals.calls.toLocaleString('en-IN')} calls.` : ''}
      </p>

      {error && !r ? (
        <Alert tone="error" title="Couldn't load the report">
          <p>{asAuthError(error).message}</p>
          <button type="button" className="btn-text" onClick={retry}>
            Try again
          </button>
        </Alert>
      ) : !r ? (
        <ReportSkeleton />
      ) : (
        <>
          {error ? (
            <p className="op-stale" role="alert">
              <strong>Couldn’t refresh.</strong> {asAuthError(error).message} Still showing {onScreen.toLowerCase()} from the last time it loaded.{' '}
              <button type="button" className="btn-text" onClick={retry}>
                Retry
              </button>
            </p>
          ) : null}
          <div className={`hd-grid${loading ? ' is-loading' : ''}${error ? ' is-stale' : ''}`} aria-busy={loading || undefined}>
            <Dashboard r={r} days={shown!.days} agentId={shown!.agentId} base={base} canCalls={canOpen(access, 'calls')} />
          </div>
        </>
      )}
    </section>
  )
}

/** Cards shaped like the real ones, while the first report loads. */
function ReportSkeleton() {
  return (
    <div className="hd-grid" aria-busy="true">
      <p role="status" className="sr-only">
        Loading the report…
      </p>
      <div className="hd-s12 hd-skel-kpis">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} block height="6.5rem" />
        ))}
      </div>
      <div className="hd-s5">
        <Skeleton block height="12rem" />
      </div>
      <div className="hd-s7">
        <Skeleton block height="12rem" />
      </div>
      <div className="hd-s8">
        <Skeleton block height="14rem" />
      </div>
      <div className="hd-s4">
        <Skeleton block height="14rem" />
      </div>
    </div>
  )
}

function Card({ section, title, span, sub, children }: { section: string; title: string; span: number; sub?: ReactNode; children: ReactNode }) {
  return (
    <section id={section} className={`hd-card hd-s${span}`} aria-labelledby={`${section}-title`}>
      <h3 id={`${section}-title`} tabIndex={-1} className="hd-card__title">
        {title}
      </h3>
      {sub && <p className="hd-note">{sub}</p>}
      {children}
    </section>
  )
}

function Dashboard({ r, days, agentId, base, canCalls }: { r: Report; days: Days; agentId: string; base: string; canCalls: boolean }) {
  const t = r.totals
  const p = r.previous
  const none = t.calls === 0
  const overall = none ? null : percent(t.byAgent, t.calls)
  const found = useMemo(() => findings(r, { previous: PERIOD[days] }), [r, days])

  const outcomes: Series[] = [
    { key: 'agent', label: 'Answered by the agents', slot: 1, values: r.byDay.map((d) => d.resolved) },
    { key: 'team', label: 'Handed to your team', slot: 2, values: r.byDay.map((d) => d.handedOver) },
    { key: 'dropped', label: 'Caller hung up', slot: 3, values: r.byDay.map((d) => d.dropped) },
  ]
  // A line needs two days; and a line of all zeros says nothing.
  const trend = (values: number[]) => (values.length > 1 && values.some((v) => v > 0) ? values : undefined)

  return (
    <>
      <Card section={SECTION.kpis} title="At a glance" span={12} sub={`${DAYS_LABEL[days]}, compared with ${PERIOD[days]}.`}>
        <KpiGrid label={`${DAYS_LABEL[days]} at a glance`}>
          <KpiCard
            label="Calls"
            value={num(t.calls)}
            sub={none ? 'No calls in this period' : undefined}
            change={none && p.calls === 0 ? undefined : { now: t.calls, before: p.calls, period: PERIOD[days], upIsGood: true }}
            series={trend(r.byDay.map((d) => d.resolved + d.handedOver + d.dropped))}
            seriesLabel="Calls each day"
          />
          <KpiCard
            label="Answered by the agents"
            value={none ? null : (pctOrNull(t.byAgent, t.calls) ?? '-')}
            notMeasured="No calls to measure"
            sub={`${num(t.byAgent)} calls, no person needed`}
            change={none || p.calls === 0 ? undefined : { now: share(t.byAgent, t.calls), before: share(p.byAgent, p.calls), period: PERIOD[days], upIsGood: true, format: points, words: ['higher', 'lower'] }}
            series={trend(r.byDay.map((d) => d.resolved))}
            seriesLabel="Calls the agents answered each day"
          />
          <KpiCard
            label="Handed to your team"
            value={num(t.handedOver)}
            sub={none ? undefined : `${pct(t.handedOver, t.calls)} of calls`}
            change={none && p.calls === 0 ? undefined : { now: t.handedOver, before: p.handedOver, period: PERIOD[days], upIsGood: false }}
            series={trend(r.byDay.map((d) => d.handedOver))}
            seriesLabel="Calls handed to your team each day"
          />
          <KpiCard
            label="Caller hung up"
            value={num(t.dropped)}
            sub={none ? undefined : `${pct(t.dropped, t.calls)} of calls`}
            change={none && p.calls === 0 ? undefined : { now: t.dropped, before: p.dropped, period: PERIOD[days], upIsGood: false }}
            series={trend(r.byDay.map((d) => d.dropped))}
            seriesLabel="Calls where the caller hung up, each day"
          />
          <KpiCard
            label="Average call"
            value={none ? null : duration(t.avgDurationSec)}
            notMeasured="No calls to measure"
            change={none || p.calls === 0 ? undefined : { now: t.avgDurationSec, before: p.avgDurationSec, period: PERIOD[days], upIsGood: false, format: duration, words: ['longer', 'shorter'] }}
          />
        </KpiGrid>
      </Card>

      <WhatChanged items={found} hasCalls={!none} />

      <Card section={SECTION.ended} title="How calls ended" span={5} sub="Each as a share of all calls. Successful isn’t a step after answered: a call handed to your team can still meet its agent’s criteria.">
        {none ? <p className="empty-note">No calls in this period.</p> : <Funnel r={r} />}
      </Card>

      <Card section={SECTION.days} title="Calls each day, by what happened" span={7}>
        {none ? (
          <p className="empty-note">No calls in this period.</p>
        ) : days === 1 || r.byDay.length < 2 ? (
          <p className="hd-note">Today is one day, so there is no day-by-day picture yet. Pick a longer period to see calls day by day.</p>
        ) : (
          <ColumnChart title="Calls each day, by what happened" categories={r.byDay.map((d) => shortDay(d.date))} categoryName={(i) => longDay(r.byDay[i].date)} series={outcomes} />
        )}
      </Card>

      <Card
        section={SECTION.quality}
        title="Quality"
        span={12}
        sub={`From each call's analysis and the voice servers' timings. Success is measured against each agent's own criteria.${r.quality.success === null && r.quality.replyP50Ms === null && !none ? ' These show once the voice servers send each call’s analysis and timings.' : ''}`}
      >
        <Quality r={r} none={none} />
      </Card>

      <Card section={SECTION.topics} title="What callers want" span={8} sub={none ? undefined : 'Each topic against the share of all calls the agents answered on their own. Pick a topic to see its calls.'}>
        <Topics r={r} overall={overall} days={days} agentId={agentId} base={base} canCalls={canCalls} />
      </Card>

      <Card section={SECTION.languages} title="Languages" span={4}>
        {r.languages.length === 0 ? (
          <p className="empty-note">No calls in this period.</p>
        ) : (
          <BarList label="Calls by language" showShare items={r.languages.map((l) => ({ label: languageName(l.language), value: l.calls }))} />
        )}
      </Card>

      <Card
        section={SECTION.agents}
        title="Agents"
        span={7}
        sub={r.agents.length === 1 ? 'The agent that took calls in this period.' : r.agents.length > 1 ? 'How each agent did in this period.' : undefined}
      >
        <Agents r={r} />
      </Card>

      <Card section={SECTION.dropoff} title="Where calls left the agent" span={5} sub="The step where callers hung up or were handed to a person, and the share of those calls.">
        {r.dropOff.length === 0 ? (
          <p className="empty-note">No calls left early in this period.</p>
        ) : (
          <BarList label="Calls that left at each step" showShare items={r.dropOff.map((d) => ({ label: d.step, value: d.calls }))} />
        )}
      </Card>

      <Card section={SECTION.when} title="When people call" span={12} sub="All calls in the period, by the weekday and hour they came in.">
        {none ? <p className="empty-note">No calls in this period.</p> : <HourHeatmap data={r.byDayHour} dates={r.byDay.map((d) => d.date)} />}
      </Card>
    </>
  )
}

/** All calls, answered by the agents, and successful: bars to one scale, each with its count and share of all calls.
 * Not a true funnel: successful calls include some handed to the team, so it can exceed answered. */
function Funnel({ r }: { r: Report }) {
  const calls = r.totals.calls
  const q = r.quality
  const rows: { key: string; label: string; value: number | null; note?: string }[] = [
    { key: 'all', label: 'All calls', value: calls },
    { key: 'agent', label: 'Answered by the agents', value: r.totals.byAgent, note: 'no person needed' },
    { key: 'ok', label: 'Successful', value: q.success, note: 'met their agent’s criteria' },
  ]
  const analysed = q.analysed
  const partial = q.success !== null && analysed !== undefined && analysed < calls
  return (
    <>
      <ul className="hd-funnel" aria-label="How calls ended, each as a share of all calls">
        {rows.map((row) => (
          <li key={row.key} className="hd-funnel__row">
            <span className="hd-funnel__label">
              {row.label}
              {row.note && <span className="hd-funnel__note"> {row.note}</span>}
            </span>
            {row.value === null ? (
              <span className="hd-funnel__none">Not measured yet</span>
            ) : (
              <>
                <span className="hd-funnel__track" aria-hidden="true">
                  <span className="hd-funnel__bar" style={{ width: `${(row.value / calls) * 100}%` }} />
                </span>
                <span className="hd-funnel__value num">
                  {num(row.value)} <span className="hd-funnel__pct">{pct(row.value, calls)}</span>
                  <span className="sr-only"> of all calls</span>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="hd-note">
        The other calls: {num(r.totals.handedOver)} handed to your team ({pct(r.totals.handedOver, calls)}) and {num(r.totals.dropped)} where the caller hung up ({pct(r.totals.dropped, calls)}).
        {partial && ` Success is judged on the ${num(analysed!)} calls that were analysed.`}
      </p>
    </>
  )
}

function Quality({ r, none }: { r: Report; none: boolean }) {
  const q = r.quality
  const base = q.analysed ?? r.totals.calls
  const missing = none ? 'No calls to measure' : 'Not measured yet'
  const stages =
    q.speechMs === null || q.languageMs === null || q.voiceMs === null
      ? null
      : [
          { slot: 1 as const, label: 'Hearing the caller (speech recognition)', value: q.speechMs },
          { slot: 2 as const, label: 'Working out the reply (language model)', value: q.languageMs },
          { slot: 3 as const, label: 'Starting to speak (voice)', value: q.voiceMs },
        ]
  return (
    <>
      <KpiGrid label="Quality">
        <KpiCard
          label="Successful calls"
          value={none ? null : pctOrNull(q.success, base)}
          notMeasured={missing}
          sub={q.success === null ? undefined : `${num(q.success)} met their agent's criteria`}
        />
        <KpiCard
          label="Callers pleased"
          value={none ? null : pctOrNull(q.sentiment?.positive ?? null, base)}
          notMeasured={missing}
          sub={q.sentiment ? `${pct(q.sentiment.negative, base)} sounded unhappy` : undefined}
        />
        <KpiCard
          label="Typical reply"
          value={none || q.replyP50Ms === null ? null : secs(q.replyP50Ms)}
          notMeasured={missing}
          sub={`Slowest 1 in 20: ${q.replyP95Ms === null ? 'not measured' : secs(q.replyP95Ms)}`}
        />
        <KpiCard label="First words" value={none || q.firstWordMs === null ? null : secs(q.firstWordMs)} notMeasured={missing} sub="From answering to the greeting" />
        <KpiCard
          label="Caller cut in"
          value={none || q.interruptionsPerCall === null ? null : q.interruptionsPerCall.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          notMeasured={missing}
          sub="Times per call, on average"
        />
      </KpiGrid>
      <div className="hd-stage">
        <h4 className="hd-subtitle">Where a reply's wait goes</h4>
        {stages === null ? (
          <p className="hd-note">{missing}.</p>
        ) : (
          <StageBar stages={stages} />
        )}
      </div>
    </>
  )
}

/** One bar split into the parts of a reply's wait, with each part's milliseconds in words beside it. */
function StageBar({ stages }: { stages: { slot: 1 | 2 | 3; label: string; value: number }[] }) {
  const total = stages.reduce((s, x) => s + x.value, 0)
  return (
    <div className="hd-stage__body">
      <div className="hd-stage__bar" role="img" aria-label={`Typical time for each part of a reply: ${stages.map((s) => `${s.label} ${ms(s.value)}`).join(', ')}.`}>
        {stages.map((s) => (
          <span key={s.slot} className={`hd-stage__seg hd-stage__seg--${s.slot}`} style={{ flexGrow: Math.max(s.value, 1) }} />
        ))}
      </div>
      <ul className="hd-stage__list" aria-label="Typical time for each part of a reply, in milliseconds">
        {stages.map((s) => (
          <li key={s.slot}>
            <span className={`chart__swatch chart__swatch--${s.slot}`} aria-hidden="true" />
            <span className="hd-stage__name">{s.label}</span>
            <strong className="num">{ms(s.value)}</strong>
            <span className="hd-stage__pct num">{total > 0 ? `${percent(s.value, total)}%` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface TopicRow {
  label: string
  calls: number
  share: number
  answered: number
  gap: number | null
}

function Topics({ r, overall, days, agentId, base, canCalls }: { r: Report; overall: number | null; days: Days; agentId: string; base: string; canCalls: boolean }) {
  const rows = useMemo<TopicRow[]>(
    () => r.intents.map((it) => ({ label: it.label, calls: it.calls, share: percent(it.calls, r.totals.calls), answered: percent(it.byAgent, it.calls), gap: topicGap(it, overall) })),
    [r, overall],
  )
  const columns = useMemo<Column<TopicRow>[]>(
    () => [
      {
        key: 'topic',
        header: 'Topic',
        cell: (row) =>
          canCalls ? (
            <Link className="link" to={`${base}/calls?q=${encodeURIComponent(row.label)}&days=${days}${agentId ? `&agent=${encodeURIComponent(agentId)}` : ''}`}>
              {row.label}
            </Link>
          ) : (
            row.label
          ),
        sortValue: (row) => row.label,
      },
      { key: 'calls', header: 'Calls', align: 'end', cell: (row) => num(row.calls), sortValue: (row) => row.calls, width: '5.5rem' },
      { key: 'share', header: 'Share of calls', align: 'end', cell: (row) => `${row.share}%`, sortValue: (row) => row.share, width: '7rem' },
      { key: 'answered', header: 'Answered by the agents', align: 'end', cell: (row) => `${row.answered}%`, sortValue: (row) => row.answered, width: '9rem' },
      { key: 'gap', header: 'Against the average', cell: (row) => <GapBar gap={row.gap} overall={overall} />, sortValue: (row) => row.gap, width: '14rem' },
    ],
    [base, days, agentId, canCalls, overall],
  )
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.label}
      caption="What callers want, and how many the agents answered on their own"
      defaultSort={{ key: 'calls', dir: 'descending' }}
      bar={false}
      maxHeight="24rem"
      empty="No calls in this period."
    />
  )
}

/**
 * A topic's answered share against the overall one: a bar either side of a
 * zero line, and the same said in words. A topic well below the average is
 * marked with an icon and "below average", not by colour. Too few calls and
 * it says so rather than draw a gap out of noise.
 */
function GapBar({ gap, overall }: { gap: number | null; overall: number | null }) {
  if (overall === null) return <span className="hd-gap__na">-</span>
  if (gap === null) return <span className="hd-gap__na">Too few calls to compare (under {MIN_TOPIC_COMPARE})</span>
  const worse = gap <= -GAP_POINTS
  const dir = gap < 0 ? 'below' : gap > 0 ? 'above' : 'same'
  return (
    <span className={`hd-gap hd-gap--${dir}${worse ? ' is-worse' : ''}`}>
      <span className="hd-gap__bar" aria-hidden="true">
        <span className="hd-gap__fill" style={{ width: `${Math.min(Math.abs(gap), 50)}%` }} />
      </span>
      <span className="hd-gap__text">
        {worse && <ToneIcon tone="warn" />}
        {gap === 0 ? 'Same as average' : `${gap < 0 ? '▼' : '▲'} ${Math.abs(gap)} ${Math.abs(gap) === 1 ? 'pt' : 'pts'} ${gap < 0 ? 'below' : 'above'} average`}
        {worse && <span className="sr-only">: worth a look</span>}
      </span>
    </span>
  )
}

interface AgentRow {
  id: string
  name: string
  calls: number
  answered: number
  success: number | null
  reply: number | null
}

function Agents({ r }: { r: Report }) {
  const rows = useMemo<AgentRow[]>(
    () => r.agents.map((a) => ({ id: a.agentId, name: a.name, calls: a.calls, answered: percent(a.byAgent, a.calls), success: a.success === null || a.calls === 0 ? null : percent(a.success, a.calls), reply: a.replyP50Ms })),
    [r],
  )
  const columns: Column<AgentRow>[] = [
    { key: 'agent', header: 'Agent', cell: (a) => <strong className="hd-strong">{a.name}</strong>, sortValue: (a) => a.name },
    { key: 'calls', header: 'Calls', align: 'end', cell: (a) => num(a.calls), sortValue: (a) => a.calls, width: '5.5rem' },
    { key: 'answered', header: 'Answered by the agent', align: 'end', cell: (a) => `${a.answered}%`, sortValue: (a) => a.answered, width: '9rem' },
    { key: 'success', header: 'Successful', align: 'end', cell: (a) => (a.success === null ? 'Not measured' : `${a.success}%`), sortValue: (a) => a.success, width: '8rem' },
    { key: 'reply', header: 'Typical reply', align: 'end', cell: (a) => (a.reply === null ? 'Not measured' : secs(a.reply)), sortValue: (a) => a.reply, width: '8rem' },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      caption={rows.length === 1 ? 'Calls, success and reply time for the agent' : 'Calls, success and reply time for each agent'}
      defaultSort={{ key: 'calls', dir: 'descending' }}
      bar={false}
      maxHeight="20rem"
      empty="No agent took calls in this period."
    />
  )
}
