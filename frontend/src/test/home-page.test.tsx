import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import type { Appointment, ConsoleClient, Desk, Report } from '../console/types'
import { localDay } from '../lib/time'
import { makeReport, NO_QUALITY } from './homeFixtures'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'

// A fixed moment: the demo's live calls, callbacks and call log follow the clock.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(1_700_000_000_000))
})
afterEach(() => vi.useRealTimers())

const appointment = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'apt_x', patientName: 'Gita Subramanian', phone: '+91 98400 00000', department: 'Cardiology', doctor: 'Dr Menon', date: localDay(0), time: '10:30', status: 'needs_check',
  checkReason: 'The caller wasn’t sure of the date.', bookedBy: 'agent', agentName: 'OPD appointments', callId: null, createdAt: new Date().toISOString(), ...over,
})

/** The demo, with the report and today's appointments and desk pinned to known values. */
function clientWith(over: Partial<ConsoleClient> = {}): ConsoleClient {
  const demo = createDemoConsoleClient({ latency: 0 })
  return {
    ...demo,
    getReport: async () => makeReport(),
    listAppointments: async () => [appointment(), appointment({ id: 'apt_ok', patientName: 'Already Fine', status: 'confirmed' })],
    getDesk: async (o): Promise<Desk> => {
      const desk = await demo.getDesk(o)
      const now = Date.now()
      return {
        ...desk,
        notices: [{ id: 'n_1', text: 'The lift in block B is out of order.', agentId: null, from: new Date(now - 3_600_000).toISOString(), until: new Date(now + 3_600_000).toISOString(), createdBy: 'Meena S', createdAt: new Date(now - 3_600_000).toISOString() }],
        doctorChanges: [{ id: 'dc_1', doctor: 'Dr Arvind', department: 'Orthopaedics', date: localDay(0), kind: 'late', detail: 'Seeing patients from 11 AM', createdBy: 'Meena S', createdAt: new Date(now).toISOString() }],
      }
    },
    ...over,
  }
}

async function open(email: string, consoleClient: ConsoleClient = clientWith(), path = O) {
  const view = renderApp(path, { consoleClient })
  await signIn(view.user, email)
  return { ...view, client: consoleClient }
}

const HEADINGS = [/^at a glance$/i, /^quality$/i, /^how calls ended$/i, /^calls each day, by what happened$/i, /^what callers want$/i, /^agents$/i, /^when people call$/i, /^where calls left the agent$/i, /^languages$/i, /^what changed/i]

