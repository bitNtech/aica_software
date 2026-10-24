import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { flowRequestDetail } from '../console/flowRequest'
import type { CallLogPage, ConsoleClient } from '../console/types'
import { address, callFor, demo, loadCalls, O, ORG, open as openAs, patternFor, withOverrides } from './callsFixtures'

// A fixed moment: the demo's call log follows the clock.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(1_700_000_000_000))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const table = () => screen.getByRole('table', { name: /calls, newest first/i })
const bodyRows = () => within(table()).getAllByRole('row').slice(1)
const preview = () => screen.getByRole('article', { name: /selected call/i })

/** Signs in on the call history and waits for rows. */
async function open(email: string, search = '', client: ConsoleClient = demo()) {
  const view = await openAs(email, `${O}/calls${search}`, client)
  await screen.findByRole('heading', { level: 1, name: /call history|calls you handled/i })
  await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0))
  return view
}

describe('Call history: the table', () => {
  it('lists the calls as a table with a column for each thing the old rows said', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    await open('supervisor@example.com', '', client)
    const headers = within(table()).getAllByRole('columnheader').map((h) => h.textContent?.trim())
    expect(headers).toEqual(['When', 'Caller', 'Agent', 'What they wanted', 'Outcome', 'Length', 'Language', 'Sounded', 'Success', 'Taken by'])
    expect(bodyRows()).toHaveLength(calls.length)
    const first = bodyRows()[0]
    expect(first).toHaveTextContent(calls[0].agentName)
    expect(first).toHaveTextContent(calls[0].intent)
    // The outcome is words, with an icon, not a colour.
    expect(within(first).getByText(/answered by the agent|booked|handed over|callback asked for|caller hung up|emergency/i)).toBeInTheDocument()
    // The call list has no sentiment or success: "not measured", not a made-up value.
    expect(within(first).getAllByText('Not measured').length).toBeGreaterThanOrEqual(2)
  })

  it('sorts by a column, saying which way', async () => {
    const { user } = await open('supervisor@example.com')
    const head = within(table()).getByRole('columnheader', { name: /length/i })
    expect(head).toHaveAttribute('aria-sort', 'none')
    await user.click(within(head).getByRole('button'))
    expect(head).toHaveAttribute('aria-sort', 'ascending')
    const lengths = () => bodyRows().map((r) => within(r).getAllByRole('cell')[5].textContent!)
    const secs = (t: string) => {
      const h = /(\d+) hour/.exec(t)?.[1] ?? '0'
      const m = /(\d+) min/.exec(t)?.[1] ?? '0'
      const s = /(\d+) s(?:econds?)?\b/.exec(t)?.[1] ?? '0'
      return +h * 3600 + +m * 60 + +s
    }
    const up = lengths().map(secs)
    expect(up).toEqual([...up].sort((a, b) => a - b))
    await user.click(within(head).getByRole('button'))
    expect(head).toHaveAttribute('aria-sort', 'descending')
    const down = lengths().map(secs)
    expect(down).toEqual([...down].sort((a, b) => b - a))
  })

  it('moves with the arrow keys and j and k, and opens the preview with Enter', async () => {
    const { user } = await open('supervisor@example.com')
    const rows = bodyRows()
    rows[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(bodyRows()[1]).toHaveFocus()
    await user.keyboard('j')
    expect(bodyRows()[2]).toHaveFocus()
    await user.keyboard('k')
    expect(bodyRows()[1]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('article', { name: /selected call/i })).toBeInTheDocument()
    expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true')
    // Focus stays in the table, so the next arrow key moves on.
    expect(bodyRows()[1]).toHaveFocus()
  })

  it('j from outside the table moves into it, and / goes to the search', async () => {
    const { user } = await open('supervisor@example.com')
    await user.click(document.body)
    await user.keyboard('j')
    expect(bodyRows()[0]).toHaveFocus()
    await user.keyboard('/')
    expect(screen.getByLabelText('Search')).toHaveFocus()
  })
})

