import type { ActivityEntry, Appointment, AnswerFlag, DeskLine, DoctorChange, Notice, Report, TranscriptTurn } from '../../../../console/types'
import { localDay } from '../../../../lib/time'
import { addDays, dateList, norm, shortDay, doctorNote, toMin } from '../appointments/model'
import { share, timeOfDay } from '../shared'

/**
 * The Bot desk, worked out: countdowns, which notices are showing or
 * scheduled, duplicate notices, a doctor's calendar of changes and the
 * appointments they touch, which flags to show, the part of a call a flag
 * is about, and which activity entries belong to the desk. Pure (the clock
 * is always passed in), so every rule is tested without a page.
 */

const MIN = 6e4

/* ------------------------------------------------------------ time in words */

/** "40 min", "2 h 10 min", "1 day 3 h": how long until `iso`. "now" once it has passed. */
export function remaining(iso: string, now: number): string {
  const ms = Date.parse(iso) - now
  if (!(ms > 0)) return 'now'
  const m = Math.ceil(ms / MIN)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} day${d === 1 ? '' : 's'} ${h % 24} h` : `${d} day${d === 1 ? '' : 's'}`
}

/** "today, 2:30 pm", "tomorrow, 11:59 pm", "24 Oct, 9:00 am". */
export function when(iso: string, now: number): string {
  const d = new Date(iso)
  const day = localDay(0, d.getTime())
  if (day === localDay(0, now)) return `today, ${timeOfDay(iso)}`
  if (day === localDay(1, now)) return `tomorrow, ${timeOfDay(iso)}`
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${timeOfDay(iso)}`
}

