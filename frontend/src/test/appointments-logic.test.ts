import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Appointment, DoctorChange, OrgSettings } from '../console/types'
import {
  addDays,
  applyFilters,
  baseWindow,
  capacityFor,
  clockOf,
  countStatuses,
  csvCell,
  daySheet,
  doctorColumns,
  doctorLoads,
  doctorNote,
  findProblems,
  gridWindow,
  hoursFor,
  inferSlotLength,
  initials,
  knownDoctors,
  layoutColumn,
  loadWindow,
  mondayOf,
  neighbour,
  NO_FILTERS,
  parseClock,
  patientIdentity,
  proposalProblems,
  readView,
  saveView,
  suggestSlots,
  time12,
  undoPatches,
  viewDates,
  weekdayIndex,
  type Ctx,
} from '../pages/console/operate/appointments/model'

// Monday 26 October 2026, 10:40 (the hospital's local time).
const NOW = new Date(2026, 9, 26, 10, 40).getTime()
const MON = '2026-10-26'
const TUE = '2026-10-27'
const SUN = '2026-11-01'

let n = 0
function appt(over: Partial<Appointment> = {}): Appointment {
  n++
  return {
    id: `a${n}`,
    patientName: `Patient ${n}`,
    phone: `98000000${String(n).padStart(2, '0')}`,
    department: 'Cardiology',
    doctor: 'Dr. R. Ramachandran',
    date: MON,
    time: '11:00',
    status: 'pending',
    bookedBy: 'agent',
    agentName: 'OPD appointments',
    callId: null,
    createdAt: '2026-10-25T10:00:00Z',
    ...over,
  }
}

const day = (open = true, from = '09:00', to = '17:00') => ({ open, from, to })
const SETTINGS: OrgSettings = {
  name: 'Arogya',
  city: 'Coimbatore',
  languages: ['english'],
  // Monday to Friday 9 to 5, Saturday mornings, closed Sunday.
  hours: [day(), day(), day(), day(), day(), day(true, '09:00', '13:00'), day(false)],
  closed: [{ date: TUE, label: 'Deepavali' }],
  updatedAt: '2026-10-01T00:00:00Z',
  updatedBy: 'Lakshmi K',
}
const change = (over: Partial<DoctorChange>): DoctorChange => ({ id: 'c1', doctor: 'Dr. R. Ramachandran', department: 'Cardiology', date: MON, kind: 'away', detail: 'On leave.', createdBy: 'Meena', createdAt: '2026-10-25T10:00:00Z', ...over })

const SEES = { phone: true, name: true }
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  settings: SETTINGS,
  changes: [],
  library: null,
  now: NOW,
  slot: 30,
  who: (a) => a.patientName,
  identity: (a) => patientIdentity(a, SEES),
  ...over,
})
const kinds = (m: Map<string, { kind: string }[]>, id: string) => (m.get(id) ?? []).map((p) => p.kind).sort()

afterEach(() => vi.restoreAllMocks())

describe('dates and times', () => {
  it('works in weeks that start on Monday', () => {
    expect(weekdayIndex(MON)).toBe(0)
    expect(weekdayIndex(SUN)).toBe(6)
    expect(mondayOf(SUN)).toBe(MON)
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(clockOf(NOW)).toEqual({ date: MON, minutes: 640 })
  })
  it('says times the way the front desk does', () => {
    expect(time12('09:05')).toBe('9:05 am')
    expect(time12('12:00')).toBe('12:00 pm')
    expect(time12('16:30')).toBe('4:30 pm')
  })
  it('reads a time out of what the Bot desk was told', () => {
    expect(parseClock('Seeing patients from 11 AM tomorrow, after surgery.')).toBe(660)
    expect(parseClock('In from 2:30 pm')).toBe(870)
    expect(parseClock('Back at 14:15')).toBe(855)
    expect(parseClock('On leave today.')).toBeNull()
  })
  it('abbreviates a doctor to initials', () => {
    expect(initials('Dr. R. Ramachandran')).toBe('RR')
    expect(initials('Dr. Kavitha')).toBe('KA')
  })
})