describe('Call history: the preview', () => {
  it('opens beside the list with what the full call has, and puts the call in the address', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    const pick = calls[1]
    const record = await client.getCallRecord(ORG, pick.id)
    const { user } = await open('supervisor@example.com', '?days=7', client)
    await user.click(bodyRows()[1])
    const p = await screen.findByRole('article', { name: /selected call/i })
    await within(p).findByText(record.summary)
    expect(address(screen).params.get('call')).toBe(pick.id)
    // Summary, how it ended, details, the path as a list, the start of the conversation, the notes, the way on.
    expect(within(p).getByRole('heading', { name: /after the call/i })).toBeInTheDocument()
    expect(within(p).getByText(record.analysis.successReason)).toBeInTheDocument()
    const path = within(p).getByRole('region', { name: /path through the flow/i })
    expect(within(path).getAllByRole('listitem').map((li) => li.textContent)).toEqual(record.path)
    const turns = within(within(p).getByRole('region', { name: /start of the conversation/i })).getAllByRole('listitem')
    expect(turns.length).toBeLessThanOrEqual(4)
    expect(turns[0]).toHaveTextContent(/AICA|Caller/)
    expect(within(p).getByText(/no notes yet|\d notes?/i)).toBeInTheDocument()
    expect(within(p).getByRole('link', { name: /open full call/i })).toHaveAttribute('href', `${O}/calls/${pick.id}`)
    // The row is marked as the open one, and the list is still there.
    expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true')
    expect(bodyRows().length).toBe(calls.length)
  })

  it('keeps the filters in the address, and Back closes it', async () => {
    const { user } = await open('supervisor@example.com', '?days=30&q=a&outcome=resolved')
    await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0))
    await user.click(bodyRows()[0])
    await screen.findByRole('article', { name: /selected call/i })
    const params = address(screen).params
    expect([params.get('days'), params.get('q'), params.get('outcome')]).toEqual(['30', 'a', 'resolved'])
    expect(params.get('call')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /probe back/i }))
    await waitFor(() => expect(screen.queryByRole('article', { name: /selected call/i })).not.toBeInTheDocument())
    expect(address(screen).params.get('call')).toBeNull()
    expect(address(screen).params.get('days')).toBe('30')
    await user.click(screen.getByRole('button', { name: /probe forward/i }))
    expect(await screen.findByRole('article', { name: /selected call/i })).toBeInTheDocument()
  })

  it('opens a shared link straight to the call, and Escape closes it', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    const { user } = await open('supervisor@example.com', `?call=${calls[2].id}`, client)
    const p = await screen.findByRole('article', { name: /selected call/i })
    expect(within(p).getByRole('link', { name: /open full call/i })).toHaveAttribute('href', `${O}/calls/${calls[2].id}`)
    expect(bodyRows()[2]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('article', { name: /selected call/i })).not.toBeInTheDocument())
    expect(address(screen).params.get('call')).toBeNull()
  })

  it('goes to the whole call with O', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    const { user } = await open('supervisor@example.com', `?call=${calls[0].id}`, client)
    await screen.findByRole('article', { name: /selected call/i })
    await user.click(bodyRows()[0])
    await user.keyboard('o')
    await waitFor(() => expect(address(screen).path).toBe(`${O}/calls/${calls[0].id}`))
  })

  it('opens in a drawer on a narrow screen, still in the address, and Close puts the list back', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
    try {
      const { user } = await open('supervisor@example.com')
      await user.click(bodyRows()[0])
      const drawer = await screen.findByRole('dialog', { name: /call preview/i })
      expect(within(drawer).getByRole('article', { name: /selected call/i })).toBeInTheDocument()
      expect(address(screen).params.get('call')).toBeTruthy()
      // The drawer has its own Close, so the preview doesn't add a second.
      expect(within(drawer).getAllByRole('button', { name: /^close/i })).toHaveLength(1)
      await user.click(within(drawer).getByRole('button', { name: /^close$/i }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /call preview/i })).not.toBeInTheDocument())
      expect(address(screen).params.get('call')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('says when the call can’t be opened, and tries again', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    let fail = true
    const flaky = withOverrides(client, {
      getCallRecord: async (o, id) => {
        if (fail) throw new AuthError('unknown', 'The call service is busy.')
        return client.getCallRecord(o, id)
      },
    })
    const { user } = await open('supervisor@example.com', `?call=${calls[0].id}`, flaky)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/the call service is busy/i)
    fail = false
    await user.click(within(alert).getByRole('button', { name: /try again/i }))
    expect(await within(preview()).findByRole('heading', { name: /after the call/i })).toBeInTheDocument()
  })

  it('shows sentiment and success in the table for a call once it has been opened', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    const record = await client.getCallRecord(ORG, calls[0].id)
    const { user } = await open('supervisor@example.com', '', client)
    expect(within(bodyRows()[0]).getAllByText('Not measured')).toHaveLength(2)
    await user.click(bodyRows()[0])
    await within(preview()).findByRole('heading', { name: /after the call/i })
    await waitFor(() => expect(within(bodyRows()[0]).queryByText('Not measured', { selector: '.sr-only' })).toBeNull())
    expect(within(bodyRows()[0]).getByText(record.analysis.success ? 'Successful' : 'Not successful')).toBeInTheDocument()
  })
})

