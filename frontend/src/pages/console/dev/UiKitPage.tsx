import { useMemo, useRef, useState } from 'react'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { DataTable, type Column } from '../../../components/console/DataTable'
import { KpiCard, KpiGrid } from '../../../components/console/KpiCard'
import { useShortcuts } from '../../../components/console/KeyboardHelp'
import { Skeleton } from '../../../components/console/Skeleton'
import { SplitView } from '../../../components/console/SplitView'
import { StatusPill, type Tone } from '../../../components/console/StatusPill'
import { Timeline, type TimelineItem } from '../../../components/console/Timeline'
import { Toolbar, type FilterChip } from '../../../components/console/Toolbar'
import { UpdatedAgo } from '../../../components/console/UpdatedAgo'
import { useToast } from '../../../components/console/Toast'
import { WaitTimer } from '../../../components/console/WaitTimer'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Field'
import { SegFilter } from '../../../components/console/ListTools'
import './UiKit.css'

/**
 * /o/:slug/dev/ui, in development only (App.tsx registers it when
 * import.meta.env.DEV, so it never reaches a production build): the shared
 * working-screen components with realistic front-desk content, for
 * reviewing the foundation by eye. All of it is made up.
 */

type CallerState = 'person' | 'emergency' | 'upset' | 'oncall'

interface Caller {
  id: string
  name: string
  phone: string
  /** Seconds waiting when the page opened. */
  waited: number
  reason: string
  state: CallerState
  language: string
  line: string
  summary: string
  steps: { minsAgo: number; who?: string; kind: TimelineItem['kind']; title: string; body?: string }[]
}

const STATE: Record<CallerState, { tone: Tone; label: string }> = {
  person: { tone: 'info', label: 'Asking for a person' },
  emergency: { tone: 'danger', label: 'Emergency' },
  upset: { tone: 'warn', label: 'Upset' },
  oncall: { tone: 'live', label: 'On call' },
}

const CALLERS: Caller[] = [
  {
    id: 'c1', name: 'Ramesh Iyer', phone: '+91 98xxx x1234', waited: 410, reason: 'Chest pain, wants the casualty doctor', state: 'emergency', language: 'Tamil', line: 'Main line',
    summary: 'Caller says his father has had chest pain for twenty minutes. The agent gave the casualty number and passed the call at once.',
    steps: [
      { minsAgo: 7, kind: 'call', title: 'Call came in on the main line' },
      { minsAgo: 7, who: 'The agent', kind: 'agent', title: 'Heard "chest pain" and asked if the patient was breathing', body: 'Caller: "Yes, but he is sweating a lot."' },
      { minsAgo: 6, who: 'The agent', kind: 'alert', title: 'Marked as an emergency and passed to the front desk' },
    ],
  },
  {
    id: 'c2', name: 'Latha Venkatesh', phone: '+91 97xxx x4821', waited: 205, reason: 'Wants to reschedule Dr Menon on Friday', state: 'person', language: 'English', line: 'Appointments',
    summary: 'Needs to move a cardiology follow-up from Friday morning to the afternoon. The agent could not see a free afternoon slot.',
    steps: [
      { minsAgo: 4, kind: 'call', title: 'Call came in on the appointments line' },
      { minsAgo: 4, who: 'The agent', kind: 'agent', title: 'Found the booking for Friday 10:30 with Dr Menon' },
      { minsAgo: 3, who: 'The agent', kind: 'agent', title: 'No afternoon slot free; offered Monday, caller declined' },
    ],
  },
  {
    id: 'c3', name: 'Mohammed Farook', phone: '+91 99xxx x7733', waited: 95, reason: 'Billing: charged twice for a scan', state: 'upset', language: 'Hindi', line: 'Main line',
    summary: 'Says the MRI was billed twice on the same invoice. Raised his voice twice; the agent offered an apology and passed him on.',
    steps: [
      { minsAgo: 2, kind: 'call', title: 'Call came in on the main line' },
      { minsAgo: 2, who: 'The agent', kind: 'agent', title: 'Caller described a double charge on invoice 20418' },
      { minsAgo: 1, who: 'The agent', kind: 'note', title: 'Caller sounds upset', body: 'Raised voice detected twice in the last minute.' },
    ],
  },
  {
    id: 'c4', name: 'Anitha Krishnan', phone: '+91 94xxx x2290', waited: 40, reason: 'Lab report not received by email', state: 'person', language: 'Tamil', line: 'Main line',
    summary: 'Blood test was on Monday. The report was promised by email on Tuesday and has not arrived.',
    steps: [
      { minsAgo: 1, kind: 'call', title: 'Call came in on the main line' },
      { minsAgo: 1, who: 'The agent', kind: 'agent', title: 'Lab reports are not something the agent can look up; passed to the front desk' },
    ],
  },
  {
    id: 'c5', name: 'Sunita Rao', phone: '+91 98xxx x6107', waited: 12, reason: 'Asking about visiting hours in the ICU', state: 'oncall', language: 'English', line: 'Main line',
    summary: 'The agent is still on this call, answering from the visiting-hours notice. Not waiting for a person.',
    steps: [
      { minsAgo: 0, kind: 'call', title: 'Call came in on the main line' },
      { minsAgo: 0, who: 'The agent', kind: 'agent', title: 'Reading out the ICU visiting hours' },
    ],
  },
]