describe('opening hours', () => {
  it('uses the weekday, a holiday, a closed day, and a fallback when settings are unreadable', () => {
    expect(hoursFor(MON, SETTINGS)).toMatchObject({ open: true, from: 540, to: 1020, known: true })
    expect(hoursFor('2026-10-31', SETTINGS)).toMatchObject({ open: true, to: 780 })
    expect(hoursFor(TUE, SETTINGS)).toMatchObject({ open: false, reason: 'Deepavali' })
    expect(hoursFor(SUN, SETTINGS)).toMatchObject({ open: false, reason: 'Closed on Sundays' })
    expect(hoursFor(MON, null)).toMatchObject({ open: true, from: 480, to: 1200, known: false })
  })
  it('widens the timetable to the hour for a booking outside opening hours', () => {
    expect(gridWindow(MON, SETTINGS, [appt()], 30)).toMatchObject({ gridFrom: 540, gridTo: 1020, widened: false })
    const wide = gridWindow(MON, SETTINGS, [appt({ time: '07:30' }), appt({ time: '18:15' })], 30)
    expect(wide).toMatchObject({ gridFrom: 420, gridTo: 1140, widened: true })
    // The end of a late booking counts: 16:45 for 30 minutes ends at 17:15.
    expect(gridWindow(MON, SETTINGS, [appt({ time: '16:45' })], 30).gridTo).toBe(1080)
    expect(gridWindow(MON, null, [], 30)).toMatchObject({ gridFrom: 480, gridTo: 1200, known: false })
  })
})

describe('slot length and capacity', () => {
  it('reads the length of an appointment off the bookings', () => {
    expect(inferSlotLength([])).toBe(15)
    expect(inferSlotLength([appt({ time: '09:00' })])).toBe(15)
    expect(inferSlotLength([appt({ time: '09:00' }), appt({ time: '09:30' }), appt({ time: '10:30' })])).toBe(30)
    expect(inferSlotLength([appt({ time: '09:00' }), appt({ time: '09:20' })])).toBe(20)
    expect(inferSlotLength([appt({ time: '09:00' }), appt({ time: '09:07' })])).toBe(10)
    // Different doctors at nearby times say nothing about the length; a cancelled booking is ignored.
    expect(inferSlotLength([appt({ time: '09:00' }), appt({ time: '09:15', doctor: 'Dr. B' })])).toBe(15)
    expect(inferSlotLength([appt({ time: '09:00' }), appt({ time: '09:10', status: 'cancelled' })])).toBe(15)
  })
  it('counts the slots in a doctor’s day, less the time they are not there', () => {
    expect(capacityFor(MON, 'Dr. R. Ramachandran', SETTINGS, [], 30)).toBe(16)
    expect(capacityFor(MON, 'Dr. R. Ramachandran', SETTINGS, [change({ kind: 'late', detail: 'Seeing patients from 11 AM' })], 30)).toBe(12)
    expect(capacityFor(MON, 'Dr. R. Ramachandran', SETTINGS, [change({})], 30)).toBe(0)
    expect(capacityFor(TUE, 'Dr. R. Ramachandran', SETTINGS, [], 30)).toBe(0)
    // Unreadable hours: the fallback 8 to 8.
    expect(capacityFor(MON, 'Dr. R. Ramachandran', null, [], 30)).toBe(24)
  })
  it('sets booked against capacity for each doctor, leaving cancelled ones out', () => {
    const appts = [appt({ time: '09:00' }), appt({ time: '09:30' }), appt({ time: '10:00', status: 'cancelled' }), appt({ doctor: 'Dr. S. Meenakshi', department: 'ENT' })]
    const known = knownDoctors(appts, [{ doctor: 'Dr. K. Arvind', department: 'Orthopaedics' }], [])
    const loads = doctorLoads([MON], appts, known, SETTINGS, [change({ doctor: 'Dr. K. Arvind', department: 'Orthopaedics' })], 30)
    const by = Object.fromEntries(loads.map((l) => [l.doctor, l]))
    expect(by['Dr. R. Ramachandran']).toMatchObject({ booked: 2, capacity: 16 })
    expect(by['Dr. S. Meenakshi']).toMatchObject({ booked: 1, capacity: 16 })
    expect(by['Dr. K. Arvind']).toMatchObject({ booked: 0, capacity: 0 })
    expect(by['Dr. K. Arvind'].note?.kind).toBe('away')
  })
  it('counts statuses and the agents’ bookings', () => {
    const c = countStatuses([
      appt({ status: 'pending', checkReason: 'Unsure of the date.' }),
      appt({ status: 'confirmed' }),
      appt({ status: 'cancelled', bookedBy: 'staff', agentName: null }),
      appt(),
      appt({ status: 'completed', source: 'manual', bookedBy: 'staff' }),
      appt({ status: 'no_show' }),
      appt({ status: 'rescheduled' }),
    ])
    expect(c).toEqual({ needsCheck: 1, pending: 2, confirmed: 1, rescheduled: 1, completed: 1, noShow: 1, cancelled: 1, declined: 0, byAgent: 5, total: 7 })
  })
})