describe('Call history: from a link, and by who is looking', () => {
  it('starts from the period, agent, outcome and search in the address, as Home links it', async () => {
    const client = demo()
    const agent = (await client.listAgents(ORG)).find((a) => !a.setupStep)!
    await open('owner@example.com', `?q=a&days=30&outcome=resolved&agent=${agent.id}`, client)
    expect(screen.getByRole('radio', { name: '30 days' })).toBeChecked()
    expect(screen.getByLabelText('Search')).toHaveValue('a')
    expect(screen.getByLabelText('What happened')).toHaveValue('resolved')
    expect(screen.getByLabelText('Agent')).toHaveValue(agent.id)
    // Each is a chip too, and Clear all takes them off.
    const chips = screen.getByRole('list', { name: /applied filters/i })
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/when: 30 days/i), expect.stringMatching(/search: a/i), expect.stringMatching(/outcome: answered/i)]))
  })

  it('writes a changed filter into the address, and Clear all puts the plain page back', async () => {
    const { user } = await open('supervisor@example.com')
    await user.click(screen.getByRole('radio', { name: '30 days' }))
    await user.selectOptions(screen.getByLabelText('What happened'), 'dropped')
    await waitFor(() => expect(address(screen).params.get('outcome')).toBe('dropped'))
    expect(address(screen).params.get('days')).toBe('30')
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    await waitFor(() => expect(address(screen).params.toString()).toBe(''))
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked()
  })

  it('shows the front desk only the calls they took, with no agent filter', async () => {
    await open('frontdesk@example.com')
    expect(screen.getByRole('heading', { level: 1, name: /calls you handled/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Agent')).not.toBeInTheDocument()
    const taken = bodyRows().map((r) => within(r).getAllByRole('cell')[9].textContent)
    expect(taken.every((t) => /Meena S/.test(t ?? ''))).toBe(true)
  })

  it('shows an owner every call, with the agent filter', async () => {
    const client = demo()
    const all = await loadCalls(client)
    await open('owner@example.com', '', client)
    expect(screen.getByRole('heading', { level: 1, name: /^call history$/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Agent')).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(all.calls.length)
  })

  it('hides names and personal details from someone without them, in the table and the preview', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    const named = calls.find((c) => c.callerName)!
    const { user } = await open('viewer@example.com', '', client)
    expect(screen.queryByText(named.callerName!)).not.toBeInTheDocument()
    expect(within(bodyRows()[0]).getByText('A caller')).toBeInTheDocument()
    expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Number or what they asked')
    await user.click(bodyRows()[0])
    const p = await screen.findByRole('article', { name: /selected call/i })
    await within(p).findByRole('heading', { name: /after the call/i })
    expect(within(p).getByText(/personal details are hidden/i)).toBeInTheDocument()
    expect(within(p).queryByText(named.callerName!)).not.toBeInTheDocument()
  })

  it('shows names to someone who may see them', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    const named = calls.find((c) => c.callerName)!
    await open('supervisor@example.com', '', client)
    expect(screen.getAllByText(named.callerName!).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Number, name or what they asked')
  })
})

describe('Call history: export', () => {
  const exporting = (client: ConsoleClient) => {
    const exportCallLog = vi.fn(async () => new Blob(['id,when\n']))
    return { exportCallLog, client: withOverrides(client, { exportCallLog }) }
  }

  it('offers the download to someone who may export, for the period and agent shown', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const { exportCallLog, client } = exporting(demo())
    const { user } = await open('supervisor@example.com', '?days=30', client)
    await user.click(screen.getByRole('button', { name: /download call list/i }))
    await waitFor(() => expect(exportCallLog).toHaveBeenCalledWith(ORG, { days: 30, agentId: undefined }))
    expect(await screen.findByText(/call list downloaded/i)).toBeInTheDocument()
  })

  it('says what went wrong when the file can’t be made', async () => {
    const client = withOverrides(demo(), { exportCallLog: async () => Promise.reject(new AuthError('unknown', 'The export service is down.')) })
    const { user } = await open('supervisor@example.com', '', client)
    await user.click(screen.getByRole('button', { name: /download call list/i }))
    expect(await screen.findByText(/the export service is down/i)).toBeInTheDocument()
  })

  it('has no download for someone without the Export permission, or when the console can’t make one', async () => {
    const { client } = exporting(demo())
    await open('viewer@example.com', '', client)
    expect(screen.queryByRole('button', { name: /download call list/i })).not.toBeInTheDocument()
  })

  it('has no download when the client cannot export (the demo)', async () => {
    await open('supervisor@example.com')
    expect(screen.queryByRole('button', { name: /download call list/i })).not.toBeInTheDocument()
  })
})

describe('Call history: filters over the loaded calls', () => {
  it('filters by language and says it is of the calls loaded', async () => {
    const client = demo()
    const { calls, total } = await loadCalls(client)
    const english = calls.filter((c) => c.language === 'english').length
    const { user } = await open('supervisor@example.com', '', client)
    await user.selectOptions(screen.getByLabelText('Language'), 'english')
    await waitFor(() => expect(bodyRows()).toHaveLength(english))
    expect(address(screen).params.get('lang')).toBe('english')
    const summary = screen.getAllByRole('status').map((s) => s.textContent).join(' ')
    expect(summary).toMatch(new RegExp(`${english} of the ${calls.length} loaded calls`))
    if (total > calls.length) expect(summary).toMatch(/in the period/)
    expect(screen.getByRole('button', { name: /remove filter: language: english/i })).toBeInTheDocument()
  })

  it('says how many of the calls haven’t been opened when asking for sentiment or success', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    const { user } = await open('supervisor@example.com', '', client)
    await user.selectOptions(screen.getByLabelText('How the caller sounded'), 'positive')
    expect(await screen.findByText(/only known for calls opened in this view/i)).toHaveTextContent(new RegExp(`${calls.length} of the loaded calls haven’t been opened`))
    expect(screen.getByText(/none of the \d+ loaded calls match/i)).toBeInTheDocument()
  })

  it('summarises the calls shown: how many, how many the agents answered, how many were handed over', async () => {
    const client = demo()
    const { calls } = await loadCalls(client)
    await open('supervisor@example.com', '', client)
    const answered = Math.round((calls.filter((c) => c.outcome === 'resolved' || c.outcome === 'booked').length / calls.length) * 100)
    const handed = Math.round((calls.filter((c) => ['handed_over', 'emergency', 'callback'].includes(c.outcome)).length / calls.length) * 100)
    const line = screen.getAllByRole('status').find((s) => /answered by the agents/.test(s.textContent ?? ''))!
    expect(line).toHaveTextContent(`${answered}% answered by the agents`)
    expect(line).toHaveTextContent(`${handed}% handed over`)
  })
})

describe('Call history: states', () => {
  const pageOf = (over: Partial<CallLogPage>): CallLogPage => ({ calls: [], total: 0, ...over })

  it('says so when the period has no calls', async () => {
    const client = withOverrides(demo(), { listCallLog: async () => pageOf({}) })
    const view = renderEmpty(client)
    await view
    expect(await screen.findByText('No calls in this period.')).toBeInTheDocument()
  })

  it('says nothing matches, and clears the filters', async () => {
    const real = demo()
    let none = true
    const client = withOverrides(real, { listCallLog: async (o, q) => (none && q.q ? pageOf({}) : real.listCallLog(o, q)) })
    const { user } = await openAs('supervisor@example.com', `${O}/calls?q=zzzz`, client)
    expect(await screen.findByText(/no calls match/i)).toBeInTheDocument()
    none = false
    await user.click(screen.getByRole('button', { name: /clear the filters/i }))
    await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0))
    expect(screen.getByLabelText('Search')).toHaveValue('')
  })

  it('shows skeleton rows while the first calls load', async () => {
    let release: (p: CallLogPage) => void = () => undefined
    const real = demo()
    const client = withOverrides(real, { listCallLog: () => new Promise<CallLogPage>((r) => (release = r)) })
    await openAs('supervisor@example.com', `${O}/calls`, client)
    expect(await screen.findByText('Loading calls…')).toBeInTheDocument()
    expect(table()).toHaveAttribute('aria-busy', 'true')
    await act(async () => release(await loadCalls(real)))
    await waitFor(() => expect(table()).not.toHaveAttribute('aria-busy'))
  })

  it('shows an error with a way to retry', async () => {
    const real = demo()
    let fail = true
    const client = withOverrides(real, { listCallLog: async (o, q) => (fail ? Promise.reject(new AuthError('network', 'We couldn’t reach AICA.')) : real.listCallLog(o, q)) })
    const { user } = await openAs('supervisor@example.com', `${O}/calls`, client)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't load calls/i)
    fail = false
    await user.click(within(alert).getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0))
  })

  it('keeps the calls on screen and says it could not refresh them', async () => {
    const real = demo()
    let fail = false
    const client = withOverrides(real, { listCallLog: async (o, q) => (fail ? Promise.reject(new AuthError('network', 'We couldn’t reach AICA.')) : real.listCallLog(o, q)) })
    const { user } = await open('supervisor@example.com', '', client)
    const rows = bodyRows().length
    fail = true
    await user.click(screen.getByRole('button', { name: /^refresh$/i }))
    expect(await screen.findByText(/couldn’t refresh/i)).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(rows)
    fail = false
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(screen.queryByText(/couldn’t refresh/i)).not.toBeInTheDocument())
  })

  it('asks for more calls and says how many are loaded', async () => {
    const real = demo()
    const { calls } = await loadCalls(real)
    // 120 calls in the period, however many the demo really has.
    const many = Array.from({ length: 120 }, (_, i) => ({ ...calls[i % calls.length], id: `call_many_${i}` }))
    const asked: (number | undefined)[] = []
    const client = withOverrides(real, {
      listCallLog: async (_o, q) => {
        asked.push(q.limit)
        return { calls: many.slice(0, q.limit ?? 50), total: many.length }
      },
    })
    const { user } = await open('supervisor@example.com', '', client)
    expect(bodyRows()).toHaveLength(50)
    expect(screen.getByText(/showing 50 of 120/i)).toBeInTheDocument()
    expect(screen.getAllByRole('status').some((s) => /50 of 120 calls/.test(s.textContent ?? ''))).toBe(true)
    await user.click(screen.getByRole('button', { name: /show 50 more/i }))
    await waitFor(() => expect(bodyRows()).toHaveLength(100))
    expect(asked).toEqual([50, 100])
    expect(screen.getByRole('button', { name: /show 20 more/i })).toBeInTheDocument()
  })

  async function renderEmpty(client: ConsoleClient) {
    return openAs('supervisor@example.com', `${O}/calls`, client)
  }
})

