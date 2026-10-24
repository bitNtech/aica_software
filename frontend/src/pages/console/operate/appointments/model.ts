import { isOpen, needsCheck } from '../../../../console/appointmentRecords'
import { awaitsReview, nowKey, startsAt } from '../../../../console/appointmentRecords'
import type { Appointment, AppointmentPatch, AppointmentStatus, AppointmentType, BookingSettings, BookingSource, DoctorChange, OrgSettings, PatientUpdate, PriorityLevel } from '../../../../console/types'

/**
 * Appointments, worked out: dates and times, a doctor's day, how full it is,
 * what is wrong with a booking, which slots are free, and the day sheet.
 * Everything here is a pure function of what the API returns (appointments,
 * the organisation's hours and closed days, the Bot desk's doctor changes
 * and doctor list), so the page only draws it. Nothing here reads fields the
 * live API doesn't send.
 */

export const APPT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  rescheduled: 'Rescheduled',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  declined: 'Declined',
}
export const SOURCE_LABEL: Record<BookingSource, string> = { ai_call: 'AI call', front_desk: 'Front desk', manual: 'Entered by hand' }
export const TYPE_LABEL: Record<AppointmentType, string> = { new_visit: 'New visit', follow_up: 'Follow-up', procedure: 'Procedure', test: 'Test or scan' }
/** How it was booked, for records from before the source was kept. */
export const sourceOf = (a: Appointment): BookingSource => a.source ?? (a.bookedBy === 'agent' ? 'ai_call' : 'front_desk')
export { awaitsReview, isOpen, needsCheck }

/** The entry for `key`, made if it isn't there yet. */
function group<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let v = map.get(key)
  if (v === undefined) {
    v = make()
    map.set(key, v)
  }
  return v
}

/** Cancelled bookings and declined requests are out of play: they take no time, cause no clash and need no check. */
export const isActive = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'declined'

/* ------------------------------------------------------------ dates and times */

const pad = (n: number) => String(n).padStart(2, '0')
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A yyyy-mm-dd day as a Date at midday (so a daylight-saving change can't move the day). */
export function parseDay(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}
export const dayString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function addDays(date: string, n: number): string {
  const d = parseDay(date)
  d.setDate(d.getDate() + n)
  return dayString(d)
}
/** 0 for Monday … 6 for Sunday: the order the organisation's hours are in. */
export const weekdayIndex = (date: string) => (parseDay(date).getDay() + 6) % 7
export const weekdayName = (date: string) => WEEKDAYS[weekdayIndex(date)]
export const mondayOf = (date: string) => addDays(date, -weekdayIndex(date))
export const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 864e5)
export const dateList = (from: string, count: number) => Array.from({ length: Math.max(0, count) }, (_, i) => addDays(from, i))

/** "09:30" as minutes since midnight. */
export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}
export const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`

/** "16:30" as "4:30 pm", "08:00" as "8:00 am". */
export function time12(t: string): string {
  const m = toMin(t)
  const h = Math.floor(m / 60) % 24
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'am' : 'pm'}`
}
/** An hour mark for the time rail: "9 am", "12 pm". */
export function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`
}

/** "Today", "Tomorrow", "Yesterday" or "Thu 16 Oct". */
export function dayName(date: string, today: string): string {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  return shortDay(date)
}
/** "Thu 16 Oct". */
export function shortDay(date: string): string {
  const d = parseDay(date)
  return `${WEEKDAYS[weekdayIndex(date)].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}
