import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import type { ConsoleClient } from '../console/types'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'

// A fixed moment, when all three of the lines' own sample calls are in
// progress (the demo's live calls follow the clock). The three waiting
// callers don't depend on it: they stay on the line while they wait.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(1_700_000_000_000))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** The queue's rows, in order, across its groups (not the filter menus' own options). */
const rows = () => screen.getAllByRole('listbox').flatMap((l) => within(l).getAllByRole('option'))

async function open(email: string, path = `${O}/live`, consoleClient?: ConsoleClient) {
  const view = renderApp(path, consoleClient ? { consoleClient } : undefined)
  await signIn(view.user, email)
  await screen.findAllByRole('listbox')
  return { ...view, options: rows() }
}

/** Signs in and waits for the sidebar, on a page that isn't the queue. */
async function openPage(email: string, path: string) {
  const view = renderApp(path)
  await signIn(view.user, email)
  await screen.findByRole('navigation', { name: /organisation/i })
  return view
}

const detail = () => screen.getByRole('region', { name: /call details/i })
const nav = () => within(screen.getByRole('navigation', { name: /organisation/i }))
const ACTIONS = /take the call|guide the agent|hand to a colleague|make a callback/i

describe('Live calls: one queue', () => {
  it('lists emergencies first, then who has waited longest, then the calls the agents are on', async () => {
    const { options } = await open('frontdesk@example.com')
    expect(options[0]).toHaveTextContent(/emergency/i)
    expect(options[0]).toHaveTextContent(/venkatesan r/i)
    // Waiting 4.5 minutes, then 2 minutes.
    expect(options[1]).toHaveTextContent(/selvi murugan/i)
    expect(options[2]).toHaveTextContent(/ramasamy k/i)
    // Then the call that sounds upset, before the two ordinary ones.
    expect(options[3]).toHaveTextContent(/sounds upset/i)
    expect(options[3]).not.toHaveTextContent(/asking for a person/i)
    expect(options).toHaveLength(6)
    // Each row says who, which agent and line, and what state it is in, in words.
    expect(options[1]).toHaveTextContent(/OPD appointments/)
    expect(options[1]).toHaveTextContent(/\+91 00000 01210/)
    expect(options[1]).toHaveTextContent(/asking for a person/i)
    expect(options[5]).toHaveTextContent(/with the agent/i)
    // The summary line and the group counts.
    expect(screen.getByText('3 waiting · 3 on calls')).toBeInTheDocument()
  })

  it('keeps taken and missed handovers in a folded "Recently" group, with what the old queue showed', async () => {
    const { user } = await open('frontdesk@example.com')
    const toggle = screen.getByRole('button', { name: /recently ended or taken/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const recent = screen.getByRole('listbox', { name: /recently ended or taken/i })
    // Meena is the person signed in, so it says "you".
    expect(within(recent).getAllByText(/taken by you at/i).length).toBeGreaterThan(0)
    expect(within(recent).getByText(/wanted to book for two family members/i)).toBeInTheDocument()
    expect(within(recent).getByText(/caller hung up before anyone answered/i)).toBeInTheDocument()
  })

  it('opens the most urgent caller beside the list, with everything the agent learned', async () => {
    const { user, options } = await open('frontdesk@example.com')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    let d = within(detail())
    expect(d.getByRole('heading', { level: 2, name: /venkatesan r/i })).toBeInTheDocument()
    expect(d.getByText(/this caller needs a person now/i)).toBeInTheDocument()
    expect(d.getByRole('heading', { name: /why they want a person/i })).toBeInTheDocument()
    expect(d.getByText(/the caller described chest pain/i)).toBeInTheDocument()

    await user.click(options[2])
    d = within(detail())
    expect(d.getByRole('heading', { name: /agent’s summary so far/i })).toBeInTheDocument()
    expect(d.getByText(/why the insurance claim for his father/i)).toBeInTheDocument()
    expect(d.getByRole('heading', { name: /details collected/i })).toBeInTheDocument()
    expect(d.getByText('Policy number')).toBeInTheDocument()
    expect(d.getByText('SH-88213-02')).toBeInTheDocument()
    // The transcript, as a log that doesn't read itself out line by line.
    const log = d.getByRole('log', { name: /live transcript/i })
    expect(log).toHaveAttribute('aria-live', 'off')
    expect(within(log).getByText(/nobody tells me anything/i)).toBeInTheDocument()
    expect(d.getByRole('heading', { name: /notes to the agent/i })).toBeInTheDocument()
    // Where the call is, and its language, line and agent.
    expect(d.getByText('Insurance claim')).toBeInTheDocument()
    expect(d.getByText(/passed to a person/i)).toBeInTheDocument()
    expect(d.getByText('English')).toBeInTheDocument()
    expect(d.getByText('Main reception')).toBeInTheDocument()
  })

  it('moves between rows with the arrow keys and j and k, and opens one with Enter', async () => {
    const { user, options } = await open('frontdesk@example.com')
    options[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(options[1]).toHaveFocus()
    // Moving doesn't open: the open one is still the first.
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('j')
    expect(options[2]).toHaveFocus()
    await user.keyboard('k')
    expect(options[1]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(within(detail()).getByRole('heading', { level: 2, name: /selvi murugan/i })).toBeInTheDocument()
  })

  it('searches and filters, with a chip for each, and clears them', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.type(screen.getByRole('searchbox', { name: /search calls/i }), '21877')
    expect(rows()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /remove filter: search: 21877/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    expect(rows()).toHaveLength(6)

    await user.click(screen.getByRole('checkbox', { name: /needs a person only/i }))
    // Three waiting, and the one that sounds upset.
    expect(rows()).toHaveLength(4)
    await user.selectOptions(screen.getByLabelText(/^agent$/i), 'OPD appointments')
    expect(rows()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /remove filter: agent: opd appointments/i })).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: /search calls/i }), 'zzzz')
    expect(await screen.findByText(/no calls match/i)).toBeInTheDocument()
  })
})

