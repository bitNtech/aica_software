import type { Callback, CallSummary, Member, OrgSettings } from '../../../../console/types'

/**
 * The logic behind /o/:slug/callbacks: how the list is grouped by urgency,
 * filtered and sorted, which callback comes next, who has rung back, and the
 * warnings the detail shows. Pure functions (no React, no clock of their
 * own: `now` is passed in), so each rule is tested directly.
 */

/** The server moves a callback to "Couldn't reach" after this many tries
 * with no answer (backend/app/routes/org/callbacks.py, UNREACHABLE_AFTER). */
export const UNREACHABLE_AFTER = 3

const MIN = 60_000
const HOUR = 60 * MIN

/** Where a row sits. `all` is the one flat group used when the list is
 * sorted by when it was asked rather than by urgency. */
export type Group = 'overdue' | 'hour' | 'today' | 'later' | 'all' | 'closed'
export const GROUP_ORDER: Group[] = ['overdue', 'hour', 'today', 'later', 'all', 'closed']

export type Sort = 'urgency' | 'newest' | 'oldest'
export type Status = '' | Callback['status']

export interface QueueFilter {
  /** Name, digits of the number, or words of the reason. */
  text: string
  /** '' anyone, 'me', 'nobody' (not given to anyone), or a member's id. */
  assignee: string
  tries: '' | 'untried' | 'tried'
  status: Status
}
export const NO_FILTER: QueueFilter = { text: '', assignee: '', tries: '', status: '' }

export interface QueueItem {
  callback: Callback
  group: Group
  /** Due time minus now, in ms: negative once overdue. */
  dueInMs: number
  overdue: boolean
  /** The other open callbacks for the same number. */
  duplicates: Callback[]
}

export const digitsOf = (phone: string) => phone.replace(/\D/g, '')
/** A number as a person would compare it: ten digits, without 91 or 0 in front. */
export const numberKey = (phone: string) => {
  const d = digitsOf(phone)
  return d.length > 10 ? d.slice(-10) : d
}
/** The call log keeps numbers masked, showing only the last five digits. */
export const lastFive = (phone: string) => digitsOf(phone).slice(-5)

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

/** Which urgency group an open callback is in. Anything not open is `closed`. */
export function groupOf(c: Callback, now: number): Group {
  if (c.status !== 'open') return 'closed'
  const due = Date.parse(c.dueBy)
  if (due < now) return 'overdue'
  if (due <= now + HOUR) return 'hour'
  return sameDay(due, now) ? 'today' : 'later'
}

/** The open callbacks for each number, by number. */
function openByNumber(callbacks: Callback[]): Map<string, Callback[]> {
  const map = new Map<string, Callback[]>()
  for (const c of callbacks) {
    if (c.status !== 'open') continue
    const key = numberKey(c.callerPhone)
    if (!key) continue
    map.set(key, [...(map.get(key) ?? []), c])
  }
  return map
}

/** The other open callbacks for this callback's number (none when it is not open itself). */
export function otherOpenFor(c: Callback, callbacks: Callback[]): Callback[] {
  if (c.status !== 'open') return []
  return (openByNumber(callbacks).get(numberKey(c.callerPhone)) ?? []).filter((x) => x.id !== c.id).sort((a, b) => a.dueBy.localeCompare(b.dueBy))
}

/** The caller's name, for a row: "Caller not named" when there isn't one. */
export const nameOf = (c: Callback) => c.callerName?.trim() || 'Caller not named'

/** Whether a callback passes the filters. */
export function passes(c: Callback, f: QueueFilter, meId: string): boolean {
  if (f.status && c.status !== f.status) return false
  if (f.tries === 'untried' && c.attempts > 0) return false
  if (f.tries === 'tried' && c.attempts === 0) return false
  if (f.assignee === 'me' && c.assignedTo?.id !== meId) return false
  if (f.assignee === 'nobody' && c.assignedTo) return false
  if (f.assignee && f.assignee !== 'me' && f.assignee !== 'nobody' && c.assignedTo?.id !== f.assignee) return false
  const text = f.text.trim().toLowerCase()
  if (text) {
    // Typed like a number (digits, spaces, + or -): look in the number.
    const typedAsNumber = /^[\d\s+\-()]+$/.test(text) && digitsOf(text).length >= 2
    if (typedAsNumber) return digitsOf(c.callerPhone).includes(digitsOf(text))
    return `${c.callerName ?? ''} ${c.reason}`.toLowerCase().includes(text)
  }
  return true
}