describe('the day by doctor', () => {
  it('has a column for every doctor we know of: the bookings’ and the desk’s list', () => {
    const appts = [appt(), appt({ doctor: 'Dr. S. Meenakshi', department: 'ENT' })]
    const known = knownDoctors(appts, [{ doctor: 'dr k arvind', department: 'Orthopaedics' }, { doctor: 'Dr. R. Ramachandran', department: 'Cardiology' }], [change({ doctor: 'Dr. P. Lakshmi', department: 'Paediatrics' })])
    expect(known.map((d) => d.doctor)).toEqual(['dr k arvind', 'Dr. P. Lakshmi', 'Dr. R. Ramachandran', 'Dr. S. Meenakshi'])
    const cols = doctorColumns(MON, appts, known, [change({})], 30)
    expect(cols).toHaveLength(4)
    expect(cols.find((c) => c.doctor === 'Dr. R. Ramachandran')).toMatchObject({ note: { kind: 'away' } })
    expect(cols.find((c) => c.doctor === 'dr k arvind')?.appts).toHaveLength(0)
    // Only those with a booking or a note; or one doctor, or one department.
    expect(doctorColumns(MON, appts, known, [change({})], 30).filter((c) => c.appts.length || c.note).map((c) => c.doctor)).toEqual(['Dr. R. Ramachandran', 'Dr. S. Meenakshi'])
    expect(doctorColumns(MON, appts, known, [], 30, { doctor: 'Dr. S. Meenakshi' }).map((c) => c.doctor)).toEqual(['Dr. S. Meenakshi'])
    expect(doctorColumns(MON, appts, known, [], 30, { department: 'ENT' }).map((c) => c.doctor)).toEqual(['Dr. S. Meenakshi'])
  })
  it('puts overlapping bookings side by side and others in the full column', () => {
    const a = appt({ time: '09:00' })
    const b = appt({ time: '09:00' })
    const c = appt({ time: '09:15' })
    const d = appt({ time: '11:00' })
    const placed = layoutColumn([d, c, b, a], 30)
    const by = (x: Appointment) => placed.find((p) => p.appt === x)!
    expect([by(a).lane, by(b).lane, by(c).lane].sort()).toEqual([0, 1, 2])
    expect(by(a).lanes).toBe(3)
    expect(by(d)).toMatchObject({ lane: 0, lanes: 1, start: 660, end: 690 })
  })
})