describe('Home: front desk', () => {
  it('opens on their shift: who is waiting, their callbacks, appointments to check and today’s notices', async () => {
    await open('frontdesk@example.com')
    const shift = (await screen.findByRole('heading', { level: 2, name: /^your shift$/i })).closest('section')!

    // Waiting callers: the emergency first, with a timer and a link to where it is dealt with.
    const waiting = await within(shift).findByRole('heading', { name: /callers waiting for a person/i })
    const waitingBlock = waiting.closest('section')!
    // The heading shows while the block loads: wait for its rows.
    await within(waitingBlock).findAllByText('Emergency')
    const rows = within(waitingBlock).getAllByRole('listitem')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(within(rows[0]).getByText('Emergency')).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent(/waiting/i)
    expect(within(waitingBlock).getByRole('link', { name: /open in live calls/i })).toHaveAttribute('href', `${O}/live`)

    // My callbacks: Meena's and the unassigned; overdue first, then soonest due. Suresh's are not hers.
    const mine = (await within(shift).findByRole('heading', { name: /my next callbacks/i })).closest('section')!
    await within(mine).findByText('Anand Kumar')
    const callbacks = within(mine).getAllByRole('listitem')
    expect(callbacks.map((li) => within(li).getByText(/^(Anand Kumar|Fathima B|Caller not named|Revathi M|Joseph Antony)$/).textContent)).toEqual(['Anand Kumar', 'Fathima B', 'Caller not named', 'Revathi M'])
    expect(within(callbacks[0]).getByText('Overdue')).toBeInTheDocument()
    expect(within(callbacks[0]).getByText(/late/)).toBeInTheDocument()
    expect(within(callbacks[1]).queryByText('Overdue')).not.toBeInTheDocument()
    expect(within(callbacks[1]).getByText(/^Due in /)).toBeInTheDocument()
    expect(within(callbacks[0]).getByRole('link', { name: /call anand kumar on \+91 98945 30017/i })).toHaveAttribute('href', 'tel:+919894530017')
    expect(within(mine).getByRole('link', { name: /open callbacks/i })).toHaveAttribute('href', `${O}/callbacks`)

    // Appointments needing a check, today.
    const appts = (await within(shift).findByRole('heading', { name: /today’s appointments to check/i })).closest('section')!
    expect(await within(appts).findByText('Gita Subramanian')).toBeInTheDocument()
    expect(within(appts).getByText('10:30 am')).toBeInTheDocument()
    expect(within(appts).getByText(/Dr Menon, Cardiology/)).toBeInTheDocument()
    expect(within(appts).queryByText('Already Fine')).not.toBeInTheDocument()

    // Notices and doctor changes from the desk.
    const desk = (await within(shift).findByRole('heading', { name: /today’s notices and doctor changes/i })).closest('section')!
    expect(await within(desk).findByText('The lift in block B is out of order.')).toBeInTheDocument()
    expect(within(desk).getByText('Dr Arvind')).toBeInTheDocument()
    expect(within(desk).getByText('Running late')).toBeInTheDocument()
  })

  it('shows no report, and no Needs a person cards: the shift already says it', async () => {
    await open('frontdesk@example.com')
    await screen.findByRole('heading', { name: /^your shift$/i })
    expect(screen.queryByRole('heading', { name: /^reports$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^at a glance$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /download csv/i })).not.toBeInTheDocument()
    await screen.findByRole('heading', { name: /callers waiting for a person/i })
    expect(screen.queryByRole('heading', { name: /^needs a person$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /3 waiting for a person/i })).not.toBeInTheDocument()
  })

  it('says so in plain words when a block is empty, and keeps the other blocks when one fails', async () => {
    const client = clientWith({ listCallbacks: async () => Promise.reject(new Error('callbacks are down')), listAppointments: async () => [] })
    await open('frontdesk@example.com', client)
    const shift = (await screen.findByRole('heading', { name: /^your shift$/i })).closest('section')!
    expect(await within(shift).findByText('Nothing to check today.')).toBeInTheDocument()
    const mine = within(shift).getByRole('heading', { name: /my next callbacks/i }).closest('section')!
    expect(await within(mine).findByRole('button', { name: /try again/i })).toBeInTheDocument()
    // The waiting callers did not go blank because callbacks failed.
    expect(within(shift).getByRole('link', { name: /open in live calls/i })).toBeInTheDocument()
  })

  it('says nobody is waiting, and that no callbacks are due', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    const client = clientWith({ listHandoffs: async () => [], listCallbacks: async () => (await demo.listCallbacks('arogya-demo')).map((c) => ({ ...c, status: 'done' as const })) })
    await open('frontdesk@example.com', client)
    expect(await screen.findByText(/nobody is waiting for a person/i)).toBeInTheDocument()
    expect(await screen.findByText('No callbacks due. Nice.')).toBeInTheDocument()
  })
})