const AGENTS = ['Appointments', 'Reception', 'Pharmacy line']
const TOPICS = ['Book a visit', 'Reschedule', 'Doctor availability', 'Lab report', 'Billing', 'Directions', 'Visiting hours', 'Pharmacy stock']
const NAMES = ['Meera Nair', 'Arun Prakash', 'Divya Menon', 'Kabir Shaikh', 'Lakshmi Devi', 'Joseph Mathew', 'Pooja Bansal', 'Suresh Kumar', 'Fatima Begum', 'Naveen Reddy', 'Gita Subramanian', 'Imran Khan', 'Revathi S', 'Harish Patel', 'Nisha George']
const OUTCOMES: { tone: Tone; label: string }[] = [
  { tone: 'ok', label: 'Resolved' },
  { tone: 'ok', label: 'Booked' },
  { tone: 'info', label: 'Handed to staff' },
  { tone: 'warn', label: 'Callback needed' },
  { tone: 'neutral', label: 'Hung up' },
  { tone: 'danger', label: 'Emergency' },
]

interface CallRow {
  id: string
  at: number
  caller: string
  agent: string
  topic: string
  outcome: { tone: Tone; label: string }
  seconds: number
}

function makeCalls(base: number): CallRow[] {
  return Array.from({ length: 25 }, (_, i) => ({
    id: `call-${i + 1}`,
    at: base - i * 7.5 * 60_000,
    caller: NAMES[(i * 7) % NAMES.length],
    agent: AGENTS[i % AGENTS.length],
    topic: TOPICS[(i * 3) % TOPICS.length],
    outcome: OUTCOMES[(i * 5 + (i % 3)) % OUTCOMES.length],
    seconds: 35 + ((i * 53) % 290),
  }))
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const wait = (s: number) => s

export default function UiKitPage() {
  const toast = useToast()
  const [base] = useState(() => Date.now())
  const search = useRef<HTMLInputElement>(null)
  // A wide screen starts with the first caller open; a narrow one starts on the list,
  // since there the detail is a drawer over it.
  const [openId, setOpenId] = useState<string | null>(() => (window.matchMedia?.('(min-width: 1100px)').matches ? 'c1' : null))
  const [filter, setFilter] = useState<'all' | CallerState>('all')
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const calls = useMemo(() => makeCalls(base), [base])
  const shown = CALLERS.filter((c) => (filter === 'all' || c.state === filter) && (text === '' || `${c.name} ${c.reason}`.toLowerCase().includes(text.toLowerCase())))
  const open = CALLERS.find((c) => c.id === openId) ?? null

  const chips: FilterChip[] = [
    ...(filter !== 'all' ? [{ id: 'state', label: `Status: ${STATE[filter].label}`, onRemove: () => setFilter('all') }] : []),
    ...(text ? [{ id: 'text', label: `Search: ${text}`, onRemove: () => setText('') }] : []),
  ]
  const clear = () => {
    setFilter('all')
    setText('')
  }

  useShortcuts({
    '/': { description: 'Search the queue', run: () => search.current?.focus() },
    e: { description: 'Show emergencies only', run: () => setFilter('emergency') },
    c: { description: 'Clear all filters', run: clear },
  })

  const columns: Column<CallRow>[] = [
    { key: 'at', header: 'Time', cell: (r) => new Date(r.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }), sortValue: (r) => r.at, width: '6.5rem' },
    { key: 'caller', header: 'Caller', cell: (r) => <strong className="who__name-sm">{r.caller}</strong>, sortValue: (r) => r.caller },
    { key: 'agent', header: 'Agent', cell: (r) => r.agent, sortValue: (r) => r.agent },
    { key: 'topic', header: 'Topic', cell: (r) => r.topic, sortValue: (r) => r.topic },
    { key: 'outcome', header: 'Outcome', cell: (r) => <StatusPill tone={r.outcome.tone}>{r.outcome.label}</StatusPill>, sortValue: (r) => r.outcome.label },
    { key: 'dur', header: 'Duration', align: 'end', cell: (r) => mmss(r.seconds), sortValue: (r) => r.seconds, width: '7rem' },
  ]

  const timeline = (c: Caller): TimelineItem[] => c.steps.map((s, i) => ({ id: `${c.id}-${i}`, at: new Date(base - s.minsAgo * 60_000), who: s.who, kind: s.kind, title: s.title, body: s.body }))

  return (
    <ConsolePage
      kicker="Developer"
      title="UI kit"
      docTitle="UI kit"
      status={<UpdatedAgo at={base} />}
      lede={<p>The shared working-screen components, with made-up front-desk content. Development only. Press ? for this page's shortcuts.</p>}
    >
      <div className="kit">
        <section className="kit__section" aria-labelledby="kit-kpi">
          <h2 id="kit-kpi" className="kit__title">
            Today so far
          </h2>
          <KpiGrid label="Today so far">
            <KpiCard label="Calls" value="212" sub="since 8 am" change={{ now: 212, before: 188, period: 'this time yesterday', upIsGood: true }} series={[14, 18, 22, 19, 27, 31, 26, 29, 35, 33, 38, 41, 37, 44]} seriesLabel="Calls an hour, since 8 am" />
            <KpiCard label="Answered by the agent" value="86%" sub="of 212 calls" change={{ now: 86, before: 82, period: 'yesterday', upIsGood: true, format: (n) => `${n} points` }} series={[78, 80, 79, 83, 82, 85, 84, 86]} seriesLabel="Answered by the agent, last 8 days" seriesFormat={(n) => `${n}%`} />
            <KpiCard label="Handed to staff" value="23" sub="11% of calls" change={{ now: 23, before: 31, period: 'yesterday', upIsGood: false }} series={[4, 3, 5, 2, 4, 3, 2]} seriesLabel="Handed to staff, last 7 hours" />
            <KpiCard label="Hung up" value="7" sub="before the agent finished" series={[1, 0, 2, 1, 1, 0, 2]} seriesLabel="Hung up, last 7 hours" />
            <KpiCard label="Typical reply" value="1.4 s" sub="median, agent to caller" change={{ now: 1.4, before: 1.1, period: 'yesterday', upIsGood: false, words: ['slower', 'faster'], format: (n) => `${n.toFixed(1)} s` }} series={[1.1, 1.2, 1.1, 1.3, 1.4, 1.3, 1.4]} seriesLabel="Typical reply time, last 7 hours" seriesFormat={(n) => `${n.toFixed(1)} s`} />
            <KpiCard label="Caller rating" value={null} notMeasured="Callers aren't asked yet" />
          </KpiGrid>
        </section>

        <section className="kit__section" aria-labelledby="kit-split">
          <h2 id="kit-split" className="kit__title">
            Callers waiting
          </h2>
          <p className="kit__note">A split view: the list on the left, the caller on the right. Drag the divider, or focus it and use the arrow keys. Below 1100px the caller opens in a drawer.</p>
          <Toolbar
            label="Filter the queue"
            search={<TextField ref={search} label="Search the queue" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name or reason" />}
            filters={
              <SegFilter<'all' | CallerState>
                legend="Status"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'emergency', label: 'Emergency' },
                  { value: 'person', label: 'Asking for a person' },
                  { value: 'upset', label: 'Upset' },
                  { value: 'oncall', label: 'On call' },
                ]}
              />
            }
            summary={`${shown.length} of ${CALLERS.length} callers`}
            chips={chips}
            onClearAll={clear}
            sticky={false}
          />
          <SplitView
            storageKey="aica.split.ui-kit"
            listLabel="Callers waiting"
            detailLabel="Caller details"
            detailOpen={open !== null}
            onCloseDetail={() => setOpenId(null)}
            detailEmpty={<p className="split__empty">Pick a caller to see what the agent heard and what has happened so far.</p>}
            list={
              shown.length === 0 ? (
                <p className="split__empty">No callers match. Clear the filters to see everyone.</p>
              ) : (
                <ul className="queue">
                  {shown.map((c) => (
                    <li key={c.id} className="queue__item">
                      <button type="button" className="queue__btn" aria-current={openId === c.id} onClick={() => setOpenId(c.id)}>
                        <span className="queue__top">
                          <span className="queue__name">{c.name}</span>
                          {c.state === 'oncall' ? <span className="queue__phone">with the agent</span> : <WaitTimer since={base - c.waited * 1000} warn={wait(120)} alert={wait(300)} />}
                        </span>
                        <span className="queue__phone num">{c.phone}</span>
                        <span className="queue__reason">{c.reason}</span>
                        <span className="queue__tags">
                          <StatusPill tone={STATE[c.state].tone}>{STATE[c.state].label}</StatusPill>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
            detail={
              open && (
                <div className="who">
                  <div className="who__head">
                    <h3 className="who__name">{open.name}</h3>
                    <StatusPill tone={STATE[open.state].tone}>{STATE[open.state].label}</StatusPill>
                  </div>
                  <dl className="who__facts">
                    <div>
                      <dt>Phone</dt>
                      <dd className="num">{open.phone}</dd>
                    </div>
                    <div>
                      <dt>Language</dt>
                      <dd>{open.language}</dd>
                    </div>
                    <div>
                      <dt>Line</dt>
                      <dd>{open.line}</dd>
                    </div>
                    <div>
                      <dt>Waiting</dt>
                      <dd>{open.state === 'oncall' ? 'Not waiting' : <WaitTimer since={base - open.waited * 1000} />}</dd>
                    </div>
                  </dl>
                  <p className="who__summary">{open.summary}</p>
                  <div className="who__actions">
                    <Button size="sm" onClick={() => toast.show({ message: `Put through to you: ${open.name}`, tone: 'ok' })}>
                      Take the call
                    </Button>
                    <Button size="sm" variant="line" onClick={() => toast.show({ message: `Turned ${open.name} into a callback`, action: { label: 'Undo', onClick: () => toast.show({ message: 'Callback undone' }) } })}>
                      Make it a callback
                    </Button>
                  </div>
                  <h4 className="who__h">What has happened</h4>
                  <Timeline label={`Timeline for ${open.name}`} items={timeline(open)} />
                </div>
              )
            }
          />
        </section>

        <div className="kit__cols">
          <section className="kit__section" aria-labelledby="kit-table">
            <h2 id="kit-table" className="kit__title">
              Today's calls
            </h2>
            <p className="kit__note">Click a header to sort, use the arrow keys to move between rows and Enter to open one. {picked ? `Opened: ${picked}.` : 'Nothing opened yet.'}</p>
            <DataTable
              caption="Today's calls"
              columns={columns}
              rows={calls}
              rowKey={(r) => r.id}
              rowLabel={(r) => `${r.caller}, ${r.topic}`}
              defaultSort={{ key: 'at', dir: 'descending' }}
              selectedKey={calls.find((r) => `${r.caller}, ${r.topic}` === picked)?.id ?? null}
              onSelect={(r) => setPicked(`${r.caller}, ${r.topic}`)}
              checked={{ keys: checked, onChange: (k) => setChecked(k) }}
              loading={loading}
              densityKey="aica.table.ui-kit"
              maxHeight="28rem"
              empty="No calls today."
            />
          </section>

          <div className="kit__aside">
            <section className="kit__card" aria-labelledby="kit-timers">
              <h2 id="kit-timers" className="kit__title">
                Wait timers
              </h2>
              <p className="kit__note">Warns at 2 minutes, then alerts at 5. The words and icon change, not just the colour.</p>
              {[30, 150, 420, 4000].map((s) => (
                <div key={s} className="kit__row">
                  <WaitTimer since={base - s * 1000} />
                </div>
              ))}
            </section>

            <section className="kit__card" aria-labelledby="kit-pills">
              <h2 id="kit-pills" className="kit__title">
                Status pills
              </h2>
              <div className="kit__row">
                <StatusPill>Neutral</StatusPill>
                <StatusPill tone="info">Info</StatusPill>
                <StatusPill tone="ok">Resolved</StatusPill>
                <StatusPill tone="warn">Needs a check</StatusPill>
                <StatusPill tone="danger">Emergency</StatusPill>
                <StatusPill tone="live">On call</StatusPill>
              </div>
            </section>

            <section className="kit__card" aria-labelledby="kit-load" aria-busy={loading}>
              <h2 id="kit-load" className="kit__title">
                Loading and toasts
              </h2>
              {loading ? (
                <>
                  <p role="status" className="sr-only">
                    Loading the calls…
                  </p>
                  <Skeleton lines={3} />
                  <Skeleton block height="4rem" />
                </>
              ) : (
                <p className="kit__note">Skeletons stand in while data loads. Switch them on to see them (the table shows its own).</p>
              )}
              <div className="kit__row">
                <Button size="sm" variant="line" onClick={() => setLoading((l) => !l)}>
                  {loading ? 'Stop loading' : 'Show loading'}
                </Button>
                <Button
                  size="sm"
                  variant="line"
                  onClick={() =>
                    toast.show({
                      message: 'Callback for Latha Venkatesh closed',
                      action: { label: 'Undo', onClick: () => toast.show({ message: 'Callback reopened', tone: 'ok' }) },
                    })
                  }
                >
                  Close a callback
                </Button>
                <Button size="sm" variant="line" onClick={() => toast.show({ message: 'Could not reach the call server. Trying again.', tone: 'danger' })}>
                  Show an error
                </Button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </ConsolePage>
  )
}
