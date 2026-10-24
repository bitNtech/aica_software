import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import { callLog } from '../console/demo/operations'
import type { Appointment, ConsoleClient } from '../console/types'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'
const SLUG = 'arogya-demo'

// A fixed moment (12:00 local on a Saturday) so "today", "tomorrow" and the
// countdowns don't depend on the clock. The sample notice runs from 12:00 less
// a few hours until midnight; Dr. Senthil is away today, Dr. Arvind late tomorrow.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 24, 12, 0))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const fresh = () => createDemoConsoleClient({ latency: 0, persist: false })
/** The same demo, with some calls changed (it keeps its own state: call through to `demo`). */
const withOverrides = (demo: ConsoleClient, over: Partial<ConsoleClient>) => ({ ...demo, ...over }) as ConsoleClient

const appt = (id: string, doctor: string, date: string, time: string, over: Partial<Appointment> = {}): Appointment => ({
  id,
  patientName: `Patient ${id}`,
  phone: '+91 90000 00000',
  department: 'ENT',
  doctor,
  date,
  time,
  status: 'booked',
  bookedBy: 'agent',
  agentName: 'OPD appointments',
  callId: null,
  createdAt: new Date().toISOString(),
  ...over,
})
/** Four with Dr. Senthil today (one cancelled: not counted), two with Dr. Lakshmi on Sunday. */
const APPOINTMENTS: Appointment[] = [
  appt('s1', 'Dr. V. Senthil', '2026-10-24', '14:00'),
  appt('s2', 'Dr. V. Senthil', '2026-10-24', '15:30', { status: 'confirmed' }),
  appt('s3', 'Dr. V. Senthil', '2026-10-24', '16:00', { status: 'cancelled' }),
  appt('s4', 'Dr. V. Senthil', '2026-10-24', '17:00'),
  appt('l1', 'Dr. P. Lakshmi', '2026-10-25', '09:30', { department: 'Paediatrics' }),
  appt('l2', 'Dr. P. Lakshmi', '2026-10-25', '10:00', { department: 'Paediatrics' }),
]

/** The desk with one more open flag, as if it had been raised on a call. (Data made before signing in is reset on sign-in, so it's added to what the desk returns.) */
const withFlag = (demo: ConsoleClient, flag: { callId: string | null; agentName: string | null; text: string; correction: string }) =>
  withOverrides(demo, {
    getDesk: async (o) => {
      const d = await demo.getDesk(o)
      return { ...d, flags: [{ id: 'flag_call', ...flag, by: 'Meena S', at: new Date().toISOString(), status: 'open' as const }, ...d.flags] }
    },
  })

async function open(email: string, consoleClient: ConsoleClient = fresh()) {
  const view = renderApp(`${O}/desk`, { consoleClient })
  await signIn(view.user, email)
  await screen.findByRole('heading', { level: 2, name: 'Lines' })
  return view
}

const lines = () => screen.getByRole('list', { name: 'Phone lines' })
const card = (name: string) => within(lines()).getByRole('heading', { level: 3, name }).closest('li')!
const flagsPanel = () => screen.getByRole('heading', { level: 2, name: 'Flagged answers' }).closest('section')!
const noticesPanel = () => screen.getByRole('heading', { level: 2, name: 'Notices' }).closest('section')!
const calendar = () => screen.getByRole('table', { name: /doctors by day/i })
const cellButton = (name: RegExp) => within(calendar()).getByRole('button', { name })
/** The newest toast's Undo (earlier toasts may still be showing). */
const toastUndo = async () => (await screen.findAllByRole('button', { name: 'Undo' })).at(-1)!

