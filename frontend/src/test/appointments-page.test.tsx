import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import type { Appointment, CallRecord, ConsoleClient, DoctorChange, OrgSettings } from '../console/types'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'
// Monday 26 October 2026, 10:40, the hospital's local time. Only the clock is faked: timers and promises run for real.
const TODAY = '2026-10-26'
const TOMORROW = '2026-10-27'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 26, 10, 40))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const row = (o: Partial<Appointment> & Pick<Appointment, 'id' | 'patientName' | 'phone' | 'doctor' | 'department' | 'date' | 'time'>): Appointment => ({
  status: 'booked',
  bookedBy: 'agent',
  agentName: 'OPD appointments',
  callId: null,
  createdAt: '2026-10-25T09:00:00.000Z',
  ...o,
})
const RAMA = { doctor: 'Dr. R. Ramachandran', department: 'Cardiology' }
const MEENA = { doctor: 'Dr. S. Meenakshi', department: 'General medicine' }
const ARVIND = { doctor: 'Dr. K. Arvind', department: 'Orthopaedics' }

const ROWS: Appointment[] = [
  row({ id: 'r1', patientName: 'Lakshmi Narayanan', phone: '+91 98400 12345', ...RAMA, date: TODAY, time: '11:00', status: 'needs_check', checkReason: 'The caller wasn’t sure of the date.', callId: 'call_1', note: 'Wants a morning slot.' }),
  row({ id: 'r2', patientName: 'Divya Prakash', phone: '+91 98400 22222', ...RAMA, date: TODAY, time: '11:00', bookedBy: 'staff', agentName: null }),
  row({ id: 'r3', patientName: 'Mohammed Irfan', phone: '+91 98400 33333', ...RAMA, date: TODAY, time: '09:30', status: 'cancelled' }),
  row({ id: 'm1', patientName: 'Selvi Murugan', phone: '+91 98400 44444', ...MEENA, date: TODAY, time: '14:00', status: 'confirmed' }),
  row({ id: 'm2', patientName: 'Selvi Murugan', phone: '+91 98400 44444', ...MEENA, date: TODAY, time: '14:30' }),
  row({ id: 'm3', patientName: 'Selvi Murugan', phone: '+91 98400 44444', ...MEENA, date: TOMORROW, time: '10:00', status: 'confirmed' }),
  row({ id: 'a1', patientName: 'Anand Kumar', phone: '+91 98400 55555', ...ARVIND, date: TODAY, time: '12:00' }),
  row({ id: 'w1', patientName: 'Gopal Krishnan', phone: '+91 98400 66666', ...ARVIND, date: '2026-10-28', time: '10:00' }),
]

const day = (open = true, from = '09:00', to = '17:00') => ({ open, from, to })
const SETTINGS: OrgSettings = {
  name: 'Arogya Demo Hospital',
  city: 'Coimbatore',
  languages: ['english'],
  hours: [day(), day(), day(), day(), day(), day(true, '09:00', '13:00'), day(false)],
  closed: [{ date: '2026-10-29', label: 'Pongal holiday' }],
  updatedAt: '2026-10-01T00:00:00.000Z',
  updatedBy: 'Lakshmi K',
}
const AWAY: DoctorChange = { id: 'c1', doctor: 'Dr. K. Arvind', department: 'Orthopaedics', date: TODAY, kind: 'away', detail: 'On leave today.', createdBy: 'Meena S', createdAt: '2026-10-25T09:00:00.000Z' }

interface Fixture {
  client: ConsoleClient
  store: Appointment[]
  update: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}