/** "Thursday 16 October". */
export function longDay(date: string): string {
  const d = parseDay(date)
  return `${weekdayName(date)} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}
/** "16 Oct". */
export function dayMonth(date: string): string {
  const d = parseDay(date)
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}

/** The minutes since midnight and the day, for a moment, in the browser's local time (the hospital's). */
export function clockOf(now: number): { date: string; minutes: number } {
  const d = new Date(now)
  return { date: dayString(d), minutes: d.getHours() * 60 + d.getMinutes() }
}

/** The booking's start as a comparable number: its date then time. */
export const startKey = (a: Pick<Appointment, 'date' | 'time'>) => `${a.date} ${a.time}`
export const byStart = (a: Appointment, b: Appointment) => startKey(a).localeCompare(startKey(b)) || a.doctor.localeCompare(b.doctor) || a.id.localeCompare(b.id)

/* ------------------------------------------------------------ hours and closed days */

/** Used when the organisation's hours can't be read (the page is open to people without Organisation settings). */
export const FALLBACK_HOURS = { from: 8 * 60, to: 20 * 60 }

export interface Hours {
  /** False on a closed day, whatever the hours say. */
  open: boolean
  from: number
  to: number
  /** False when the hours are the fallback, because settings couldn't be read. */
  known: boolean
  /** Why it is closed: a holiday's name, or "Closed on Sundays". */
  reason?: string
}

export function hoursFor(date: string, settings: OrgSettings | null): Hours {
  if (!settings) return { open: true, ...FALLBACK_HOURS, known: false }
  const holiday = settings.closed.find((c) => c.date === date)
  const day = settings.hours[weekdayIndex(date)]
  const from = day?.open ? toMin(day.from) : FALLBACK_HOURS.from
  const to = day?.open ? toMin(day.to) : FALLBACK_HOURS.to
  if (holiday) return { open: false, from, to, known: true, reason: holiday.label }
  if (!day?.open) return { open: false, from, to, known: true, reason: `Closed on ${weekdayName(date)}s` }
  return { open: true, from, to, known: true }
}

/* ------------------------------------------------------------ doctors */

/** A name compared loosely: "Dr. R. Ramachandran" and "dr r ramachandran" are one doctor. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export interface DoctorInfo {
  doctor: string
  department: string
}

/** Every doctor we can name: the Bot desk's list (the knowledge library), then anyone with a booking or a change. */
export function knownDoctors(appts: Appointment[], library: DoctorInfo[] | null, changes: DoctorChange[]): DoctorInfo[] {
  const seen = new Map<string, DoctorInfo>()
  const add = (doctor: string, department: string) => {
    const k = norm(doctor)
    if (k && !seen.has(k)) seen.set(k, { doctor, department })
  }
  for (const d of library ?? []) add(d.doctor, d.department)
  for (const a of appts) add(a.doctor, a.department)
  for (const c of changes) add(c.doctor, c.department)
  return [...seen.values()].sort((a, b) => a.doctor.localeCompare(b.doctor, 'en-IN', { numeric: true }))
}

/** "R. Ramachandran" → "RR": the letters on a doctor's marker. */
export function initials(doctor: string): string {
  const words = doctor.split(/\s+/).filter((w) => w && !/^dr\.?$/i.test(w))
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
/** "Dr. R. Ramachandran" → "Ramachandran". */
export const doctorShort = (doctor: string) => doctor.trim().split(/\s+/).pop() ?? doctor

/** A hue for each doctor, stable while the list of doctors is. Never the only sign: initials and names go with it. */
const HUES = [18, 218, 150, 282, 42, 336, 190, 100]
export function hueFor(doctor: string, known: DoctorInfo[]): number {
  const i = known.findIndex((d) => norm(d.doctor) === norm(doctor))
  return HUES[(i < 0 ? 0 : i) % HUES.length]
}

/** What the Bot desk says about a doctor on a day. */
export interface DoctorNote {
  kind: DoctorChange['kind']
  detail: string
  /** Minutes since midnight until which they are not seeing patients (1440: all day). 0 when it can't be told. */
  until: number
}

/** "Seeing patients from 11 AM": the time in free text, as minutes, or null. */
export function parseClock(text: string): number | null {
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i.exec(text)
  if (ampm) {
    const h = Number(ampm[1])
    if (h < 1 || h > 12) return null
    const pm = ampm[3].toLowerCase().startsWith('p')
    return ((h % 12) + (pm ? 12 : 0)) * 60 + Number(ampm[2] ?? 0)
  }
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
  return h24 ? Number(h24[1]) * 60 + Number(h24[2]) : null
}

/** The doctor's change for `date`, if any. Away is the whole day; late runs until the time in its words (if it has one). */
export function doctorNote(doctor: string, date: string, changes: DoctorChange[]): DoctorNote | null {
  const c = changes.find((x) => x.date === date && norm(x.doctor) === norm(doctor))
  if (!c) return null
  if (c.kind === 'away') return { kind: 'away', detail: c.detail, until: 24 * 60 }
  if (c.kind === 'late') return { kind: 'late', detail: c.detail, until: parseClock(c.detail) ?? 0 }
  return { kind: 'moved', detail: c.detail, until: 0 }
}

/** Whether the doctor is not seeing patients at that minute. */
export const unavailableAt = (note: DoctorNote | null, minutes: number) => !!note && (note.kind === 'away' || (note.kind === 'late' && minutes < note.until))

/** The words for a doctor's note: "Away", "Late: from 11 AM", "Moved: In OPD room 4". */
export const noteLabel = (n: DoctorNote) => `${n.kind === 'away' ? 'Away' : n.kind === 'late' ? 'Late' : 'Moved'}: ${n.detail}`

/* ------------------------------------------------------------ slot length and capacity */

const SLOT_CHOICES = [10, 15, 20, 30, 45, 60]
export const DEFAULT_SLOT = 15

/**
 * How long one appointment takes, read off the bookings: the smallest gap
 * between two different start times for the same doctor on a day, rounded
 * down to a usual length (10, 15, 20, 30, 45 or 60 minutes). With no such
 * pair there is nothing to go on, so 15.
 */
export function inferSlotLength(appts: Appointment[]): number {
  const perDay = new Map<string, Set<number>>()
  for (const a of appts) {
    if (!isActive(a)) continue
    const k = `${norm(a.doctor)}|${a.date}`
    group(perDay, k, () => new Set<number>()).add(toMin(a.time))
  }
  let min = Infinity
  for (const starts of perDay.values()) {
    const sorted = [...starts].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) min = Math.min(min, sorted[i] - sorted[i - 1])
  }
  if (!Number.isFinite(min)) return DEFAULT_SLOT
  return [...SLOT_CHOICES].reverse().find((c) => c <= min) ?? SLOT_CHOICES[0]
}

/** What the day's grid covers: the opening hours, widened to the hour for any booking outside them. */
export interface GridWindow extends Hours {
  /** Where the grid starts and ends (minutes), always on the hour. */
  gridFrom: number
  gridTo: number
  /** A booking sits outside the opening hours, so the grid is wider than them. */
  widened: boolean
}
export function gridWindow(date: string, settings: OrgSettings | null, dayAppts: Appointment[], slot: number): GridWindow {
  const h = hoursFor(date, settings)
  let from = Math.floor(h.from / 60) * 60
  let to = Math.ceil(h.to / 60) * 60
  const base = { from, to }
  for (const a of dayAppts) {
    const s = toMin(a.time)
    from = Math.min(from, Math.floor(s / 60) * 60)
    to = Math.max(to, Math.min(24 * 60, Math.ceil((s + slot) / 60) * 60))
  }
  return { ...h, gridFrom: from, gridTo: to, widened: from !== base.from || to !== base.to }
}

/** How many appointments fit in one doctor's day: the open hours over the slot length, less the time they aren't there. */
export function capacityFor(date: string, doctor: string, settings: OrgSettings | null, changes: DoctorChange[], slot: number): number {
  const h = hoursFor(date, settings)
  if (!h.open) return 0
  const note = doctorNote(doctor, date, changes)
  const start = note?.kind === 'away' ? h.to : note?.kind === 'late' ? Math.min(h.to, Math.max(h.from, note.until)) : h.from
  return Math.max(0, Math.floor((h.to - start) / slot))
}

export interface DoctorLoad {
  doctor: string
  department: string
  booked: number
  capacity: number
  /** The capacity rests on the fallback hours, because the real ones couldn't be read. */
  approximate: boolean
  note: DoctorNote | null
}

/** Booked against capacity for each doctor over `dates` (one day, a week, a range). Cancelled bookings don't count as booked. */
export function doctorLoads(dates: string[], appts: Appointment[], known: DoctorInfo[], settings: OrgSettings | null, changes: DoctorChange[], slot: number): DoctorLoad[] {
  const set = new Set(dates)
  return known
    .map((d) => {
      const mine = appts.filter((a) => set.has(a.date) && isActive(a) && norm(a.doctor) === norm(d.doctor))
      return {
        doctor: d.doctor,
        department: d.department,
        booked: mine.length,
        capacity: dates.reduce((n, date) => n + capacityFor(date, d.doctor, settings, changes, slot), 0),
        approximate: !settings,
        // The note is only meaningful for a single day.
        note: dates.length === 1 ? doctorNote(d.doctor, dates[0], changes) : null,
      }
    })
    .filter((l) => l.booked > 0 || l.capacity > 0 || l.note)
}

export interface Counts {
  needsCheck: number
  pending: number
  confirmed: number
  rescheduled: number
  completed: number
  noShow: number
  cancelled: number
  declined: number
  byAgent: number
  total: number
}
export function countStatuses(appts: Appointment[]): Counts {
  const c: Counts = { needsCheck: 0, pending: 0, confirmed: 0, rescheduled: 0, completed: 0, noShow: 0, cancelled: 0, declined: 0, byAgent: 0, total: appts.length }
  for (const a of appts) {
    if (needsCheck(a)) c.needsCheck++
    if (a.status === 'pending') c.pending++
    if (a.status === 'confirmed') c.confirmed++
    if (a.status === 'rescheduled') c.rescheduled++
    if (a.status === 'completed') c.completed++
    if (a.status === 'no_show') c.noShow++
    if (a.status === 'cancelled') c.cancelled++
    if (a.status === 'declined') c.declined++
    if (sourceOf(a) === 'ai_call') c.byAgent++
  }
  return c
}

/* ------------------------------------------------------------ the day by doctor */

export interface Placed {
  appt: Appointment
  start: number
  end: number
  /** 0-based side-by-side position among bookings that overlap, and how many there are. */
  lane: number
  lanes: number
}

/**
 * Positions one doctor's bookings in a column: overlapping ones share it
 * side by side, except the agent's requests for the same time, which take
 * one place together as a pile (best-ranked in front).
 */
export function layoutColumn(appts: Appointment[], slot: number): Placed[] {
  const units = new Map<string, Appointment[]>()
  for (const a of appts) group(units, pileOf(a) ? `pile|${a.time}` : a.id, () => []).push(a)
  const items = [...units.values()]
    .map((members) => ({ members: [...members].sort(byStartRank), start: toMin(members[0].time), end: toMin(members[0].time) + slot }))
    .sort((a, b) => a.start - b.start || a.members[0].id.localeCompare(b.members[0].id))
  const out: Placed[] = []
  let cluster: { item: (typeof items)[number]; lane: number }[] = []
  let clusterEnd = -1
  const flush = () => {
    const lanes = cluster.reduce((m, c) => Math.max(m, c.lane + 1), 1)
    for (const c of cluster) for (const appt of c.item.members) out.push({ appt, start: c.item.start, end: c.item.end, lane: c.lane, lanes })
    cluster = []
  }
  for (const item of items) {
    if (cluster.length && item.start >= clusterEnd) flush()
    const taken = new Set(cluster.filter((c) => c.item.end > item.start).map((c) => c.lane))
    let lane = 0
    while (taken.has(lane)) lane++
    cluster.push({ item, lane })
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  flush()
  return out
}

export interface DoctorColumn extends DoctorInfo {
  hue: number
  note: DoctorNote | null
  appts: Appointment[]
  placed: Placed[]
}

/**
 * One column per doctor for a day: everyone we know of (filtered by the
 * doctor and department chosen), with that day's bookings positioned and
 * the Bot desk's note, if any. `onlyBusy` leaves out doctors with nothing
 * that day (no booking, no note), for a hospital with many.
 */
export function doctorColumns(date: string, dayAppts: Appointment[], known: DoctorInfo[], changes: DoctorChange[], slot: number, opts: { doctor?: string; department?: string; onlyBusy?: boolean } = {}): DoctorColumn[] {
  return known
    .filter((d) => (!opts.doctor || norm(d.doctor) === norm(opts.doctor)) && (!opts.department || d.department === opts.department))
    .map((d) => {
      const appts = dayAppts.filter((a) => norm(a.doctor) === norm(d.doctor))
      return { ...d, hue: hueFor(d.doctor, known), note: doctorNote(d.doctor, date, changes), appts, placed: layoutColumn(appts, slot) }
    })
    .filter((c) => !opts.onlyBusy || c.appts.length > 0 || c.note)
}

/* ------------------------------------------------------------ problems */

export type ProblemKind = 'double_booked' | 'outside_hours' | 'closed_day' | 'doctor_away' | 'doctor_late' | 'in_the_past' | 'past_unconfirmed' | 'same_patient_twice' | 'unknown_doctor'

export interface Problem {
  kind: ProblemKind
  /** In plain words, for the person who has to deal with it. */
  text: string
  /** Danger: someone will turn up to no doctor, or to a closed building. */
  tone: 'warn' | 'danger'
}

/** The few words on a block or a pill. */
export const PROBLEM_SHORT: Record<ProblemKind, string> = {
  double_booked: 'Double booked',
  outside_hours: 'Outside hours',
  closed_day: 'Closed day',
  doctor_away: 'Doctor away',
  doctor_late: 'Doctor late',
  in_the_past: 'In the past',
  past_unconfirmed: 'Not marked',
  same_patient_twice: 'Twice in a day',
  unknown_doctor: 'Unknown doctor',
}

/** What the checks need to know. */
export interface Ctx {
  /** The organisation's hours and closed days, or null when this role can't read them. */
  settings: OrgSettings | null
  /** Doctor away, late or moved (the Bot desk), or none when this role can't read it. */
  changes: DoctorChange[]
  /** The doctors the agents answer from (the knowledge library, via the Bot desk), or null when it can't be read. */
  library: DoctorInfo[] | null
  now: number
  slot: number
  /** How a patient is named in a message, with their privacy respected. */
  who(a: Appointment): string
  /** What marks one patient from another, when this role can tell (phone, or name); null when it can't. */
  identity(a: Appointment): string | null
}

export interface Slot {
  date: string
  time: string
  doctor: string
}

const overlaps = (a: number, b: number, slot: number) => Math.abs(a - b) < slot

/**
 * What is wrong with a time and doctor, ignoring who the patient is: it
 * overlaps another booking with the same doctor, it is outside opening hours
 * or on a closed day, the doctor is away or late, or it is already past.
 * `others` are the other bookings (not this one).
 */
export function slotProblems(slot: Slot, others: Appointment[], ctx: Ctx): Problem[] {
  const out: Problem[] = []
  const start = toMin(slot.time)
  const clash = others.filter((o) => isActive(o) && o.date === slot.date && norm(o.doctor) === norm(slot.doctor) && overlaps(toMin(o.time), start, ctx.slot))
  if (clash.length) {
    const first = clash[0]
    out.push({
      kind: 'double_booked',
      tone: 'danger',
      text: `Overlaps ${ctx.who(first)} at ${time12(first.time)} with ${slot.doctor}${clash.length > 1 ? ` and ${clash.length - 1} more` : ''}.`,
    })
  }
  if (ctx.settings) {
    const h = hoursFor(slot.date, ctx.settings)
    if (!h.open) out.push({ kind: 'closed_day', tone: 'danger', text: `The organisation is closed that day: ${h.reason}.` })
    else if (start < h.from || start >= h.to) out.push({ kind: 'outside_hours', tone: 'warn', text: `${time12(slot.time)} is outside opening hours (${time12(fromMin(h.from))} to ${time12(fromMin(h.to))}).` })
  }
  const note = doctorNote(slot.doctor, slot.date, ctx.changes)
  if (note?.kind === 'away') out.push({ kind: 'doctor_away', tone: 'danger', text: `${slot.doctor} is away that day. ${note.detail}` })
  else if (note?.kind === 'late' && start < note.until) out.push({ kind: 'doctor_late', tone: 'warn', text: `${slot.doctor} isn't in until ${time12(fromMin(note.until))}. ${note.detail}` })
  return out
}

