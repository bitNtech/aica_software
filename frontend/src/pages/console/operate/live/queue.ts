import type { Handoff, LiveCall } from '../../../../console/types'

/**
 * The one queue behind /o/:slug/live: live calls and handed-over callers
 * joined into rows, ordered by who needs a person soonest. Pure functions
 * only (no React, no clock of their own), so the ordering is tested
 * directly.
 */

/** Where a row sits. The numbers are the order the groups appear in. */
export type Section = 'emergency' | 'waiting' | 'flagged' | 'active' | 'recent'
const RANK: Record<Section, number> = { emergency: 0, waiting: 1, flagged: 2, active: 3, recent: 4 }

/** A call that dropped off the live list is kept this long in "Recently". */
export const RECENT_MS = 15 * 60 * 1000

/** A call last seen on the live list, and when it stopped being there. */
export interface GoneCall {
  call: LiveCall
  endedAt: number
}

export interface QueueItem {
  /** Stable while the call changes group: the call's id (or the handover's). */
  key: string
  section: Section
  /** The live call, or its last known copy once it has ended. Null when only
   * a handover is known (the live list is a separate source). */
  call: LiveCall | null
  handoff: Handoff | null
  /** The call has left the live list. */
  ended: boolean
  endedAt: number | null
  /** Ordering within "Recently": when it was taken, hung up or ended. */
  recentAt: number
}

/** The things a row and its detail both say, whichever source they came from. */
export interface Facts {
  callId: string
  callerPhone: string
  agentName: string
  line: string
  language: LiveCall['language']
  intent: string | null
  step: string | null
  reason: string | null
  summary: string | null
  emergency: boolean
  /** Asking for a person right now. */
  waiting: boolean
  waitingSince: string | null
  startedAt: string | null
  /** Who has it, once someone has taken or been handed it. */
  takenBy: string | null
  takenAt: string | null
  /** The caller hung up before anyone answered. */
  missed: boolean
  flagged: boolean
}

export function factsOf(item: QueueItem): Facts {
  const { call: c, handoff: h } = item
  const taken = h?.status === 'taken' ? h.takenBy : (c?.takenBy ?? h?.takenBy ?? null)
  return {
    callId: c?.id ?? h?.callId ?? '',
    callerPhone: c?.callerPhone ?? h?.callerPhone ?? '',
    agentName: c?.agentName ?? h?.agentName ?? '',
    line: c?.line ?? h?.line ?? '',
    language: c?.language ?? h?.language ?? 'english',
    intent: c?.intent ?? null,
    step: c?.step ?? null,
    reason: h?.reason ?? null,
    summary: h?.summary ?? null,
    emergency: !!h?.emergency,
    waiting: h?.status === 'waiting',
    waitingSince: h?.waitingSince ?? null,
    startedAt: c?.startedAt ?? null,
    takenBy: taken,
    takenAt: h?.takenAt ?? null,
    missed: h?.status === 'missed',
    flagged: !!c?.flagged && !item.ended,
  }
}

/** The caller's name, for those who may see names: the handover's "Patient
 * name" detail. Null when there is none, or it is hidden. */
export function callerName(item: QueueItem, mayShowPersonal: boolean): string | null {
  if (!mayShowPersonal) return null
  const d = item.handoff?.details.find((x) => x.label === 'Patient name')
  return d?.value?.trim() || null
}

const time = (iso: string | null | undefined): number => {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isFinite(n) ? n : 0
}

function sectionOf(c: LiveCall | null, h: Handoff | null, ended: boolean): Section {
  const takenBy = h?.status === 'taken' ? h.takenBy : (c?.takenBy ?? null)
  if (h?.status === 'missed' || h?.status === 'taken' || takenBy) return 'recent'
  if (h?.status === 'waiting') return h.emergency ? 'emergency' : 'waiting'
  if (ended) return 'recent'
  return c?.flagged ? 'flagged' : 'active'
}

function recentAtOf(c: LiveCall | null, h: Handoff | null, endedAt: number | null): number {
  return Math.max(time(h?.takenAt), endedAt ?? 0) || time(h?.waitingSince) || time(c?.startedAt)
}

/** Longest-waiting first within a group; recent ones newest first. */
function compare(a: QueueItem, b: QueueItem): number {
  if (a.section !== b.section) return RANK[a.section] - RANK[b.section]
  const fa = factsOf(a)
  const fb = factsOf(b)
  let by = 0
  if (a.section === 'emergency' || a.section === 'waiting') by = time(fa.waitingSince) - time(fb.waitingSince)
  else if (a.section === 'recent') by = b.recentAt - a.recentAt
  else by = time(fa.startedAt) - time(fb.startedAt)
  return by || a.key.localeCompare(b.key)
}

/**
 * Joins and orders. A handover belongs to a live call when
 * `handoff.callId === call.id`; one with no live call (they come from
 * different sources, so that can happen) is still a row, from its own
 * fields. Order: emergencies; people waiting, longest first; calls that
 * sound upset; other calls in progress, longest first; then "Recently":
 * taken, hung up, or dropped off the live list in the last 15 minutes.
 */