describe('problems', () => {
  it('flags a double booking on both bookings, not a booking back to back', () => {
    const a = appt({ time: '12:00', status: 'confirmed' })
    const b = appt({ time: '12:15', status: 'confirmed' })
    const c = appt({ time: '12:30', status: 'confirmed' })
    const other = appt({ time: '12:00', doctor: 'Dr. S. Meenakshi', status: 'confirmed' })
    const m = findProblems([a, b, c, other], ctx())
    expect(kinds(m, a.id)).toEqual(['double_booked'])
    expect(kinds(m, b.id)).toEqual(['double_booked'])
    expect(m.get(b.id)![0].text).toMatch(/overlaps/i)
    // 12:30 follows the 12:00 booking (30 minutes) but 12:15 overlaps it.
    expect(kinds(m, c.id)).toEqual(['double_booked'])
    expect(m.has(other.id)).toBe(false)
  })
  it('treats the agent’s requests for one time as a contest, not a clash, and flags a request for a time already given', () => {
    const r1 = appt({ time: '10:00' })
    const r2 = appt({ time: '10:00' })
    const given = appt({ time: '11:00', status: 'confirmed' })
    const late = appt({ time: '11:00' })
    const m = findProblems([r1, r2, given, late], ctx())
    for (const x of [r1, r2, given]) expect(m.get(x.id)?.map((p) => p.kind) ?? []).not.toContain('double_booked')
    expect(kinds(m, late.id)).toEqual(['double_booked'])
  })
  it('flags outside hours and a closed day (a holiday or a closed weekday), only when the hours are known', () => {
    const early = appt({ time: '08:00' })
    const late = appt({ time: '17:00' })
    const holiday = appt({ date: TUE, time: '10:00' })
    const sunday = appt({ date: SUN, time: '10:00' })
    const fine = appt({ time: '12:00' })
    const m = findProblems([early, late, holiday, sunday, fine], ctx({ now: NOW - 864e5 * 3 }))
    expect(kinds(m, early.id)).toEqual(['outside_hours'])
    expect(kinds(m, late.id)).toEqual(['outside_hours'])
    expect(kinds(m, holiday.id)).toEqual(['closed_day'])
    expect(m.get(holiday.id)![0].text).toMatch(/Deepavali/)
    expect(kinds(m, sunday.id)).toEqual(['closed_day'])
    expect(m.has(fine.id)).toBe(false)
    const blind = findProblems([early, holiday], ctx({ settings: null, now: NOW - 864e5 * 3 }))
    expect(blind.size).toBe(0)
  })
  it('flags a doctor away, or late at that time but not after they arrive', () => {
    const early = appt({ time: '10:00', date: TUE })
    const after = appt({ time: '12:00', date: TUE })
    const away = appt({ time: '12:00' })
    const c = [change({ date: TUE, kind: 'late', detail: 'Seeing patients from 11 AM' })]
    const m = findProblems([early, after], ctx({ settings: { ...SETTINGS, closed: [] }, changes: c }))
    expect(kinds(m, early.id)).toContain('doctor_late')
    expect(m.has(after.id)).toBe(false)
    const m2 = findProblems([away], ctx({ changes: [change({})] }))
    expect(kinds(m2, away.id)).toEqual(['doctor_away'])
    // A "late" with no time in it can't be tested against a booking.
    expect(findProblems([early], ctx({ settings: { ...SETTINGS, closed: [] }, changes: [change({ date: TUE, kind: 'late', detail: 'Delayed.' })] })).size).toBe(0)
    // Moved is for information only.
    expect(findProblems([away], ctx({ changes: [change({ kind: 'moved', detail: 'Room 4' })] })).size).toBe(0)
  })
  it('flags a past booking that was never confirmed, or never marked, and leaves settled ones alone', () => {
    const past = appt({ time: '09:00', status: 'pending' })
    const pastConfirmed = appt({ time: '09:30', status: 'confirmed' })
    const yesterday = appt({ date: '2026-10-25', time: '09:00', status: 'pending' })
    const later = appt({ time: '15:00', status: 'pending' })
    const done = appt({ time: '09:00', doctor: 'Dr. Z', status: 'completed' })
    const missed = appt({ time: '09:15', doctor: 'Dr. Y', status: 'no_show' })
    const m = findProblems([past, pastConfirmed, yesterday, later, done, missed], ctx({ settings: null }))
    expect(kinds(m, past.id)).toEqual(['past_unconfirmed'])
    expect(kinds(m, yesterday.id)).toEqual(['past_unconfirmed'])
    expect(m.get(pastConfirmed.id)?.[0].text).toMatch(/mark it completed or a no-show/i)
    expect(m.has(later.id)).toBe(false)
    expect(m.has(done.id)).toBe(false)
    expect(m.has(missed.id)).toBe(false)
  })
  it('flags the same patient twice in a day, by phone (or by name when the phone is hidden), and not when nobody can tell', () => {
    const a = appt({ phone: '9800011111', time: '15:00', doctor: 'Dr. A' })
    const b = appt({ phone: '98000 11111', time: '16:00', doctor: 'Dr. B' })
    const c = appt({ phone: '9800022222', time: '15:00', doctor: 'Dr. C' })
    const m = findProblems([a, b, c], ctx())
    expect(kinds(m, a.id)).toEqual(['same_patient_twice'])
    expect(m.get(a.id)![0].text).toMatch(/4:00 pm with Dr\. B/)
    expect(m.has(c.id)).toBe(false)
    const byName = [appt({ patientName: 'Selvi M', phone: 'XXXXX 1', time: '15:00', doctor: 'Dr. A' }), appt({ patientName: 'selvi m', phone: 'XXXXX 2', time: '16:00', doctor: 'Dr. B' })]
    expect(findProblems(byName, ctx({ identity: (x) => patientIdentity(x, { phone: false, name: true }) })).size).toBe(2)
    expect(findProblems(byName, ctx({ identity: (x) => patientIdentity(x, { phone: false, name: false }) })).size).toBe(0)
  })
  it('flags a doctor missing from the knowledge library only when that list was read and has doctors', () => {
    const a = appt({ doctor: 'Dr. Unknown', time: '15:00' })
    const known = appt({ doctor: 'dr r ramachandran', time: '15:00' })
    const library = [{ doctor: 'Dr. R. Ramachandran', department: 'Cardiology' }]
    const m = findProblems([a, known], ctx({ library }))
    expect(kinds(m, a.id)).toEqual(['unknown_doctor'])
    expect(m.has(known.id)).toBe(false)
    expect(findProblems([a], ctx({ library: null })).size).toBe(0)
    expect(findProblems([a], ctx({ library: [] })).size).toBe(0)
  })
  it('never reports a cancelled booking, nor lets it cause a clash', () => {
    const a = appt({ time: '09:00' })
    const gone = appt({ time: '09:00', status: 'cancelled', date: TUE })
    const gone2 = appt({ time: '09:00', status: 'cancelled' })
    const m = findProblems([a, gone, gone2], ctx())
    expect(m.has(gone.id)).toBe(false)
    expect(m.has(gone2.id)).toBe(false)
    expect(kinds(m, a.id)).not.toContain('double_booked')
  })
  it('warns about a time someone is about to pick, ignoring the booking being moved', () => {
    const mine = appt({ time: '11:00' })
    const other = appt({ time: '15:00' })
    const k = (date: string, time: string) => proposalProblems({ date, time, doctor: mine.doctor }, [other], ctx()).map((p) => p.kind)
    expect(k(MON, '10:00')).toContain('in_the_past')
    expect(k(MON, '15:15')).toEqual(['double_booked'])
    expect(k(MON, '16:00')).toEqual([])
    expect(k('2026-10-25', '12:00')).toContain('in_the_past')
    expect(k(SUN, '12:00')).toContain('closed_day')
    expect(k('2026-10-28', '07:00')).toContain('outside_hours')
  })
})