/** `slotProblems`, plus "that time has passed", for a time someone is about to pick. */
export function proposalProblems(slot: Slot, others: Appointment[], ctx: Ctx): Problem[] {
  const out = slotProblems(slot, others, ctx)
  const t = clockOf(ctx.now)
  if (slot.date < t.date || (slot.date === t.date && toMin(slot.time) < t.minutes)) out.push({ kind: 'in_the_past', tone: 'warn', text: 'That time has already passed.' })
  return out
}

/**
 * Everything wrong with the bookings, by appointment id (bookings with
 * nothing wrong are left out). Only pending, confirmed and rescheduled
 * bookings are checked: completed, missed and cancelled ones are settled.
 * Checked: double booking, outside hours, closed day, doctor away or late
 * at that time, past and never confirmed, the same patient twice on a day,
 * and a doctor missing from the knowledge library (only when that list was
 * readable and has doctors in it).
 */
export function findProblems(appts: Appointment[], ctx: Ctx): Map<string, Problem[]> {
  // Only bookings still to be dealt with: a completed, missed or cancelled one has nothing left to fix.
  const active = appts.filter(isOpen)
  const found = new Map<string, Problem[]>()
  const add = (id: string, p: Problem) => group(found, id, () => []).push(p)

  // Same doctor and day, together: only these can clash with each other.
  const groups = new Map<string, Appointment[]>()
  for (const a of active) group(groups, `${norm(a.doctor)}|${a.date}`, () => []).push(a)
  const t = clockOf(ctx.now)
  const libraryNames = ctx.library && ctx.library.length ? new Set(ctx.library.map((d) => norm(d.doctor))) : null

  for (const a of active) {
    // The agent's requests for a time aren't a clash with each other (they are ranked and decided), nor with a booking already given that time: the request is the one flagged.
    const mates = groups.get(`${norm(a.doctor)}|${a.date}`)!.filter((o) => o !== a && !(isRequest(o) && (isRequest(a) || a.status !== 'pending')))
    for (const p of slotProblems(a, mates, ctx)) add(a.id, p)
    if (isOpen(a) && (a.date < t.date || (a.date === t.date && toMin(a.time) < t.minutes))) {
      add(a.id, {
        kind: 'past_unconfirmed',
        tone: 'warn',
        text: a.status === 'confirmed' ? 'That time has passed: mark it completed or a no-show.' : `That time has passed and the booking was never confirmed (${APPT_STATUS_LABEL[a.status].toLowerCase()}).`,
      })
    }
    if (libraryNames && !libraryNames.has(norm(a.doctor))) {
      add(a.id, { kind: 'unknown_doctor', tone: 'warn', text: `${a.doctor} isn't in the doctor list the agents answer from.` })
    }
  }

  // The same patient twice in a day.
  const byPatient = new Map<string, Appointment[]>()
  for (const a of active) {
    const id = ctx.identity(a)
    if (!id) continue
    const k = `${id}|${a.date}`
    group(byPatient, k, () => []).push(a)
  }
  for (const list of byPatient.values()) {
    if (list.length < 2) continue
    for (const a of list) {
      const rest = list.filter((o) => o !== a).sort(byStart)
      add(a.id, { kind: 'same_patient_twice', tone: 'warn', text: `${ctx.who(a)} is booked ${list.length} times that day: also ${rest.map((o) => `${time12(o.time)} with ${o.doctor}`).join(' and ')}.` })
    }
  }
  return found
}

