import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import type { Callback, CallRecord, CallSummary, ConsoleClient, OrgSettings } from '../console/types'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'

// A fixed moment (12:00 local on a Saturday), so which group each sample
// callback is in doesn't depend on the clock: the demo's callbacks are
// relative to now. Overdue: Anand (-2 h), Joseph (-30 min, Suresh's). Within
// the hour: Fathima. Later today: the unnamed caller and Revathi.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 24, 12, 0))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const queue = () => screen.getByRole('region', { name: 'Callbacks' })
const detail = () => screen.getByRole('region', { name: /callback details/i })
/** Each row of the queue (its one button), by who is on it. */
const rowButtons = () => within(queue()).getAllByRole('button', { name: /\+91 \d{5} \d{5}/ })
const row = (name: RegExp) => within(queue()).getByRole('button', { name })
const asTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** Signs in and waits for the queue to have rows. */
async function open(email: string, consoleClient?: ConsoleClient) {
  const view = renderApp(`${O}/callbacks`, consoleClient ? { consoleClient } : undefined)
  await signIn(view.user, email)
  await screen.findByRole('region', { name: 'Callbacks' })
  await waitFor(() => expect(within(queue()).queryAllByRole('button', { name: /\+91 \d{5} \d{5}/ }).length).toBeGreaterThan(0))
  return view
}
/** The same demo, with some calls changed (it keeps its own state: call through to `demo`). */
const withOverrides = (over: (demo: ConsoleClient) => Partial<ConsoleClient>) => {
  const demo = createDemoConsoleClient({ latency: 0, persist: false })
  return { ...demo, ...over(demo) } as ConsoleClient
}

