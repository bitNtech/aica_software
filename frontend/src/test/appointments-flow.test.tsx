import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fromRecord, toApiPatch } from '../console/appointmentRecords'
import { createDemoConsoleClient } from '../console/demoClient'
import type { Appointment } from '../console/types'
import { localDay } from '../lib/time'
import { addMonths, monthGrid } from '../pages/console/operate/appointments/model'
import { renderApp, signIn } from './renderApp'

const O = 'arogya-demo'
const client = (role: 'owner' | 'front_desk' | 'viewer' = 'front_desk') => {
  const c = createDemoConsoleClient({ latency: 0, persist: false })
  c.setViewer?.({ id: 'u_x', name: 'Meena S', roles: { [O]: role } })
  return c
}
const all = (c: ReturnType<typeof client>) => c.listAppointments(O, localDay(-14), localDay(13))

describe('appointment records', () => {
  it('reads the API’s older statuses as the page’s', () => {
    const base = { id: 'a', patientName: 'P', phone: '', department: 'D', doctor: 'Dr', date: '2026-11-01', time: '10:00', agentName: null, callId: null, createdAt: '' }
    expect(fromRecord({ ...base, status: 'booked' as Appointment['status'], bookedBy: 'agent' })).toMatchObject({ status: 'pending', source: 'ai_call' })
    expect(fromRecord({ ...base, status: 'needs_check' as Appointment['status'], checkReason: 'Unsure.', bookedBy: 'staff' })).toMatchObject({ status: 'pending', checkReason: 'Unsure.', source: 'front_desk' })
  })
  it('writes only what the current API knows', () => {
    expect(toApiPatch({ status: 'rescheduled', time: '11:00', changeReason: 'x', undo: true })).toEqual({ status: 'booked', time: '11:00' })
    expect(() => toApiPatch({ status: 'completed' })).toThrow(/server to be updated/i)
  })
  it('lays a month out as whole weeks, and steps months safely', () => {
    const g = monthGrid('2026-02-14')
    expect(g[0]).toBe('2026-01-26')
    expect(g.length % 7).toBe(0)
    expect(g.at(-1)).toBe('2026-03-01')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
  })
})

describe('the demo appointments', () => {
  it('has every status, a source and a history', async () => {
    const rows = await all(client())
    for (const s of ['pending', 'confirmed', 'rescheduled', 'completed', 'no_show', 'cancelled']) expect(rows.some((a) => a.status === s), s).toBe(true)
    expect(new Set(rows.map((a) => a.source))).toEqual(new Set(['ai_call', 'front_desk', 'manual']))
    expect(rows.every((a) => (a.history ?? []).at(-1)?.kind === 'created')).toBe(true)
    expect(rows.filter((a) => a.status === 'cancelled').every((a) => !!a.cancelReason)).toBe(true)
  })

  it('confirms, reschedules with a reason, cancels with a reason, and keeps each in the history', async () => {
    const c = client()
    const a = (await all(c)).find((x) => x.status === 'pending' && x.date > localDay(0))!
    const confirmed = await c.updateAppointment(O, a.id, { status: 'confirmed' })
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.checkReason).toBeUndefined()
    await expect(c.updateAppointment(O, a.id, { time: '18:00' })).rejects.toThrow(/say why/i)
    const moved = await c.updateAppointment(O, a.id, { time: '18:00', changeReason: 'Evening suits them.' })
    expect(moved.status).toBe('rescheduled')
    expect(moved.history![0]).toMatchObject({ kind: 'rescheduled', reason: 'Evening suits them.', by: 'Meena S' })
    expect(moved.history![0].text).toMatch(/^Moved from .* to .*18:00/)
    await expect(c.updateAppointment(O, a.id, { status: 'completed' })).rejects.toThrow(/once the appointment time has come/i)
    await expect(c.updateAppointment(O, a.id, { status: 'cancelled' })).rejects.toThrow(/say why/i)
    const cancelled = await c.updateAppointment(O, a.id, { status: 'cancelled', changeReason: 'Travelling.' })
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Travelling.', updatedBy: 'Meena S' })
    await expect(c.updateAppointment(O, a.id, { status: 'confirmed' })).rejects.toThrow(/book it again first/i)
    const back = await c.updateAppointment(O, a.id, { status: 'pending' })
    expect(back.cancelReason).toBeUndefined()
    expect(back.history!.map((h) => h.kind).slice(0, 4)).toEqual(['restored', 'cancelled', 'rescheduled', 'confirmed'])
  })

  it('marks a past booking completed or a no-show, and Undo puts it back', async () => {
    const c = client()
    // A walk-in entered for just after midnight today: its time has passed.
    const target = await c.createAppointment(O, { patientName: 'Walk In', phone: '9840011111', doctor: 'Dr. R. Ramachandran', department: 'Cardiology', date: localDay(0), time: '00:01', type: 'new_visit', visitReason: '', source: 'manual', confirmed: true })
    const done = await c.updateAppointment(O, target.id, { status: 'completed' })
    expect(done.status).toBe('completed')
    await expect(c.updateAppointment(O, target.id, { status: 'no_show' })).rejects.toThrow(/only an appointment that was booked/i)
    const undone = await c.updateAppointment(O, target.id, { undo: true, status: 'confirmed' })
    expect(undone.status).toBe('confirmed')
    expect(undone.history![0].kind).toBe('undone')
    expect((await c.updateAppointment(O, target.id, { status: 'no_show' })).status).toBe('no_show')
  })

  it('adds a booking by hand, pending or confirmed, and checks what it’s given', async () => {
    const c = client()
    const input = { patientName: 'Kavitha R', phone: '98400 55555', doctor: 'Dr. R. Ramachandran', department: 'Cardiology', date: localDay(2), time: '10:00', type: 'follow_up' as const, visitReason: 'BP review', source: 'manual' as const, confirmed: false }
    await expect(c.createAppointment(O, { ...input, phone: '123' })).rejects.toThrow(/10-digit/i)
    await expect(c.createAppointment(O, { ...input, date: localDay(-1) })).rejects.toThrow(/today or a later day/i)
    const made = await c.createAppointment(O, input)
    expect(made).toMatchObject({ status: 'pending', source: 'manual', bookedBy: 'staff', type: 'follow_up', visitReason: 'BP review', phone: '+91 98400 55555' })
    expect(made.history![0]).toMatchObject({ kind: 'created', text: 'Entered by hand', by: 'Meena S' })
    expect((await c.createAppointment(O, { ...input, time: '11:00', confirmed: true, source: 'front_desk' })).status).toBe('confirmed')
    expect((await all(c)).some((a) => a.id === made.id)).toBe(true)
  })

  it('lets only people who manage appointments change them', async () => {
    const c = client('viewer')
    const a = (await all(c))[0]
    await expect(c.updateAppointment(O, a.id, { status: 'confirmed' })).rejects.toThrow(/permission/i)
    await expect(
      c.createAppointment(O, { patientName: 'X Y', phone: '9840055555', doctor: 'Dr', department: 'D', date: localDay(1), time: '10:00', type: 'new_visit', visitReason: '', source: 'manual', confirmed: false }),
    ).rejects.toThrow(/permission/i)
  })
})