/* ------------------------------------------------------------ free slots */

export interface FreeSlot {
  date: string
  time: string
}

/**
 * The first free times for a doctor: every slot-length step through each
 * open day's hours, from `from` for `days` days, leaving out times that
 * have passed, closed days, the time the doctor is away or late, and
 * anything overlapping a booking. `others` are the bookings to avoid: pass
 * every booking except the one being moved.
 */
export function suggestSlots(opts: { doctor: string; from: string; days?: number; count?: number; others: Appointment[]; ctx: Ctx }): FreeSlot[] {
  const { doctor, from, others, ctx } = opts
  const days = opts.days ?? 7
  const count = opts.count ?? 6
  const now = clockOf(ctx.now)
  const out: FreeSlot[] = []
  for (const date of dateList(from, days)) {
    if (date < now.date) continue
    const h = hoursFor(date, ctx.settings)
    if (!h.open) continue
    const note = doctorNote(doctor, date, ctx.changes)
    if (note?.kind === 'away') continue
    const taken = others.filter((o) => isActive(o) && o.date === date && norm(o.doctor) === norm(doctor)).map((o) => toMin(o.time))
    for (let m = h.from; m + ctx.slot <= h.to; m += ctx.slot) {
      if (date === now.date && m <= now.minutes) continue
      if (unavailableAt(note, m)) continue
      if (taken.some((t) => overlaps(t, m, ctx.slot))) continue
      out.push({ date, time: fromMin(m) })
      if (out.length >= count) return out
    }
  }
  return out
}