describe('Live calls: what a person who takes calls can do', () => {
  it('takes a waiting caller, and says who has it', async () => {
    const { user } = await open('frontdesk@example.com')
    const d = within(detail())
    for (const name of [/take the call/i, /guide the agent/i, /hand to a colleague/i, /make a callback/i]) expect(d.getByRole('button', { name })).toBeInTheDocument()
    await user.click(d.getByRole('button', { name: /take the call/i }))
    expect(await screen.findByText(/you took the call from venkatesan r/i)).toBeInTheDocument()
    await waitFor(() => expect(within(detail()).getAllByText(/taken by you/i).length).toBeGreaterThan(0))
    // Nothing more to take, and the agent is no longer on it.
    expect(within(detail()).queryByRole('button', { name: /take the call/i })).toBeNull()
    expect(within(detail()).queryByRole('button', { name: /guide the agent/i })).toBeNull()
    // It left the waiting group for "Recently", and the count went down.
    expect(await screen.findByText('2 waiting · 3 on calls')).toBeInTheDocument()
    expect(await nav().findByRole('link', { name: /^live calls 2 waiting$/i })).toBeInTheDocument()
  })

  it('says who has a call when someone else got there first, and shows who', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    // Somebody else takes the first caller just before this person's click arrives.
    const client: ConsoleClient = {
      ...demo,
      takeHandoff: async (o, id) => {
        demo.setViewer?.({ id: 'u_frontdesk2', name: 'Suresh B', roles: { 'arogya-demo': 'front_desk' } })
        await demo.takeHandoff(o, id)
        demo.setViewer?.({ id: 'u_frontdesk', name: 'Meena S', roles: { 'arogya-demo': 'front_desk' } })
        return demo.takeHandoff(o, id)
      },
    }
    const { user } = await open('frontdesk@example.com', `${O}/live`, client)
    await user.click(within(detail()).getByRole('button', { name: /take the call/i }))
    expect(await within(detail()).findByRole('alert')).toHaveTextContent(/suresh b has already taken this call/i)
    await waitFor(() => expect(within(detail()).getAllByText(/taken by suresh b/i).length).toBeGreaterThan(0))
  })

  it('guides the agent with a note only it hears', async () => {
    const { user, options } = await open('frontdesk@example.com')
    await user.click(options[2])
    await user.click(within(detail()).getByRole('button', { name: /guide the agent/i }))
    const field = within(detail()).getByLabelText(/note to the agent/i)
    expect(field).toHaveFocus()
    await user.type(field, 'Offer a call from billing today.')
    await user.click(within(detail()).getByRole('button', { name: /send to the agent/i }))
    expect(await screen.findByText(/sent to the agent\. the caller doesn’t hear it/i)).toBeInTheDocument()
    expect(await within(detail()).findByText(/offer a call from billing today/i)).toBeInTheDocument()
  })

  it('hands a call to a colleague', async () => {
    const { user, options } = await open('frontdesk@example.com')
    await user.click(options[2])
    await user.click(within(detail()).getByRole('button', { name: /hand to a colleague/i }))
    const dialog = screen.getByRole('dialog', { name: /hand the call to a colleague/i })
    const who = within(dialog).getByLabelText(/who takes it/i)
    const colleague = within(who).getAllByRole('option').find((o) => (o as HTMLOptionElement).value !== '')!
    await user.selectOptions(who, colleague.textContent!)
    await user.click(within(dialog).getByRole('button', { name: /hand over/i }))
    expect((await screen.findAllByText(new RegExp(`handed to ${colleague.textContent}`, 'i'))).length).toBeGreaterThan(0)
  })

  it('turns a caller who hung up into a callback, with a way to Callbacks', async () => {
    const { user, options } = await open('frontdesk@example.com')
    await user.click(options[1])
    await user.click(within(detail()).getByRole('button', { name: /caller hung up: make a callback/i }))
    expect(await screen.findByText(/a callback was made for selvi murugan, assigned to you/i)).toBeInTheDocument()
    // The row now says the caller hung up.
    await waitFor(() => expect(within(detail()).getAllByText(/caller hung up/i).length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: /open callbacks/i }))
    expect(await screen.findByText(/needs a cardiology review this week/i)).toBeInTheDocument()
  })

  it('shows a shortcut for each action, and the ? list names them', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.keyboard('?')
    const list = within(await screen.findByRole('dialog', { name: /keyboard shortcuts/i }))
    for (const text of [/take the call/i, /guide the agent/i, /hand the call to a colleague/i, /next caller/i, /search the queue/i]) expect(list.getByText(text)).toBeInTheDocument()
  })

  it('takes the open call with T', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.keyboard('t')
    expect(await screen.findByText(/you took the call from venkatesan r/i)).toBeInTheDocument()
  })
})