describe('free slots', () => {
  it('suggests the next free times: not past, not booked, not closed, not while the doctor is away', () => {
    const booked = [appt({ time: '11:00' }), appt({ time: '11:30' })]
    const free = suggestSlots({ doctor: 'Dr. R. Ramachandran', from: MON, others: booked, ctx: ctx() })
    // It is 10:40 on Monday: 11:00 and 11:30 are taken, so 12:00 is the first free time today.
    expect(free).toHaveLength(6)
    expect(free[0]).toEqual({ date: MON, time: '12:00' })
    expect(free.every((f) => f.date > MON || f.time > '10:40')).toBe(true)
    expect(free.some((f) => f.time === '11:00' && f.date === MON)).toBe(false)
    // Tuesday is a holiday: nothing from it. Sunday is closed too.
    expect(free.some((f) => f.date === TUE)).toBe(false)
    const week = suggestSlots({ doctor: 'Dr. R. Ramachandran', from: MON, days: 7, count: 500, others: [], ctx: ctx() })
    expect(week.some((f) => f.date === SUN || f.date === TUE)).toBe(false)
    expect(week.some((f) => f.date === '2026-10-28')).toBe(true)
  })
  it('skips an away day and the hours before a late doctor arrives, and uses the slot length', () => {
    const c = ctx({ slot: 20, changes: [change({ date: '2026-10-28', kind: 'away' }), change({ id: 'c2', date: '2026-10-29', kind: 'late', detail: 'Seeing patients from 11 AM' })] })
    const week = suggestSlots({ doctor: 'Dr. R. Ramachandran', from: '2026-10-28', days: 3, count: 500, others: [], ctx: c })
    expect(week.some((f) => f.date === '2026-10-28')).toBe(false)
    expect(week.find((f) => f.date === '2026-10-29')?.time).toBe('11:00')
    expect(week.filter((f) => f.date === '2026-10-29').slice(0, 3).map((f) => f.time)).toEqual(['11:00', '11:20', '11:40'])
  })
  it('takes the first six by default, from a date given, and avoids another doctor’s booking not at all', () => {
    const other = appt({ doctor: 'Dr. S. Meenakshi', time: '09:00', date: '2026-10-28' })
    const free = suggestSlots({ doctor: 'Dr. R. Ramachandran', from: '2026-10-28', others: [other], ctx: ctx() })
    expect(free).toHaveLength(6)
    expect(free[0]).toEqual({ date: '2026-10-28', time: '09:00' })
  })
})