/** When it was last touched: the newest note, else when it was asked. */
const touchedAt = (c: Callback) => Math.max(Date.parse(c.requestedAt), ...c.notes.map((n) => Date.parse(n.at)))

/**
 * The rows to show, in the order they appear: by urgency (overdue first,
 * then due within the hour, later today, another day; soonest due first in
 * each) or, sorted by when they were asked, one flat group of open ones.
 * Done and couldn't-reach callbacks always come last, most recently touched
 * first.
 */
export function buildQueue(callbacks: Callback[], filter: QueueFilter, sort: Sort, now: number, meId: string): QueueItem[] {
  const index = openByNumber(callbacks)
  const items: QueueItem[] = callbacks
    .filter((c) => passes(c, filter, meId))
    .map((callback) => {
      const due = Date.parse(callback.dueBy)
      const group: Group = callback.status !== 'open' ? 'closed' : sort === 'urgency' ? groupOf(callback, now) : 'all'
      return {
        callback,
        group,
        dueInMs: due - now,
        overdue: callback.status === 'open' && due < now,
        duplicates: callback.status === 'open' ? (index.get(numberKey(callback.callerPhone)) ?? []).filter((x) => x.id !== callback.id) : [],
      }
    })
  const within = (a: QueueItem, b: QueueItem) => {
    if (a.group === 'closed') return touchedAt(b.callback) - touchedAt(a.callback)
    if (sort === 'newest') return Date.parse(b.callback.requestedAt) - Date.parse(a.callback.requestedAt)
    if (sort === 'oldest') return Date.parse(a.callback.requestedAt) - Date.parse(b.callback.requestedAt)
    return Date.parse(a.callback.dueBy) - Date.parse(b.callback.dueBy)
  }
  return items.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || within(a, b) || a.callback.id.localeCompare(b.callback.id))
}

/** "3 open · 1 overdue". */
export function summarize(items: QueueItem[]): { open: number; overdue: number } {
  return { open: items.filter((i) => i.callback.status === 'open').length, overdue: items.filter((i) => i.overdue).length }
}

/**
 * The next callback for this person to ring: open, and theirs or not given to
 * anyone yet, most urgent first. After `currentId` in that order (wrapping
 * round to the top), so pressing it again goes on down the list; the
 * current one is skipped. When `currentId` is not in the list (it was just
 * marked done) the most urgent one is next.
 */
export function nextCallback(callbacks: Callback[], currentId: string | null, meId: string): Callback | null {
  const mine = callbacks
    .filter((c) => c.status === 'open' && (!c.assignedTo || c.assignedTo.id === meId))
    .sort((a, b) => Date.parse(a.dueBy) - Date.parse(b.dueBy) || a.id.localeCompare(b.id))
  const at = mine.findIndex((c) => c.id === currentId)
  if (at === -1) return mine[0] ?? null
  return mine.length > 1 ? mine[(at + 1) % mine.length] : null
}

/** Past calls that are from this callback's number (the log shows the last five digits only). */
export function callsFromNumber(c: Callback, calls: CallSummary[]): CallSummary[] {
  const tail = lastFive(c.callerPhone)
  return tail.length === 5 ? calls.filter((x) => lastFive(x.callerPhone) === tail) : []
}

/** The first call from the same number after the callback was asked for, if
 * the caller has already rung back (best effort: the call log is matched on the
 * last five digits). The call the callback came from does not count. */
