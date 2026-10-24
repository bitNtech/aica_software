import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { localDay } from '../lib/time'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'
const nav = async () => within(await screen.findByRole('navigation', { name: /^organisation$/i }))

async function open(email: string, client = createDemoConsoleClient({ latency: 0 }), path = O) {
  const view = renderApp(path, { consoleClient: client })
  await signIn(view.user, email)
  return { ...view, client }
}

describe('Sidebar counts', () => {
  it('shows the front desk who is waiting and what is overdue, and says it in words', async () => {
    await open('frontdesk@example.com')
    // The count is part of the link's name, so it is read with it.
    // The demo has one emergency among the three waiting.
    const queue = await screen.findByRole('link', { name: /^live calls 3 waiting, including an emergency$/i })
    // The figure drawn is the number (with a mark for the emergency): the words are for screen readers.
    expect(within(queue).getByText('! 3')).toHaveAttribute('aria-hidden', 'true')
    expect(await (await nav()).findByRole('link', { name: /^callbacks \d+ overdue$/i })).toBeInTheDocument()
  })

  it('puts the number of waiting callers in the browser tab', async () => {
    await open('frontdesk@example.com')
    await waitFor(() => expect(document.title).toMatch(/^\(3\) /))
    expect(document.title).toMatch(/· Arogya .* · AICA$/)
  })

  it('counts appointment requests to review for a viewer, who also sees who is waiting but not callbacks', async () => {
    const client = createDemoConsoleClient({ latency: 0 })
    const handoffs = vi.spyOn(client, 'listHandoffs')
    const callbacks = vi.spyOn(client, 'listCallbacks')
    const desk = vi.spyOn(client, 'getDesk')
    const appointments = vi.spyOn(client, 'listAppointments')
    await open('viewer@example.com', client)

    await (await nav()).findByRole('link', { name: /appointments/i })
    await waitFor(() => expect(appointments).toHaveBeenCalled())
    const check = (await client.listAppointments('arogya-demo', localDay(0), localDay(7))).filter((a) => a.status === 'pending' || (!!a.checkReason && a.status === 'rescheduled')).length
    if (check > 0) expect(await (await nav()).findByRole('link', { name: new RegExp(`^appointments ${check} to review$`, 'i') })).toBeInTheDocument()
    else expect((await nav()).getByRole('link', { name: /^appointments$/i })).toBeInTheDocument()

    // A viewer watches Live calls, so it reads who is waiting; Callbacks and the desk aren't theirs.
    await waitFor(() => expect(handoffs).toHaveBeenCalled())
    expect(callbacks).not.toHaveBeenCalled()
    expect(desk).not.toHaveBeenCalled()
    // They watch Live calls, so they get its count of callers waiting too.
    expect(await (await nav()).findByRole('link', { name: /^live calls \d+ waiting/i })).toBeInTheDocument()
    expect((await nav()).queryByRole('link', { name: /handoff queue/i })).not.toBeInTheDocument()
  })

  it('counts open flagged answers on the Bot desk for the people who run it', async () => {
    const client = createDemoConsoleClient({ latency: 0 })
    await open('admin@example.com', client)
    const open_ = (await client.getDesk('arogya-demo')).flags.filter((f) => f.status === 'open').length
    if (open_ > 0) expect(await (await nav()).findByRole('link', { name: new RegExp(`^bot desk ${open_} flagged$`, 'i') })).toBeInTheDocument()
  })

  it('marks an emergency in the badge and announces it once', async () => {
    // The demo's own waiting list has an emergency in it.
    await open('frontdesk@example.com')
    const queue = await screen.findByRole('link', { name: /^live calls 3 waiting, including an emergency$/i })
    // An exclamation mark as well as the colour.
    expect(within(queue).getByText('! 3')).toBeInTheDocument()
    const region = await waitFor(() => {
      const el = document.querySelector('[aria-live="assertive"].sr-only')
      expect(el).toHaveTextContent(/emergency: a caller is waiting for a person/i)
      return el
    })
    expect(region).toHaveAttribute('aria-atomic', 'true')
  })

  it('keeps the last counts when a refresh fails', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    let fail = false
    const client = {
      ...demo,
      listHandoffs: async (org: string) => {
        if (fail) throw new Error('offline')
        return demo.listHandoffs(org)
      },
    }
    const view = await open('frontdesk@example.com', client)
    await screen.findByRole('link', { name: /^live calls 3 waiting, including an emergency$/i })
    fail = true
    window.dispatchEvent(new Event('focus'))
    // Nothing is said about the failure and the badge stays.
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByRole('link', { name: /^live calls 3 waiting, including an emergency$/i })).toBeInTheDocument()
    view.unmount()
  })
})
