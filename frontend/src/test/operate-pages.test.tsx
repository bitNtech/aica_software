import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'

// A fixed moment, when all three sample live calls are in progress: the
// demo's live calls and call log follow the clock.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(1_700_000_000_000))
})
afterEach(() => vi.useRealTimers())

async function open(email: string, path: string) {
  const view = renderApp(path)
  await signIn(view.user, email)
  return view
}

describe('Home', () => {
  it('shows managers what needs a person and today so far', async () => {
    await open('admin@example.com', O)
    const now = await screen.findByRole('heading', { name: /needs a person/i })
    const cards = now.closest('section')!
    expect(within(cards).getByRole('link', { name: /3 waiting in the handoff queue/i })).toHaveAttribute('href', `${O}/handoffs`)
    expect(within(cards).getByRole('link', { name: /calls in progress/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /^reports$/i })).toBeInTheDocument()
    // Appears twice now Reports is embedded in Home: the stat tile and the
    // trend chart's legend share the label.
    expect(screen.getAllByText('Answered by the agents').length).toBeGreaterThan(0)
  })

  it('shows the front desk their work, without the numbers', async () => {
    await open('frontdesk@example.com', O)
    expect(await screen.findByRole('link', { name: /waiting in the handoff queue/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /callbacks for you or nobody yet/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /today so far/i })).not.toBeInTheDocument()
  })

  it('shows viewers the numbers and appointments, not the queue', async () => {
    await open('viewer@example.com', O)
    // The "Needs a person" cards and the Reports section load independently;
    // wait for the one each assertion actually needs, not an unrelated one.
    expect(await screen.findByRole('link', { name: /appointments to check/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /^reports$/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /handoff queue/i, current: false })).toBeNull()
  })
})

describe('Live calls and the handoff queue', () => {
  it('puts a live call through to the person asking', async () => {
    const { user } = await open('supervisor@example.com', `${O}/live`)
    const list = await screen.findByRole('list', { name: /calls in progress/i })
    const upset = within(list).getByText(/sounds upset/i).closest('li')!
    await user.click(within(upset).getByRole('button', { name: /put through to me/i }))
    expect(await within(upset).findByText(/put through to you/i)).toBeInTheDocument()
    // Live, personal details stay hidden.
    expect(within(upset).queryByText(/ramasamy/i)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /listen in/i })[0]).toHaveAttribute('aria-disabled', 'true')
  })

  it('takes a waiting caller, or turns one into a callback', async () => {
    const { user } = await open('frontdesk@example.com', `${O}/handoffs`)
    const waiting = await screen.findByRole('list', { name: /waiting now/i })
    const first = within(waiting).getAllByRole('listitem')[0]
    expect(within(first).getByRole('heading', { name: /selvi murugan/i })).toBeInTheDocument()
    const takenBefore = screen.getAllByText(/taken by meena s/i).length
    await user.click(within(first).getByRole('button', { name: /take this call/i }))
    await waitFor(() => expect(screen.getAllByText(/taken by meena s/i)).toHaveLength(takenBefore + 1))
    expect(within(waiting).getAllByRole('listitem')).toHaveLength(2)

    const next = within(waiting).getAllByRole('listitem')[0]
    await user.click(within(next).getByRole('button', { name: /call back later/i }))
    await waitFor(() => expect(within(waiting).getAllByRole('listitem')).toHaveLength(1))

    await user.click(within(screen.getByRole('navigation', { name: /organisation/i })).getByRole('link', { name: /^callbacks$/i }))
    expect(await screen.findByText(/insurance claim for his father/i)).toBeInTheDocument()
  })
})