export function rangBack(c: Callback, calls: CallSummary[]): CallSummary | null {
  if (c.status !== 'open') return null
  const asked = Date.parse(c.requestedAt)
  return (
    callsFromNumber(c, calls)
      .filter((x) => x.id !== c.callId && Date.parse(x.startedAt) > asked)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0] ?? null
  )
}

/** Whether the person it is given to is still someone who can take it. */
export function assigneeGone(c: Callback, team: Member[]): boolean {
  return c.status === 'open' && !!c.assignedTo && !team.some((m) => m.id === c.assignedTo!.id && m.status === 'active' && m.role !== 'viewer')
}

/** What changed between two copies of one callback, in words, for "this changed while you looked". */
export function describeChange(before: Callback, after: Callback, meId: string): string[] {
  const out: string[] = []
  if (before.assignedTo?.id !== after.assignedTo?.id) {
    out.push(after.assignedTo ? (after.assignedTo.id === meId ? 'It is yours now.' : `${after.assignedTo.name} has it now.`) : 'It is not given to anyone now.')
  }
  if (before.status !== after.status) {
    out.push(after.status === 'done' ? 'It was marked done.' : after.status === 'unreachable' ? 'It was moved to Couldn’t reach.' : 'It is open again.')
  }
  if (before.attempts !== after.attempts) out.push(`It has been tried ${after.attempts} ${after.attempts === 1 ? 'time' : 'times'} now.`)
  if (after.notes.length > before.notes.length) {
    const added = after.notes.length - before.notes.length
    out.push(`${added} new note${added === 1 ? '' : 's'}.`)
  }
  return out
}

// ---------------------------------------------------------------- wording

/** "under a minute", "25 min", "2 h 10 min", "9 h", "3 days": a length of time. */
export function howLong(ms: number): string {
  const m = Math.round(Math.abs(ms) / MIN)
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 6) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'}`
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** "4:05 pm today", "9:00 am tomorrow", "6:10 pm yesterday", "21 Oct, 10:42 am". */
export function dayTime(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (sameDay(t, now)) return `${clock(iso)} today`
  if (sameDay(t, now + 24 * HOUR)) return `${clock(iso)} tomorrow`
  if (sameDay(t, now - 24 * HOUR)) return `${clock(iso)} yesterday`
  return `${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${clock(iso)}`
}

/** What a row says about its due time: "Overdue by 2 h", "Due in 25 min", "Due Sat, 4:30 pm". */
export function dueText(item: QueueItem, now: number): string {
  if (item.overdue) return `Overdue by ${howLong(item.dueInMs)}`
  const due = item.callback.dueBy
  if (item.group === 'hour' || item.group === 'today') return `Due in ${howLong(item.dueInMs)}`
  return `Due ${dayTime(due, now)}`
}

/** Initials for an avatar: "Meena S" → "MS". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

export const triesText = (n: number) => (n === 0 ? 'Not tried yet' : `Tried ${n} ${n === 1 ? 'time' : 'times'}`)

// ---------------------------------------------------------------- opening hours

const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const IST_OFFSET = 5.5 * HOUR

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const clock12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`
}

/** Why a due time falls outside the organisation's opening hours (which are
 * in India Standard Time), or null when it is inside them. */
export function outsideHours(dueIso: string, settings: OrgSettings): string | null {
  const t = Date.parse(dueIso)
  if (!Number.isFinite(t)) return null
  const ist = new Date(t + IST_OFFSET)
  const date = ist.toISOString().slice(0, 10)
  const closed = settings.closed.find((c) => c.date === date)
  if (closed) return `the organisation is closed that day (${closed.label})`
  const day = (ist.getUTCDay() + 6) % 7
  const hours = settings.hours[day]
  if (!hours) return null
  if (!hours.open) return `the organisation is closed on ${WEEKDAY[day]}s`
  const at = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  if (at < minutesOf(hours.from)) return `that is before the organisation opens at ${clock12(hours.from)}`
  if (at >= minutesOf(hours.to)) return `that is after the organisation closes at ${clock12(hours.to)}`
  return null
}