/** "until 2:30 pm", "until tomorrow, 11:59 pm", "until 24 Oct". */
export function until(iso: string, now: number): string {
  const d = new Date(iso)
  const day = localDay(0, d.getTime())
  if (day === localDay(0, now)) return `until ${timeOfDay(iso)}`
  if (day === localDay(1, now)) return `until tomorrow, ${timeOfDay(iso)}`
  return `until ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
}

/** The end of the local day `offset` days from `now`, as an ISO time (11:59 pm). */
export function endOfDay(offset: number, now: number): string {
  const d = new Date(now)
  d.setDate(d.getDate() + offset)
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}

/** `yyyy-mm-ddTHH:mm` for an <input type="datetime-local">, in local time. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The ISO time for what a datetime-local field holds, or null when it isn't a time. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/* ------------------------------------------------------------ lines */

export type LineState = 'answering' | 'staff' | 'paused' | 'none'

/** What a line is doing, for its status pill. */
export function lineState(l: DeskLine): LineState {
  if (!l.agentName) return 'none'
  if (l.mode === 'staff') return 'staff'
  if (l.agentStatus === 'paused') return 'paused'
  return 'answering'
}

/** Lines whose calls can be sent to staff: an agent that isn't paused answers them. */
export const switchable = (l: DeskLine) => lineState(l) === 'answering' || lineState(l) === 'staff'

/** Lines an agent is answering now: what "send every line to staff" would change. */
export const toSend = (lines: DeskLine[]) => lines.filter((l) => lineState(l) === 'answering')
/** Lines with staff now: what "give every line back" would change. */
export const toGiveBack = (lines: DeskLine[]) => lines.filter((l) => lineState(l) === 'staff')

export interface BoardSummary {
  answering: number
  staff: number
  paused: number
  none: number
}
export function boardSummary(lines: DeskLine[]): BoardSummary {
  const s: BoardSummary = { answering: 0, staff: 0, paused: 0, none: 0 }
  for (const l of lines) s[lineState(l)]++
  return s
}

export type HowLong = '1' | '2' | 'day' | 'at' | 'open'

/** When the hand-over ends, for the choice made: an ISO time, null (until someone switches it back), or what to say is wrong. */
export function untilFor(how: HowLong, now: number, at = ''): { until: string | null } | { error: string } {
  if (how === 'open') return { until: null }
  if (how === 'day') return { until: endOfDay(0, now) }
  if (how === 'at') {
    if (!/^\d{2}:\d{2}$/.test(at)) return { error: 'Choose a time today.' }
    const d = new Date(now)
    d.setHours(Number(at.slice(0, 2)), Number(at.slice(3)), 0, 0)
    if (d.getTime() <= now) return { error: 'Choose a time later than now.' }
    return { until: d.toISOString() }
  }
  return { until: new Date(now + Number(how) * 36e5).toISOString() }
}

/** Today's calls on one line's agent and the share handed to a person; null when the day has no calls yet. */
export function todayFigures(report: Pick<Report, 'totals'> | null | undefined): { calls: number; handedOver: number; rate: number | null } | null {
  if (!report) return null
  const { calls, handedOver } = report.totals
  return { calls, handedOver, rate: calls > 0 ? share(handedOver, calls) : null }
}

/* ------------------------------------------------------------ notices */

export type NoticeState = 'showing' | 'scheduled' | 'ended'

/** The page's clock ticks every half minute, so a notice about to start (or just posted "now") counts as showing. */
const TICK = 60_000

export function noticeState(n: Pick<Notice, 'from' | 'until'>, now: number): NoticeState {
  if (Date.parse(n.until) <= now) return 'ended'
  return Date.parse(n.from) > now + TICK ? 'scheduled' : 'showing'
}

/** What is being said now (soonest ending first), what is coming (soonest starting first), and what ran out since the page last read the desk. */
export function groupNotices(notices: Notice[], now: number): { showing: Notice[]; scheduled: Notice[]; ended: Notice[] } {
  const out = { showing: [] as Notice[], scheduled: [] as Notice[], ended: [] as Notice[] }
  for (const n of notices) out[noticeState(n, now)].push(n)
  out.showing.sort((a, b) => a.until.localeCompare(b.until))
  out.scheduled.sort((a, b) => a.from.localeCompare(b.from) || a.until.localeCompare(b.until))
  return out
}

/** Within a quarter of an hour of ending. */
export const endsSoon = (n: Pick<Notice, 'until'>, now: number) => {
  const left = Date.parse(n.until) - now
  return left > 0 && left <= 15 * MIN
}

export interface NoticeTemplate {
  id: string
  label: string
  /** Parts in [square brackets] are for the person to fill in. */
  text: string
  ends: Exclude<EndPreset, 'keep' | 'custom'>
}

export const NOTICE_TEMPLATES: NoticeTemplate[] = [
  { id: 'leave', label: 'Doctor on leave', text: '[Dr. name] is on leave today. [Dr. name] sees [department] patients in room [number].', ends: 'today' },
  { id: 'lift', label: 'Lift or parking', text: 'The lift in [block] is under repair today. Patients who need it can use the ramp near [place].', ends: 'today' },
  { id: 'holiday', label: 'Holiday hours', text: 'The hospital is closed for [holiday] on [date]. The emergency department stays open 24 hours. OPD reopens at [time] on [day].', ends: 'tomorrow' },
  { id: 'camp', label: 'Camp or event', text: 'There is a free [eye check-up] camp in [the OPD lobby] on [date], from [time] to [time]. No booking is needed.', ends: 'week' },
  { id: 'counter', label: 'Counter moved', text: 'The [pharmacy] counter has moved to [the ground floor] today.', ends: 'today' },
]

/** Parts of a template nobody has filled in yet. */
export const hasPlaceholder = (text: string) => /\[[^\]\n]+\]/.test(text)

export type EndPreset = 'keep' | '2h' | 'today' | 'tomorrow' | 'week' | 'custom'

/** When a notice that starts at `start` ends, for the choice made. Null when `custom` has no valid time. */
export function endFor(preset: EndPreset, start: number, opts: { custom?: string; keep?: string } = {}): string | null {
  switch (preset) {
    case 'keep':
      return opts.keep ?? null
    case 'custom':
      return opts.custom ? fromLocalInput(opts.custom) : null
    case '2h':
      return new Date(start + 2 * 36e5).toISOString()
    case 'today':
      return endOfDay(0, start)
    case 'tomorrow':
      return endOfDay(1, start)
    case 'week':
      return endOfDay(7, start)
  }
}

export interface NoticeCheck {
  text?: string
  when?: string
}

/** What is wrong with a notice before it is sent, in words for the form; empty when it is fine. */
export function checkNotice(input: { text: string; from: string | null; until: string | null }, now: number): NoticeCheck {
  const out: NoticeCheck = {}
  const text = input.text.trim()
  if (text.length < 5) out.text = 'Write what callers should know, in a sentence or two.'
  else if (hasPlaceholder(text)) out.text = 'Fill in the parts in [square brackets] first.'
  if (!input.from) out.when = 'Choose when it starts.'
  else if (!input.until) out.when = 'Choose when it ends.'
  else if (Date.parse(input.until) <= now) out.when = 'Choose an end later than now.'
  else if (Date.parse(input.until) <= Date.parse(input.from)) out.when = 'It must end after it starts.'
  else if (Date.parse(input.until) - Date.parse(input.from) > 31 * 864e5) out.when = 'Notices last up to 31 days. For longer, add it to Knowledge.'
  return out
}

/** The notice as a caller would hear it, said plainly: no rewriting, only tidied. */
export function noticePreview(text: string, who: string | null, from: string, until: string, now: number): { intro: string; says: string; timing: string } {
  const says = text.replace(/\s+/g, ' ').trim()
  const closed = /[.!?]$/.test(says) ? says : says ? `${says}.` : ''
  const starts = Date.parse(from) > now ? `from ${when(from, now)}` : 'from now'
  return {
    intro: `${who ?? 'Every agent'} will tell callers`,
    says: closed,
    timing: `${starts}, until ${when(until, now)}`,
  }
}

const STOP = new Set(['the', 'and', 'for', 'are', 'was', 'has', 'have', 'can', 'will', 'today', 'this', 'that', 'with', 'from', 'you', 'our', 'your', 'please', 'there', 'their', 'they'])

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  )
}

/** How much of the shorter text is in the other, 0 to 1. */
export function similarity(a: string, b: string): number {
  const x = wordsOf(a)
  const y = wordsOf(b)
  if (x.size === 0 || y.size === 0) return 0
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return both / Math.min(x.size, y.size)
}

/**
 * A notice already showing or coming up that says much the same thing to
 * the same agents at an overlapping time, so posting another would have
 * callers told twice. `ignoreId` is the notice being changed.
 */
export function similarNotice(
  text: string,
  others: Notice[],
  mine: { agentId: string | null; from: string; until: string; ignoreId?: string },
  now: number,
): Notice | null {
  if (wordsOf(text).size < 3) return null
  let best: { n: Notice; score: number } | null = null
  for (const n of others) {
    if (n.id === mine.ignoreId || noticeState(n, now) === 'ended') continue
    if (n.agentId && mine.agentId && n.agentId !== mine.agentId) continue
    if (Date.parse(n.from) >= Date.parse(mine.until) || Date.parse(n.until) <= Date.parse(mine.from)) continue
    const score = similarity(text, n.text)
    if (score >= 0.7 && (!best || score > best.score)) best = { n, score }
  }
  return best?.n ?? null
}

/* ------------------------------------------------------------ doctor calendar */

export const CALENDAR_DAYS = 14

export interface CalendarRow {
  doctor: string
  department: string
  /** In the knowledge library's doctor list; a change can name someone who isn't (they were removed, or typed differently). */
  inLibrary: boolean
}

/** The next fortnight, starting today. */
export const calendarDays = (today: string, count = CALENDAR_DAYS) => dateList(today, count)

/** One row per doctor in the library, then anyone else with a change in `days`, by name. */
export function calendarRows(doctors: { doctor: string; department: string }[], changes: DoctorChange[], days: string[]): CalendarRow[] {
  const seen = new Map<string, CalendarRow>()
  for (const d of doctors) if (!seen.has(norm(d.doctor))) seen.set(norm(d.doctor), { doctor: d.doctor, department: d.department, inLibrary: true })
  for (const c of changes) if (days.includes(c.date) && !seen.has(norm(c.doctor))) seen.set(norm(c.doctor), { doctor: c.doctor, department: c.department, inLibrary: false })
  return [...seen.values()].sort((a, b) => a.doctor.localeCompare(b.doctor, 'en-IN', { numeric: true }))
}

/** The change for one doctor on one day. */
export const changeAt = (doctor: string, date: string, changes: DoctorChange[]) => changes.find((c) => c.date === date && norm(c.doctor) === norm(doctor)) ?? null

export const CHANGE_WORD: Record<DoctorChange['kind'], string> = { away: 'Away', late: 'Late', moved: 'Moved' }
export const CHANGE_LONG: Record<DoctorChange['kind'], string> = { away: 'Away all day', late: 'Starting late', moved: 'In another room' }

/** The booked (not cancelled) appointments a doctor has on a day. */
export const bookedWith = (doctor: string, date: string, appts: Appointment[]) => appts.filter((a) => a.status !== 'cancelled' && a.date === date && norm(a.doctor) === norm(doctor))

/**
 * The appointments a change touches: all of an away day; those before the
 * time a late doctor arrives (all of them when the words give no time); and
 * every one when they are in another room, as those patients need telling.
 */
export function affectedAppointments(change: DoctorChange, appts: Appointment[]): Appointment[] {
  const day = bookedWith(change.doctor, change.date, appts)
  if (change.kind !== 'late') return day
  const note = doctorNote(change.doctor, change.date, [change])
  if (!note || note.until <= 0) return day
  return day.filter((a) => toMin(a.time) < note.until)
}

/** The same change, when the person picks a doctor and day in the form: this one is replaced rather than refused. */
export const existingChange = changeAt

/** "Sat 25 Oct: Dr. K. Arvind is late. Seeing patients from 11 AM." for a screen reader. */
export function cellSpeech(doctor: string, date: string, today: string, change: DoctorChange | null, booked: number | null, canEdit: boolean): string {
  const day = date === today ? `today, ${shortDay(date)}` : shortDay(date)
  const what = change ? `${CHANGE_LONG[change.kind]}${change.detail ? `, ${change.detail}` : ''}` : 'no change'
  const appts = change && booked !== null ? `, ${booked} ${booked === 1 ? 'appointment' : 'appointments'} affected` : ''
  return `${doctor}, ${day}: ${what}${appts}.${canEdit ? (change ? ' Change it.' : ' Add a change.') : ''}`
}

/** The first and last day to ask the appointments for. */
export const calendarRange = (today: string, count = CALENDAR_DAYS) => ({ from: today, to: addDays(today, count - 1) })

/* ------------------------------------------------------------ flagged answers */

export type FlagTab = AnswerFlag['status']

export interface FlagFilter {
  text: string
  agent: string
}
export const NO_FLAG_FILTER: FlagFilter = { text: '', agent: '' }

/** Open, fixed and dismissed counts, for the tabs. */
export function flagCounts(flags: AnswerFlag[]): Record<FlagTab, number> {
  const c: Record<FlagTab, number> = { open: 0, fixed: 0, dismissed: 0 }
  for (const f of flags) c[f.status]++
  return c
}

/** The flags in one tab that match the search and agent: open ones oldest first (the longest wrong), the rest newest dealt-with first. */
export function filterFlags(flags: AnswerFlag[], tab: FlagTab, filter: FlagFilter): AnswerFlag[] {
  const q = filter.text.trim().toLowerCase()
  const rows = flags.filter((f) => {
    if (f.status !== tab) return false
    if (filter.agent === '__none') {
      if (f.agentName) return false
    } else if (filter.agent && f.agentName !== filter.agent) return false
    if (!q) return true
    return [f.text, f.correction, f.by, f.agentName ?? '', f.resolution?.note ?? '', f.resolution?.by ?? ''].some((s) => s.toLowerCase().includes(q))
  })
  return rows.sort((a, b) => (tab === 'open' ? Date.parse(a.at) - Date.parse(b.at) : Date.parse(b.resolution?.at ?? b.at) - Date.parse(a.resolution?.at ?? a.at)))
}

/** The agent names to filter by: those on flags and on lines, each once, with "no agent named" when a flag has none. */
export function flagAgents(flags: AnswerFlag[], lines: DeskLine[]): { value: string; label: string }[] {
  const names = new Set<string>()
  for (const l of lines) if (l.agentName) names.add(l.agentName)
  for (const f of flags) if (f.agentName) names.add(f.agentName)
  const out = [{ value: '', label: 'Every agent' }, ...[...names].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }))]
  if (flags.some((f) => !f.agentName)) out.push({ value: '__none', label: 'No agent named' })
  return out
}

/** The agent a flag names, as a line's agent id (for "Ask bitNtech"), when it is one of ours. */
export const agentIdFor = (flag: Pick<AnswerFlag, 'agentName'>, lines: DeskLine[]) => (flag.agentName ? (lines.find((l) => l.agentName === flag.agentName)?.agentId ?? null) : null)

export interface Excerpt {
  turns: TranscriptTurn[]
  /** The caller's words just before the flagged reply, when it could be found. */
  question: string | null
  /** The flagged reply was found in the call; otherwise these are its first turns. */
  matched: boolean
}

const wordSet = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9₹]+/).filter((w) => w.length >= 3 && !STOP.has(w)))

/**
 * The part of a call a flag is about: the agent's reply that shares the most
 * words with what was flagged, with the caller's question before it and the
 * next turn after. When nothing matches well, the start of the call, said
 * to be that.
 */
export function excerptFor(turns: TranscriptTurn[], flagText: string): Excerpt {
  const want = wordSet(flagText)
  let best = -1
  let bestScore = 0
  turns.forEach((t, i) => {
    if (t.speaker === 'caller') return
    let score = 0
    for (const w of wordSet(t.text)) if (want.has(w)) score++
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  })
  const enough = best >= 0 && bestScore >= Math.min(2, Math.max(1, want.size))
  if (!enough) return { turns: turns.slice(0, 3), question: turns.find((t) => t.speaker === 'caller')?.text ?? null, matched: false }
  let from = best
  while (from > 0 && turns[from].speaker !== 'caller') from--
  const asked = turns[from].speaker === 'caller' ? turns[from] : null
  return { turns: turns.slice(from, Math.min(turns.length, best + 2)), question: asked?.text ?? null, matched: true }
}

/** What to copy for a new FAQ: the caller's question (or what was flagged) and what the agent should have said. */
export function faqDraft(flag: Pick<AnswerFlag, 'text' | 'correction'>, question: string | null): string {
  const q = (question ?? flag.text).trim()
  return flag.correction.trim() ? `Question: ${q}\nAnswer: ${flag.correction.trim()}` : `Question: ${q}`
}

/* ------------------------------------------------------------ desk activity */

/** The activity entries that are the desk's own: lines sent to staff and back, notices, doctor changes and flagged answers. */
export function isDeskEntry(e: Pick<ActivityEntry, 'area' | 'text'>): boolean {
  if (e.area !== 'agents') return false
  return /\bto staff\b|back to the agent|\ba notice\b|^Marked .+ on \d{4}-\d{2}-\d{2}|’s change on|flagged answer/i.test(e.text)
}

export const deskEntries = (entries: ActivityEntry[]) => entries.filter(isDeskEntry)