describe('Bot desk: the lines', () => {
  it('shows each line with its agent, who is answering and calls now, in words', async () => {
    await open('frontdesk@example.com')
    expect(screen.getByText('2 answering · 1 paused · 2 without an agent')).toBeInTheDocument()
    const main = card('Main reception')
    expect(within(main).getByText('+91 00000 01200')).toBeInTheDocument()
    expect(within(main).getByText('Main reception is answering')).toBeInTheDocument()
    expect(within(main).getByText(/on \d+ calls? now\.|no calls right now\./i)).toBeInTheDocument()
    expect(within(card('Spare line')).getByText('No agent: calls go straight to your team.')).toBeInTheDocument()
    // A paused agent's line says so and can't be sent to staff (its calls already go there).
    expect(within(card('Lab')).getByText('Lab report status is paused')).toBeInTheDocument()
    expect(within(card('Lab')).queryByRole('button')).toBeNull()
    // The front desk can't read reports: no figures, and no error about it.
    expect(screen.queryByText('Calls today')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send every line to staff' })).toBeInTheDocument()
  })

  it('adds today’s calls and the share handed over for people who can read reports', async () => {
    await open('owner@example.com')
    const main = card('Main reception')
    expect(await within(main).findByText('Calls today')).toBeInTheDocument()
    expect(within(main).getByText('Handed over')).toBeInTheDocument()
    expect(within(main).getByText(/^\d+$/)).toBeInTheDocument()
  })

  it('sends a line to staff until a time today, and says when it comes back', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.click(within(card('OPD appointments')).getByRole('button', { name: /send to staff/i }))
    const dialog = screen.getByRole('dialog', { name: /send opd appointments to your team/i })
    await user.click(within(dialog).getByRole('radio', { name: /until a time today/i }))
    // A time that has passed is refused, in words.
    fireEvent.change(within(dialog).getByLabelText('Until'), { target: { value: '11:00' } })
    await user.click(within(dialog).getByRole('button', { name: /^send to staff$/i }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a time later than now.')
    fireEvent.change(within(dialog).getByLabelText('Until'), { target: { value: '23:30' } })
    await user.type(within(dialog).getByLabelText(/^why/i), 'OPD desk is quiet')
    await user.click(within(dialog).getByRole('button', { name: /^send to staff$/i }))
    const opd = card('OPD appointments')
    expect(await within(opd).findByText('Your team is answering')).toBeInTheDocument()
    expect(within(opd).getByText(/back to opd appointments in 11 h 30 min/i)).toBeInTheDocument()
    expect(within(opd).getByText(/“OPD desk is quiet”/)).toBeInTheDocument()
    expect(within(opd).getByText(/switched by meena s/i)).toBeInTheDocument()
    // Undo from the toast puts it back.
    await user.click(await toastUndo())
    expect(await within(card('OPD appointments')).findByText('OPD appointments is answering')).toBeInTheDocument()
  })

  it('sends every line to staff, names the one that could not be changed, and undoes the rest', async () => {
    const demo = fresh()
    const client = withOverrides(demo, {
      setLineMode: async (o, id, change) => {
        if (id === 'num_1210' && change.mode === 'staff') throw new AuthError('invalid_input', 'Say where OPD appointments’ calls go first.')
        return demo.setLineMode(o, id, change)
      },
    })
    const { user } = await open('frontdesk@example.com', client)
    await user.click(screen.getByRole('button', { name: 'Send every line to staff' }))
    const dialog = screen.getByRole('dialog', { name: /send every line to your team/i })
    // The confirmation lists what will change; lines without an agent aren't in it.
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Main reception'), expect.stringContaining('OPD appointments')])
    await user.click(within(dialog).getByRole('button', { name: /send 2 lines to staff/i }))
    const alert = (await screen.findByText(/sent to your team: 1 of 2 lines/i)).closest('.alert')!
    expect(alert).toHaveTextContent('Sent to your team: 1 of 2 lines')
    expect(alert).toHaveTextContent('Couldn’t change OPD appointments')
    expect(alert).toHaveTextContent('Say where OPD appointments’ calls go first.')
    expect(within(card('Main reception')).getByText('Your team is answering')).toBeInTheDocument()
    expect(within(card('OPD appointments')).getByText('OPD appointments is answering')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 lines now ring your team\. 1 couldn’t be changed\./)).toBeInTheDocument()
    // Undo puts back the one that was changed.
    await user.click(await toastUndo())
    await waitFor(() => expect(within(card('Main reception')).getByText('Main reception is answering')).toBeInTheDocument())
  })

  it('gives every line back after confirming', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.click(screen.getByRole('button', { name: 'Send every line to staff' }))
    await user.click(within(screen.getByRole('dialog', { name: /send every line to your team/i })).getByRole('button', { name: /send 2 lines to staff/i }))
    expect(await screen.findByText('Every line is with your team')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send every line to staff' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Give every line back' }))
    const confirm = screen.getByRole('dialog', { name: /give every line back/i })
    expect(within(confirm).getAllByRole('listitem')).toHaveLength(2)
    await user.click(within(confirm).getByRole('button', { name: 'Give every line back' }))
    await waitFor(() => expect(screen.queryByText('Every line is with your team')).toBeNull())
    expect(within(card('Main reception')).getByText('Main reception is answering')).toBeInTheDocument()
  })
})