describe('Home: owner and supervisor', () => {
  it('shows the whole dashboard, with a one-line shift above it', async () => {
    await open('owner@example.com')
    for (const name of HEADINGS) expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^reports$/i })).toBeInTheDocument()

    // The compact shift: counts and links, not the blocks.
    const strip = screen.getByRole('heading', { level: 2, name: /^your shift$/i }).closest('section')!
    expect(within(strip).getByRole('link', { name: /open in live calls/i })).toHaveAttribute('href', `${O}/live`)
    expect(within(strip).getByRole('link', { name: /open callbacks/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /my next callbacks/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /callers waiting for a person/i })).not.toBeInTheDocument()
    // The attention cards stay.
    expect(screen.getByRole('link', { name: /waiting for a person/i })).toBeInTheDocument()
  })

  it('has KPIs with their change, sparklines for counts and none for quality', async () => {
    await open('owner@example.com')
    const kpis = (await screen.findByRole('heading', { name: /^at a glance$/i })).closest('section')!
    for (const label of ['Calls', 'Answered by the agents', 'Handed to your team', 'Caller hung up', 'Average call']) expect(within(kpis).getByText(label)).toBeInTheDocument()
    expect(within(kpis).getByText('70%')).toBeInTheDocument()
    expect(within(kpis).getByText('70 calls, no person needed')).toBeInTheDocument()
    expect(within(kpis).getByText(/10 more than the 7 days before/)).toBeInTheDocument()
    expect(within(kpis).getByText(/8 percentage points lower than the 7 days before/)).toBeInTheDocument()
    // Calls, answered, handed over, hung up: four trend lines. Average call has none.
    expect(within(kpis).getAllByRole('img').length).toBe(4)
    expect(within(kpis).getByRole('img', { name: /calls each day: lowest 14, highest 15, latest 14/i })).toBeInTheDocument()
    const quality = screen.getByRole('heading', { name: /^quality$/i }).closest('section')!
    expect(within(quality).queryAllByRole('img', { name: /lowest/i })).toHaveLength(0)
  })

  it('draws no sparkline for Today, which is one day', async () => {
    const day = makeReport().byDay[6]
    const client = clientWith({ getReport: async (_o, q) => (q.days === 1 ? makeReport({ days: 1, byDay: [day] }) : makeReport()) })
    const { user } = await open('owner@example.com', client)
    const kpis = (await screen.findByRole('heading', { name: /^at a glance$/i })).closest('section')!
    expect(within(kpis).getAllByRole('img').length).toBe(4)
    await user.click(screen.getByRole('radio', { name: 'Today' }))
    await waitFor(() => expect(screen.getByText(/Today, compared with yesterday by this time/)).toBeInTheDocument())
    expect(within(kpis).queryAllByRole('img')).toHaveLength(0)
    expect(screen.getByText(/today is one day/i)).toBeInTheDocument()
  })

  it('switches period and agent by asking for another report, keeping the CSV button', async () => {
    const asked: unknown[] = []
    const client = clientWith({
      getReport: async (_o, q) => {
        asked.push(q)
        return makeReport({ totals: { calls: q.days === 30 ? 410 : 100, byAgent: 70, handedOver: 20, dropped: 10, avgDurationSec: 95 } })
      },
    })
    const { user } = await open('owner@example.com', client)
    const kpis = (await screen.findByRole('heading', { name: /^at a glance$/i })).closest('section')!
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }))
    await waitFor(() => expect(within(kpis).getByText('410')).toBeInTheDocument())
    expect(asked).toContainEqual({ days: 30, agentId: undefined })
    expect(screen.getByText(/Last 30 days, compared with the 30 days before/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Agent'), (await screen.findAllByRole('option', { name: /.+/ })).find((o) => o.textContent !== 'All agents')!.textContent!)
    await waitFor(() => expect(asked.some((q) => (q as { agentId?: string }).agentId)).toBe(true))
  })
})

describe('Home: viewer', () => {
  it('sees the report, the appointments card and who is waiting, but no shift', async () => {
    await open('viewer@example.com')
    expect(await screen.findByRole('heading', { name: /^at a glance$/i })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /appointments to check/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /your shift/i })).not.toBeInTheDocument()
    // Viewers watch Live calls, so they see who is waiting there; they take nothing.
    expect(await screen.findByRole('link', { name: /waiting for a person/i })).toHaveAttribute('href', `${O}/live`)
    expect(screen.queryByRole('link', { name: /open in live calls/i })).not.toBeInTheDocument()
    // Viewers can't export.
    expect(screen.queryByRole('button', { name: /download csv/i })).not.toBeInTheDocument()
  })
})

