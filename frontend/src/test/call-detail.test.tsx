import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import type { CallRecord, ConsoleClient } from '../console/types'
import { turnForStep, searchTurns } from '../pages/console/operate/calls/detail/logic'
import { callFor, demo, loadCalls, O, ORG, open as openAs, withOverrides } from './callsFixtures'

// A fixed moment: the demo's call log follows the clock.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(1_700_000_000_000))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Opens one call's page and waits for its conversation. */
async function openCall(email: string, id: string, client: ConsoleClient = demo()) {
  const view = await openAs(email, `${O}/calls/${id}`, client)
  await screen.findByRole('heading', { level: 2, name: /^the conversation$/i })
  return view
}

const turns = () => document.querySelectorAll<HTMLElement>('.transcript__turn')
const pathSection = () => screen.getByRole('heading', { level: 2, name: /^path through the flow$/i }).closest('section')!
const diagram = () => within(pathSection()).getByRole('tree', { name: /this call’s path on the designed flow/i })

describe('Call detail: what it still shows', () => {
  it('has the header facts, summary, analysis, details, response times, knowledge, recording and notes', async () => {
    const client = demo()
    const { summary, record } = await callFor(client, 'Book an appointment', 'booked')
    await openCall('supervisor@example.com', summary.id, client)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(record.callerName ?? record.callerPhone)
    expect(screen.getByText(new RegExp(`${record.agentName} on ${record.line.replace(/[+]/g, '\\+')}`))).toBeInTheDocument()
    for (const h of [/^what happened$/i, /^after the call$/i, /^details collected$/i, /^tools used$/i, /^response times$/i, /^knowledge used$/i, /^recording$/i, /^notes$/i, /^something wrong\?$/i, /^path through the flow$/i, /^the conversation$/i]) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    }
    expect(screen.getByText(record.summary)).toBeInTheDocument()
    expect(screen.getByText(record.analysis.successReason)).toBeInTheDocument()
    expect(screen.getByText(/how the caller sounded/i)).toBeInTheDocument()
    for (const d of record.details) expect(screen.getAllByText(d.label).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/replied in \d\.\d s/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/first words/i)).toBeInTheDocument()
    expect(screen.getByText(/the demo has no recordings/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /flag a wrong answer/i })).toBeInTheDocument()
    expect(document.querySelector('.op-crumb')).toHaveAttribute('href', `${O}/calls`)
  })

  it('hides names and personal details from someone who may not see them, and no flag for a viewer', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    let rec: CallRecord | undefined
    for (const c of calls) {
      const r = await client.getCallRecord(ORG, c.id)
      if (r.callerName && r.details.some((d) => d.personal) && r.transcript.some((t) => /\{\{name:/.test(t.text))) {
        rec = r
        break
      }
    }
    expect(rec).toBeDefined()
    await openCall('viewer@example.com', rec!.id, client)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A caller')
    expect(screen.getByText(/personal details are hidden/i)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(rec!.callerName!))).not.toBeInTheDocument()
    expect(screen.getAllByText('Hidden').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /flag a wrong answer/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/add a note/i)).not.toBeInTheDocument()
  })

  it('says so, with a way to retry, when the call can’t be opened', async () => {
    const real = demo()
    const { calls } = await loadCalls(real)
    let fail = true
    const client = withOverrides(real, { getCallRecord: async (o, id) => (fail ? Promise.reject(new AuthError('unknown', 'The call service is busy.')) : real.getCallRecord(o, id)) })
    const { user } = await openAs('supervisor@example.com', `${O}/calls/${calls[0].id}`, client)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/the call service is busy/i)
    fail = false
    await user.click(within(alert).getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('heading', { level: 2, name: /^the conversation$/i })).toBeInTheDocument()
  })
})