describe('Live calls: people who only watch', () => {
  it('sees the queue and the call, and no buttons to act on it', async () => {
    const { options } = await open('viewer@example.com')
    expect(options.length).toBeGreaterThan(0)
    expect(within(detail()).getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(within(detail()).getByRole('log', { name: /live transcript/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ACTIONS })).toBeNull()
    expect(screen.queryByRole('button', { name: /listen in/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /alerts/i })).toBeNull()
    expect(screen.queryByLabelText(/note to the agent/i)).toBeNull()
    // They aren't shown disabled ones, either.
    expect(document.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0)
  })

  it('reaches Live calls from the sidebar, without a count they cannot see', async () => {
    await openPage('viewer@example.com', O)
    expect(await nav().findByRole('link', { name: /^live calls$/i })).toBeInTheDocument()
  })

  it('also sees it as a supervisor, with the buttons that go with taking calls', async () => {
    await open('supervisor@example.com')
    expect(within(detail()).getByRole('button', { name: /take the call/i })).toBeInTheDocument()
  })
})

describe('Live calls: the old Handoff queue', () => {
  it('redirects /handoffs to Live calls, and is gone from the sidebar', async () => {
    await openPage('frontdesk@example.com', `${O}/handoffs`)
    expect(await screen.findByRole('heading', { level: 1, name: /live calls/i })).toBeInTheDocument()
    expect(nav().queryByRole('link', { name: /handoff queue/i })).toBeNull()
    const link = nav().getByRole('link', { name: /^live calls/i })
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link).toHaveAttribute('href', `${O}/live`)
  })

  it('carries the waiting count as a badge on Live calls, marking the emergency in words', async () => {
    await openPage('frontdesk@example.com', O)
    const link = await nav().findByRole('link', { name: /^live calls 3 waiting, including an emergency$/i })
    expect(within(link).getByText('! 3')).toBeInTheDocument()
  })
})

