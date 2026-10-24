import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { advanceUpdates, seedBookingSettings } from '../console/demo/bookingRequests'
import { createDemoConsoleClient } from '../console/demoClient'
import type { Appointment } from '../console/types'
import { localDay } from '../lib/time'
import { autoPreview, layoutColumn, neighbour, requestGroups, rivalsOf } from '../pages/console/operate/appointments/model'
import { renderApp, signIn } from './renderApp'

const O = 'arogya-demo'
const client = (role: 'owner' | 'front_desk' | 'viewer' = 'front_desk') => {
  const c = createDemoConsoleClient({ latency: 0, persist: false })
  c.setViewer?.({ id: 'u_x', name: 'Meena S', roles: { [O]: role } })
  return c
}
const all = (c: ReturnType<typeof client>) => c.listAppointments(O, localDay(-14), localDay(13))
/** The seeded cardiology time three patients asked for. */
const contested = async (c: ReturnType<typeof client>) => (await all(c)).filter((a) => a.status === 'pending' && a.date === localDay(1) && a.time === '10:45').sort((a, b) => a.rank!.position - b.rank!.position)

describe('the agent’s requests in the demo', () => {
  it('ranks requests for the same time, the most pressing first, with reasons', async () => {
    const reqs = await contested(client())
    expect(reqs.map((a) => a.rank!.position)).toEqual([1, 2, 3])
    expect(reqs[0]).toMatchObject({ visitReason: expect.stringMatching(/chest pain/i), rank: { level: 'urgent', of: 3 } })
    expect(reqs[2].rank!.level).toBe('routine')
    for (const a of reqs) expect(a.rank!.reasons.length).toBeGreaterThan(20)
  })

  it('tells the patient once confirmed, and Undo stops what hasn’t gone', async () => {
    const c = client()
    const [top] = await contested(c)
    const done = await c.updateAppointment(O, top.id, { status: 'confirmed' })
    expect(done).toMatchObject({ status: 'confirmed', confirmedBy: 'staff' })
    expect(done.updates!.map((u) => [u.channel, u.about, u.state])).toEqual([
      ['callback', 'confirmed', 'queued'],
      ['whatsapp', 'confirmed', 'queued'],
    ])
    expect(done.history!.slice(0, 2).map((h) => h.kind)).toEqual(['notified', 'confirmed'])
    const back = await c.updateAppointment(O, top.id, { undo: true, status: 'pending' })
    expect(back.updates).toBeUndefined()
    expect(back.history![0].text).toMatch(/wasn’t told/)
  })

  it('declines only with a reason, and tells the patient why', async () => {
    const c = client()
    const [, second] = await contested(c)
    await expect(c.updateAppointment(O, second.id, { status: 'declined' })).rejects.toThrow(/say why/i)
    const d = await c.updateAppointment(O, second.id, { status: 'declined', changeReason: 'The doctor is fully booked that day.' })
    expect(d).toMatchObject({ status: 'declined', declineReason: 'The doctor is fully booked that day.' })
    expect(d.updates!.every((u) => u.about === 'declined')).toBe(true)
    await expect(c.updateAppointment(O, second.id, { status: 'confirmed' })).rejects.toThrow(/book it again first/i)
  })

  it('moves a callback and a message on with the clock', () => {
    const at = '2026-10-24T10:00:00.000Z'
    const a = { source: 'ai_call', updates: [{ id: 'upd_ok', about: 'confirmed', channel: 'callback', state: 'queued', at, attempts: 1 }, { id: 'upd_ok2', about: 'confirmed', channel: 'whatsapp', state: 'queued', at, attempts: 1 }] } as unknown as Appointment
    advanceUpdates(a, seedBookingSettings(), Date.parse(at) + 20e3)
    expect(a.updates!.map((u) => u.state)).toEqual(['in_progress', 'sent'])
    advanceUpdates(a, seedBookingSettings(), Date.parse(at) + 300e3)
    expect(a.updates!.map((u) => u.state)).toEqual(['done', 'read'])
  })

  it('sends a failed update again', async () => {
    const c = client()
    const a = (await all(c)).find((x) => x.updates?.some((u) => u.state === 'failed'))!
    const u = a.updates!.find((x) => x.state === 'failed')!
    const again = await c.retryPatientUpdate!(O, a.id, u.id)
    expect(again.updates!.find((x) => x.id === u.id)).toMatchObject({ state: 'queued', attempts: 2 })
    await expect(c.retryPatientUpdate!(O, a.id, u.id)).rejects.toThrow(/nothing to send again/i)
  })

  it('runs the automatic confirmation only when it’s on, leaving urgent ones for a person', async () => {
    const c = client('owner')
    await expect(c.runAutoConfirm!(O)).rejects.toThrow(/automatic confirmation is off/i)
    await c.updateBookingSettings!(O, { ...(await c.getBookingSettings!(O)), confirm: 'auto' })
    const preview = autoPreview(await all(c), await c.getBookingSettings!(O), Date.now())
    const r = await c.runAutoConfirm!(O)
    expect(r.confirmed).toBe(preview.confirm)
    expect(r.offered + r.declined).toBe(preview.others)
    expect(r.left).toBe(preview.left)
    // The cardiology time's top request is urgent: all three are left for a person.
    expect((await contested(c)).length).toBe(3)
    expect((await all(c)).filter((a) => a.updatedBy === 'Automatic confirmation').length).toBe(r.confirmed + r.offered + r.declined)
  })

  it('lets only owners and admins change the booking settings, and checks them', async () => {
    const desk = client('front_desk')
    const s = await desk.getBookingSettings!(O)
    expect(s).toMatchObject({ confirm: 'staff', autoAt: '19:00', callback: true, whatsapp: true })
    await expect(desk.updateBookingSettings!(O, s)).rejects.toThrow(/permission/i)
    const owner = client('owner')
    await expect(owner.updateBookingSettings!(O, { ...s, autoAt: '7pm' })).rejects.toThrow(/choose a time/i)
    expect(await owner.updateBookingSettings!(O, { ...s, whatsapp: false })).toMatchObject({ whatsapp: false, updatedBy: 'Meena S' })
  })
})