/* ------------------------------------------------------------ filters */

export interface Filters {
  doctor: string
  department: string
  status: AppointmentStatus | ''
  by: '' | BookingSource
  text: string
  problemsOnly: boolean
}
export const NO_FILTERS: Filters = { doctor: '', department: '', status: '', by: '', text: '', problemsOnly: false }
export const isFiltering = (f: Filters) => f.doctor !== '' || f.department !== '' || f.status !== '' || f.by !== '' || f.text.trim() !== '' || f.problemsOnly

/** What this person may see of a patient. */
export interface Sees {
  /** The phone number: with Manage appointments. */
  phone: boolean
  /** The patient's name: with See callers' details. */
  name: boolean
}

export const patientLabel = (a: Appointment, sees: Sees) => (sees.name ? a.patientName : 'A patient')

/** The same patient, as far as this person can tell: by phone number if they may see it, else by name if they may see that. */
export function patientIdentity(a: Appointment, sees: Sees): string | null {
  const digits = a.phone.replace(/\D/g, '')
  if (sees.phone && digits.length >= 6) return `p${digits.slice(-10)}`
  if (sees.name && a.patientName.trim()) return `n${norm(a.patientName)}`
  return null
}

export function applyFilters(appts: Appointment[], f: Filters, problems: Map<string, Problem[]>, sees: Sees): Appointment[] {
  const text = f.text.trim().toLowerCase()
  const digits = text.replace(/\D/g, '')
  return appts.filter((a) => {
    if (f.doctor && norm(a.doctor) !== norm(f.doctor)) return false
    if (f.department && a.department !== f.department) return false
    if (f.status && a.status !== f.status) return false
    if (f.by && sourceOf(a) !== f.by) return false
    if (f.problemsOnly && !problems.has(a.id)) return false
    if (text) {
      const hit =
        a.doctor.toLowerCase().includes(text) ||
        a.department.toLowerCase().includes(text) ||
        (sees.name && a.patientName.toLowerCase().includes(text)) ||
        (sees.phone && digits.length >= 3 && a.phone.replace(/\D/g, '').includes(digits))
      if (!hit) return false
    }
    return true
  })
}