describe('filters', () => {
  const a = appt({ patientName: 'Selvi Murugan', phone: '98400 12345', doctor: 'Dr. K. Arvind', department: 'Orthopaedics', status: 'confirmed', bookedBy: 'staff', agentName: null })
  const b = appt({ patientName: 'Gopal K', doctor: 'Dr. S. Meenakshi', department: 'ENT' })
  const problems = new Map([[b.id, [{ kind: 'double_booked' as const, text: 'x', tone: 'danger' as const }]]])
  it('filters by doctor, department, status, who booked and problems', () => {
    const run = (f: Partial<typeof NO_FILTERS>) => applyFilters([a, b], { ...NO_FILTERS, ...f }, problems, SEES).map((x) => x.id)
    expect(run({})).toEqual([a.id, b.id])
    expect(run({ doctor: 'dr k arvind' })).toEqual([a.id])
    expect(run({ department: 'ENT' })).toEqual([b.id])
    expect(run({ status: 'confirmed' })).toEqual([a.id])
    expect(run({ by: 'ai_call' })).toEqual([b.id])
    expect(run({ by: 'front_desk' })).toEqual([a.id])
    expect(run({ problemsOnly: true })).toEqual([b.id])
    expect(run({ doctor: 'Dr. K. Arvind', problemsOnly: true })).toEqual([])
  })
  it('searches the patient, phone and doctor, but only what this person may see', () => {
    const run = (text: string, sees = SEES) => applyFilters([a, b], { ...NO_FILTERS, text }, problems, sees).map((x) => x.id)
    expect(run('selvi')).toEqual([a.id])
    expect(run('84001')).toEqual([a.id])
    expect(run('meenakshi')).toEqual([b.id])
    expect(run('selvi', { phone: false, name: false })).toEqual([])
    expect(run('84001', { phone: false, name: true })).toEqual([])
    expect(run('arvind', { phone: false, name: false })).toEqual([a.id])
  })
})

describe('ranges', () => {
  it('loads a week back to a month ahead, and moves the window for days outside it', () => {
    expect(baseWindow(MON)).toEqual({ from: '2026-10-19', to: '2026-11-25' })
    expect(loadWindow(MON, [TUE])).toEqual(baseWindow(MON))
    const far = loadWindow(MON, ['2027-02-10'])
    expect(far).toEqual({ from: '2027-02-03', to: '2027-03-12' })
    const old = loadWindow(MON, ['2026-08-01'])
    expect(old.from < '2026-08-01' && old.to > '2026-08-01').toBe(true)
    // Never more than the API's 62 days.
    for (const w of [far, old, baseWindow(MON)]) expect((Date.parse(w.to) - Date.parse(w.from)) / 864e5).toBeLessThanOrEqual(62)
  })
  it('shows a day, a Monday-to-Sunday week, or everything loaded', () => {
    expect(viewDates('day', TUE, 'week', MON)).toEqual([TUE])
    expect(viewDates('week', SUN, 'week', MON)).toEqual([MON, TUE, '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', SUN])
    expect(viewDates('list', TUE, 'day', MON)).toEqual([TUE])
    expect(viewDates('list', TUE, 'week', MON)).toHaveLength(7)
    const all = viewDates('list', TUE, 'all', MON)
    expect(all[0]).toBe('2026-10-19')
    expect(all[all.length - 1]).toBe('2026-11-25')
  })
})