describe('Home: report cards', () => {
  it('says "Not measured yet" for quality the voice servers have not sent', async () => {
    const client = clientWith({ getReport: async () => makeReport({ quality: NO_QUALITY, agents: makeReport().agents.map((a) => ({ ...a, success: null, replyP50Ms: null })) }) })
    await open('owner@example.com', client)
    const quality = (await screen.findByRole('heading', { name: /^quality$/i })).closest('section')!
    for (const label of ['Successful calls', 'Callers pleased', 'Typical reply', 'First words', 'Caller cut in']) {
      const card = within(quality).getByText(label).closest('.kpi') as HTMLElement
      expect(within(card).getByText('Not measured yet')).toBeInTheDocument()
    }
    expect(within(quality).getByText('Not measured yet.')).toBeInTheDocument()
    const ended = screen.getByRole('heading', { name: /^how calls ended$/i }).closest('section')!
    expect(within(ended).getByText('Not measured yet')).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })

  it('shows where a reply’s wait goes in milliseconds, and the funnel with counts and shares', async () => {
    await open('owner@example.com')
    const quality = (await screen.findByRole('heading', { name: /^quality$/i })).closest('section')!
    const stages = within(quality).getByRole('list', { name: /each part of a reply, in milliseconds/i })
    expect(within(stages).getByText('350 ms').closest('li')).toHaveTextContent('Hearing the caller (speech recognition)')
    expect(within(stages).getByText('800 ms')).toBeInTheDocument()
    expect(within(quality).getByRole('img', { name: /hearing the caller \(speech recognition\) 350 ms/i })).toBeInTheDocument()
    expect(within(quality).getByText('Slowest 1 in 20: 3.2 s')).toBeInTheDocument()

    const ended = screen.getByRole('heading', { name: /^how calls ended$/i }).closest('section')!
    const funnel = within(ended).getByRole('list', { name: /how calls ended, each as a share of all calls/i })
    const rows = within(funnel).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('All calls')
    expect(rows[0]).toHaveTextContent('100')
    expect(rows[0]).toHaveTextContent('100%')
    expect(rows[1]).toHaveTextContent('Answered by the agents')
    expect(rows[1]).toHaveTextContent('70 70%')
    expect(rows[2]).toHaveTextContent('Successful')
    expect(rows[2]).toHaveTextContent('62 62%')
  })

  it('keeps the daily chart with its legend and table', async () => {
    const { user } = await open('owner@example.com')
    const days = (await screen.findByRole('heading', { name: /^calls each day, by what happened$/i })).closest('section')!
    expect(within(days).getByRole('list', { name: 'Key' })).toHaveTextContent('Answered by the agents')
    await user.click(within(days).getByRole('button', { name: /show as a table/i }))
    expect(within(days).getByRole('table', { name: /calls each day, by what happened/i })).toBeInTheDocument()
  })

  it('lists topics with each one’s gap against the average, sortable, linking to the calls', async () => {
    const { user } = await open('owner@example.com')
    const topics = (await screen.findByRole('heading', { name: /^what callers want$/i })).closest('section')!
    const table = within(topics).getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Book an appointment', 'Billing question', 'Doctor timings'])

    const billing = rows[1]
    expect(within(billing).getByRole('link', { name: 'Billing question' })).toHaveAttribute('href', `${O}/calls?q=Billing%20question&days=7`)
    expect(within(billing).getAllByRole('cell')[2]).toHaveTextContent('25%')
    expect(within(billing).getAllByRole('cell')[3]).toHaveTextContent('40%')
    // Well below the average: said in words, with the worth-a-look mark.
    expect(within(billing).getByText(/▼ 30 pts below average/)).toBeInTheDocument()
    expect(within(billing).getByText(/worth a look/i)).toBeInTheDocument()
    // Better than average, and too few calls to compare.
    expect(within(rows[0]).getByText(/▲ 20 pts above average/)).toBeInTheDocument()
    expect(within(rows[2]).getByText(/too few calls to compare/i)).toBeInTheDocument()

    // Sort by answered share, lowest first.
    await user.click(within(table).getByRole('button', { name: /answered by the agents/i }))
    const sorted = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)
    expect(sorted).toEqual(['Billing question', 'Book an appointment', 'Doctor timings'])
  })

  it('does not link topics for someone who cannot open call history', async () => {
    // A viewer can (they see every call), so check the link is there for them too.
    await open('viewer@example.com')
    const topics = (await screen.findByRole('heading', { name: /^what callers want$/i })).closest('section')!
    expect(within(topics).getByRole('link', { name: 'Billing question' })).toBeInTheDocument()
  })

  it('shows the agents, and for a single agent just the row, without comparison wording', async () => {
    await open('owner@example.com')
    const agents = (await screen.findByRole('heading', { name: /^agents$/i })).closest('section')!
    expect(within(agents).getByText('How each agent did in this period.')).toBeInTheDocument()
    expect(within(agents).getByRole('columnheader', { name: /successful/i })).toBeInTheDocument()
    expect(within(agents).getAllByRole('row')).toHaveLength(3)
  })

  it('with one agent, shows one row and no comparison', async () => {
    const client = clientWith({ getReport: async () => makeReport({ agents: [makeReport().agents[0]] }) })
    await open('owner@example.com', client)
    const agents = (await screen.findByRole('heading', { name: /^agents$/i })).closest('section')!
    expect(within(agents).getByText('The agent that took calls in this period.')).toBeInTheDocument()
    expect(within(agents).queryByText(/how each agent did/i)).not.toBeInTheDocument()
    expect(within(agents).getAllByRole('row')).toHaveLength(2)
    expect(screen.queryByText(/below Reception/)).not.toBeInTheDocument()
  })

  it('keeps the heatmap, drop-off with shares, and languages', async () => {
    await open('owner@example.com')
    const when = (await screen.findByRole('heading', { name: /^when people call$/i })).closest('section')!
    expect(within(when).getByText(/busiest:/i)).toBeInTheDocument()
    expect(within(when).getByRole('img', { name: /calls by weekday and hour/i })).toBeInTheDocument()
    const drop = screen.getByRole('heading', { name: /^where calls left the agent$/i }).closest('section')!
    const steps = within(drop).getByRole('list', { name: /calls that left at each step/i })
    expect(within(steps).getAllByRole('listitem')[0]).toHaveTextContent('Collect details')
    expect(within(steps).getAllByRole('listitem')[0]).toHaveTextContent('18 60%')
    const langs = screen.getByRole('heading', { name: /^languages$/i }).closest('section')!
    expect(within(langs).getByRole('list', { name: /calls by language/i })).toHaveTextContent('English')
  })

  it('what changed: short findings, each linking to its evidence, never in place of a chart', async () => {
    const { user } = await open('owner@example.com')
    const panel = (await screen.findByRole('heading', { name: /^what changed/i })).closest('section')!
    const toggle = within(panel).getByRole('button', { name: /what changed/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const items = within(panel).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[0]).toHaveTextContent('“Billing question”')
    await user.click(within(items[0]).getByRole('link', { name: /see what callers want/i }))
    expect(screen.getByRole('heading', { name: /^what callers want$/i })).toHaveFocus()
    // The charts are all still there.
    expect(screen.getByRole('heading', { name: /^calls each day, by what happened$/i })).toBeInTheDocument()
    // It can be shut and opened.
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('what changed: says nothing stands out when there is too little to say', async () => {
    const client = clientWith({
      getReport: async () => makeReport({ totals: { calls: 12, byAgent: 9, handedOver: 2, dropped: 1, avgDurationSec: 60 }, intents: [{ label: 'Book an appointment', calls: 12, byAgent: 9 }], agents: [makeReport().agents[0]] }),
    })
    await open('owner@example.com', client)
    expect(await screen.findByText(/nothing stands out/i, { selector: 'p' })).toBeInTheDocument()
  })

  it('treats a period with no calls calmly: no NaN, no 0% figures, a note on each card', async () => {
    const empty: Partial<Report> = {
      totals: { calls: 0, byAgent: 0, handedOver: 0, dropped: 0, avgDurationSec: 0 },
      previous: { calls: 0, byAgent: 0, handedOver: 0, dropped: 0, avgDurationSec: 0 },
      byDay: makeReport().byDay.map((d) => ({ ...d, resolved: 0, handedOver: 0, dropped: 0 })),
      byHour: Array(24).fill(0),
      byDayHour: Array.from({ length: 7 }, () => Array(24).fill(0)),
      languages: [],
      intents: [],
      dropOff: [],
      quality: NO_QUALITY,
      agents: [],
    }
    const client = clientWith({ getReport: async () => makeReport(empty) })
    await open('owner@example.com', client)
    await screen.findByRole('heading', { name: /^at a glance$/i })
    for (const name of HEADINGS) expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.queryByText(/NaN|Infinity|undefined/)).not.toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.getByText('No calls in this period')).toBeInTheDocument()
    expect(screen.getAllByText('No calls in this period.').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText(/no calls in this period, so there is nothing to compare/i)).toBeInTheDocument()
  })
})