/* ------------------------------------------------------------ views and ranges */

/** Calendars (day by doctor, week, month) and lists (today, all, pending, changes). */
export type View = 'today' | 'day' | 'week' | 'month' | 'list' | 'pending' | 'changes'
/** `pending` is the requests to review (its key kept, so a remembered view still opens). */
export const CALENDAR_VIEWS: View[] = ['day', 'week', 'month']
export type ListScope = 'day' | 'week' | 'all'
/** Days back and ahead of today that are always loaded: a week back, a month ahead. */
export const DAYS_BACK = 7
export const DAYS_AHEAD = 30

export const baseWindow = (today: string) => ({ from: addDays(today, -DAYS_BACK), to: addDays(today, DAYS_AHEAD) })

/** The days a view shows. The list's "all" is the whole loaded range. */
export function viewDates(view: View, anchor: string, scope: ListScope, today: string): string[] {
  if (view === 'today') return [today]
  if (view === 'day' || (view === 'list' && scope === 'day')) return [anchor]
  if (view === 'week' || (view === 'list' && scope === 'week')) return dateList(mondayOf(anchor), 7)
  if (view === 'month') return monthGrid(anchor)
  const w = baseWindow(today)
  return dateList(w.from, daysBetween(w.from, w.to) + 1)
}

/**
 * What to ask the API for: a week back to a month ahead of today, unless
 * the days being looked at fall outside it, in which case a week before the
 * first of them to a month after. Never more than the API's 62 days.
 */
export function loadWindow(today: string, dates: string[]): { from: string; to: string } {
  const base = baseWindow(today)
  const first = dates[0] ?? today
  const last = dates[dates.length - 1] ?? today
  if (first >= base.from && last <= base.to) return base
  const to = addDays(first, DAYS_AHEAD)
  return { from: addDays(first, -DAYS_BACK), to: last > to ? last : to }
}

/** The month around `date`, as whole weeks: Monday before the 1st to Sunday after the last day. */
export function monthGrid(date: string): string[] {
  const first = `${date.slice(0, 7)}-01`
  const next = addMonths(first, 1)
  const start = mondayOf(first)
  const end = addDays(mondayOf(addDays(next, -1)), 6)
  return dateList(start, daysBetween(start, end) + 1)
}

/** The same day `n` months on (the 1st of the month for day 1; clamped to the month's last day). */
export function addMonths(date: string, n: number): string {
  const d = parseDay(date)
  const day = d.getDate()
  const m = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
  return dayString(new Date(m.getFullYear(), m.getMonth(), Math.min(day, last)))
}