describe('Live calls: when things change under you', () => {
  it('shows "Jump to latest" once you scroll up in the transcript', async () => {
    const { user } = await open('frontdesk@example.com')
    const log = within(detail()).getByRole('log', { name: /live transcript/i })
    expect(screen.queryByRole('button', { name: /jump to latest/i })).toBeNull()
    // jsdom has no layout: say how tall the log is and where it is scrolled to.
    Object.defineProperty(log, 'scrollHeight', { value: 500, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 100, configurable: true })
    fireEvent.scroll(log)
    const jump = await screen.findByRole('button', { name: /jump to latest/i })
    await user.click(jump)
    expect(screen.queryByRole('button', { name: /jump to latest/i })).toBeNull()
  })

  it('keeps the last queue, with a notice and a way to retry, when a refresh fails', { timeout: 20_000 }, async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    let offline = false
    const client: ConsoleClient = {
      ...demo,
      listLiveCalls: async (o) => {
        if (offline) throw new Error('The network is down.')
        return demo.listLiveCalls(o)
      },
    }
    const { user } = await open('frontdesk@example.com', `${O}/live`, client)
    offline = true
    expect(await screen.findByText(/not updating/i, {}, { timeout: 9000 })).toBeInTheDocument()
    // The page isn't blanked: the callers and the open call are still there.
    expect(rows()).toHaveLength(6)
    expect(within(detail()).getByRole('heading', { level: 2, name: /venkatesan r/i })).toBeInTheDocument()
    offline = false
    await user.click(screen.getByRole('button', { name: /try now/i }))
    await waitFor(() => expect(screen.queryByText(/not updating/i)).toBeNull())
  })

  it('keeps showing a call that ended while it was open, and says so', { timeout: 20_000 }, async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    let drop = false
    const client: ConsoleClient = {
      ...demo,
      listLiveCalls: async (o) => {
        const all = await demo.listLiveCalls(o)
        return drop ? all.filter((c) => c.id !== 'live_handoff_3') : all
      },
    }
    await open('frontdesk@example.com', `${O}/live`, client)
    drop = true
    expect(await within(detail()).findByText(/this call has ended/i, {}, { timeout: 9000 })).toBeInTheDocument()
    expect(within(detail()).getByRole('heading', { level: 2, name: /venkatesan r/i })).toBeInTheDocument()
    // Its caller is still waiting for a person, so it can still be taken.
    expect(within(detail()).getByRole('button', { name: /take the call/i })).toBeInTheDocument()
  })

  it('does not take over what you are reading when an emergency arrives', { timeout: 20_000 }, async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    let emergency = false
    const client: ConsoleClient = {
      ...demo,
      listHandoffs: async (o) => (await demo.listHandoffs(o)).filter((h) => emergency || h.id !== 'ho_3'),
      listLiveCalls: async (o) => (await demo.listLiveCalls(o)).filter((c) => emergency || c.id !== 'live_handoff_3'),
    }
    const { user, options } = await open('frontdesk@example.com', `${O}/live`, client)
    expect(options[0]).toHaveTextContent(/selvi murugan/i)
    await user.click(options[1])
    expect(within(detail()).getByRole('heading', { level: 2, name: /ramasamy k/i })).toBeInTheDocument()
    emergency = true
    await waitFor(() => expect(rows()[0]).toHaveTextContent(/emergency/i), { timeout: 9000 })
    // Still the same call open.
    expect(within(detail()).getByRole('heading', { level: 2, name: /ramasamy k/i })).toBeInTheDocument()
    expect(rows().find((o) => o.getAttribute('aria-selected') === 'true')).toHaveTextContent(/ramasamy k/i)
  })

  it('says so, calmly, when there are no calls', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    const client: ConsoleClient = { ...demo, listLiveCalls: async () => [], listHandoffs: async () => [] }
    const view = renderApp(`${O}/live`, { consoleClient: client })
    await signIn(view.user, 'frontdesk@example.com')
    expect(await screen.findByText(/no calls right now\. new calls appear here as they come in/i)).toBeInTheDocument()
  })

  it('says what went wrong, with a retry, when the first load fails', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    let fail = true
    const client: ConsoleClient = {
      ...demo,
      listLiveCalls: async (o) => {
        if (fail) throw new Error('The network is down.')
        return demo.listLiveCalls(o)
      },
    }
    const view = renderApp(`${O}/live`, { consoleClient: client })
    await signIn(view.user, 'frontdesk@example.com')
    expect(await screen.findByText(/couldn't load live calls/i)).toBeInTheDocument()
    fail = false
    await view.user.click(screen.getByRole('button', { name: /try again/i }))
    expect((await screen.findAllByRole('listbox')).length).toBeGreaterThan(0)
  })
})