describe('Call history: detected flow patterns', () => {
  async function withPattern(email = 'owner@example.com') {
    const base = demo()
    const { summary, record } = await callFor(base, 'Book an appointment')
    const pattern = await patternFor(base, summary, record)
    const create = vi.fn(base.createChangeRequest.bind(base))
    const client = withOverrides(base, {
      detectNewFlowPatterns: async () => [pattern],
      listNewFlowPatterns: async () => [pattern],
      createChangeRequest: create,
    })
    const view = await open(email, '', client)
    return { ...view, pattern, create, client, record }
  }

  it('shows the banner, and the flow drawn against the designed flow with what is new', async () => {
    const { user, pattern } = await withPattern()
    const banner = await screen.findByRole('region', { name: /detected call flow patterns/i })
    expect(within(banner).getByText(pattern.summary)).toBeInTheDocument()
    await user.click(within(banner).getByRole('button', { name: /view flow/i }))
    const dialog = screen.getByRole('dialog', { name: /detected call flow pattern/i })
    expect(within(dialog).getByRole('tree', { name: /detected flow diagram/i })).toBeInTheDocument()
    const compare = await within(dialog).findByRole('region', { name: /against the designed flow/i })
    const steps = await within(compare).findByRole('list', { name: /each step against the designed flow/i })
    const items = within(steps).getAllByRole('listitem')
    expect(items).toHaveLength(pattern.steps.length)
    // Two steps come from a real call's path, so they are in the design; the extra one is new.
    expect(items[0]).toHaveTextContent('In the designed flow')
    expect(items[items.length - 1]).toHaveTextContent(/^Ask about insurance cover\s*New/)
    expect(within(compare).getByText(/2 of 3 steps are in the designed flow; 1 is new/i)).toBeInTheDocument()
  })

  it('shows sample calls from the pattern with what the caller said, and links to them', async () => {
    const { user, pattern } = await withPattern()
    await user.click(await screen.findByRole('button', { name: /view flow/i }))
    const dialog = screen.getByRole('dialog', { name: /detected call flow pattern/i })
    const calls = await within(dialog).findByRole('region', { name: /calls in this pattern/i })
    const list = await within(calls).findByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(3)
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', expect.stringMatching(new RegExp(`${O}/calls/(${pattern.callIds.join('|')})$`)))
    expect(within(items[0]).getByText(/^“.+”$/)).toBeInTheDocument()
  })

  it('asks bitNtech to build the flow as detected', async () => {
    const { user, pattern, create } = await withPattern()
    await user.click(await screen.findByRole('button', { name: /view flow/i }))
    const dialog = screen.getByRole('dialog', { name: /detected call flow pattern/i })
    await user.click(within(dialog).getByRole('button', { name: /ask bitntech to build this flow/i }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith(ORG, { kind: 'flow_change', agentId: pattern.agentId, title: 'New call flow pattern detected', detail: flowRequestDetail(pattern), urgency: 'normal' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /detected call flow pattern/i })).not.toBeInTheDocument())
  })

  it('lets the hospital edit the detected steps as a diagram, and asks for their version', async () => {
    const { user, pattern, create } = await withPattern()
    await user.click(await screen.findByRole('button', { name: /view flow/i }))
    await user.click(screen.getByRole('button', { name: /edit as a diagram/i }))
    const dialog = screen.getByRole('dialog', { name: /detected call flow pattern/i })
    // Their version is a copy of what was detected, in the editor's diagram; the original stays available.
    expect(within(dialog).getByRole('tree', { name: /conversation flow diagram/i })).toBeInTheDocument()
    expect(within(dialog).getByText(/no changes yet/i)).toBeInTheDocument()
    // Work in the outline (the same editor, as a list).
    await user.click(within(dialog).getByRole('radio', { name: 'Outline' }))
    await user.click(within(dialog).getByRole('button', { name: `Edit ${pattern.steps[2]}` }))
    const name = within(dialog).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Check insurance first')
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    await user.click(within(dialog).getByRole('button', { name: `Add branch to ${pattern.steps[0]}` }))
    await user.type(within(dialog).getByLabelText('Name'), 'No insurance')
    await user.type(within(dialog).getByLabelText('When this applies'), 'the caller has none')
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    await user.click(within(dialog).getByRole('button', { name: `Move ${pattern.steps[1]} down` }))
    await user.type(within(dialog).getByLabelText('A note for bitNtech'), 'Most of these callers are insured.')
    expect(within(dialog).getByText(/added 1 item, renamed 1, moved 1/i)).toBeInTheDocument()

    // As detected is still there to compare with.
    await user.click(within(dialog).getByRole('radio', { name: 'As detected' }))
    expect(within(dialog).getByRole('tree', { name: /flow as detected/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('treeitem', { name: new RegExp(pattern.steps[2]) })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /ask bitntech to build your version/i }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const sent = create.mock.calls[0][1]
    expect(sent).toMatchObject({ kind: 'flow_change', agentId: pattern.agentId, title: 'New call flow pattern detected, with our changes' })
    expect(sent.detail).toContain('Check insurance first')
    expect(sent.detail).not.toContain(`Step: ${pattern.steps[2]}\n`)
    expect(sent.detail).toContain('Branch: No insurance (when the caller has none)')
    expect(sent.detail).toContain('Our note: Most of these callers are insured.')
    expect(sent.detail).toContain(`As detected: ${pattern.steps.join(' > ')}`)
    expect(sent.detail).not.toBe(flowRequestDetail(pattern))
  })

  it('can go back to the detected flow and put the steps back as detected', async () => {
    const { user, pattern } = await withPattern()
    await user.click(await screen.findByRole('button', { name: /view flow/i }))
    await user.click(screen.getByRole('button', { name: /edit as a diagram/i }))
    const dialog = screen.getByRole('dialog', { name: /detected call flow pattern/i })
    await user.click(within(dialog).getByRole('radio', { name: 'Outline' }))
    await user.click(within(dialog).getByRole('button', { name: `Move ${pattern.steps[1]} down` }))
    expect(within(dialog).getByText(/moved 1/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /put back as detected/i }))
    expect(within(dialog).getByText(/no changes yet/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /back to the detected flow/i }))
    expect(within(dialog).getByRole('button', { name: /ask bitntech to build this flow/i })).toBeInTheDocument()
  })

  it('says why a request failed, and keeps the dialog open', async () => {
    const base = demo()
    const { summary, record } = await callFor(base, 'Book an appointment')
    const pattern = await patternFor(base, summary, record)
    const client = withOverrides(base, {
      detectNewFlowPatterns: async () => [pattern],
      listNewFlowPatterns: async () => [pattern],
      createChangeRequest: async () => Promise.reject(new AuthError('forbidden', 'You can’t ask bitNtech for changes.')),
    })
    const { user } = await open('owner@example.com', '', client)
    await user.click(await screen.findByRole('button', { name: /view flow/i }))
    const dialog = screen.getByRole('dialog', { name: /detected call flow pattern/i })
    await user.click(within(dialog).getByRole('button', { name: /ask bitntech to build this flow/i }))
    expect(await within(dialog).findByText(/you can’t ask bitntech for changes/i)).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
  })

  it('still shows the pattern when the designed flow can’t be read, without comparing', async () => {
    const base = demo()
    const { summary, record } = await callFor(base, 'Book an appointment')
    const pattern = await patternFor(base, summary, record)
    const client = withOverrides(base, {
      detectNewFlowPatterns: async () => [pattern],
      listNewFlowPatterns: async () => [pattern],
      getAgent: async () => Promise.reject(new AuthError('forbidden', 'No.')),
    })
    const { user } = await open('owner@example.com', '', client)
    await user.click(await screen.findByRole('button', { name: /view flow/i }))
    const dialog = screen.getByRole('dialog', { name: /detected call flow pattern/i })
    expect(await within(dialog).findByText(/designed flow isn’t available to compare with/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('tree', { name: /detected flow diagram/i })).toBeInTheDocument()
  })

  it('does not show patterns to the front desk, who see only their own calls', async () => {
    const base = demo()
    const { summary, record } = await callFor(base, 'Book an appointment')
    const pattern = await patternFor(base, summary, record)
    const detect = vi.fn(async () => [pattern])
    await open('frontdesk@example.com', '', withOverrides(base, { detectNewFlowPatterns: detect, listNewFlowPatterns: async () => [pattern] }))
    // Their own calls only: nothing to compare against the agents' flows.
    expect(detect).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: /detected call flow patterns/i })).not.toBeInTheDocument()
  })

  it('looks for one agent’s patterns when the list is filtered to that agent', async () => {
    const base = demo()
    const agent = (await base.listAgents(ORG)).find((a) => !a.setupStep)!
    const detect = vi.fn(async () => [])
    await open('owner@example.com', `?agent=${agent.id}`, withOverrides(base, { detectNewFlowPatterns: detect, listNewFlowPatterns: async () => [] }))
    await waitFor(() => expect(detect).toHaveBeenCalledWith(ORG, agent.id, { windowSize: 5 }))
  })
})