describe('Bot desk: notices', () => {
  it('splits what is showing now from what is scheduled, with a countdown and who posted it', async () => {
    await open('frontdesk@example.com')
    const list = within(noticesPanel()).getByRole('list', { name: /notices showing now/i })
    const lift = within(list).getByText(/lift in block b is under repair/i).closest('li')!
    expect(within(lift).getByText(/ends in 12 h \(until tomorrow, 12:00 am\)/i)).toBeInTheDocument()
    expect(within(lift).getByText(/every agent · posted by meena s/i)).toBeInTheDocument()
    expect(within(noticesPanel()).queryByRole('list', { name: /scheduled notices/i })).toBeNull()
  })

  it('posts from a ready-made notice, refuses it until filled in, previews it and warns about a duplicate', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.click(within(noticesPanel()).getByRole('button', { name: /post a notice/i }))
    const dialog = screen.getByRole('dialog', { name: /post a notice/i })
    await user.click(within(dialog).getByRole('button', { name: 'Lift or parking' }))
    const text = within(dialog).getByLabelText(/what callers should know/i) as HTMLTextAreaElement
    expect(text.value).toMatch(/the lift in \[block\] is under repair today/i)
    expect(within(dialog).getByRole('button', { name: 'Lift or parking' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(dialog).getByRole('button', { name: /post notice/i }))
    expect(text).toHaveAccessibleDescription(/fill in the parts in \[square brackets\]/i)
    expect(text).toHaveFocus()

    // Filled in, it says much the same as the lift notice already showing.
    await user.clear(text)
    await user.type(text, 'The lift in Block B is under repair today. Please use the ramp near the pharmacy.')
    const dup = within(dialog).getByText(/much the same notice is already showing/i).closest('div')!
    expect(dup).toHaveTextContent(/every agent, until tomorrow, 12:00 am/i)
    // The preview is the wording as it stands, and when callers hear it.
    const preview = within(dialog).getByRole('region', { name: 'Preview' })
    expect(preview).toHaveTextContent(/every agent will tell callers, from now, until today, 11:59 pm/i)
    expect(within(preview).getByText('The lift in Block B is under repair today. Please use the ramp near the pharmacy.')).toBeInTheDocument()

    // Something different: no warning.
    await user.clear(text)
    await user.type(text, 'A free eye check-up camp runs in the OPD lobby this afternoon.')
    expect(within(dialog).queryByText(/much the same notice/i)).toBeNull()
  })

  it('schedules a notice for later, shows it under Scheduled, and undoes it', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.click(within(noticesPanel()).getByRole('button', { name: /post a notice/i }))
    const dialog = screen.getByRole('dialog', { name: /post a notice/i })
    await user.type(within(dialog).getByLabelText(/what callers should know/i), 'A free eye check-up camp runs in the OPD lobby from 4 PM.')
    await user.click(within(dialog).getByRole('radio', { name: /at a time i choose/i }))
    fireEvent.change(within(dialog).getByLabelText('Starts at'), { target: { value: '2026-10-24T16:00' } })
    expect(within(dialog).getByRole('region', { name: 'Preview' })).toHaveTextContent(/from today, 4:00 pm/i)
    await user.click(within(dialog).getByRole('button', { name: /schedule notice/i }))
    const scheduled = await within(noticesPanel()).findByRole('list', { name: /scheduled notices/i })
    const item = within(scheduled).getByText(/free eye check-up camp/i).closest('li')!
    expect(within(item).getByText(/starts in 4 h/i)).toBeInTheDocument()
    expect(within(noticesPanel()).getByRole('heading', { level: 3, name: /^scheduled 1$/i })).toBeInTheDocument()
    await user.click(await toastUndo())
    await waitFor(() => expect(within(noticesPanel()).queryByRole('list', { name: /scheduled notices/i })).toBeNull())
  })

  it('refuses an end before the start, in words on the field', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.click(within(noticesPanel()).getByRole('button', { name: /post a notice/i }))
    const dialog = screen.getByRole('dialog', { name: /post a notice/i })
    await user.type(within(dialog).getByLabelText(/what callers should know/i), 'The cash counter is closed for an hour.')
    await user.selectOptions(within(dialog).getByLabelText('Ends'), 'custom')
    fireEvent.change(within(dialog).getByLabelText('Ends at'), { target: { value: '2026-10-24T11:00' } })
    await user.click(within(dialog).getByRole('button', { name: /post notice/i }))
    expect(within(dialog).getByLabelText('Ends')).toHaveAccessibleDescription(/later than now/i)
  })

  it('ends a notice early, can undo it, and changes one with the form filled in', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.click(within(noticesPanel()).getByRole('button', { name: /end the notice early: the lift/i }))
    await waitFor(() => expect(within(noticesPanel()).queryByText(/lift in block b/i)).toBeNull())
    expect(within(noticesPanel()).getByText(/no notices\./i)).toBeInTheDocument()
    await user.click(await toastUndo())
    const lift = await within(noticesPanel()).findByText(/lift in block b is under repair/i)
    await user.click(within(lift.closest('li')!).getByRole('button', { name: /change the notice/i }))
    const dialog = screen.getByRole('dialog', { name: /change the notice/i })
    expect((within(dialog).getByLabelText(/what callers should know/i) as HTMLTextAreaElement).value).toMatch(/lift in block b/i)
    // No templates when changing one, and its start can't move once it has begun.
    expect(within(dialog).queryByRole('button', { name: 'Lift or parking' })).toBeNull()
    expect(within(dialog).getByText(/^started today/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
  })
})