describe('requests, worked out', () => {
  it('groups requests by time, urgent first, piles them on a calendar in rank order, and finds a request’s rivals', async () => {
    const rows = await all(client())
    const groups = requestGroups(rows.filter((a) => a.status === 'pending'), rows, 15)
    expect(groups[0].level).toBe('urgent')
    const cardio = groups.find((g) => g.time === '10:45' && g.date === localDay(1))!
    expect(cardio.requests.map((a) => a.rank!.position)).toEqual([1, 2, 3])
    expect(rivalsOf(cardio.requests[0], rows).map((a) => a.id)).toEqual(cardio.requests.slice(1).map((a) => a.id))
    // A pile takes one place in the column (no side-by-side lanes), best-ranked first, beside a booking that truly clashes.
    const clash = { ...cardio.requests[0], id: 'given', status: 'confirmed' as const, rank: undefined }
    const placed = layoutColumn([...cardio.requests].reverse().concat(clash), 15)
    const pile = placed.filter((p) => p.appt.id !== 'given')
    expect(pile.map((p) => p.appt.rank!.position)).toEqual([1, 2, 3])
    expect(new Set(pile.map((p) => p.lane)).size).toBe(1)
    expect(placed.find((p) => p.appt.id === 'given')!.lane).not.toBe(pile[0].lane)
    expect(pile[0].lanes).toBe(2)
    // The arrow keys go down the pile in rank order.
    const items = pile.map((p) => ({ id: p.appt.id, col: 0, start: p.start + (p.appt.rank!.position - 1) / 100 }))
    expect(neighbour(items, pile[0].appt.id, 'ArrowDown')).toBe(pile[1].appt.id)
  })
})

describe('the Requests view', () => {
  async function open() {
    const view = renderApp(`/o/${O}/appointments`, { consoleClient: createDemoConsoleClient({ latency: 0, persist: false }) })
    await signIn(view.user, 'owner@example.com')
    await view.user.click(await screen.findByRole('button', { name: 'Requests to review' }, { timeout: 4000 }))
    return view
  }

  it('shows the ranked requests, and confirming one settles the others', async () => {
    const { user } = await open()
    const groups = await screen.findByRole('list', { name: /requests by time/i })
    const first = within(groups).getAllByRole('listitem')[0]
    expect(within(first).getByText(/^\d+ requests for this time$/)).toBeInTheDocument()
    expect(within(first).getByText('Recommended')).toBeInTheDocument()
    expect(within(first).getByText('Urgent')).toBeInTheDocument()
    await user.click(within(first).getAllByRole('button', { name: /^confirm /i })[0])
    const dialog = within(await screen.findByRole('dialog', { name: /^confirm /i }))
    expect(dialog.getAllByRole('button', { name: 'Offer another time' }).length).toBeGreaterThan(0)
    await user.click(dialog.getAllByRole('button', { name: 'Decline' })[0])
    await user.click(dialog.getByRole('button', { name: /confirm and settle the others/i }))
    expect(await screen.findByText(/request is confirmed; .*(offered another time|declined).* the patients are being told/i)).toBeInTheDocument()
  })

  it('turns on the automatic confirmation in Booking settings, and says what it will do', async () => {
    const { user } = await open()
    expect(await screen.findByText(/requests wait for staff to confirm them/i)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Booking settings' })[0])
    const dialog = within(await screen.findByRole('dialog', { name: 'Booking settings' }))
    await user.click(dialog.getByRole('radio', { name: /automatically, at the end of the day/i }))
    await user.click(dialog.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(screen.getByText(/automatic confirmation at 7:00 pm:/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument()
  })
})