describe('arrow keys between blocks', () => {
  const items = [
    { id: 'a1', col: 0, start: 540 },
    { id: 'a2', col: 0, start: 600 },
    { id: 'b1', col: 1, start: 570 },
    { id: 'c1', col: 3, start: 660 },
  ]
  it('moves down and up a column, and across to the nearest column by time', () => {
    expect(neighbour(items, 'a1', 'ArrowDown')).toBe('a2')
    expect(neighbour(items, 'a2', 'ArrowDown')).toBeNull()
    expect(neighbour(items, 'a2', 'ArrowUp')).toBe('a1')
    expect(neighbour(items, 'a2', 'ArrowRight')).toBe('b1')
    // Column 2 has none: it skips to column 3.
    expect(neighbour(items, 'b1', 'ArrowRight')).toBe('c1')
    expect(neighbour(items, 'c1', 'ArrowRight')).toBeNull()
    expect(neighbour(items, 'c1', 'ArrowLeft')).toBe('b1')
    expect(neighbour(items, 'a1', 'End')).toBe('a2')
    expect(neighbour(items, 'a2', 'Home')).toBe('a1')
    expect(neighbour(items, 'zzz', 'ArrowUp')).toBeNull()
  })
})

describe('the day sheet', () => {
  const a = appt({ patientName: 'Selvi M', phone: '+91 98400 12345', doctor: 'Dr. B', time: '10:00', status: 'confirmed', note: 'Bring "old" scans, please' })
  const b = appt({ patientName: '=cmd|calc', time: '09:00', doctor: 'Dr. A' })
  it('is in time order, with the phone only for those who may see it, and the patient as they may see them', () => {
    const full = daySheet([a, b], SEES).split('\n')
    expect(full[0]).toBe('Appointment,Date,Time,Doctor,Department,Patient,Phone,Type,Reason for visit,Status,Booked through,Notes')
    expect(full[1]).toMatch(new RegExp(`^${b.id},2026-10-26,09:00,Dr\\. A,Cardiology,'=cmd\\|calc,`))
    expect(full[2]).toBe(`${a.id},2026-10-26,10:00,Dr. B,Cardiology,Selvi M,'+91 98400 12345,,,Confirmed,AI call,"Bring ""old"" scans, please"`)
    const limited = daySheet([a, b], { phone: false, name: false })
    expect(limited).not.toMatch(/98400/)
    expect(limited).not.toMatch(/Selvi/)
    expect(limited.split('\n')[0]).toBe('Appointment,Date,Time,Doctor,Department,Patient,Type,Reason for visit,Status,Booked through,Notes')
    expect(limited.split('\n')[2]).toContain('A patient')
  })
  it('quotes cells and defuses formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('+1 2')).toBe("'+1 2")
    expect(csvCell('plain')).toBe('plain')
  })
})

describe('undo', () => {
  it('gives one exact "undo" change that puts a booking back', () => {
    const before = appt({ status: 'pending', time: '10:00', note: 'old' })
    const moved = { ...before, status: 'rescheduled' as const, time: '11:00', doctor: 'Dr. B', department: 'ENT', note: undefined }
    expect(undoPatches(before, moved)).toEqual([{ undo: true, status: 'pending', time: '10:00', doctor: before.doctor, department: 'Cardiology', note: 'old' }])
    expect(undoPatches(before, { ...before, status: 'confirmed' })).toEqual([{ undo: true, status: 'pending' }])
    expect(undoPatches({ ...before, status: 'confirmed' }, { ...before, status: 'cancelled' })).toEqual([{ undo: true, status: 'confirmed' }])
    expect(undoPatches({ ...before, status: 'confirmed' }, { ...before, status: 'completed' })).toEqual([{ undo: true, status: 'confirmed' }])
    expect(undoPatches(before, before)).toBeNull()
  })
})

describe('remembering the view', () => {
  it('remembers per person, and copes with storage being off', () => {
    expect(readView('u1')).toBeNull()
    saveView('u1', 'week')
    expect(readView('u1')).toBe('week')
    expect(readView('u2')).toBeNull()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readView('u1')).toBeNull()
    expect(() => saveView('u1', 'list')).not.toThrow()
  })
  it('knows a doctor’s note for a day', () => {
    expect(doctorNote('dr. r. ramachandran', MON, [change({})])?.until).toBe(1440)
    expect(doctorNote('Dr. R. Ramachandran', TUE, [change({})])).toBeNull()
  })
})