export const monthName = (date: string) => parseDay(date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

/** How far prev/next moves: a day for the day views, a week for the week views. */
export const stepDays = (view: View, scope: ListScope) => (view === 'week' || (view === 'list' && scope !== 'day') ? 7 : 1)
/** Views that show the whole loaded range rather than days picked with Previous and Next. */
export const isRangeView = (view: View, scope: ListScope) => view === 'today' || view === 'pending' || view === 'changes' || (view === 'list' && scope === 'all')

/* ------------------------------------------------------------ keyboard */

export interface NavItem {
  id: string
  /** Which column (doctor or day) it is in. */
  col: number
  /** Minutes since midnight. */
  start: number
}
export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

/**
 * Where an arrow key goes between appointment blocks: up and down move
 * through the column by time; left and right to the nearest column that has
 * any, landing on the block closest in time; Home and End to the first and
 * last of the column. Returns null when there is nowhere to go.
 */
export function neighbour(items: NavItem[], from: string, key: NavKey): string | null {
  const cur = items.find((i) => i.id === from)
  if (!cur) return null
  const column = (c: number) => items.filter((i) => i.col === c).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  const here = column(cur.col)
  const at = here.findIndex((i) => i.id === from)
  if (key === 'ArrowUp') return here[at - 1]?.id ?? null
  if (key === 'ArrowDown') return here[at + 1]?.id ?? null
  if (key === 'Home') return here[0].id === from ? null : here[0].id
  if (key === 'End') return here[here.length - 1].id === from ? null : here[here.length - 1].id
  const dir = key === 'ArrowRight' ? 1 : -1
  const cols = [...new Set(items.map((i) => i.col))].filter((c) => (c - cur.col) * dir > 0).sort((a, b) => (a - b) * dir)
  if (cols.length === 0) return null
  const target = column(cols[0])
  return target.reduce((best, i) => (Math.abs(i.start - cur.start) < Math.abs(best.start - cur.start) ? i : best)).id
}

/* ------------------------------------------------------------ the day sheet */

/** A CSV cell, with the cautions: quoted if it needs it, and not mistaken for a formula by a spreadsheet. */
export function csvCell(v: string): string {
  let t = v
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/**
 * The front counter's sheet: date, time, doctor, patient, phone (only for
 * people who may see it), status and notes, in time order. The patient is
 * named as the person exporting may see them.
 */
export function daySheet(appts: Appointment[], sees: Sees): string {
  const head = ['Appointment', 'Date', 'Time', 'Doctor', 'Department', 'Patient', ...(sees.phone ? ['Phone'] : []), 'Type', 'Reason for visit', 'Status', 'Booked through', 'Notes']
  const rows = [...appts]
    .sort(byStart)
    .map((a) => [a.id, a.date, a.time, a.doctor, a.department, patientLabel(a, sees), ...(sees.phone ? [a.phone] : []), a.type ? TYPE_LABEL[a.type] : '', a.visitReason ?? '', APPT_STATUS_LABEL[a.status], SOURCE_LABEL[sourceOf(a)], a.note ?? ''])
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

/* ------------------------------------------------------------ remembering the view */

const VIEW_KEY = (userId: string) => `aica.appointments.view.${userId}`

export function readView(userId: string): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY(userId))
    return (['today', 'day', 'week', 'month', 'list', 'pending', 'changes'] as string[]).includes(v ?? '') ? (v as View) : null
  } catch {
    return null
  }
}
export function saveView(userId: string, view: View) {
  try {
    localStorage.setItem(VIEW_KEY(userId), view)
  } catch {
    // Storage off or full: the view just isn't remembered.
  }
}

/** Merges bookings by id, the later list winning: for a wider lookup laid over the loaded range. */
export function mergeById(...lists: Appointment[][]): Appointment[] {
  const map = new Map<string, Appointment>()
  for (const list of lists) for (const a of list) map.set(a.id, a)
  return [...map.values()].sort(byStart)
}

/* ------------------------------------------------------------ undo */

/**
 * The change that puts a booking back exactly as it was (Undo), or null
 * when nothing that can be put back differs. It is marked `undo`, so the
 * usual order of statuses doesn't stop it, and the history says so.
 */
export function undoPatches(before: Appointment, after: Appointment): AppointmentPatch[] | null {
  const patch: AppointmentPatch = { undo: true }
  if (before.status !== after.status) patch.status = before.status
  if (before.date !== after.date) patch.date = before.date
  if (before.time !== after.time) patch.time = before.time
  if (before.doctor !== after.doctor) patch.doctor = before.doctor
  if (before.department !== after.department) patch.department = before.department
  if ((before.note ?? '') !== (after.note ?? '')) patch.note = before.note ?? ''
  return Object.keys(patch).length > 1 ? [patch] : null
}

/* ------------------------------------------------------------ requests and ranking */

export const PRIORITY_LABEL: Record<PriorityLevel, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', routine: 'Routine' }
export const PRIORITY_ORDER: Record<PriorityLevel, number> = { urgent: 0, high: 1, normal: 2, routine: 3 }