describe('Bot desk: doctor availability', () => {
  const withAppointments = () => withOverrides(fresh(), { listAppointments: async () => APPOINTMENTS })

  it('is a table of doctors by the next 14 days, with a marker in words for each change', async () => {
    await open('frontdesk@example.com', withAppointments())
    const table = calendar()
    expect(within(table).getAllByRole('columnheader')).toHaveLength(15)
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'Dr. K. ArvindOrthopaedics',
      'Dr. P. LakshmiPaediatrics',
      'Dr. R. RamachandranCardiology',
      'Dr. S. MeenakshiGeneral medicine',
      'Dr. V. SenthilENT',
    ])
    // Away today (an icon and the word), with the booked appointments it touches.
    await waitFor(() => expect(cellButton(/Dr\. V\. Senthil, today, Sat 24 Oct: Away all day/)).toHaveTextContent('3 booked'))
    const senthil = cellButton(/Dr\. V\. Senthil, today, Sat 24 Oct: Away all day/)
    expect(senthil).toHaveTextContent('Away')
    expect(senthil).toHaveAccessibleName(/3 appointments affected\. Change it\./)
    expect(cellButton(/Dr\. K\. Arvind, Sun 25 Oct: Starting late/)).toHaveTextContent('Late')
    expect(cellButton(/Dr\. P\. Lakshmi, Sun 25 Oct: no change\. Add a change\./)).toBeInTheDocument()
  })

  it('lists each change with who added it, the appointments affected and a link to Appointments', async () => {
    await open('frontdesk@example.com', withAppointments())
    const changes = screen.getByRole('list', { name: 'Doctor changes' })
    const senthil = within(changes).getByText('Dr. V. Senthil').closest('li')!
    expect(within(senthil).getByText('Away all day')).toBeInTheDocument()
    expect(within(senthil).getByText(/on leave today/i)).toBeInTheDocument()
    expect(within(senthil).getByText('Added by Meena S')).toBeInTheDocument()
    expect(await within(senthil).findByText('3 appointments affected.')).toBeInTheDocument()
    // The Appointments page doesn't take a day in its address, so the link opens the page.
    expect(within(senthil).getByRole('link', { name: /see appointments for dr\. v\. senthil/i })).toHaveAttribute('href', `${O}/appointments`)
    // A late doctor only touches the appointments before they arrive: nobody is booked with Dr. Arvind.
    const arvind = within(changes).getByText('Dr. K. Arvind').closest('li')!
    expect(within(arvind).getByText('No appointments are booked for this.')).toBeInTheDocument()
  })

  it('moves between cells with the arrow keys, and adds a change from a cell with Enter, with the appointments it affects', async () => {
    const { user } = await open('frontdesk@example.com', withAppointments())
    // One tab stop in the grid: the first cell.
    const first = within(calendar()).getAllByRole('button')[0]
    expect(first).toHaveAttribute('tabindex', '0')
    expect(within(calendar()).getAllByRole('button').filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1)
    first.focus()
    await user.keyboard('{ArrowRight}')
    expect(within(calendar()).getByRole('button', { name: /Dr\. K\. Arvind, Sun 25 Oct/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(cellButton(/Dr\. P\. Lakshmi, Sun 25 Oct/)).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(cellButton(/Dr\. P\. Lakshmi, today/)).toHaveFocus()
    await user.keyboard('{ArrowRight}')

    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: /mark a doctor away or late/i })
    expect(within(dialog).getByLabelText(/^doctor/i)).toHaveValue('Dr. P. Lakshmi')
    expect(within(dialog).getByLabelText('Day')).toHaveValue('2026-10-25')
    await user.click(within(dialog).getByRole('radio', { name: /in another room/i }))
    await user.type(within(dialog).getByLabelText('Where'), 'OPD room 4')
    expect(within(dialog).getByText(/2 booked appointments are affected/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))

    const cell = await within(calendar()).findByRole('button', { name: /Dr\. P\. Lakshmi, Sun 25 Oct: In another room/ })
    expect(cell).toHaveTextContent('Moved')
    expect(cell).toHaveTextContent('2 booked')
    const lakshmi = within(screen.getByRole('list', { name: 'Doctor changes' })).getByText('Dr. P. Lakshmi').closest('li')!
    expect(within(lakshmi).getByText('2 appointments affected.')).toBeInTheDocument()
    // Undo takes it back off.
    await user.click(await toastUndo())
    await waitFor(() => expect(cellButton(/Dr\. P\. Lakshmi, Sun 25 Oct: no change/)).toBeInTheDocument())
  })

  it('changes an existing day from its cell, and removes one with an undo', async () => {
    const { user } = await open('frontdesk@example.com', withAppointments())
    await user.click(cellButton(/Dr\. K\. Arvind, Sun 25 Oct: Starting late/))
    const dialog = screen.getByRole('dialog', { name: /change a doctor’s day/i })
    expect(within(dialog).getByLabelText(/^doctor/i)).toBeDisabled()
    await user.clear(within(dialog).getByLabelText('From when'))
    await user.type(within(dialog).getByLabelText('From when'), 'From 12 noon, after rounds')
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    expect(await within(calendar()).findByRole('button', { name: /Dr\. K\. Arvind, Sun 25 Oct: Starting late, From 12 noon/ })).toBeInTheDocument()

    const senthil = within(screen.getByRole('list', { name: 'Doctor changes' })).getByText('Dr. V. Senthil').closest('li')!
    await user.click(within(senthil).getByRole('button', { name: /remove dr\. v\. senthil’s change/i }))
    await waitFor(() => expect(cellButton(/Dr\. V\. Senthil, today, Sat 24 Oct: no change/)).toBeInTheDocument())
    await user.click(await toastUndo())
    expect(await within(calendar()).findByRole('button', { name: /Dr\. V\. Senthil, today, Sat 24 Oct: Away all day/ })).toBeInTheDocument()
  })

  it('shows a change for a doctor who is not in the library as its own row', async () => {
    const demo = fresh()
    const client = withOverrides(demo, {
      getDesk: async (o) => {
        const d = await demo.getDesk(o)
        return { ...d, doctorChanges: [...d.doctorChanges, { id: 'doc_x', doctor: 'Dr. Z. Visiting', department: 'Dermatology', date: '2026-10-27', kind: 'away', detail: '', createdBy: 'Meena S', createdAt: new Date().toISOString() }] }
      },
    })
    await open('frontdesk@example.com', client)
    expect(within(calendar()).getByRole('rowheader', { name: /dr\. z\. visiting/i })).toHaveTextContent('not in the library')
    expect(cellButton(/Dr\. Z\. Visiting, Tue 27 Oct: Away all day/)).toBeInTheDocument()
  })
})