describe('Call detail: the path on the designed flow', () => {
  it('draws the path in heavy arrows on the agent’s flow, and flags where the caller hung up', async () => {
    const client = demo()
    const { summary, record } = await callFor(client, 'Ask about timings and directions', 'dropped')
    await openCall('supervisor@example.com', summary.id, client)
    const tree = await waitFor(() => diagram())
    const onPath = tree.querySelectorAll('[data-on-path="true"]')
    // The intent and the one step the call reached, nothing it didn't.
    expect(onPath).toHaveLength(record.path.length)
    expect([...onPath].map((n) => n.getAttribute('aria-label')).join(' ')).toMatch(/Ask about timings and directions/)
    // Where it left is on the diagram, in words, and in the line above it.
    const exit = tree.querySelector('.is-exit')
    expect(exit).not.toBeNull()
    expect(exit).toHaveTextContent('Call left here')
    expect(within(pathSection()).getByText(/2 of 2 steps on the designed flow\. caller hung up here/i)).toBeInTheDocument()
    // The steps are also a list, so nothing depends on the picture.
    const list = within(pathSection()).getAllByRole('listitem').map((li) => li.textContent)
    expect(list.join('|')).toContain('Ask about timings and directions')
    expect(list.join('|')).toContain('Answer from the knowledge base')
    expect(list.join('|')).toMatch(/caller hung up here/)
  })

  it('lists a step the flow doesn’t have as not in it, and says a hand-over left', async () => {
    const client = demo()
    const { summary } = await callFor(client, 'Bill and insurance', 'handed_over')
    await openCall('supervisor@example.com', summary.id, client)
    await waitFor(() => diagram())
    const section = pathSection()
    expect(within(section).getByText('Hand over to a person').closest('li')).toHaveTextContent(/not in the designed flow/i)
    expect(within(section).getAllByText(/handed over here/i).length).toBeGreaterThan(0)
    expect(section.querySelector('.is-exit')).not.toBeNull()
  })

  it('jumps to the moment in the conversation when a step is picked on the diagram', async () => {
    const client = demo()
    const { summary, record } = await callFor(client, 'Book an appointment', 'booked')
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    await waitFor(() => diagram())
    const step = record.path.length - 1
    const label = record.path[step]
    // The label can repeat down another branch: the one on the call's path.
    await user.click(within(diagram()).getAllByRole('treeitem', { name: new RegExp(label) }).find((el) => el.getAttribute('data-on-path') === 'true')!)
    const expected = turnForStep(step, record.path.length, record.transcript)!
    await waitFor(() => expect(turns()[expected]).toHaveFocus())
    expect(turns()[expected]).toHaveClass('is-target')
    // Marked in words, and said to be approximate.
    expect(turns()[expected]).toHaveTextContent(`Near step: ${label}`)
    await waitFor(() => expect(screen.getAllByRole('status').map((s) => s.textContent).join(' ')).toMatch(/approximate/i))
    // The first step goes to the agent's first turn.
    await user.click(within(diagram()).getByRole('treeitem', { name: new RegExp(`^Intent: ${record.path[0]}`) }))
    await waitFor(() => expect(turns()[turnForStep(0, record.path.length, record.transcript)!]).toHaveFocus())
    expect(document.querySelectorAll('.transcript__turn.is-target')).toHaveLength(1)
  })

  it('jumps from the list of steps too, with the same keys', async () => {
    const client = demo()
    const { summary, record } = await callFor(client, 'Book an appointment', 'booked')
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    await waitFor(() => diagram())
    const buttons = within(pathSection()).getAllByRole('button', { name: new RegExp(record.path[2]) })
    const step = within(pathSection().querySelector('ol')!).getByRole('button', { name: new RegExp(`^${record.path[2]}`) })
    expect(buttons).toContain(step)
    step.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(turns()[turnForStep(2, record.path.length, record.transcript)!]).toHaveFocus())
    expect(step).toHaveAttribute('aria-current', 'step')
  })

  it('draws on the diagram’s steps only: picking one the call never reached says so', async () => {
    const client = demo()
    const { summary } = await callFor(client, 'Book an appointment', 'booked')
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    await waitFor(() => diagram())
    await user.click(within(diagram()).getByRole('treeitem', { name: /Intent: Cancel an appointment/ }))
    await waitFor(() => expect(screen.getAllByText(/“Cancel an appointment” isn’t on this call’s path/i).length).toBeGreaterThan(0))
    expect(document.querySelectorAll('.transcript__turn.is-target')).toHaveLength(0)
  })

  it('falls back to the call’s own steps, still clickable, when the designed flow can’t be read', async () => {
    const real = demo()
    const { summary, record } = await callFor(real, 'Book an appointment', 'booked')
    const client = withOverrides(real, { getAgent: async () => Promise.reject(new AuthError('forbidden', 'No.')) })
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    expect(await within(pathSection()).findByText(/designed flow isn’t available to draw this on/i)).toBeInTheDocument()
    expect(within(pathSection()).queryByRole('tree')).not.toBeInTheDocument()
    const items = within(pathSection()).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(record.path)
    await user.click(within(pathSection()).getByRole('button', { name: record.path[1] }))
    await waitFor(() => expect(turns()[turnForStep(1, record.path.length, record.transcript)!]).toHaveFocus())
  })

  it('does not read the flow for someone who may not see agents', async () => {
    const real = demo()
    const getAgent = vi.fn(real.getAgent.bind(real))
    // A front desk member who took the call may open it but has no permission to see the agent.
    const page = await loadCalls(real)
    const mine = page.calls.find((c) => c.handledBy === 'Meena S')
    expect(mine).toBeDefined()
    await openCall('frontdesk@example.com', mine!.id, withOverrides(real, { getAgent }))
    expect(within(pathSection()).getByText(/designed flow isn’t available to draw this on/i)).toBeInTheDocument()
    expect(getAgent).not.toHaveBeenCalled()
  })

  it('moves focus to the diagram with f', async () => {
    const client = demo()
    const { summary } = await callFor(client, 'Book an appointment', 'booked')
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    await waitFor(() => diagram())
    await user.click(document.body)
    await user.keyboard('f')
    expect(document.activeElement?.getAttribute('data-flow-node')).toBeTruthy()
    expect(document.activeElement?.getAttribute('data-on-path')).toBe('true')
  })
})