describe('the Appointments page with the demo data', () => {
  async function open(email = 'frontdesk@example.com') {
    const view = renderApp(`/o/${O}/appointments`, { consoleClient: createDemoConsoleClient({ latency: 0, persist: false }) })
    await signIn(view.user, email)
    await screen.findByRole('button', { name: 'Month' }, { timeout: 4000 })
    return view
  }

  it('shows the month, and opens a day from it', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'Month' }))
    const month = await screen.findByRole('table', { name: /^appointments in /i })
    await user.click(within(month).getByRole('button', { name: /\(today\).*open the day/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Day by doctor' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('shows today in three columns, and the changes with their reasons', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'Today’s appointments' }))
    for (const g of [/still to come today/i, /seen today/i, /missed today/i]) expect(await screen.findByRole('group', { name: g })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelled and rescheduled' }))
    const table = await screen.findByRole('table', { name: /cancelled and rescheduled/i })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Appointment', 'Patient', 'Doctor', 'Status', 'What changed', 'Why', 'By'])
  })

  it('opens a booking with its ID, type, reason, source, times and history', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'All' }))
    const table = await screen.findByRole('table', { name: /^appointments$/i })
    await user.click(within(table).getAllByRole('row')[1])
    const article = await screen.findByRole('article')
    const d = within(article)
    expect(d.getByText(/^appointment$/i, { exact: false })).toBeInTheDocument()
    for (const t of ['Type', 'Reason for visit', 'Booked through', 'Created', 'Last updated']) expect(d.getByText(t)).toBeInTheDocument()
    expect(d.getByRole('heading', { name: /what happened/i })).toBeInTheDocument()
  })

  it('adds an appointment by hand', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: /add appointment/i }))
    const dialog = within(await screen.findByRole('dialog', { name: /add an appointment/i }))
    await user.type(dialog.getByLabelText(/patient’s name/i), 'Kavitha Raman')
    await user.type(dialog.getByLabelText(/phone number/i), '9840055555')
    await user.click(dialog.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))[0])
    await user.type(dialog.getByLabelText(/reason for the visit/i), 'Knee pain')
    await user.click(dialog.getByRole('button', { name: /^add appointment$/i }))
    expect(await screen.findByText(/kavitha raman.s appointment is added/i)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: 'Kavitha Raman' })).toBeInTheDocument()
  })
})