/** Several requests for one doctor at one time, best-ranked first, and anything already given that time. */
export interface RequestGroup {
  key: string
  date: string
  time: string
  doctor: string
  department: string
  requests: Appointment[]
  /** A confirmed or offered booking already at that time, if any. */
  taken: Appointment | null
  /** The most pressing level among them (unranked counts as normal). */
  level: PriorityLevel
}

/** A booking the agent made that waits for the hospital to decide: only these are ranked against each other. */
export const isRequest = (a: Appointment) => a.status === 'pending' && sourceOf(a) === 'ai_call'

const reqKey = (a: Appointment) => `${norm(a.doctor)}|${a.date}|${a.time}`
const byRank = (a: Appointment, b: Appointment) => (a.rank?.position ?? 1) - (b.rank?.position ?? 1) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

/**
 * The requests waiting for a decision, grouped by doctor and time. Groups
 * with something urgent come first, then by time. `all` is every booking
 * loaded, to find a time already given to someone.
 */
export function requestGroups(requests: Appointment[], all: Appointment[], slot: number): RequestGroup[] {
  const map = new Map<string, Appointment[]>()
  for (const a of requests) if (a.status === 'pending') group(map, reqKey(a), () => []).push(a)
  const out: RequestGroup[] = []
  for (const [key, list] of map) {
    const sorted = [...list].sort(byRank)
    const first = sorted[0]
    const taken = all.find((o) => o.status !== 'pending' && isOpen(o) && o.date === first.date && norm(o.doctor) === norm(first.doctor) && Math.abs(toMin(o.time) - toMin(first.time)) < slot) ?? null
    const level = sorted.reduce<PriorityLevel>((m, a) => (a.rank && PRIORITY_ORDER[a.rank.level] < PRIORITY_ORDER[m] ? a.rank.level : m), 'normal')
    out.push({ key, date: first.date, time: first.time, doctor: first.doctor, department: first.department, requests: sorted, taken, level })
  }
  return out.sort((a, b) => PRIORITY_ORDER[a.level] - PRIORITY_ORDER[b.level] || `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || a.doctor.localeCompare(b.doctor))
}

/** The other requests for the same doctor and time, best-ranked first. */
export const rivalsOf = (a: Appointment, all: Appointment[]) => (isRequest(a) ? all.filter((o) => o.id !== a.id && isRequest(o) && reqKey(o) === reqKey(a)).sort(byRank) : [])

/** What the evening's automatic confirmation would do with the requests now: as the server will, without finding the new times. */
export function autoPreview(rows: Appointment[], s: BookingSettings, now: number): { confirm: number; others: number; left: number } {
  const nk = nowKey(now)
  const groups = requestGroups(rows.filter((a) => isRequest(a) && startsAt(a) > nk), rows, 1)
  const out = { confirm: 0, others: 0, left: 0 }
  for (const g of groups) {
    const top = g.requests[0]
    if ((s.autoSkipUrgent && top.rank?.level === 'urgent') || (s.autoSkipFlagged && top.checkReason)) out.left += g.requests.length
    else {
      out.confirm++
      out.others += g.requests.length - 1
    }
  }
  return out
}

/** Where a request sits in the pile of requests for its time (0 is the best-ranked), or null when it isn't in one. */
export interface Pile {
  index: number
  size: number
  level: PriorityLevel
}
export function pileOf(a: Appointment): Pile | null {
  return isRequest(a) && a.rank && a.rank.of > 1 ? { index: a.rank.position - 1, size: a.rank.of, level: a.rank.level } : null
}
/** By start, and within the agent's requests for one time, by rank. */
export const byStartRank = (a: Appointment, b: Appointment) =>
  startKey(a).localeCompare(startKey(b)) || a.doctor.localeCompare(b.doctor) || (pileOf(a)?.index ?? -1) - (pileOf(b)?.index ?? -1) || a.id.localeCompare(b.id)

/** Requests waiting for a decision, and flagged ones (the sidebar's and Home's count). */
export const toReview = (rows: Appointment[]) => rows.filter(awaitsReview)

export const UPDATE_CHANNEL_LABEL: Record<PatientUpdate['channel'], string> = { callback: 'Agent callback', whatsapp: 'WhatsApp message' }
export const UPDATE_ABOUT_LABEL: Record<PatientUpdate['about'], string> = { confirmed: 'Confirmation', declined: 'Request declined', moved: 'New time offered' }
export const UPDATE_STATE_LABEL: Record<PatientUpdate['state'], string> = {
  queued: 'Queued',
  in_progress: 'Calling now',
  done: 'Answered',
  no_answer: 'No answer',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
}
/** How the patient is told, in words: "the agent calls back and a WhatsApp message goes out". */
export function howTold(s: BookingSettings | null): string | null {
  if (!s) return null
  if (s.callback && s.whatsapp) return 'the agent calls the patient back and a WhatsApp message goes out'
  if (s.callback) return 'the agent calls the patient back'
  if (s.whatsapp) return 'a WhatsApp message goes to the patient'
  return null
}