describe('Call detail: searching the conversation', () => {
  async function withWord() {
    const client = demo()
    const { summary, record } = await callFor(client, 'Book an appointment', 'booked')
    // A word that comes up more than once.
    const words = record.transcript.flatMap((t) => t.text.replace(/\{\{\w+:([^}]*)\}\}/g, '$1').toLowerCase().match(/[a-z]{4,}/g) ?? [])
    const counts = new Map<string, number>()
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)
    const word = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0][0]
    return { client, summary, record, word }
  }

  it('highlights every match, counts them, and goes next and previous', async () => {
    const { client, summary, record, word } = await withWord()
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    const total = searchTurns(record.transcript, word, false).length
    expect(total).toBeGreaterThan(1)
    await user.type(screen.getByLabelText('Search the conversation'), word)
    expect(screen.getByText(`Match 1 of ${total}.`)).toBeInTheDocument()
    const marks = document.querySelectorAll('mark.ts__mark')
    expect(marks).toHaveLength(total)
    expect(marks[0]).toHaveAttribute('aria-current', 'true')
    await user.click(screen.getByRole('button', { name: /next match/i }))
    expect(screen.getByText(`Match 2 of ${total}.`)).toBeInTheDocument()
    expect(document.querySelectorAll('mark.ts__mark')[1]).toHaveAttribute('aria-current', 'true')
    expect(document.querySelectorAll('mark.ts__mark')[0]).not.toHaveAttribute('aria-current')
    await user.click(screen.getByRole('button', { name: /previous match/i }))
    await user.click(screen.getByRole('button', { name: /previous match/i }))
    // Round to the last.
    expect(screen.getByText(`Match ${total} of ${total}.`)).toBeInTheDocument()
    // Enter in the box goes on, Shift+Enter goes back.
    await user.click(screen.getByLabelText('Search the conversation'))
    await user.keyboard('{Enter}')
    expect(screen.getByText(`Match 1 of ${total}.`)).toBeInTheDocument()
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(screen.getByText(`Match ${total} of ${total}.`)).toBeInTheDocument()
  })

  it('says when nothing matches, and Escape clears the search', async () => {
    const { client, summary } = await withWord()
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    const box = screen.getByLabelText('Search the conversation')
    await user.type(box, 'zzzzqqq')
    expect(screen.getByText('No matches.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next match/i })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(box).toHaveValue('')
    expect(document.querySelectorAll('mark.ts__mark')).toHaveLength(0)
  })

  async function namedCall(client: ConsoleClient) {
    const { calls } = await loadCalls(client)
    for (const c of calls) {
      const r = await client.getCallRecord(ORG, c.id)
      if (r.callerName && r.transcript.some((t) => t.text.includes(`{{name:${r.callerName}}}`))) return r
    }
    throw new Error('No call names the caller in its transcript.')
  }

  it('keeps hidden details hidden: a name that is redacted cannot be found', async () => {
    const client = demo()
    const named = await namedCall(client)
    const { user } = await openCall('viewer@example.com', named.id, client)
    await user.type(screen.getByLabelText('Search the conversation'), named.callerName!)
    expect(screen.getByText('No matches.')).toBeInTheDocument()
  })

  it('finds the same name for someone who may see it', async () => {
    const client = demo()
    const named = await namedCall(client)
    const { user } = await openCall('supervisor@example.com', named.id, client)
    await user.type(screen.getByLabelText('Search the conversation'), named.callerName!)
    expect(screen.getByText(/^Match 1 of \d+\.$/)).toBeInTheDocument()
    expect(document.querySelector('mark.ts__mark')).toHaveTextContent(named.callerName!)
  })

  it('moves to the search with /', async () => {
    const { client, summary } = await withWord()
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    await user.click(document.body)
    await user.keyboard('/')
    expect(screen.getByLabelText('Search the conversation')).toHaveFocus()
  })
})