function makeClient(over: Partial<ConsoleClient> = {}, rows: Appointment[] = ROWS): Fixture {
  const demo = createDemoConsoleClient({ latency: 0, persist: false })
  const store = rows.map((a) => ({ ...a }))
  const list = vi.fn(async (_o: string, from: string, to: string) => store.filter((a) => a.date >= from && a.date <= to).map((a) => ({ ...a })))
  const update = vi.fn(async (_o: string, id: string, patch: Partial<Appointment>) => {
    const a = store.find((x) => x.id === id)!
    Object.assign(a, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
    if (a.note === '') delete a.note
    if (patch.status && patch.status !== 'needs_check') delete a.checkReason
    return { ...a }
  })
  const client: ConsoleClient = {
    ...demo,
    listAppointments: list as unknown as ConsoleClient['listAppointments'],
    updateAppointment: update as unknown as ConsoleClient['updateAppointment'],
    getOrgSettings: async () => SETTINGS,
    getDesk: async (o) => ({ ...(await demo.getDesk(o)), doctorChanges: [AWAY], doctors: [RAMA, MEENA, ARVIND, { doctor: 'Dr. P. Lakshmi', department: 'Paediatrics' }] }),
    getCallRecord: async (_o, id) =>
      ({ id, summary: 'Booked a cardiology visit; the caller was unsure of the date.', agentName: 'OPD appointments', startedAt: '2026-10-25T09:00:00.000Z', durationSec: 95, outcome: 'booked' }) as unknown as CallRecord,
    ...over,
  }
  return { client, store, update, list }
}

async function open(email = 'admin@example.com', fx: Fixture = makeClient(), path = `${O}/appointments`) {
  const view = renderApp(path, { consoleClient: fx.client })
  await signIn(view.user, email)
  await screen.findByRole('heading', { level: 1, name: /^appointments$/i })
  return { ...view, fx }
}
/** The day by doctor, once the bookings have loaded. */
const dayGrid = () => screen.findByRole('region', { name: /appointments by doctor/i })
/** The scrolling timetable or week, so the side panel's own buttons don't count as blocks. */
const view = () => screen.getByRole('region', { name: /(by doctor|week of).*scrollable/i })
const column = (name: RegExp) => screen.getByRole('list', { name })
const block = (name: RegExp) => within(view()).getByRole('button', { name })
const drawer = () => screen.getByRole('dialog', { name: /appointment/i, hidden: false })

describe('Appointments: day by doctor', () => {
  it('has a column for each doctor, the desk’s list as well as the bookings’, with a line for now on today', async () => {
    await open()
    await dayGrid()
    for (const d of [/Dr\. R\. Ramachandran/, /Dr\. S\. Meenakshi/, /Dr\. K\. Arvind/, /Dr\. P\. Lakshmi/]) expect(column(d)).toBeInTheDocument()
    // Dr. Lakshmi has no bookings, and still has a column to say so.
    expect(within(column(/Dr\. P\. Lakshmi/)).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('separator', { name: /^now, 10:40 am$/i })).toBeInTheDocument()
    // The title says the day, and Day by doctor is the view pressed.
    expect(screen.getByRole('heading', { name: /monday 26 october \(today\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Day by doctor' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows no line for now on another day', async () => {
    const { user } = await open()
    await dayGrid()
    await user.click(screen.getByRole('button', { name: /^tomorrow$/i }))
    await screen.findByRole('heading', { level: 2, name: /^tuesday 27 october$/i })
    expect(screen.queryByRole('separator', { name: /^now/i })).not.toBeInTheDocument()
    expect(within(column(/Dr\. S\. Meenakshi/)).getAllByRole('button')).toHaveLength(1)
  })

  it('puts a double booking side by side and flags it on both', async () => {
    await open()
    await dayGrid()
    const a = block(/Lakshmi Narayanan.*Double booked/i)
    const b = block(/Divya Prakash.*Double booked/i)
    expect(a.closest('li')).toHaveStyle({ width: '50%' })
    expect(b.closest('li')).toHaveStyle({ width: '50%' })
    expect(a.closest('li')!.style.left).not.toBe(b.closest('li')!.style.left)
    // A booking on its own is full width.
    expect(block(/Selvi Murugan, Dr\. S\. Meenakshi.*2:00 pm|2:00 pm.*Selvi Murugan/i).closest('li')).toHaveStyle({ width: '100%' })
  })

  it('shades a doctor who is away and says so in the header, and shows a booking made on their away day as a problem', async () => {
    await open()
    await dayGrid()
    const col = column(/Dr\. K\. Arvind/)
    expect(col.querySelector('.ap-shade--away')).not.toBeNull()
    // The note is in the column's name's neighbour, the header, in words.
    expect(within(view()).getByText(/away: on leave today/i)).toBeInTheDocument()
    expect(within(col).getByRole('button', { name: /Anand Kumar.*Doctor away/i })).toBeInTheDocument()
  })

  it('says each block’s time, patient, status and who booked it', async () => {
    await open()
    await dayGrid()
    const b = block(/Lakshmi Narayanan/)
    expect(b).toHaveAccessibleName(/11:00 am, Lakshmi Narayanan, Dr\. R\. Ramachandran, Cardiology, Needs a check, booked by an agent/i)
    expect(within(b).getByText('Needs a check')).toBeInTheDocument()
    expect(block(/Divya Prakash/)).not.toHaveAccessibleName(/booked by an agent/i)
    // A cancelled booking is still shown, and said to be cancelled.
    expect(block(/Mohammed Irfan/)).toHaveAccessibleName(/cancelled/i)
  })

  it('moves between blocks with the arrow keys, one Tab stop for all of them', async () => {
    const { user } = await open()
    await dayGrid()
    const stops = () => within(view()).getAllByRole('button').filter((b) => b.hasAttribute('data-appt') && b.tabIndex === 0)
    expect(stops()).toHaveLength(1)
    const first = stops()[0]
    // The first column with a booking is Dr. Arvind's; across to the next that has any (Dr. Ramachandran's).
    first.focus()
    await user.keyboard('{ArrowRight}')
    expect((document.activeElement as HTMLElement).dataset.col).toBe('2')
    const there = document.activeElement
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).not.toBe(there)
    expect((document.activeElement as HTMLElement).dataset.col).toBe('2')
    await user.keyboard('{ArrowLeft}')
    expect((document.activeElement as HTMLElement).dataset.col).toBe('0')
    // Only the focused one is now the tab stop.
    expect(stops()).toHaveLength(1)
    expect(stops()[0]).toBe(document.activeElement)
  })

  it('says so when the day is empty', async () => {
    await open('admin@example.com', makeClient({}, []))
    expect(await screen.findByText('No appointments on Monday.')).toBeInTheDocument()
  })

  it('says so when the filters match nothing, and clears them', async () => {
    const { user } = await open()
    await dayGrid()
    await user.type(screen.getByRole('searchbox', { name: /search appointments/i }), 'zzz')
    expect(await screen.findByText(/no appointments on monday match these filters/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear the filters/i }))
    await dayGrid()
    expect(screen.queryByText(/match these filters/i)).not.toBeInTheDocument()
  })

  it('shades a closed day with the reason, and widens the timetable for a booking outside opening hours', async () => {
    const rows = [row({ id: 'h1', patientName: 'Revathi M', phone: '+91 98400 77777', ...RAMA, date: '2026-10-29', time: '10:00' }), row({ id: 'e1', patientName: 'Joseph Antony', phone: '+91 98400 88888', ...RAMA, date: '2026-10-29', time: '18:15' })]
    await open('admin@example.com', makeClient({}, rows))
    await screen.findByText('No appointments on Monday.')
    fireEvent.change(screen.getByLabelText(/jump to a date/i), { target: { value: '2026-10-29' } })
    expect(await screen.findByText(/closed on thursday 29 october:/i)).toBeInTheDocument()
    expect(screen.getAllByText(/pongal holiday/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/the timetable is wider than opening hours/i)).toBeInTheDocument()
    expect(within(column(/Dr\. R\. Ramachandran/)).getByRole('button', { name: /Joseph Antony.*Closed day/i })).toBeInTheDocument()
  })

  it('on a phone becomes a list for each doctor, with no timetable to scroll', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 719px'), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }))
    await open()
    const group = await screen.findByRole('group', { name: /appointments by doctor, monday 26 october/i })
    expect(within(group).getByRole('heading', { name: /Dr\. R\. Ramachandran/ })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: /Lakshmi Narayanan/ })).toBeInTheDocument()
    expect(within(group).getByText(/away: on leave today/i)).toBeInTheDocument()
    expect(document.querySelector('.ap-day')).toBeNull()
  })
})

describe('Appointments: the booking in the drawer', () => {
  it('shows who, when, the booking call, and the patient’s other appointments', async () => {
    const { user } = await open()
    await dayGrid()
    await user.click(block(/Selvi Murugan.*2:00 pm|2:00 pm.*Selvi Murugan/i))
    const d = within(drawer())
    expect(d.getByRole('heading', { level: 2, name: 'Selvi Murugan' })).toBeInTheDocument()
    expect(d.getByText(/monday 26 october, 2:00 pm/i)).toBeInTheDocument()
    expect(d.getByRole('link', { name: '+91 98400 44444' })).toHaveAttribute('href', 'tel:+919840044444')
    // No linked call: it says how it was booked instead of inventing one.
    expect(d.getByText(/no call is linked to this booking/i)).toBeInTheDocument()
    // The other two, today at 2:30 pm and tomorrow (found by the wider lookup too).
    expect(await d.findByRole('button', { name: /today, 2:30 pm/i })).toBeInTheDocument()
    expect(d.getByRole('button', { name: /tue 27 oct, 10:00 am/i })).toBeInTheDocument()
    // Opening another replaces the detail.
    await user.click(d.getByRole('button', { name: /tue 27 oct, 10:00 am/i }))
    expect(await within(drawer()).findByText(/tuesday 27 october, 10:00 am/i)).toBeInTheDocument()
  })

  it('shows the booking call’s summary and a link to it', async () => {
    const { user } = await open()
    await dayGrid()
    await user.click(block(/Lakshmi Narayanan/))
    const d = within(drawer())
    expect(await d.findByText(/booked a cardiology visit/i)).toBeInTheDocument()
    expect(d.getByRole('link', { name: /open the call in call history/i })).toHaveAttribute('href', `${O}/calls/call_1`)
    expect(d.getByText(/the caller wasn’t sure of the date/i)).toBeInTheDocument()
    expect(d.getByText('Wants a morning slot.')).toBeInTheDocument()
    // Its problems, in words.
    expect(d.getByText(/overlaps divya prakash at 11:00 am/i)).toBeInTheDocument()
  })

  it('says when the call can’t be opened, quietly', async () => {
    const fx = makeClient({ getCallRecord: async () => Promise.reject(new AuthError('forbidden', 'You can open the calls you handled.')) })
    const { user } = await open('admin@example.com', fx)
    await dayGrid()
    await user.click(block(/Lakshmi Narayanan/))
    expect(await within(drawer()).findByText(/couldn.t open the call/i)).toBeInTheDocument()
  })

  it('confirms with one button, and offers Undo', async () => {
    const fx = makeClient()
    const { user } = await open('admin@example.com', fx)
    await dayGrid()
    await user.click(block(/Divya Prakash/))
    await user.click(within(drawer()).getByRole('button', { name: /^confirm$/i }))
    await waitFor(() => expect(fx.update).toHaveBeenCalledWith('arogya-demo', 'r2', { status: 'confirmed' }))
    expect(await screen.findByText(/divya prakash.s appointment is confirmed/i)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /^undo$/i }))
    await waitFor(() => expect(fx.update).toHaveBeenLastCalledWith('arogya-demo', 'r2', { status: 'booked' }))
    expect(await screen.findByText(/^undone\.$/i)).toBeInTheDocument()
  })

  it('asks before cancelling, reminds the person to tell the patient, and offers Undo', async () => {
    const fx = makeClient()
    const { user } = await open('admin@example.com', fx)
    await dayGrid()
    await user.click(block(/Selvi Murugan.*2:00 pm|2:00 pm.*Selvi Murugan/i))
    await user.click(within(drawer()).getByRole('button', { name: /^cancel$/i }))
    const dialog = await screen.findByRole('dialog', { name: /cancel selvi murugan.s appointment\?/i })
    expect(within(dialog).getByText(/let the patient know: aica doesn.t call them/i)).toBeInTheDocument()
    expect(fx.update).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: /^keep it$/i }))
    expect(fx.update).not.toHaveBeenCalled()
    await user.click(within(drawer()).getByRole('button', { name: /^cancel$/i }))
    await user.click(within(await screen.findByRole('dialog', { name: /cancel selvi/i })).getByRole('button', { name: /^cancel appointment$/i }))
    await waitFor(() => expect(fx.update).toHaveBeenCalledWith('arogya-demo', 'm1', { status: 'cancelled' }))
    expect(await screen.findByText(/selvi murugan.s appointment is cancelled/i)).toBeInTheDocument()
    // It was confirmed, so Undo books it again and confirms it.
    await user.click(await screen.findByRole('button', { name: /^undo$/i }))
    await waitFor(() => expect(fx.update).toHaveBeenCalledWith('arogya-demo', 'm1', { status: 'confirmed' }))
    expect(fx.update.mock.calls.filter((c) => c[1] === 'm1').map((c) => c[2])).toEqual([{ status: 'cancelled' }, { status: 'booked' }, { status: 'confirmed' }])
  })

  it('shows a cancelled booking without Confirm, Change or Cancel, but with a way to book it again', async () => {
    const { user } = await open()
    await dayGrid()
    await user.click(block(/Mohammed Irfan/))
    const d = within(drawer())
    expect(d.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument()
    expect(d.queryByRole('button', { name: /^change$/i })).not.toBeInTheDocument()
    expect(d.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument()
    expect(d.getByRole('button', { name: /book it again/i })).toBeInTheDocument()
  })

  it('refuses nothing the API doesn’t: an error is said in the dialog and the booking is left alone', async () => {
    const fx = makeClient()
    fx.client.updateAppointment = vi.fn(async () => Promise.reject(new AuthError('invalid_input', 'That appointment doesn’t exist any more.')))
    const { user } = await open('admin@example.com', fx)
    await dayGrid()
    await user.click(block(/Divya Prakash/))
    await user.click(within(drawer()).getByRole('button', { name: /^cancel$/i }))
    await user.click(within(await screen.findByRole('dialog', { name: /cancel divya/i })).getByRole('button', { name: /^cancel appointment$/i }))
    expect(await screen.findByText(/doesn.t exist any more/i)).toBeInTheDocument()
  })
})