describe('Bot desk: flagged answers', () => {
  it('has Open, Fixed and Dismissed with counts, and shows who flagged it, when, and what it should have said', async () => {
    const { user } = await open('admin@example.com')
    const panel = flagsPanel()
    expect(within(panel).getByRole('tab', { name: 'Open 1' })).toHaveAttribute('aria-selected', 'true')
    expect(within(panel).getByRole('tab', { name: 'Fixed 1' })).toBeInTheDocument()
    expect(within(panel).getByRole('tab', { name: 'Dismissed 0' })).toBeInTheDocument()
    const item = within(panel).getByText(/pharmacy closes at 8 pm/i).closest('li')!
    expect(within(item).getByText('Main reception')).toBeInTheDocument()
    expect(within(item).getByText(/flagged by suresh b, \d+ minutes? ago|flagged by suresh b, \d+ hours? ago/i)).toBeInTheDocument()
    expect(within(item).getByText(/the pharmacy is open 24 hours, every day/i)).toBeInTheDocument()
    expect(within(item).getByText('Flagged from the desk: no call is attached.')).toBeInTheDocument()
    await user.click(within(panel).getByRole('tab', { name: 'Fixed 1' }))
    const fixed = within(panel).getByText(/old consultation fee/i).closest('li')!
    expect(within(fixed).getByText(/fixed by karthik r, .*: updated the opd and lab price list\./i)).toBeInTheDocument()
    await user.click(within(panel).getByRole('tab', { name: 'Dismissed 0' }))
    expect(within(panel).getByText(/nothing dismissed lately/i)).toBeInTheDocument()
  })

  it('marks one fixed with what changed, can undo it, and reopens a fixed one', async () => {
    const { user } = await open('admin@example.com')
    const panel = flagsPanel()
    const item = within(panel).getByText(/pharmacy closes at 8 pm/i).closest('li')!
    await user.click(within(item).getByRole('button', { name: /mark fixed/i }))
    await user.click(within(item).getByRole('button', { name: /mark fixed/i }))
    expect(within(item).getByLabelText(/what you changed/i)).toHaveAccessibleDescription(/say what you changed/i)
    await user.type(within(item).getByLabelText(/what you changed/i), 'Added pharmacy hours to the FAQ.')
    await user.click(within(item).getByRole('button', { name: /mark fixed/i }))
    expect(await within(panel).findByText('Nothing flagged.')).toBeInTheDocument()
    expect(within(panel).getByRole('tab', { name: 'Fixed 2' })).toBeInTheDocument()

    // Undo: it is open again.
    await user.click(await toastUndo())
    expect(await within(panel).findByText(/pharmacy closes at 8 pm/i)).toBeInTheDocument()
    expect(within(panel).getByRole('tab', { name: 'Open 1' })).toBeInTheDocument()

    // Dismiss with no note, then reopen it from the Dismissed tab.
    await user.click(within(panel).getByRole('button', { name: /^dismiss$/i }))
    await user.click(within(panel).getByRole('button', { name: /^dismiss$/i }))
    await user.click(within(panel).getByRole('tab', { name: 'Dismissed 1' }))
    const dismissed = within(panel).getByText(/pharmacy closes at 8 pm/i).closest('li')!
    expect(within(dismissed).getByText(/dismissed by karthik r/i)).toBeInTheDocument()
    await user.click(within(dismissed).getByRole('button', { name: /reopen/i }))
    await waitFor(() => expect(within(panel).getByRole('tab', { name: 'Open 1' })).toBeInTheDocument())
  })

  it('searches and filters by agent, with a chip for each, and clears them', async () => {
    const { user } = await open('admin@example.com')
    const panel = flagsPanel()
    await user.type(within(panel).getByRole('searchbox', { name: /search flagged answers/i }), 'zebra')
    expect(within(panel).getByText(/no open answers match/i)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /remove filter: search: zebra/i })).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: /^clear the filters$/i }))
    expect(within(panel).getByText(/pharmacy closes at 8 pm/i)).toBeInTheDocument()
    await user.selectOptions(within(panel).getByLabelText('Agent'), 'OPD appointments')
    expect(within(panel).getByText(/no open answers match/i)).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: /clear all/i }))
    expect(within(panel).getByText(/pharmacy closes at 8 pm/i)).toBeInTheDocument()
  })

  it('focuses the search with / and opens the notice form with n', async () => {
    const { user } = await open('frontdesk@example.com')
    await user.keyboard('/')
    expect(screen.getByRole('searchbox', { name: /search flagged answers/i })).toHaveFocus()
    await user.tab({ shift: true })
    await user.keyboard('n')
    expect(screen.getByRole('dialog', { name: /post a notice/i })).toBeInTheDocument()
  })

  it('offers Add to FAQ and Ask bitNtech by permission: an admin has both, the front desk neither fix nor FAQ', async () => {
    const admin = await open('admin@example.com')
    const item = within(flagsPanel()).getByText(/pharmacy closes at 8 pm/i).closest('li')!
    expect(within(item).getByRole('link', { name: 'Add to FAQ' })).toHaveAttribute('href', `${O}/knowledge`)
    expect(within(item).getByRole('link', { name: 'Ask bitNtech' })).toHaveAttribute('href', `${O}/requests?new=flow_change&agent=agt_reception`)
    // The question and the answer go to the clipboard, and Knowledge opens.
    await admin.user.click(within(item).getByRole('link', { name: 'Add to FAQ' }))
    expect(await screen.findByRole('heading', { level: 1, name: /knowledge/i })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('Question: Told a caller the pharmacy closes at 8 PM on Sundays.\nAnswer: The pharmacy is open 24 hours, every day.')
    expect(await screen.findByText(/copied the question and answer/i)).toBeInTheDocument()
  })

  it('shows the front desk the flags without fix, FAQ or request actions', async () => {
    await open('frontdesk@example.com')
    const item = within(flagsPanel()).getByText(/pharmacy closes at 8 pm/i).closest('li')!
    expect(within(item).queryByRole('button', { name: /mark fixed|dismiss/i })).toBeNull()
    expect(within(item).queryByRole('link', { name: 'Add to FAQ' })).toBeNull()
    expect(within(flagsPanel()).getByText(/whoever looks after the agents fixes them/i)).toBeInTheDocument()
    // Anyone can still flag one.
    expect(within(flagsPanel()).getByRole('button', { name: /flag a wrong answer/i })).toBeInTheDocument()
  })

  it('shows the part of the call a flag came from, with a link to the call', async () => {
    const demo = fresh()
    const call = callLog({ orgSlug: SLUG, paused: new Set(), pauses: {} }, 7).find((c) => c.agentId !== 'agt_reports')!
    const record = await demo.getCallRecord(SLUG, call.id)
    const reply = record.transcript.find((t) => t.speaker === 'agent' && t.text.split(/\s+/).length > 8)!
    const client = withFlag(demo, { callId: call.id, agentName: call.agentName, text: reply.text, correction: 'Say the right thing.' })
    await open('admin@example.com', client)
    const item = within(flagsPanel()).getByText(/say the right thing/i).closest('li')!
    const excerpt = await within(item).findByRole('list', { name: 'Part of the call' })
    expect(within(excerpt).getByText(reply.text)).toBeInTheDocument()
    expect(within(item).getByText(/around the answer that was flagged/i)).toBeInTheDocument()
    expect(within(item).getByRole('link', { name: /open the whole call/i })).toHaveAttribute('href', `${O}/calls/${call.id}`)
  })

  it('says when a call could not be read, and offers to try again', async () => {
    const demo = fresh()
    const call = callLog({ orgSlug: SLUG, paused: new Set(), pauses: {} }, 7)[0]
    const client = withOverrides(withFlag(demo, { callId: call.id, agentName: 'Main reception', text: 'Gave the wrong room.', correction: '' }), {
      getCallRecord: async () => {
        throw new AuthError('network', 'The call isn’t available.')
      },
    })
    await open('admin@example.com', client)
    const item = within(flagsPanel()).getByText(/gave the wrong room/i).closest('li')!
    expect(await within(item).findByText(/couldn’t read the call: the call isn’t available\./i)).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})

describe('Bot desk: activity, loading and errors', () => {
  it('lists what the desk did from the activity log, and opens all activity', async () => {
    const { user } = await open('admin@example.com')
    expect(screen.getByRole('heading', { level: 2, name: 'Desk activity' })).toBeInTheDocument()
    // Nothing yet (the sample log has none of the desk's own, or only older ones): do something and it appears.
    await user.click(within(card('OPD appointments')).getByRole('button', { name: /send to staff/i }))
    await user.click(within(screen.getByRole('dialog', { name: /send opd appointments to your team/i })).getByRole('button', { name: /^send to staff$/i }))
    const log = await screen.findByRole('list', { name: 'Desk activity' })
    expect(await within(log).findByText(/sent opd appointments \(\+91 00000 01210\) to staff/i)).toBeInTheDocument()
    expect(within(log).getByText(/karthik r/i)).toBeInTheDocument()
    // Other activity (publishing, the team) isn't the desk's.
    expect(within(log).queryByText(/published/i)).toBeNull()
    expect(screen.getByRole('link', { name: 'See all activity' })).toHaveAttribute('href', `${O}/activity`)
  })

  it('leaves the activity block out for someone who can’t open the activity log', async () => {
    await open('frontdesk@example.com')
    expect(screen.queryByRole('heading', { name: 'Desk activity' })).toBeNull()
  })

  it('says the activity could not be loaded, with a retry, while the rest of the desk works', async () => {
    const demo = fresh()
    const client = withOverrides(demo, {
      listActivity: async () => {
        throw new AuthError('network', 'Couldn’t reach the server.')
      },
    })
    await open('admin@example.com', client)
    const block = screen.getByRole('heading', { level: 2, name: 'Desk activity' }).closest('section')!
    expect(await within(block).findByText(/couldn't load the activity/i)).toBeInTheDocument()
    expect(within(block).getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Lines' })).toBeInTheDocument()
  })

  it('says when the desk could not be loaded, and tries again', async () => {
    const demo = fresh()
    let fail = true
    const client = withOverrides(demo, {
      getDesk: async (o) => {
        if (fail) throw new AuthError('network', 'Couldn’t reach the server.')
        return demo.getDesk(o)
      },
    })
    const view = renderApp(`${O}/desk`, { consoleClient: client })
    await signIn(view.user, 'frontdesk@example.com')
    expect(await screen.findByText(/couldn't load the desk/i)).toBeInTheDocument()
    fail = false
    await view.user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Lines' })).toBeInTheDocument()
  })

  it('says there are no lines when the hospital has none', async () => {
    const demo = fresh()
    const client = withOverrides(demo, { getDesk: async (o) => ({ ...(await demo.getDesk(o)), lines: [] }) })
    await open('frontdesk@example.com', client)
    expect(screen.getByText(/no phone lines yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /every line/i })).toBeNull()
  })

  it('says the header is updated, and shows the empty states for notices, doctors and flags', async () => {
    const demo = fresh()
    const client = withOverrides(demo, { getDesk: async (o) => ({ ...(await demo.getDesk(o)), notices: [], doctorChanges: [], flags: [] }) })
    await open('frontdesk@example.com', client)
    expect(screen.getByText(/^updated /i)).toBeInTheDocument()
    expect(within(noticesPanel()).getByText(/no notices\. post one when something’s different today/i)).toBeInTheDocument()
    expect(screen.getByText('Every doctor is in as usual.')).toBeInTheDocument()
    expect(within(flagsPanel()).getByText('Nothing flagged.')).toBeInTheDocument()
  })
})