describe('Callbacks: the queue', () => {
  it('shows the front desk theirs and ones nobody has, grouped by urgency, with what the old cards showed', async () => {
    await open('frontdesk@example.com')
    const headings = within(queue()).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Overdue 1', 'Due within the hour 1', 'Later today 2', 'Done or couldn’t reach 1'])
    const rows = rowButtons()
    // Overdue first, then by soonest due. Suresh's Joseph Antony isn't theirs, so isn't here.
    expect(rows[0]).toHaveTextContent(/anand kumar/i)
    expect(rows[1]).toHaveTextContent(/fathima b/i)
    expect(rows[2]).toHaveTextContent(/caller not named/i)
    expect(rows[3]).toHaveTextContent(/revathi m/i)
    expect(screen.queryByText(/joseph antony/i)).toBeNull()
    // Who, the full number, the reason, how late, who has it and the tries, all in words.
    expect(rows[0]).toHaveTextContent('+91 98945 30017')
    expect(rows[0]).toHaveTextContent(/asked whether his company insurance/i)
    expect(rows[0]).toHaveTextContent(/overdue by 2 h/i)
    expect(rows[0]).toHaveTextContent(/not given to anyone/i)
    expect(rows[0]).toHaveTextContent(/not tried yet/i)
    expect(rows[1]).toHaveTextContent(/due in 30 min/i)
    expect(rows[1]).toHaveTextContent(/meena s/i)
    // No tick boxes without "Assign callbacks".
    expect(within(queue()).queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByText('4 open · 1 overdue')).toBeInTheDocument()
  })

  it('folds Done or couldn’t reach until opened, and opens it for the Done filter', async () => {
    const { user } = await open('frontdesk@example.com')
    expect(screen.queryByText(/senthil kumar/i)).toBeNull()
    const toggle = within(queue()).getByRole('button', { name: /done or couldn’t reach/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(row(/senthil kumar/i)).toHaveTextContent(/done/i)
    await user.click(toggle)
    expect(screen.queryByText(/senthil kumar/i)).toBeNull()
    await user.selectOptions(screen.getByLabelText('Status'), 'done')
    expect(row(/senthil kumar/i)).toBeInTheDocument()
    expect(within(queue()).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Done or couldn’t reach 1'])
  })

  it('opens the most urgent callback beside the list, and moves with the arrow keys, j and k, opening with Enter', async () => {
    const { user } = await open('frontdesk@example.com')
    const rows = rowButtons()
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Anand Kumar' })).toBeInTheDocument()
    rows[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(rows[1]).toHaveFocus()
    // Moving doesn't open: the open one is still the first.
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
    await user.keyboard('j')
    expect(rows[2]).toHaveFocus()
    await user.keyboard('k')
    expect(rows[1]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Fathima B' })).toBeInTheDocument()
  })

  it('searches, filters and clears, with a chip for each; the assignee filter is for people who can assign', async () => {
    const { user } = await open('frontdesk@example.com')
    expect(screen.queryByLabelText('Given to')).toBeNull()
    await user.type(screen.getByRole('searchbox', { name: /search callbacks/i }), '94440')
    expect(rowButtons()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /remove filter: search: 94440/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    expect(rowButtons()).toHaveLength(4)
    await user.selectOptions(screen.getByLabelText('Tries'), 'tried')
    expect(await screen.findByText(/no callbacks match/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear the filters/i }))
    expect(rowButtons()).toHaveLength(4)
  })

  it('sorts by newest request without urgency groups', async () => {
    const { user } = await open('owner@example.com')
    await user.selectOptions(screen.getByLabelText('Order'), 'newest')
    expect(within(queue()).getByRole('heading', { name: /to call, newest first/i })).toBeInTheDocument()
    // Asked 1.5 h ago (Fathima) is the newest.
    expect(rowButtons()[0]).toHaveTextContent(/fathima b/i)
    expect(within(queue()).queryByRole('heading', { name: /^overdue/i })).toBeNull()
  })

  it('shows an empty queue calmly', async () => {
    const empty = withOverrides(() => ({ listCallbacks: async () => [] }))
    const view = renderApp(`${O}/callbacks`, { consoleClient: empty })
    await signIn(view.user, 'frontdesk@example.com')
    expect(await screen.findByText(/nobody to call back/i)).toBeInTheDocument()
    expect(within(detail()).getByText(/pick a callback to see who it is/i)).toBeInTheDocument()
  })

  it('shows a load error with a way to try again', async () => {
    let fail = true
    const flaky = withOverrides((demo) => ({
      listCallbacks: async (o) => {
        if (fail) throw new AuthError('unknown', 'The server is not answering.')
        return demo.listCallbacks(o)
      },
    }))
    const view = renderApp(`${O}/callbacks`, { consoleClient: flaky })
    await signIn(view.user, 'frontdesk@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load callbacks.*server is not answering/i)
    fail = false
    await view.user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('button', { name: /anand kumar/i })).toBeInTheDocument()
  })

  it('keeps what is on screen, and says it is not updating, when a fresh read fails', async () => {
    let calls = 0
    const client = withOverrides((demo) => ({
      listCallbacks: async (o) => {
        if (++calls > 1) throw new AuthError('unknown', 'No connection.')
        return demo.listCallbacks(o)
      },
    }))
    const { user } = await open('frontdesk@example.com', client)
    await user.click(within(detail()).getByRole('button', { name: /take it/i }))
    expect(await screen.findByText(/not updating\./i)).toBeInTheDocument()
    expect(rowButtons()).toHaveLength(4)
  })
})

describe('Callbacks: ringing back', () => {
  it('shows the caller in full, with a phone link named for the person', async () => {
    await open('frontdesk@example.com')
    const d = within(detail())
    expect(d.getByRole('heading', { level: 2, name: 'Anand Kumar' })).toBeInTheDocument()
    const link = d.getByRole('link', { name: 'Call Anand Kumar on +91 98945 30017' })
    expect(link).toHaveAttribute('href', 'tel:+919894530017')
    expect(d.getByText(/asked whether his company insurance \(md india\)/i)).toBeInTheDocument()
    expect(d.getByText('Overdue')).toBeInTheDocument()
    expect(d.getByText(/overdue by 2 h/i)).toBeInTheDocument()
    expect(d.getByText('Asked')).toBeInTheDocument()
    expect(d.getByText('Not tried yet')).toBeInTheDocument()
    expect(d.getByRole('heading', { name: /what has happened/i })).toBeInTheDocument()
  })

  it('says plainly when the caller isn’t named', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.click(row(/caller not named/i))
    const d = within(detail())
    expect(d.getByRole('heading', { level: 2, name: 'Caller not named' })).toBeInTheDocument()
    expect(d.getByText(/the caller isn’t named/i)).toBeInTheDocument()
    expect(d.getByRole('link', { name: 'Call the caller on +91 90031 77452' })).toBeInTheDocument()
  })

  it('logs "reached them" with a note, offers Undo and the next callback, and Undo brings it back', async () => {
    const { user } = await open('frontdesk@example.com')
    const d = within(detail())
    await user.click(d.getByRole('radio', { name: /reached them/i }))
    await user.type(d.getByLabelText(/^note/i), 'Told him it is covered.')
    await user.click(d.getByRole('button', { name: /^save$/i }))
    expect((await screen.findAllByText('Marked done: Anand Kumar.')).length).toBeGreaterThan(0)
    // It moved to the folded group, the note is in what has happened, and focus is on "Next callback".
    await waitFor(() => expect(within(queue()).getByRole('button', { name: /done or couldn’t reach/i })).toHaveTextContent('2'))
    expect(within(detail()).getByText('Told him it is covered.')).toBeInTheDocument()
    const nextButton = within(detail()).getByRole('button', { name: /next callback/i })
    await waitFor(() => expect(nextButton).toHaveFocus())
    expect(within(detail()).queryByRole('button', { name: /^save$/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect((await screen.findAllByText('Undone.')).length).toBeGreaterThan(0)
    await waitFor(() => expect(within(detail()).getByText('Overdue')).toBeInTheDocument())
    expect(within(detail()).getByRole('button', { name: /^save$/i })).toBeInTheDocument()
  })

  it('logs no answer: it stays, counts a try, and warns before the last try', async () => {
    const { user } = await open('owner@example.com')
    // Joseph Antony: tried once already, with Suresh's note.
    await user.click(row(/joseph antony/i))
    let d = within(detail())
    expect(d.getByText('Tried 1 time')).toBeInTheDocument()
    expect(d.getByText('No answer. Will try after lunch.')).toBeInTheDocument()
    expect(d.queryByText(/this is the last try/i)).toBeNull()
    await user.click(d.getByRole('radio', { name: /no answer/i }))
    await user.click(d.getByRole('button', { name: /^save$/i }))
    expect((await screen.findAllByText(/no answer logged\. tried 2 times; it stays on the list/i)).length).toBeGreaterThan(0)
    // No Undo: a try can't be taken back.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    d = within(detail())
    expect(await d.findByText(/this is the last try/i)).toBeInTheDocument()
    expect(d.getByText(/try 3: it moves to “couldn’t reach”/i)).toBeInTheDocument()
    // The last try: no answer moves it to "Couldn't reach".
    await user.click(d.getByRole('radio', { name: /no answer/i }))
    await user.click(d.getByRole('button', { name: /^save$/i }))
    expect((await screen.findAllByText(/that was try 3 with no answer: moved to couldn’t reach/i)).length).toBeGreaterThan(0)
    expect(within(detail()).getByText('Couldn’t reach')).toBeInTheDocument()
    expect(within(detail()).getByRole('button', { name: /open again/i })).toBeInTheDocument()
  })

  it('opens a done callback again', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.click(within(queue()).getByRole('button', { name: /done or couldn’t reach/i }))
    await user.click(row(/senthil kumar/i))
    expect(within(detail()).queryByRole('button', { name: /^save$/i })).toBeNull()
    await user.click(within(detail()).getByRole('button', { name: /open again/i }))
    expect((await screen.findAllByText('Back on the list to call.')).length).toBeGreaterThan(0)
    // Its time has passed, so it comes back as overdue.
    await waitFor(() => expect(within(detail()).getByText('Overdue')).toBeInTheDocument())
  })

  it('takes one nobody has, and Undo gives it back', async () => {
    const { user } = await open('frontdesk@example.com')
    expect(within(detail()).getByText('Not given to anyone yet.')).toBeInTheDocument()
    await user.click(within(detail()).getByRole('button', { name: /^take it$/i }))
    expect((await screen.findAllByText('It’s yours now.')).length).toBeGreaterThan(0)
    await waitFor(() => expect(within(detail()).getByText('It’s yours.')).toBeInTheDocument())
    expect(rowButtons()[0]).toHaveTextContent(/meena s/i)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(within(detail()).getByText('Not given to anyone yet.')).toBeInTheDocument())
    expect(rowButtons()[0]).toHaveTextContent(/not given to anyone/i)
    // Their own can be given back; no assigning to others.
    await user.click(row(/fathima b/i))
    expect(within(detail()).getByRole('button', { name: /give it back/i })).toBeInTheDocument()
    expect(within(detail()).queryByLabelText(/give it to/i)).toBeNull()
  })

  it('opens the next callback with N, and with the button, going on down the list', async () => {
    const { user } = await open('frontdesk@example.com')
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Anand Kumar' })).toBeInTheDocument()
    await user.keyboard('n')
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Fathima B' })).toBeInTheDocument()
    await waitFor(() => expect(within(detail()).getByRole('heading', { level: 2, name: 'Fathima B' })).toHaveFocus())
    expect(row(/fathima b/i)).toHaveAttribute('aria-current', 'true')
    await user.click(within(detail()).getByRole('button', { name: /next callback/i }))
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Caller not named' })).toBeInTheDocument()
  })

  it('says someone else has it when taking fails, and shows it is no longer on the list', async () => {
    let taken = false
    const client = withOverrides((demo) => ({
      listCallbacks: async (o) => (await demo.listCallbacks(o)).filter((c) => !(taken && c.id === 'cb_5')),
      updateCallback: async () => {
        taken = true
        throw new AuthError('forbidden', 'This callback is Suresh B’s. Ask a supervisor to move it.')
      },
    }))
    const { user } = await open('frontdesk@example.com', client)
    await user.click(within(detail()).getByRole('button', { name: /^take it$/i }))
    expect(await within(detail()).findByText(/this callback is suresh b’s/i)).toBeInTheDocument()
    expect(await within(detail()).findByText(/this isn’t on your list any more/i)).toBeInTheDocument()
    // Nothing left to press on a callback that has gone.
    expect(within(detail()).queryByRole('button', { name: /^take it$/i })).toBeNull()
    expect(within(detail()).queryByRole('button', { name: /^save$/i })).toBeNull()
    await waitFor(() => expect(screen.queryByRole('button', { name: /anand kumar.*\+91/i })).toBeNull())
  })

  it('says what changed when someone else changes it while it is open', async () => {
    let changed = false
    const client = withOverrides((demo) => ({
      listCallbacks: async (o) => (await demo.listCallbacks(o)).map((c) => (changed && c.id === 'cb_5' ? { ...c, assignedTo: { id: 'u_frontdesk', name: 'Meena S' }, attempts: 1 } : c)),
    }))
    const { user } = await open('frontdesk@example.com', client)
    expect(within(detail()).queryByText(/this changed while you were looking/i)).toBeNull()
    changed = true
    // Any change reads the list again; a failed take is enough to trigger it.
    await user.click(within(detail()).getByRole('button', { name: /^take it$/i }))
    await waitFor(() => expect(within(detail()).getByText(/this changed while you were looking/i)).toBeInTheDocument())
  })
})

describe('Callbacks: giving them to people', () => {
  it('lets an owner give one to a colleague, with Undo, and take it or let it go', async () => {
    const { user } = await open('owner@example.com')
    expect(rowButtons()).toHaveLength(5)
    const d = () => within(detail())
    await user.selectOptions(d().getByLabelText(/give it to/i), 'Priya N')
    await user.click(d().getByRole('button', { name: /^give$/i }))
    expect((await screen.findAllByText('Given to Priya N.')).length).toBeGreaterThan(0)
    await waitFor(() => expect(d().getByText('Priya N has it.')).toBeInTheDocument())
    expect(rowButtons()[0]).toHaveTextContent(/priya n/i)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(d().getByText('Not given to anyone yet.')).toBeInTheDocument())
    await user.click(d().getByRole('button', { name: /take it myself/i }))
    await waitFor(() => expect(d().getByText('It’s yours.')).toBeInTheDocument())
    await user.click(d().getByRole('button', { name: /unassign/i }))
    await waitFor(() => expect(d().getByText('Not given to anyone yet.')).toBeInTheDocument())
  })

  it('offers only people who can take calls, and filters by who has it', async () => {
    const { user } = await open('owner@example.com')
    const options = within(within(detail()).getByLabelText(/give it to/i)).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('Priya N')
    expect(options).toContain('Meena S')
    // Not the viewer, and not the invitation that hasn't been accepted.
    expect(options).not.toContain('Arun V')
    expect(options.join('|')).not.toMatch(/newstaff/)
    await user.selectOptions(screen.getByLabelText('Given to'), 'nobody')
    expect(screen.getByRole('button', { name: /remove filter: given to: not given to anyone/i })).toBeInTheDocument()
    for (const r of rowButtons()) expect(r).toHaveTextContent(/not given to anyone/i)
    await user.selectOptions(screen.getByLabelText('Given to'), 'Suresh B')
    expect(rowButtons()).toHaveLength(1)
    expect(rowButtons()[0]).toHaveTextContent(/joseph antony/i)
  })

  it('gives several at once, names the ones that failed and keeps the ones that worked', async () => {
    const client = withOverrides((demo) => ({
      updateCallback: async (o, id, patch) => {
        if (id === 'cb_3') throw new AuthError('invalid_input', 'Priya N can’t take calls any more.')
        return demo.updateCallback(o, id, patch)
      },
    }))
    const { user } = await open('owner@example.com', client)
    await user.click(within(queue()).getByRole('checkbox', { name: /select fathima b/i }))
    await user.click(within(queue()).getByRole('checkbox', { name: /select caller not named/i }))
    expect(screen.getByText('2 ticked')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Give to…'), 'Priya N')
    await user.click(screen.getByRole('button', { name: /^give them$/i }))
    const report = await screen.findByRole('alert')
    expect(report).toHaveTextContent(/gave 1 of 2 to priya n\. 1 couldn’t be given/i)
    expect(report).toHaveTextContent(/caller not named: priya n can’t take calls any more/i)
    expect(report).toHaveTextContent(/still ticked/i)
    // The one that worked is Priya's now; the one that failed is still ticked.
    expect(row(/fathima b/i)).toHaveTextContent(/priya n/i)
    expect(within(queue()).getByRole('checkbox', { name: /select fathima b/i })).not.toBeChecked()
    expect(within(queue()).getByRole('checkbox', { name: /select caller not named/i })).toBeChecked()
    // Undo puts the one that worked back as it was.
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(row(/fathima b/i)).toHaveTextContent(/meena s/i))
  })

  it('ticks every row that is shown, and unticks them', async () => {
    const { user } = await open('owner@example.com')
    await user.click(screen.getByRole('button', { name: /tick all 7 shown/i }))
    expect(screen.getByText('7 ticked')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear ticks/i }))
    expect(screen.queryByText(/ticked/)).toBeNull()
  })
})

describe('Callbacks: who can do what', () => {
  it('keeps people without access to Callbacks out of it, and never reads the list', async () => {
    const demo = createDemoConsoleClient({ latency: 0, persist: false })
    const spy = vi.spyOn(demo, 'listCallbacks')
    const view = renderApp(`${O}/callbacks`, { consoleClient: demo })
    await signIn(view.user, 'viewer@example.com')
    await screen.findByRole('navigation', { name: /organisation/i })
    expect(screen.queryByRole('region', { name: 'Callbacks' })).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows a supervisor every callback, including other people’s, with the assign controls and the tick boxes', async () => {
    await open('supervisor@example.com')
    expect(screen.getByText(/joseph antony/i)).toBeInTheDocument()
    expect(within(queue()).getAllByRole('checkbox')).toHaveLength(5)
    expect(within(detail()).getByLabelText(/give it to/i)).toBeInTheDocument()
  })
})

describe('Callbacks: the caller’s history and where it came from', () => {
  const REQUESTED_AGO = 26 // Anand's callback was asked 26 hours before the fixed moment
  const call = (id: string, hoursAgo: number, phone = '+91 ••••• 30017', over: Partial<CallSummary> = {}): CallSummary => ({
    id,
    agentId: 'agt_opd',
    agentName: 'OPD appointments',
    line: '+91 00000 01210',
    callerPhone: phone,
    callerName: null,
    startedAt: new Date(Date.now() - hoursAgo * 36e5).toISOString(),
    durationSec: 95,
    language: 'english',
    intent: 'Ask about prices',
    outcome: 'resolved',
    handledBy: null,
    ...over,
  })

  it('looks for the last five digits only, and shows only calls that really end the same way, linked to their records', async () => {
    const seen: unknown[] = []
    const client = withOverrides(() => ({
      listCallLog: async (_o, q) => {
        seen.push(q)
        return { calls: [call('call_1', 1), call('call_2', 40, '+91 ••••• 30017', { intent: 'Book an appointment', outcome: 'booked' }), call('call_x', 3, '+91 ••••• 99999')], total: 3 }
      },
    }))
    await open('frontdesk@example.com', client)
    const d = within(detail())
    expect(await d.findByRole('link', { name: /ask about prices/i })).toHaveAttribute('href', `${O}/calls/call_1`)
    expect(d.getByRole('link', { name: /book an appointment/i })).toHaveAttribute('href', `${O}/calls/call_2`)
    // The look-alike (a different number ending 99999) is left out.
    expect(d.getAllByRole('link', { name: /ask about prices|book an appointment/i })).toHaveLength(2)
    expect(seen[0]).toEqual({ days: 90, q: '30017', limit: 10 })
    // Said plainly: matched on five digits, and front desk see only what they handled.
    expect(d.getByText(/matched on the last five digits \(30017\)/i)).toBeInTheDocument()
    expect(d.getByText(/you see the calls you handled/i)).toBeInTheDocument()
  })

  it('notes that the caller may have rung back, with the time and a link', async () => {
    const rang = call('call_back', 1)
    const client = withOverrides(() => ({ listCallLog: async () => ({ calls: [rang, call('call_old', REQUESTED_AGO + 5)], total: 2 }) }))
    await open('frontdesk@example.com', client)
    const note = await within(detail()).findByText(/they may have called back at/i)
    expect(note).toHaveTextContent(asTime(rang.startedAt))
    expect(within(detail()).getByRole('link', { name: /see the call/i })).toHaveAttribute('href', `${O}/calls/call_back`)
  })

  it('says there were none, in the history block alone', async () => {
    const none = withOverrides(() => ({ listCallLog: async () => ({ calls: [], total: 0 }) }))
    const view = renderApp(`${O}/callbacks`, { consoleClient: none })
    await signIn(view.user, 'frontdesk@example.com')
    expect(await screen.findByText(/no calls from this number in the last 90 days/i)).toBeInTheDocument()
  })

  it('says when the look for past calls failed, with a retry, and leaves the rest of the callback alone', async () => {
    let fail = true
    const flaky = withOverrides(() => ({
      listCallLog: async () => {
        if (fail) throw new AuthError('unknown', 'The call log is not answering.')
        return { calls: [call('call_1', 2)], total: 1 }
      },
    }))
    const view = renderApp(`${O}/callbacks`, { consoleClient: flaky })
    await signIn(view.user, 'frontdesk@example.com')
    const problem = await screen.findByText(/couldn’t look for past calls: the call log is not answering/i)
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Anand Kumar' })).toBeInTheDocument()
    fail = false
    await view.user.click(within(problem.closest('p')!).getByRole('button', { name: /try again/i }))
    expect(await within(detail()).findByRole('link', { name: /ask about prices/i })).toBeInTheDocument()
  })

  it('shows the call it came from: its summary, the start of the conversation and a link; or says there is none', async () => {
    const record = {
      ...call('call_src', 27),
      summary: 'Anand asked about insurance cover and wanted a call back.',
      path: [],
      details: [],
      toolCalls: [],
      knowledgeUsed: [],
      transcript: [
        { speaker: 'agent', at: 1, text: 'Hello, this is Arogya Hospital.' },
        { speaker: 'caller', at: 5, text: 'Does my insurance cover the master check-up?' },
      ],
      notes: [],
      hasRecording: false,
      handledById: null,
    } as unknown as CallRecord
    const client = withOverrides((demo) => ({
      listCallbacks: async (o) => (await demo.listCallbacks(o)).map((c: Callback) => (c.id === 'cb_5' ? { ...c, callId: 'call_src' } : c)),
      getCallRecord: async () => record,
    }))
    const { user } = await open('frontdesk@example.com', client)
    const d = within(detail())
    expect(await d.findByText(/anand asked about insurance cover/i)).toBeInTheDocument()
    expect(d.getByText(/does my insurance cover the master check-up/i)).toBeInTheDocument()
    expect(d.getByRole('link', { name: /open the whole call/i })).toHaveAttribute('href', `${O}/calls/call_src`)
    // Another callback with no call behind it.
    await user.click(row(/fathima b/i))
    expect(await within(detail()).findByText(/no call is linked to this callback/i)).toBeInTheDocument()
  })

  it('says when the call it came from can’t be opened', async () => {
    const client = withOverrides((demo) => ({
      listCallbacks: async (o) => (await demo.listCallbacks(o)).map((c: Callback) => (c.id === 'cb_5' ? { ...c, callId: 'call_src' } : c)),
      getCallRecord: async () => {
        throw new AuthError('forbidden', 'You can open the calls you handled.')
      },
    }))
    await open('frontdesk@example.com', client)
    expect(await within(detail()).findByText(/couldn’t open the call this came from: you can open the calls you handled/i)).toBeInTheDocument()
  })
})

describe('Callbacks: things to look out for', () => {
  const extra = (c: Partial<Callback> & Pick<Callback, 'id'>): Callback => ({
    callerName: 'Anand Kumar',
    callerPhone: '+91 98945 30017',
    reason: 'Asked again about the insurance.',
    requestedAt: new Date(Date.now() - 36e5).toISOString(),
    dueBy: new Date(Date.now() + 5 * 36e5).toISOString(),
    assignedTo: null,
    status: 'open',
    attempts: 0,
    notes: [],
    callId: null,
    ...c,
  })

  it('marks callbacks that share a number, and says so in the detail with a way to the other one', async () => {
    const client = withOverrides((demo) => ({ listCallbacks: async (o) => [...(await demo.listCallbacks(o)), extra({ id: 'cb_dup' })] }))
    const { user } = await open('frontdesk@example.com', client)
    // Both rows say it, in words.
    const marked = rowButtons().filter((r) => /1 other open for this number/i.test(r.textContent ?? ''))
    expect(marked).toHaveLength(2)
    // Anand's own callback is open: it names the other one, and suggests one call.
    const d = within(detail())
    expect(d.getByText(/1 other open callback for this number/i)).toBeInTheDocument()
    expect(d.getByText(/you can deal with them all in one call/i)).toBeInTheDocument()
    await user.click(within(d.getByText(/1 other open callback for this number/i).closest('.cb-banner') as HTMLElement).getByRole('button', { name: 'Anand Kumar' }))
    expect(within(detail()).getByText(/asked again about the insurance/i)).toBeInTheDocument()
    // The history lists it too.
    expect(within(detail()).getByRole('list', { name: /other callbacks for this number/i })).toBeInTheDocument()
  })

  it('flags a callback given to someone who is no longer on the team', async () => {
    const client = withOverrides((demo) => ({
      listCallbacks: async (o) => (await demo.listCallbacks(o)).map((c) => (c.id === 'cb_5' ? { ...c, assignedTo: { id: 'u_left', name: 'Kavitha R' } } : c)),
    }))
    const { user } = await open('owner@example.com', client)
    expect(within(detail()).getByText(/given to someone who is no longer on the team/i)).toBeInTheDocument()
    expect(within(detail()).getByText(/kavitha r can’t ring this back\. give it to someone else/i)).toBeInTheDocument()
    // Still findable by who has it, marked as not on the team.
    expect(within(screen.getByLabelText('Given to')).getByRole('option', { name: 'Kavitha R (not on the team)' })).toBeInTheDocument()
    // A callback given to someone who is still here is not flagged.
    await user.click(row(/joseph antony/i))
    expect(within(detail()).queryByText(/no longer on the team/i)).toBeNull()
  })

  it('warns when the due time is outside the organisation’s hours, to those who can read them', async () => {
    const closedAllWeek = {
      name: 'Arogya',
      city: 'Chennai',
      languages: ['english'],
      hours: Array.from({ length: 7 }, () => ({ open: false, from: '09:00', to: '18:00' })),
      closed: [],
      updatedAt: '',
      updatedBy: '',
    } as OrgSettings
    const client = withOverrides(() => ({ getOrgSettings: async () => closedAllWeek }))
    await open('owner@example.com', client)
    expect(await within(detail()).findByText(/the organisation is closed on \w+s/i)).toBeInTheDocument()
  })

  it('says nothing about hours, and shows no error, when the settings can’t be read', async () => {
    const owner = withOverrides(() => ({
      getOrgSettings: async () => {
        throw new AuthError('forbidden', 'You can’t see the settings.')
      },
    }))
    const view = renderApp(`${O}/callbacks`, { consoleClient: owner })
    await signIn(view.user, 'owner@example.com')
    await screen.findByRole('heading', { level: 2, name: 'Anand Kumar' })
    expect(screen.queryByText(/the organisation is closed/i)).toBeNull()
    expect(screen.queryByText(/you can’t see the settings/i)).toBeNull()
  })

  it('never asks a front desk for the organisation’s hours', async () => {
    const demo = createDemoConsoleClient({ latency: 0, persist: false })
    const spy = vi.spyOn(demo, 'getOrgSettings')
    const view = renderApp(`${O}/callbacks`, { consoleClient: demo })
    await signIn(view.user, 'frontdesk@example.com')
    await screen.findByRole('heading', { level: 2, name: 'Anand Kumar' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows the whole list on a phone as the queue first, with the callback in a drawer', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
    try {
      const view = renderApp(`${O}/callbacks`)
      await signIn(view.user, 'frontdesk@example.com')
      await screen.findByRole('button', { name: /anand kumar.*\+91/i })
      // Nothing is open until one is chosen; then it opens in a dialog.
      expect(screen.queryByRole('region', { name: /callback details/i })).toBeNull()
      expect(screen.queryByRole('dialog', { name: /callback details/i })).toBeNull()
      await view.user.click(row(/anand kumar/i))
      const drawer = await screen.findByRole('dialog', { name: /callback details/i })
      expect(within(drawer).getByRole('heading', { level: 2, name: 'Anand Kumar' })).toBeInTheDocument()
    } finally {
      // @ts-expect-error: put jsdom back as it was, without matchMedia.
      delete window.matchMedia
    }
  })
})