describe('Appointments: change', () => {
  async function openChange(patient: RegExp, fx = makeClient()) {
    const view = await open('admin@example.com', fx)
    await dayGrid()
    await view.user.click(block(patient))
    await view.user.click(within(drawer()).getByRole('button', { name: /^change$/i }))
    const dialog = await screen.findByRole('dialog', { name: /change lakshmi narayanan.s appointment/i })
    return { ...view, dialog: within(dialog), fx }
  }

  it('suggests free times for the doctor and warns about a clash, without blocking', async () => {
    const { dialog, user, fx } = await openChange(/Lakshmi Narayanan/)
    // 11:00 with Dr. Ramachandran is shared with Divya Prakash.
    expect(dialog.getByRole('status', { name: /things to check/i })).toHaveTextContent(/overlaps divya prakash at 11:00 am/i)
    expect(dialog.getByText(/free times with dr\. r\. ramachandran, next 7 days/i)).toBeInTheDocument()
    const slots = dialog.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
    // First six: it is 10:40, 11:00 is taken, so 11:30 is first. Never a time that has passed or is booked.
    expect(slots).toHaveLength(6)
    expect(slots[0]).toHaveTextContent('Today, 11:30 am')
    expect(slots.some((s) => /today, 11:00 am/i.test(s.textContent ?? ''))).toBe(false)
    // Tomorrow is fine; the holiday isn't offered.
    await user.click(slots[0])
    expect(slots[0]).toHaveAttribute('aria-pressed', 'true')
    expect(dialog.queryByRole('status', { name: /things to check/i })).not.toBeInTheDocument()
    // The clash is back if the time is put back: a warning, and it still saves.
    fireEvent.change(dialog.getByLabelText('Time'), { target: { value: '11:00' } })
    expect(dialog.getByRole('status', { name: /things to check/i })).toBeInTheDocument()
    expect(dialog.getByText(/you can still save/i)).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: /save and confirm/i }))
    await waitFor(() => expect(fx.update).toHaveBeenCalledWith('arogya-demo', 'r1', expect.objectContaining({ date: TODAY, time: '11:00', doctor: 'Dr. R. Ramachandran', department: 'Cardiology', status: 'confirmed' })))
    expect(await screen.findByText(/lakshmi narayanan.s appointment is now today at 11:00 am/i)).toBeInTheDocument()
  })

  it('warns about a time that has passed, a closed day and a doctor who is away', async () => {
    const { dialog } = await openChange(/Lakshmi Narayanan/)
    fireEvent.change(dialog.getByLabelText('Time'), { target: { value: '09:15' } })
    expect(dialog.getByRole('status', { name: /things to check/i })).toHaveTextContent(/already passed/i)
    fireEvent.change(dialog.getByLabelText('Date'), { target: { value: '2026-10-29' } })
    expect(await dialog.findByText(/closed that day: pongal holiday/i)).toBeInTheDocument()
    fireEvent.change(dialog.getByLabelText('Date'), { target: { value: TODAY } })
    fireEvent.change(dialog.getByLabelText('Time'), { target: { value: '13:00' } })
    fireEvent.change(dialog.getByLabelText('Doctor'), { target: { value: 'Dr. K. Arvind' } })
    expect(await dialog.findByText(/dr\. k\. arvind is away that day/i)).toBeInTheDocument()
    // Free times follow the doctor chosen: none today, he is away.
    expect(dialog.getByText(/free times with dr\. k\. arvind/i)).toBeInTheDocument()
    expect(dialog.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed') && /^today/i.test(b.textContent ?? ''))).toHaveLength(0)
  })

  it('says the API’s own refusal and stays open', async () => {
    const fx = makeClient()
    fx.client.updateAppointment = vi.fn(async () => Promise.reject(new AuthError('invalid_input', 'Choose a real date.')))
    const { dialog, user } = await openChange(/Lakshmi Narayanan/, fx)
    await user.click(dialog.getByRole('button', { name: /save and confirm/i }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Choose a real date.')
  })
})

describe('Appointments: week and list', () => {
  it('shows the week with counts for each day, today marked, closed days shaded with their reason, and doctor initials on each chip', async () => {
    const { user } = await open()
    await dayGrid()
    await user.click(screen.getByRole('button', { name: 'Week' }))
    const table = await screen.findByRole('table', { name: /appointments by day and hour/i })
    const t = within(table)
    const today = t.getByRole('columnheader', { name: /today/i })
    expect(today).toHaveAttribute('aria-current', 'date')
    // Seven days, Monday to Sunday.
    expect(t.getAllByRole('columnheader').filter((h) => !h.classList.contains('ap-week__corner'))).toHaveLength(7)
    expect(t.getByRole('columnheader', { name: /thu.*closed: pongal holiday/i })).toBeInTheDocument()
    expect(t.getByRole('columnheader', { name: /sun.*closed on sundays/i })).toBeInTheDocument()
    // Today: six bookings, one of them cancelled, and one needing a check.
    expect(today).toHaveTextContent(/5\s*booked/)
    expect(today).toHaveTextContent(/1\s*need a check/)
    const chip = t.getByRole('button', { name: /Lakshmi Narayanan/ })
    expect(within(chip).getByText('RR')).toBeInTheDocument()
    await user.click(chip)
    expect(within(drawer()).getByRole('heading', { level: 2, name: 'Lakshmi Narayanan' })).toBeInTheDocument()
  })

  it('moves a week at a time, and jumps to a date', async () => {
    const { user } = await open()
    await dayGrid()
    await user.click(screen.getByRole('button', { name: 'Week' }))
    await screen.findByRole('table', { name: /appointments by day and hour/i })
    await user.click(screen.getByRole('button', { name: /next week/i }))
    expect(await screen.findByRole('heading', { name: /2 nov to 8 nov/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /previous week/i }))
    expect(await screen.findByRole('heading', { name: /26 oct to 1 nov/i })).toBeInTheDocument()
  })

  it('lists the bookings in a table you can sort, with the phone for managers, and opens one from its row', async () => {
    const { user } = await open()
    await dayGrid()
    await user.click(screen.getByRole('button', { name: 'List' }))
    const table = await screen.findByRole('table', { name: /^appointments$/i })
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim())
    expect(headers).toEqual(['Date', 'Time', 'Patient', 'Phone', 'Doctor', 'Department', 'Status', 'Booked by', 'Problems', 'Note'])
    const names = () => within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent)
    // Date then time by default: today 09:30 first.
    expect(names()[0]).toBe('Mohammed Irfan')
    await user.click(within(table).getByRole('button', { name: 'Patient' }))
    expect(within(table).getByRole('columnheader', { name: /patient/i })).toHaveAttribute('aria-sort', 'ascending')
    expect(names()[0]).toBe('Anand Kumar')
    await user.click(within(table).getByRole('button', { name: 'Patient' }))
    expect(within(table).getByRole('columnheader', { name: /patient/i })).toHaveAttribute('aria-sort', 'descending')
    expect(names()[0]).toBe('Selvi Murugan')
    // A row opens on Enter.
    const r = within(table).getAllByRole('row')[1]
    r.focus()
    await user.keyboard('{Enter}')
    expect(within(drawer()).getByRole('article')).toBeInTheDocument()
  })

  it('remembers the view for the person', async () => {
    const { user } = await open()
    await dayGrid()
    await user.click(screen.getByRole('button', { name: 'List' }))
    await screen.findByRole('table', { name: /^appointments$/i })
    expect(Object.entries(localStorage).filter(([k]) => k.startsWith('aica.appointments.view.')).map(([, v]) => v)).toEqual(['list'])
    cleanup()
    // The same person in the same browser: still signed in, and back on the list.
    renderApp(`${O}/appointments`, { consoleClient: makeClient().client })
    expect(await screen.findByRole('table', { name: /^appointments$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Appointments: needs a check, summary and filters', () => {
  it('lists what needs a check in a panel, in every view, each opening its detail', async () => {
    const { user } = await open()
    await dayGrid()
    const panel = screen.getByRole('complementary', { name: /needs a check/i })
    const p = within(panel)
    // The agent’s flag, a double booking (both of them), the same patient twice, a doctor away.
    expect(p.getByText(/the caller wasn.t sure of the date/i)).toBeInTheDocument()
    expect(p.getByRole('button', { name: /11:00 am\s*divya prakash/i })).toHaveTextContent(/double booked/i)
    expect(p.getByRole('button', { name: /anand kumar/i })).toHaveTextContent(/doctor away/i)
    expect(p.getAllByRole('button', { name: /selvi murugan/i }).length).toBeGreaterThanOrEqual(2)
    expect(p.queryByRole('button', { name: /mohammed irfan/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Week' }))
    await screen.findByRole('table', { name: /appointments by day and hour/i })
    expect(screen.getByRole('complementary', { name: /needs a check/i })).toBeInTheDocument()
    await user.click(within(screen.getByRole('complementary', { name: /needs a check/i })).getByRole('button', { name: /11:00 am\s*lakshmi narayanan/i }))
    expect(within(drawer()).getByRole('heading', { level: 2, name: 'Lakshmi Narayanan' })).toBeInTheDocument()
  })

  it('says nothing needs a check when nothing does', async () => {
    const rows = [row({ id: 'ok1', patientName: 'Fathima B', phone: '+91 98400 99999', ...MEENA, date: TOMORROW, time: '10:00', status: 'confirmed' })]
    await open('admin@example.com', makeClient({}, rows))
    await screen.findByText('No appointments on Monday.')
    expect(within(screen.getByRole('complementary', { name: /needs a check/i })).getByText('Nothing needs a check.')).toBeInTheDocument()
  })

  it('shows, for each doctor, booked against capacity, and the counts', async () => {
    await open()
    await dayGrid()
    const s = within(screen.getByRole('region', { name: /how full today is/i }))
    // Capacity: 9 to 5 over 30 minutes is 16; Dr. Arvind is away, so 0.
    // Dr. Ramachandran has two live bookings (the third is cancelled) and so has Dr. Meenakshi.
    expect(s.getAllByText('2 of 16')).toHaveLength(2)
    expect(s.getByText('1 of 0')).toBeInTheDocument()
    expect(s.getByText('0 of 16')).toBeInTheDocument()
    expect(s.getByText(/away: on leave today/i)).toBeInTheDocument()
    const counts = s.getByText(/booked by the agents/i).closest('p')!
    expect(counts).toHaveTextContent(/1\s*need a check/i)
    expect(counts).toHaveTextContent(/1\s*confirmed/i)
    expect(counts).toHaveTextContent(/5\s*booked by the agents/i)
    expect(counts).toHaveTextContent(/1\s*cancelled/i)
  })

  it('filters by doctor, status, who booked and problems, with a chip for each', async () => {
    const { user } = await open()
    await dayGrid()
    await user.selectOptions(screen.getByLabelText('Doctor'), 'Dr. S. Meenakshi')
    expect(screen.queryByRole('list', { name: /Dr\. R\. Ramachandran/ })).not.toBeInTheDocument()
    expect(column(/Dr\. S\. Meenakshi/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /remove filter: doctor/i }))
    await user.click(screen.getByRole('checkbox', { name: /only with a problem/i }))
    expect(within(column(/Dr\. R\. Ramachandran/)).queryByRole('button', { name: /mohammed irfan/i })).not.toBeInTheDocument()
    expect(within(column(/Dr\. R\. Ramachandran/)).getAllByRole('button')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    await user.selectOptions(screen.getByLabelText('Booked by'), 'staff')
    expect(within(column(/Dr\. R\. Ramachandran/)).getAllByRole('button')).toHaveLength(1)
    await user.selectOptions(screen.getByLabelText('Booked by'), '')
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled')
    expect(within(column(/Dr\. R\. Ramachandran/)).getAllByRole('button')).toHaveLength(1)
  })
})

describe('Appointments: export', () => {
  it('gives managers the day sheet as a CSV, in time order, with the phone', async () => {
    let blob: Blob | null = null
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => ((blob = b), 'blob:sheet'), revokeObjectURL: () => {} }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { user } = await open('admin@example.com')
    await dayGrid()
    await user.click(screen.getByRole('button', { name: /day sheet \(csv\)/i }))
    await waitFor(() => expect(blob).not.toBeNull())
    expect(click).toHaveBeenCalled()
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.readAsText(blob!)
    })
    const lines = text.split('\n')
    expect(lines[0]).toBe('Date,Time,Doctor,Patient,Phone,Status,Notes')
    expect(lines[1]).toContain('09:30,Dr. R. Ramachandran,Mohammed Irfan')
    expect(lines.length).toBe(7)
    expect(text).toContain("'+91 98400 12345")
    click.mockRestore()
  })

  it('doesn’t offer it to someone without the export permission', async () => {
    await open('frontdesk@example.com')
    await dayGrid()
    expect(screen.queryByRole('button', { name: /csv/i })).not.toBeInTheDocument()
  })
})

describe('Appointments: who sees what', () => {
  it('lets the front desk act, and see phone numbers, but asks the desk only for what it may read', async () => {
    const fx = makeClient()
    const settings = vi.fn(fx.client.getOrgSettings)
    fx.client.getOrgSettings = settings
    const { user } = await open('frontdesk@example.com', fx)
    await dayGrid()
    // The front desk can't read the organisation's settings: no call is made, and the page says why hours are assumed.
    expect(settings).not.toHaveBeenCalled()
    expect(screen.getAllByText(/your role can.t read the organisation.s opening hours/i).length).toBeGreaterThan(0)
    await user.click(block(/Divya Prakash/))
    const d = within(drawer())
    expect(d.getByRole('button', { name: /^confirm$/i })).toBeInTheDocument()
    expect(d.getByRole('link', { name: /call \+91 98400 22222/i })).toHaveAttribute('href', 'tel:+919840022222')
  })

  it('shows a viewer the bookings read-only: no buttons, no phone numbers, no patient names', async () => {
    const fx = makeClient()
    const desk = vi.spyOn(fx.client, 'getDesk')
    const { user } = await open('viewer@example.com', fx)
    await dayGrid()
    // They are not the front desk's: no desk read, and a note about the hours.
    expect(desk).not.toHaveBeenCalled()
    expect(screen.getAllByText(/can.t read the organisation.s opening hours/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/lakshmi narayanan/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('A patient').length).toBeGreaterThan(0)
    expect(screen.getByText(/you can look; the front desk and above make changes/i)).toBeInTheDocument()
    // Two bookings are at 11:00 with Dr. Ramachandran, and a viewer can't tell them apart by name: the one needing a check.
    await user.click(block(/11:00 am, A patient, Dr\. R\. Ramachandran.*Needs a check/i))
    const d = within(drawer())
    expect(d.getByRole('heading', { level: 2, name: 'A patient' })).toBeInTheDocument()
    for (const name of [/^confirm$/i, /^change$/i, /^cancel$/i, /^call /i, /book it again/i]) expect(d.queryByRole('button', { name })).not.toBeInTheDocument()
    expect(drawer().querySelector('a[href^="tel:"]')).toBeNull()
    expect(d.queryByText(/98400/)).not.toBeInTheDocument()
    expect(d.getByText(/can.t see callers. details/i)).toBeInTheDocument()
    // The list has no phone column for them either.
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'List' }))
    const table = await screen.findByRole('table', { name: /^appointments$/i })
    expect(within(table).queryByRole('columnheader', { name: /phone/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /csv/i })).not.toBeInTheDocument()
  })
})

describe('Appointments: loading, errors and a stale refresh', () => {
  it('says it could not load, and tries again when asked', async () => {
    let fail = true
    const fx = makeClient()
    const real = fx.client.listAppointments
    fx.client.listAppointments = (o, f, t) => (fail ? Promise.reject(new AuthError('network', 'The server is busy.')) : real(o, f, t))
    const { user } = await open('admin@example.com', fx)
    expect(await screen.findByText(/couldn.t load appointments/i)).toBeInTheDocument()
    expect(screen.getByText(/the server is busy/i)).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await dayGrid()
    expect(screen.queryByText(/couldn.t load appointments/i)).not.toBeInTheDocument()
  })

  it('keeps what it has on screen when a refresh fails, and says it isn’t updating', async () => {
    const fx = makeClient()
    const { user } = await open('admin@example.com', fx)
    await dayGrid()
    fx.client.listAppointments = () => Promise.reject(new AuthError('network', 'Offline.'))
    // A confirmation reads the bookings again straight away; that read fails.
    await user.click(block(/Divya Prakash/))
    await user.click(within(drawer()).getByRole('button', { name: /^confirm$/i }))
    expect(await screen.findByText(/not updating/i)).toBeInTheDocument()
    expect(screen.getByText(/offline\./i)).toBeInTheDocument()
    expect(block(/Lakshmi Narayanan/)).toBeInTheDocument()
  })

  it('reads another window when the day looked at is outside the loaded one', async () => {
    const fx = makeClient()
    await open('admin@example.com', fx)
    await dayGrid()
    expect(fx.list).toHaveBeenCalledWith('arogya-demo', '2026-10-19', '2026-11-25')
    fireEvent.change(screen.getByLabelText(/jump to a date/i), { target: { value: '2027-02-10' } })
    await waitFor(() => expect(fx.list).toHaveBeenCalledWith('arogya-demo', '2027-02-03', '2027-03-12'))
    expect(await screen.findByText('No appointments on Wednesday.')).toBeInTheDocument()
  })
})

describe('Appointments: with the demo’s own data', () => {
  it.each(['owner@example.com', 'frontdesk@example.com', 'viewer@example.com'])('draws every view for %s without trouble', async (email) => {
    const view = renderApp(`${O}/appointments`, { consoleClient: createDemoConsoleClient({ latency: 0, persist: false }) })
    await signIn(view.user, email)
    await screen.findByRole('heading', { level: 2, name: /monday 26 october/i })
    for (const name of ['Week', 'List', 'Day by doctor']) {
      await view.user.click(screen.getByRole('button', { name }))
      await waitFor(() => expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true'))
    }
    expect(await screen.findByRole('complementary', { name: /needs a check/i })).toBeInTheDocument()
  })
})