describe('Call detail: tool calls and notes', () => {
  it('puts the tools the agent used on a timeline, each saying whether it worked', async () => {
    const client = demo()
    const { summary, record } = await callFor(client, 'Book an appointment', 'booked')
    expect(record.toolCalls.length).toBeGreaterThan(0)
    await openCall('supervisor@example.com', summary.id, client)
    const timeline = screen.getByRole('list', { name: /tools used, in order/i })
    const items = within(timeline).getAllByRole('listitem')
    expect(items).toHaveLength(record.toolCalls.length)
    const first = [...record.toolCalls].sort((a, b) => a.at - b.at)[0]
    expect(items[0]).toHaveTextContent(first.name)
    expect(items[0]).toHaveTextContent(first.ok ? 'worked' : 'failed')
    expect(items[0]).toHaveTextContent(first.summary)
    expect(items[0]).toHaveTextContent(/\d+:\d\d into the call/)
  })

  it('says None when no tool was used', async () => {
    const client = demo()
    const { summary, record } = await callFor(client, 'Ask about timings and directions', 'dropped')
    expect(record.toolCalls).toHaveLength(0)
    await openCall('supervisor@example.com', summary.id, client)
    const section = screen.getByRole('heading', { level: 2, name: /^tools used$/i }).closest('section')!
    expect(within(section).getByText('None.')).toBeInTheDocument()
    expect(within(section).queryByRole('list')).not.toBeInTheDocument()
  })

  it('adds a note that shows at once, and tells the form what is missing', async () => {
    const client = demo()
    const { summary } = await callFor(client, 'Book an appointment', 'booked')
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    const notes = screen.getByRole('heading', { level: 2, name: /^notes$/i }).closest('section')!
    await user.click(within(notes).getByRole('button', { name: /add note/i }))
    expect(await within(notes).findByText('Write the note first.')).toBeInTheDocument()
    await user.type(within(notes).getByLabelText('Add a note'), 'Called the patient back; slot confirmed.')
    await user.click(within(notes).getByRole('button', { name: /add note/i }))
    expect(await within(notes).findByText(/called the patient back; slot confirmed/i)).toBeInTheDocument()
    expect(within(notes).getByLabelText('Add a note')).toHaveValue('')
    expect((await client.getCallRecord(ORG, summary.id)).notes.map((n) => n.text)).toContain('Called the patient back; slot confirmed.')
  })

  it('flags a wrong answer', async () => {
    const client = demo()
    const { summary } = await callFor(client, 'Book an appointment', 'booked')
    const { user } = await openCall('supervisor@example.com', summary.id, client)
    await user.click(screen.getByRole('button', { name: /flag a wrong answer/i }))
    const dialog = screen.getByRole('dialog', { name: /flag a wrong answer/i })
    await user.type(within(dialog).getByLabelText(/what it got wrong/i), 'Gave the wrong OPD room.')
    await user.click(within(dialog).getByRole('button', { name: /flag it/i }))
    expect(await screen.findByText(/flagged\. it’s on the bot desk/i)).toBeInTheDocument()
  })
})