export function buildQueue(calls: LiveCall[], handoffs: Handoff[], gone: GoneCall[], now: number): QueueItem[] {
  const liveIds = new Set(calls.map((c) => c.id))
  const byCall = new Map<string, Handoff>()
  for (const h of handoffs) if (h.callId) byCall.set(h.callId, h)
  const used = new Set<string>()
  const items: QueueItem[] = []

  const add = (c: LiveCall, ended: boolean, endedAt: number | null) => {
    const h = byCall.get(c.id) ?? null
    if (h) used.add(h.id)
    items.push({ key: c.id, section: sectionOf(c, h, ended), call: c, handoff: h, ended, endedAt, recentAt: recentAtOf(c, h, endedAt) })
  }
  for (const c of calls) add(c, false, null)
  for (const g of gone) {
    if (liveIds.has(g.call.id) || now - g.endedAt > RECENT_MS) continue
    add(g.call, true, g.endedAt)
  }
  for (const h of handoffs) {
    if (used.has(h.id)) continue
    items.push({ key: h.callId || h.id, section: sectionOf(null, h, false), call: null, handoff: h, ended: false, endedAt: null, recentAt: recentAtOf(null, h, null) })
  }
  return items.sort(compare)
}

/**
 * The calls that were on the list last time and aren't now, with when they
 * went (kept 15 minutes). A call that comes back is dropped from the list
 * of ended ones. `prev` is null before the first load: nothing has ended yet.
 */
export function trackEnded(prev: LiveCall[] | null, next: LiveCall[], gone: GoneCall[], now: number): GoneCall[] {
  const here = new Set(next.map((c) => c.id))
  const kept = gone.filter((g) => !here.has(g.call.id) && now - g.endedAt <= RECENT_MS)
  if (!prev) return kept
  const known = new Set(kept.map((g) => g.call.id))
  const fresh = prev.filter((c) => !here.has(c.id) && !known.has(c.id)).map((call) => ({ call, endedAt: now }))
  return fresh.length ? [...kept, ...fresh] : kept
}

export interface Summary {
  /** Emergencies and people waiting for a person. */
  waiting: number
  /** Calls the agents are on (including ones that sound upset). */
  onCalls: number
  /** Taken, hung up or ended lately. */
  recent: number
}

export function summarize(items: QueueItem[]): Summary {
  const n = (...s: Section[]) => items.filter((i) => s.includes(i.section)).length
  return { waiting: n('emergency', 'waiting'), onCalls: n('flagged', 'active'), recent: n('recent') }
}

export interface QueueFilter {
  text: string
  agent: string
  line: string
  needsPerson: boolean
}
export const NO_FILTER: QueueFilter = { text: '', agent: '', line: '', needsPerson: false }

const digitsOf = (s: string) => s.replace(/\D/g, '')

/** What a search can match: the caller's number (the digits shown), agent,
 * line, intent, step and reason; their name only when the person may see names. */
function haystack(item: QueueItem, mayShowPersonal: boolean): string {
  const f = factsOf(item)
  return [callerName(item, mayShowPersonal), f.callerPhone, f.agentName, f.line, f.intent, f.step, f.reason, f.takenBy].filter(Boolean).join(' ').toLowerCase()
}

export function filterQueue(items: QueueItem[], f: QueueFilter, mayShowPersonal: boolean): QueueItem[] {
  const text = f.text.trim().toLowerCase()
  const digits = digitsOf(text)
  // A query that is only digits and spaces is a number: match the digits, so
  // "21877" finds "+91 ••••• 21877" however the spaces fall.
  const isNumber = digits.length >= 2 && /^[\d\s+()-]+$/.test(text)
  return items.filter((i) => {
    const facts = factsOf(i)
    if (f.agent && facts.agentName !== f.agent) return false
    if (f.line && facts.line !== f.line) return false
    if (f.needsPerson && !(i.section === 'emergency' || i.section === 'waiting' || i.section === 'flagged')) return false
    if (!text) return true
    if (isNumber) return digitsOf(facts.callerPhone).includes(digits)
    return haystack(i, mayShowPersonal).includes(text)
  })
}

/** Distinct agents and lines in the queue, for the filter menus. */
export function filterOptions(items: QueueItem[]): { agents: string[]; lines: string[] } {
  const agents = new Set<string>()
  const lines = new Set<string>()
  for (const i of items) {
    const f = factsOf(i)
    if (f.agentName) agents.add(f.agentName)
    if (f.line) lines.add(f.line)
  }
  return { agents: [...agents].sort(), lines: [...lines].sort() }
}

/**
 * Who is new since the last look, for the opt-in alerts. `seen` is null
 * before the first load, which only learns what is there and fires
 * nothing. A waiting handover not seen before is a `request`; an emergency
 * not alerted before is an `emergency` (a request that turns into one
 * alerts again).
 */
export function newArrivals(seen: ReadonlySet<string> | null, handoffs: Handoff[]): { seen: Set<string>; requests: Handoff[]; emergencies: Handoff[] } {
  const next = new Set(seen ?? [])
  const requests: Handoff[] = []
  const emergencies: Handoff[] = []
  for (const h of handoffs) {
    if (seen && h.status === 'waiting') {
      if (h.emergency && !seen.has(`${h.id}!`)) emergencies.push(h)
      else if (!h.emergency && !seen.has(h.id)) requests.push(h)
    }
    next.add(h.id)
    if (h.emergency) next.add(`${h.id}!`)
  }
  return { seen: next, requests, emergencies }
}