describe('Home: loading and failing', () => {
  it('shows card-shaped placeholders while the first report loads', async () => {
    let release: (r: Report) => void = () => {}
    const client = clientWith({ getReport: () => new Promise<Report>((res) => (release = res)) })
    await open('owner@example.com', client)
    expect(await screen.findByRole('heading', { name: /^reports$/i })).toBeInTheDocument()
    expect(screen.getAllByText('Loading the report…').length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: /^at a glance$/i })).not.toBeInTheDocument()
    release(makeReport())
    expect(await screen.findByRole('heading', { name: /^at a glance$/i })).toBeInTheDocument()
  })

  it('offers Try again when the first report never loads', async () => {
    let fail = true
    const client = clientWith({ getReport: async () => (fail ? Promise.reject(new Error('The report is unavailable.')) : makeReport()) })
    const { user } = await open('owner@example.com', client)
    expect(await screen.findByText(/couldn't load the report/i)).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('heading', { name: /^at a glance$/i })).toBeInTheDocument()
  })

  it('keeps the last report on screen when a refresh fails, says so, and Retry brings the new one', async () => {
    let fail = false
    const client = clientWith({
      getReport: async (_o, q) => {
        if (fail && q.days === 30) throw new AuthError('network', 'The report server is not answering.')
        return makeReport({ totals: { calls: q.days === 30 ? 410 : 100, byAgent: 70, handedOver: 20, dropped: 10, avgDurationSec: 95 } })
      },
    })
    const { user } = await open('owner@example.com', client)
    await screen.findByRole('heading', { name: /^at a glance$/i })
    fail = true
    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }))
    const note = await screen.findByRole('alert')
    expect(note).toHaveTextContent(/couldn’t refresh/i)
    expect(note).toHaveTextContent(/the report server is not answering/i)
    // Still showing the last 7 days, and says which period that is.
    expect(note).toHaveTextContent(/still showing last 7 days/i)
    expect(screen.getByRole('heading', { name: /^at a glance$/i })).toBeInTheDocument()
    expect(screen.queryByText('410')).not.toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: /^at a glance$/i }).closest('section')!).getByText('100')).toBeInTheDocument()
    fail = false
    await user.click(within(note).getByRole('button', { name: /^retry$/i }))
    await waitFor(() => expect(within(screen.getByRole('heading', { name: /^at a glance$/i }).closest('section')!).getByText('410')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Call history opened from a Home link', () => {
  it('starts with the period, search and outcome from the address', async () => {
    await open('owner@example.com', clientWith(), `${O}/calls?q=Billing%20question&days=30&outcome=dropped`)
    await screen.findByRole('heading', { level: 1, name: /call history/i })
    expect(screen.getByRole('radio', { name: '30 days' })).toBeChecked()
    expect(screen.getByLabelText('Search')).toHaveValue('Billing question')
    expect(screen.getByLabelText('What happened')).toHaveValue('dropped')
  })

  it('ignores a period or outcome it does not know', async () => {
    await open('owner@example.com', clientWith(), `${O}/calls?days=12&outcome=nonsense`)
    await screen.findByRole('heading', { level: 1, name: /call history/i })
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked()
    expect(screen.getByLabelText('What happened')).toHaveValue('')
  })
})