describe('Live calls: alerts, opt in and remembered', () => {
  class FakeAudio {
    static made = 0
    state = 'running'
    currentTime = 0
    destination = {}
    resume() {}
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }
    }
    createOscillator() {
      FakeAudio.made += 1
      return { type: '', frequency: { value: 0 }, connect: (n: unknown) => n, start() {}, stop() {} }
    }
  }

  it('starts off, turns sound on for this person, remembers it, and plays nothing on load', async () => {
    vi.stubGlobal('AudioContext', FakeAudio)
    FakeAudio.made = 0
    const first = await open('frontdesk@example.com')
    const menu = screen.getByRole('button', { name: /alerts/i })
    expect(menu).toHaveTextContent(/off/i)
    await first.user.click(menu)
    const sound = screen.getByRole('switch', { name: /sound for new requests/i })
    expect(sound).toHaveAttribute('aria-checked', 'false')
    await first.user.click(sound)
    expect(sound).toHaveAttribute('aria-checked', 'true')
    expect(JSON.parse(localStorage.getItem('aica.live.alerts.u_frontdesk')!)).toEqual({ sound: true, desktop: false })
    // A quiet blip confirms it, once.
    const afterTurningOn = FakeAudio.made
    expect(afterTurningOn).toBeGreaterThan(0)
    first.unmount()

    // Back later (still signed in): still on, and the waiting callers already there don't make a sound.
    renderApp(`${O}/live`)
    await screen.findAllByRole('listbox')
    expect(screen.getByRole('button', { name: /alerts/i })).toHaveTextContent(/1 on/i)
    expect(FakeAudio.made).toBe(afterTurningOn)
  })

  it('sounds the tone for a new waiting caller, not for the ones already there', { timeout: 20_000 }, async () => {
    vi.stubGlobal('AudioContext', FakeAudio)
    FakeAudio.made = 0
    localStorage.setItem('aica.live.alerts.u_frontdesk', JSON.stringify({ sound: true, desktop: false }))
    const demo = createDemoConsoleClient({ latency: 0 })
    let arrived = false
    const client: ConsoleClient = {
      ...demo,
      listHandoffs: async (o) => {
        const all = await demo.listHandoffs(o)
        const extra = { ...all.find((h) => h.id === 'ho_1')!, id: 'ho_new', callId: 'live_new', waitingSince: new Date().toISOString() }
        return arrived ? [...all, extra] : all
      },
    }
    await open('frontdesk@example.com', `${O}/live`, client)
    // The three already waiting made no sound.
    expect(FakeAudio.made).toBe(0)
    arrived = true
    // Two gentle notes for the new one.
    await waitFor(() => expect(FakeAudio.made).toBe(2), { timeout: 9000 })
    await new Promise((r) => setTimeout(r, 4500))
    expect(FakeAudio.made).toBe(2)
  })

  it('says why desktop notifications cannot be turned on, rather than failing silently', async () => {
    // jsdom has no Notification, as some browsers don't.
    const { user } = await open('frontdesk@example.com')
    await user.click(screen.getByRole('button', { name: /alerts/i }))
    const desktop = screen.getByRole('switch', { name: /desktop notification/i })
    await user.click(desktop)
    expect(await screen.findByText(/can’t show desktop notifications/i)).toBeInTheDocument()
    expect(desktop).toHaveAttribute('aria-checked', 'false')
  })

  it('asks the browser only when desktop notifications are turned on, and handles a refusal', async () => {
    const request = vi.fn().mockResolvedValue('denied')
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default', requestPermission: request }))
    const { user } = await open('frontdesk@example.com')
    expect(request).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /alerts/i }))
    await user.click(screen.getByRole('switch', { name: /desktop notification/i }))
    expect(request).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/permission wasn’t given/i)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /desktop notification/i })).toHaveAttribute('aria-checked', 'false')
  })
})