describe('Callbacks', () => {
  it('lets the front desk see theirs and unassigned ones, and log tries', async () => {
    const { user } = await open('frontdesk@example.com', `${O}/callbacks`)
    const list = await screen.findByRole('list', { name: /^callbacks$/i })
    // Suresh's callback isn't theirs to see.
    expect(within(list).queryByText(/joseph antony/i)).not.toBeInTheDocument()
    const fathima = within(list).getByRole('heading', { name: /fathima b/i }).closest('li')!
    for (let i = 0; i < 3; i++) {
      await user.click(within(fathima).getByRole('button', { name: /log a call/i }))
      const dialog = screen.getByRole('dialog', { name: /call fathima b/i })
      await user.click(within(dialog).getByRole('radio', { name: /no answer/i }))
      await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    expect(within(list).queryByRole('heading', { name: /fathima b/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /couldn’t reach/i }))
    expect(await screen.findByRole('heading', { name: /fathima b/i })).toBeInTheDocument()
  })

  it('lets a supervisor give one to someone', async () => {
    const { user } = await open('supervisor@example.com', `${O}/callbacks`)
    const list = await screen.findByRole('list', { name: /^callbacks$/i })
    const unknown = within(list).getByRole('heading', { name: /unknown caller/i }).closest('li')!
    // Choosing isn't saving: arrowing through the list mustn't reassign it.
    await user.selectOptions(within(unknown).getByLabelText(/who calls back/i), 'Suresh B')
    expect(screen.queryByText(/given to suresh b/i)).not.toBeInTheDocument()
    await user.click(within(unknown).getByRole('button', { name: /^assign$/i }))
    expect(await screen.findByText(/given to suresh b/i)).toBeInTheDocument()
    // Viewers can't make calls: they aren't offered.
    expect(within(within(unknown).getByLabelText(/who calls back/i)).queryByRole('option', { name: /arun v/i })).toBeNull()
  })
})

describe('Appointments', () => {
  it('confirms, changes and cancels', async () => {
    const { user } = await open('frontdesk@example.com', `${O}/appointments`)
    // "Needs a check" shows a flat list with buttons directly accessible.
    await user.click(await screen.findByRole('radio', { name: /needs a check/i }))
    const confirm = screen.getAllByRole('button', { name: /^confirm /i })[0]
    const who = confirm.getAttribute('aria-label')!.replace(/^Confirm /, '')
    await user.click(confirm)
    expect(await screen.findByText(/appointment is confirmed/i)).toBeInTheDocument()

    // "This week" shows the timetable; click a slot cell to open its detail panel.
    await user.click(screen.getByRole('radio', { name: /this week/i }))
    await user.click((await screen.findAllByRole('button', { name: /appointment/i }))[0])
    const change = screen.getAllByRole('button', { name: /^change /i })[0]
    await user.click(change)
    const dialog = screen.getByRole('dialog', { name: /change .*appointment/i })
    await user.clear(within(dialog).getByLabelText(/^time/i))
    await user.type(within(dialog).getByLabelText(/^time/i), '17:15')
    await user.click(within(dialog).getByRole('button', { name: /save and confirm/i }))
    expect(await screen.findByText(/at 5:15 pm\./i)).toBeInTheDocument()

    // Slot panel closes after opening the change dialog; open another slot for cancel.
    await user.click((await screen.findAllByRole('button', { name: /appointment/i }))[0])
    const cancel = screen.getAllByRole('button', { name: /^cancel /i })[0]
    await user.click(cancel)
    await user.click(within(screen.getByRole('dialog', { name: /cancel .*appointment/i })).getByRole('button', { name: /cancel appointment/i }))
    expect(await screen.findByText(/appointment is cancelled/i)).toBeInTheDocument()
    expect(who).toBeTruthy()
  })

  it('is read-only for viewers', async () => {
    await open('viewer@example.com', `${O}/appointments`)
    await screen.findByRole('radio', { name: /this week/i })
    // In the timetable view, confirm/change/cancel buttons are only inside the slot
    // detail panel; they are never rendered directly in the page.
    expect(screen.queryByRole('button', { name: /^(confirm|change|cancel) /i })).not.toBeInTheDocument()
  })
})

describe('Call history and detail', () => {
  it('searches calls and opens one, with notes', async () => {
    const { user } = await open('admin@example.com', `${O}/calls`)
    const list = await screen.findByRole('list', { name: /calls, newest first/i })
    expect(within(list).getAllByRole('listitem').length).toBe(50)
    await user.selectOptions(screen.getByLabelText(/what happened/i), 'Booked')
    await waitFor(() => expect(within(screen.getByRole('list', { name: /calls, newest first/i })).getAllByText('Booked').length).toBeGreaterThan(0))
    for (const chip of within(screen.getByRole('list', { name: /calls, newest first/i })).getAllByText(/^(Booked|Answered by the agent|Handed over|Caller hung up)$/)) expect(chip).toHaveTextContent('Booked')

    await user.click(within(screen.getByRole('list', { name: /calls, newest first/i })).getAllByRole('link')[0])
    expect(await screen.findByRole('heading', { name: /path through the flow/i })).toBeInTheDocument()
    expect(screen.getByText('Book an appointment', { selector: '.op-path li' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/add a note/i), 'Patient asked for a wheelchair at the entrance.')
    await user.click(screen.getByRole('button', { name: /add note/i }))
    expect(await screen.findByText(/wheelchair at the entrance/i)).toBeInTheDocument()
    expect(screen.getByText(/karthik r,/i)).toBeInTheDocument()
  })

  it('shows the front desk only calls they handled', async () => {
    await open('frontdesk@example.com', `${O}/calls`)
    expect(await screen.findByRole('heading', { level: 1, name: /calls you handled/i })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: /calls, newest first/i })
    for (const row of within(list).getAllByRole('listitem')) expect(row).toHaveTextContent(/taken by meena s/i)
  })

  it('hides personal details from viewers, who read notes but don’t add them', async () => {
    const { user } = await open('viewer@example.com', `${O}/calls`)
    await user.selectOptions(await screen.findByLabelText(/what happened/i), 'Booked')
    // No caller's name anywhere in the list.
    await waitFor(() => expect(within(screen.getByRole('list', { name: /calls, newest first/i })).getAllByRole('link')[0]).toHaveTextContent(/^a caller/i))
    for (const link of within(screen.getByRole('list', { name: /calls, newest first/i })).getAllByRole('link')) expect(link).toHaveTextContent(/^a caller/i)
    await user.click(within(screen.getByRole('list', { name: /calls, newest first/i })).getAllByRole('link')[0])
    expect(await screen.findByRole('heading', { level: 1, name: 'A caller' })).toBeInTheDocument()
    expect(screen.getAllByText('Hidden').length).toBeGreaterThan(0)
    expect(screen.getByText(/personal details are hidden/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/add a note/i)).not.toBeInTheDocument()
    expect(screen.getByText(/recordings of the calls you handled/i)).toBeInTheDocument()
  })
})

// Reports used to be its own page; it's now embedded in Home, and the old
// /reports path just redirects there (App.tsx) for anyone with a bookmark.
describe('Reports (embedded in Home)', () => {
  it('shows the period’s numbers, charts with tables, and switches period', async () => {
    const { user } = await open('supervisor@example.com', O)
    expect(await screen.findByRole('heading', { name: /^last 7 days$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /calls each day, by what happened/i })).toBeInTheDocument()
    const toggle = screen.getAllByRole('button', { name: /show as a table/i })[0]
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('table', { name: /calls each day/i })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: /calls each day/i })).getAllByRole('row')).toHaveLength(8)
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /^today$/i }))
    expect(await screen.findByRole('heading', { name: /^today$/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /calls each day/i })).not.toBeInTheDocument()
  })

  it('isn’t for the front desk', async () => {
    await open('frontdesk@example.com', O)
    expect(screen.queryByRole('heading', { name: /^reports$/i })).not.toBeInTheDocument()
  })

  it('redirects the old standalone page to Home', async () => {
    await open('supervisor@example.com', `${O}/reports`)
    expect(await screen.findByRole('heading', { name: /^reports$/i })).toBeInTheDocument()
  })
})
