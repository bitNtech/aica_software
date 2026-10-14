import type { Language } from '../../auth/types'
import type {
  Appointment,
  Callback,
  CallOutcome,
  CallRecord,
  CallSummary,
  CollectedDetail,
  Handoff,
  LiveCall,
  Member,
  Report,
  ToolCallRecord,
  TranscriptTurn,
} from '../types'
import { localDay } from '../../lib/time'
import { ago, ahead, DAY } from './runtime'

/**
 * Sample operations data: the call log, live calls, handoffs, callbacks,
 * appointments and reports. The call log is generated from the date with a
 * seeded random generator, so it's the same on every reload and never needs
 * storing; only what people change (notes, who took a call) is kept. Names
 * and numbers are invented.
 */

// ---------------------------------------------------------------- random

/** A small seeded generator (mulberry32): the same seed, the same numbers. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)

function pick<T>(r: () => number, items: readonly T[], weights?: readonly number[]): T {
  if (!weights) return items[Math.floor(r() * items.length)]
  const total = weights.reduce((a, b) => a + b, 0)
  let x = r() * total
  for (let i = 0; i < items.length; i++) {
    x -= weights[i]
    if (x < 0) return items[i]
  }
  return items[items.length - 1]
}

// ---------------------------------------------------------------- people

export function seedMembers(orgSlug: string): Member[] {
  if (orgSlug !== 'arogya-demo')
    return [{ id: 'u_admin', name: 'Karthik R', email: 'admin@example.com', role: 'owner', lastActiveAt: ago(0.1), status: 'active' }]
  return [
    { id: 'u_owner', name: 'Lakshmi K', email: 'lakshmi@example.com', role: 'owner', lastActiveAt: ago(1), status: 'active' },
    { id: 'u_admin', name: 'Karthik R', email: 'admin@example.com', role: 'admin', lastActiveAt: ago(0.05), status: 'active' },
    { id: 'u_supervisor', name: 'Priya N', email: 'supervisor@example.com', role: 'supervisor', lastActiveAt: ago(0.2), status: 'active' },
    { id: 'u_frontdesk', name: 'Meena S', email: 'frontdesk@example.com', role: 'front_desk', lastActiveAt: ago(0.02), status: 'active' },
    { id: 'u_frontdesk2', name: 'Suresh B', email: 'suresh@example.com', role: 'front_desk', lastActiveAt: ago(0.4), status: 'active' },
    { id: 'u_viewer', name: 'Arun V', email: 'viewer@example.com', role: 'viewer', lastActiveAt: ago(6), status: 'active' },
    { id: 'inv_newstaff', name: 'newstaff@example.com', email: 'newstaff@example.com', role: 'supervisor', lastActiveAt: null, status: 'invited' },
  ]
}

/** Staff who pick up handed-over calls. */
const DESK = [
  { id: 'u_frontdesk', name: 'Meena S' },
  { id: 'u_frontdesk2', name: 'Suresh B' },
  { id: 'u_supervisor', name: 'Priya N' },
]

const NAMES = ['Lakshmi Narayanan', 'Ramasamy K', 'Divya Prakash', 'Mohammed Irfan', 'Selvi Murugan', 'Anand Kumar', 'Fathima B', 'Gopal Krishnan', 'Priya Dharshini', 'Karthikeyan S', 'Meenakshi R', 'Joseph Antony', 'Revathi M', 'Senthil Kumar']
const DEPARTMENTS: [string, string][] = [
  ['Cardiology', 'Dr. R. Ramachandran'],
  ['General medicine', 'Dr. S. Meenakshi'],
  ['Orthopaedics', 'Dr. K. Arvind'],
  ['Paediatrics', 'Dr. P. Lakshmi'],
  ['ENT', 'Dr. V. Senthil'],
]

const phone = (r: () => number) => `9${Math.floor(r() * 9e8 + 1e8)}`.slice(0, 10)
const formatPhone = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`
const maskPhone = (p: string) => `+91 ••••• ${p.slice(5)}`

// ---------------------------------------------------------------- agents and what callers want

interface AgentShape {
  id: string
  name: string
  line: string
  /** Share of the day's calls. */
  weight: number
  intents: { label: string; weight: number; path: string[]; outcomes: [CallOutcome, number][] }[]
}

const AGENTS: AgentShape[] = [
  {
    id: 'agt_reception',
    name: 'Main reception',
    line: '+91 00000 01200',
    weight: 5,
    intents: [
      { label: 'Ask about timings and directions', weight: 5, path: ['Understand the question', 'Answer from the knowledge base'], outcomes: [['resolved', 85], ['handed_over', 8], ['dropped', 7]] },
      { label: 'Ask about a doctor', weight: 3, path: ['Understand the question', 'Answer from the knowledge base'], outcomes: [['resolved', 75], ['handed_over', 17], ['dropped', 8]] },
      { label: 'Ask about prices', weight: 2, path: ['Understand the question', 'Answer from the knowledge base'], outcomes: [['resolved', 70], ['handed_over', 22], ['dropped', 8]] },
      { label: 'Bill and insurance', weight: 2, path: ['Understand the question', 'Hand over to billing'], outcomes: [['handed_over', 55], ['callback', 30], ['dropped', 15]] },
      { label: 'Emergency', weight: 0.15, path: ['Emergency'], outcomes: [['emergency', 100]] },
    ],
  },
  {
    id: 'agt_appointments',
    name: 'OPD appointments',
    line: '+91 00000 01210',
    weight: 4,
    intents: [
      { label: 'Book an appointment', weight: 6, path: ['Ask for the doctor or department', 'Ask if it’s a first visit or a review', 'Take the patient’s name and number', 'Offer two slots', 'Confirm the booking'], outcomes: [['booked', 78], ['handed_over', 9], ['callback', 5], ['dropped', 8]] },
      { label: 'Reschedule an appointment', weight: 2, path: ['Find the booking', 'Offer new slots', 'Confirm the change'], outcomes: [['booked', 70], ['handed_over', 15], ['dropped', 15]] },
      { label: 'Cancel an appointment', weight: 1.2, path: ['Find the booking', 'Confirm the cancellation'], outcomes: [['resolved', 85], ['dropped', 15]] },
      { label: 'Ask about timings and directions', weight: 1, path: ['Answer from the knowledge base'], outcomes: [['resolved', 80], ['dropped', 20]] },
    ],
  },
  {
    id: 'agt_reports',
    name: 'Lab report status',
    line: '+91 00000 01220',
    weight: 2,
    intents: [
      { label: 'Check if a report is ready', weight: 5, path: ['Ask for the patient ID', 'Look up the report', 'Say when it’s ready'], outcomes: [['resolved', 82], ['handed_over', 10], ['dropped', 8]] },
      { label: 'Ask how to collect a report', weight: 2, path: ['Explain collection'], outcomes: [['resolved', 90], ['dropped', 10]] },
    ],
  },
]

/** Hours callers ring, weighted: mornings and early evenings. */
const HOUR_WEIGHT = [0.2, 0.1, 0.1, 0.1, 0.1, 0.2, 0.6, 1.5, 3.2, 4.6, 5, 4.4, 3.4, 2.6, 2.8, 3.1, 3.6, 3.4, 2.5, 1.7, 1.1, 0.7, 0.4, 0.3]
const LANGUAGES: (Language | 'mixed')[] = ['tamil', 'tanglish', 'english', 'mixed']
const LANGUAGE_WEIGHT = [38, 34, 20, 8]

// ---------------------------------------------------------------- the call log

/** The hospital's day: India Standard Time, UTC+5:30. Day numbers count
 * IST dates since 1970, so "today" turns over at midnight in India. */
const IST = 5.5 * 36e5
const today = () => Math.floor((Date.now() + IST) / DAY)

/** When an agent was paused: from, and to (null while still paused), in ms. */
export type Pauses = Record<string, { from: number; to: number | null }[]>
const pausedAt = (pauses: Pauses, agentId: string, t: number) => (pauses[agentId] ?? []).some((p) => t >= p.from && (p.to === null || t < p.to))

/** One IST day's calls (day = IST dates since 1970), oldest first. Today's stop at now. */
function callsOn(orgSlug: string, day: number, pauses: Pauses): CallSummary[] {
  if (orgSlug !== 'arogya-demo') return []
  const r = rng(hash(`${orgSlug}:${day}`))
  const weekday = new Date(day * DAY).getUTCDay()
  const count = Math.round((weekday === 0 ? 22 : 44) * (0.85 + r() * 0.3))
  const out: CallSummary[] = []
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    const hour = pick(r, [...HOUR_WEIGHT.keys()], HOUR_WEIGHT)
    const startedAt = day * DAY + hour * 36e5 + Math.floor(r() * 36e5) - IST // an hour of the IST day
    const agent = pick(r, AGENTS, AGENTS.map((a) => a.weight))
    const intent = pick(r, agent.intents, agent.intents.map((x) => x.weight))
    const outcome = pick(r, intent.outcomes.map((o) => o[0]), intent.outcomes.map((o) => o[1]))
    const callerPhone = phone(r)
    const named = r() > 0.3
    const durationSec = Math.round(25 + r() * (outcome === 'booked' ? 220 : outcome === 'handed_over' ? 140 : 160))
    const language = pick(r, LANGUAGES, LANGUAGE_WEIGHT)
    const callerName = named ? pick(r, NAMES) : null
    // A paused agent takes no calls while paused; calls before stay in history.
    if (pausedAt(pauses, agent.id, startedAt)) continue
    if (startedAt > now) continue
    out.push({
      id: `call_${day}_${i}`,
      agentId: agent.id,
      agentName: agent.name,
      line: agent.line,
      callerPhone: maskPhone(callerPhone),
      callerName,
      startedAt: new Date(startedAt).toISOString(),
      durationSec,
      language,
      intent: intent.label,
      outcome,
      // From the call's own seed, as its full record works it out.
      handledBy: outcome === 'handed_over' || outcome === 'emergency' ? deskFor(`call_${day}_${i}`).name : null,
    })
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export interface LogContext {
  orgSlug: string
  /** Agents that are paused, and since which day (whole days since 1970). */
  /** Agents paused now (for live calls). */
  paused: Set<string>
  pauses: Pauses
}

/** Every call in the last `days` days, newest first. */
export function callLog(ctx: LogContext, days: number): CallSummary[] {
  const t = today()
  const out: CallSummary[] = []
  for (let d = t - days + 1; d <= t; d++) out.push(...callsOn(ctx.orgSlug, d, ctx.pauses))
  return out.reverse()
}

/** Who took a handed-over call over, by id, from the call's own seed. */
function deskFor(id: string) {
  const r = rng(hash(id))
  return pick(r, DESK, [5, 3, 1])
}

const SCRIPT: Record<string, (name: string, ph: string, r: () => number) => { turns: TranscriptTurn[]; details: CollectedDetail[]; tools: ToolCallRecord[]; knowledge: string[] }> = {
  'Book an appointment': (name, ph, r) => {
    const [dept, doc] = pick(r, DEPARTMENTS)
    const day = pick(r, ['Thursday', 'Friday', 'Monday', 'Saturday'])
    return {
      turns: [
        { speaker: 'agent', at: 0, text: 'Vanakkam! This is Kavya from Arogya Demo Hospital. How can I help you today?' },
        { speaker: 'caller', at: 4, text: `${dept} doctor kitta appointment venum.` },
        { speaker: 'agent', at: 8, text: 'Sure. Is this your first visit, or a review visit?' },
        { speaker: 'caller', at: 12, text: 'First visit.' },
        { speaker: 'agent', at: 14, text: 'May I have the patient’s name and the registered phone number?' },
        { speaker: 'caller', at: 19, text: `{{name:${name}}}, {{phone:${ph}}}.` },
        { speaker: 'agent', at: 27, text: `${doc} has ${day} 10:30 or 11:15. Which suits you?` },
        { speaker: 'caller', at: 33, text: '10:30.' },
        { speaker: 'agent', at: 36, text: `Booked: ${day}, 10:30 AM with ${doc}. Please come 15 minutes early with your old reports.` },
      ],
      details: [
        { label: 'Patient name', value: name, personal: true },
        { label: 'Phone number', value: formatPhone(ph), personal: true },
        { label: 'Department', value: dept, personal: false },
        { label: 'Visit type', value: 'First visit', personal: false },
        { label: 'Preferred date', value: day, personal: false },
      ],
      tools: [
        { name: 'Find free slots', ok: true, summary: `2 free slots with ${doc} on ${day}.`, at: 24 },
        { name: 'Book an appointment', ok: true, summary: `Booked ${day} 10:30 AM, booking AR-${Math.floor(r() * 9000 + 1000)}.`, at: 35 },
        { name: 'Send an SMS', ok: true, summary: 'Sent the booking and directions by SMS.', at: 38 },
      ],
      knowledge: ['Doctor schedule, October 2026'],
    }
  },
  'Check if a report is ready': (_name, _ph, r) => {
    const id = `AR-${Math.floor(r() * 900 + 100)}-${Math.floor(r() * 9000 + 1000)}`
    return {
      turns: [
        { speaker: 'agent', at: 0, text: 'Vanakkam, Arogya lab. This is Kavya. How can I help?' },
        { speaker: 'caller', at: 3, text: 'Blood test report ready-a?' },
        { speaker: 'agent', at: 6, text: 'Can you tell me the patient ID on the bill?' },
        { speaker: 'caller', at: 10, text: `{{patient_id:${id}}}.` },
        { speaker: 'agent', at: 16, text: 'The thyroid profile is ready. The lipid profile will be ready by 5 PM today.' },
      ],
      details: [{ label: 'Patient ID', value: id, personal: true }],
      tools: [{ name: 'Look up report status', ok: true, summary: '2 tests: 1 ready, 1 due by 5 PM.', at: 14 }],
      knowledge: [],
    }
  },
}

const GENERIC = (intent: string) => ({
  turns: [
    { speaker: 'agent' as const, at: 0, text: 'Vanakkam! This is Kavya from Arogya Demo Hospital. How can I help you today?' },
    { speaker: 'caller' as const, at: 4, text: intent === 'Ask about prices' ? 'Thyroid test evlo?' : intent === 'Bill and insurance' ? 'Insurance claim status theriyanum.' : 'What time is the OPD open on Sunday?' },
    {
      speaker: 'agent' as const,
      at: 8,
      text:
        intent === 'Ask about prices'
          ? 'A thyroid profile is ₹700. Results come the same evening.'
          : intent === 'Bill and insurance'
            ? 'Let me connect you to our billing desk. Please stay on the line.'
            : 'On Sundays only the emergency department is open. The OPD is open Monday to Saturday, 8 AM to 8 PM.',
    },
  ],
  details: [] as CollectedDetail[],
  tools: intent === 'Bill and insurance' ? [{ name: 'Transfer to a person', ok: true, summary: 'Put through to the billing desk.', at: 9 }] : [],
  knowledge: intent === 'Ask about prices' ? ['OPD and lab price list'] : intent === 'Bill and insurance' ? [] : ['Visiting hours and directions'],
})

/** "wanted to book an appointment", or "asked about bill and insurance"
 * for intents that aren't something to do. */
const want = (intent: string) => (/^(ask|book|reschedule|cancel|check)\b/i.test(intent) ? `wanted to ${intent.toLowerCase()}` : `asked about ${intent.toLowerCase()}`)

/** A call in full, built from its own seed, so it's the same every time. */
export function callRecord(s: CallSummary): Omit<CallRecord, 'notes'> {
  const r = rng(hash(s.id))
  // The same number the log shows masked: its last five digits match.
  const ph = `9${Math.floor(r() * 9000 + 1000)}${s.callerPhone.slice(-5)}`
  const name = s.callerName ?? 'the caller'
  const shape = AGENTS.find((a) => a.id === s.agentId)
  const intent = shape?.intents.find((i) => i.label === s.intent)
  const script = (SCRIPT[s.intent] ?? (() => GENERIC(s.intent)))(name, ph, r)
  const path = intent ? [s.intent, ...intent.path] : [s.intent]
  // Where it ended changes the path: a drop stops part way; a handover adds a step.
  const walked = s.outcome === 'dropped' ? path.slice(0, Math.max(2, Math.ceil(path.length / 2))) : s.outcome === 'handed_over' ? [...path.slice(0, 3), 'Hand over to a person'] : path
  const turns = s.outcome === 'dropped' ? script.turns.slice(0, Math.max(3, Math.ceil(script.turns.length / 2))) : script.turns
  const handled = s.outcome === 'handed_over' || s.outcome === 'emergency' ? deskFor(s.id) : null
  const summary =
    s.outcome === 'booked'
      ? `${s.callerName ?? 'A caller'} booked an appointment. Details read back and confirmed.`
      : s.outcome === 'handed_over'
        ? `${s.callerName ?? 'A caller'} ${want(s.intent)}; the agent handed over to ${handled?.name}.`
        : s.outcome === 'dropped'
          ? `The caller hung up during “${walked[walked.length - 1].toLowerCase()}”.`
          : s.outcome === 'callback'
            ? `${s.callerName ?? 'A caller'} ${want(s.intent)}, and asked to be called back.`
            : s.outcome === 'emergency'
              ? 'The caller described an emergency; the agent gave the emergency number and put them through to the emergency desk.'
              : `${s.callerName ?? 'A caller'} ${want(s.intent)}; the agent answered.`
  return {
    ...s,
    summary,
    path: walked,
    details: script.details,
    toolCalls: s.outcome === 'dropped' ? [] : script.tools,
    knowledgeUsed: script.knowledge,
    transcript: turns,
    hasRecording: true,
    handledById: handled?.id ?? null,
    handledBy: handled?.name ?? null,
  }
}

// ---------------------------------------------------------------- reports

const istDayStart = (ms: number) => Math.floor((ms + IST) / DAY) * DAY - IST

/** Calendar days in IST: today and the `days - 1` before it, against the
 * same span just before, up to the same time of day (so today so far is
 * compared with yesterday by this time, not all of yesterday). */
export function report(ctx: LogContext, days: number, agentId?: string): Report {
  const nowMs = Date.now()
  const start = istDayStart(nowMs) - (days - 1) * DAY
  const prevStart = start - days * DAY
  const prevEnd = nowMs - days * DAY
  const all = callLog(ctx, days * 2 + 2)
  const inScope = (c: CallSummary) => !agentId || c.agentId === agentId
  const at = (c: CallSummary) => Date.parse(c.startedAt)
  const now = all.filter((c) => inScope(c) && at(c) >= start && at(c) <= nowMs)
  const before = all.filter((c) => inScope(c) && at(c) >= prevStart && at(c) < prevEnd)
  const totals = (cs: CallSummary[]) => ({
    calls: cs.length,
    byAgent: cs.filter((c) => c.outcome === 'resolved' || c.outcome === 'booked').length,
    handedOver: cs.filter((c) => c.outcome === 'handed_over' || c.outcome === 'emergency' || c.outcome === 'callback').length,
    dropped: cs.filter((c) => c.outcome === 'dropped').length,
    avgDurationSec: cs.length ? Math.round(cs.reduce((s, c) => s + c.durationSec, 0) / cs.length) : 0,
  })
  const byDayMap = new Map<string, { resolved: number; handedOver: number; dropped: number }>()
  const dayKey = (iso: string) => new Date(Date.parse(iso) + IST).toISOString().slice(0, 10)
  for (let i = 0; i < days; i++) byDayMap.set(dayKey(new Date(start + i * DAY).toISOString()), { resolved: 0, handedOver: 0, dropped: 0 })
  const byHour = Array(24).fill(0) as number[]
  const languages = new Map<Language | 'mixed', number>()
  const intents = new Map<string, { calls: number; byAgent: number }>()
  const drops = new Map<string, number>()
  for (const c of now) {
    const d = byDayMap.get(dayKey(c.startedAt))
    if (d) {
      if (c.outcome === 'dropped') d.dropped++
      else if (c.outcome === 'resolved' || c.outcome === 'booked') d.resolved++
      else d.handedOver++
    }
    byHour[new Date(Date.parse(c.startedAt) + IST).getUTCHours()]++
    languages.set(c.language, (languages.get(c.language) ?? 0) + 1)
    const it = intents.get(c.intent) ?? { calls: 0, byAgent: 0 }
    it.calls++
    if (c.outcome === 'resolved' || c.outcome === 'booked') it.byAgent++
    intents.set(c.intent, it)
    if (c.outcome === 'dropped' || c.outcome === 'handed_over') {
      const step = callRecord(c).path.at(-1) ?? c.intent
      drops.set(step, (drops.get(step) ?? 0) + 1)
    }
  }
  return {
    days,
    totals: totals(now),
    previous: totals(before),
    byDay: [...byDayMap].map(([date, v]) => ({ date, ...v })),
    byHour,
    languages: [...languages].map(([language, calls]) => ({ language, calls })).sort((a, b) => b.calls - a.calls),
    intents: [...intents].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.calls - a.calls),
    dropOff: [...drops].map(([step, calls]) => ({ step, calls })).sort((a, b) => b.calls - a.calls).slice(0, 6),
  }
}

// ---------------------------------------------------------------- live calls

const LIVE_SCRIPTS: { agent: string; intent: string; flagged: boolean; language: Language | 'mixed'; turns: TranscriptTurn[]; steps: [number, string][] }[] = [
  {
    agent: 'agt_appointments',
    intent: 'Book an appointment',
    flagged: false,
    language: 'tanglish',
    turns: [
      { speaker: 'agent', at: 0, text: 'Vanakkam! This is Kavya from Arogya Demo Hospital. How can I help you today?' },
      { speaker: 'caller', at: 5, text: 'Ortho doctor kitta appointment venum, knee pain.' },
      { speaker: 'agent', at: 10, text: 'Sure. Is this your first visit, or a review?' },
      { speaker: 'caller', at: 16, text: 'First time.' },
      { speaker: 'agent', at: 20, text: 'May I have the patient’s name and the registered phone number?' },
      { speaker: 'caller', at: 28, text: '{{name:Gopal Krishnan}}, {{phone:98431 22760}}.' },
      { speaker: 'agent', at: 40, text: 'Dr. K. Arvind has Tuesday 11:15 or Thursday 12:30. Which suits you?' },
      { speaker: 'caller', at: 52, text: 'Thursday.' },
      { speaker: 'agent', at: 58, text: 'Booked: Thursday, 12:30 PM with Dr. K. Arvind. Please come 15 minutes early.' },
    ],
    steps: [[0, 'Greeting'], [10, 'Ask if it’s a first visit or a review'], [20, 'Take the patient’s name and number'], [40, 'Offer two slots'], [58, 'Confirm the booking']],
  },
  {
    agent: 'agt_reception',
    intent: 'Bill and insurance',
    flagged: true,
    language: 'english',
    turns: [
      { speaker: 'agent', at: 0, text: 'Vanakkam! This is Kavya from Arogya Demo Hospital. How can I help you today?' },
      { speaker: 'caller', at: 4, text: 'I have called three times about my father’s insurance claim. Nobody tells me anything.' },
      { speaker: 'agent', at: 13, text: 'I’m sorry about that. May I have the patient’s name and the policy number?' },
      { speaker: 'caller', at: 22, text: '{{name:Ramasamy K}}, policy {{policy:SH-88213-02}}. Please just put me to someone.' },
      { speaker: 'agent', at: 34, text: 'Of course. Let me connect you to our billing desk. Please stay on the line.' },
    ],
    steps: [[0, 'Greeting'], [13, 'Understand the question'], [34, 'Hand over to billing']],
  },
  {
    agent: 'agt_reception',
    intent: 'Ask about timings and directions',
    flagged: false,
    language: 'tamil',
    turns: [
      { speaker: 'agent', at: 0, text: 'Vanakkam! Arogya Demo Hospital, Kavya pesuren. Ungalukku eppadi udhava mudiyum?' },
      { speaker: 'caller', at: 6, text: 'Nalaikku Sunday OPD irukka?' },
      { speaker: 'agent', at: 12, text: 'Sunday-la emergency mattum thaan. OPD Monday mudhal Saturday varai, kaalai 8 mudhal iravu 8 varai.' },
      { speaker: 'caller', at: 24, text: 'Parking?' },
      { speaker: 'agent', at: 28, text: 'Basement-la free parking irukku, Gandhipuram Main Road vazhiya.' },
    ],
    steps: [[0, 'Greeting'], [12, 'Answer from the knowledge base']],
  },
]

/** Each live call lasts this long, then the next one starts on the same "line". */
const LIVE_CYCLE = 150

/** Calls in progress now. They come and go as time passes, so the page is
 * worth refreshing. `taken` holds who took over which call. */
export function liveCalls(orgSlug: string, taken: Record<string, string>, paused: Set<string>): LiveCall[] {
  if (orgSlug !== 'arogya-demo') return []
  const now = Date.now() / 1000
  return LIVE_SCRIPTS.flatMap((s, i) => {
    if (paused.has(s.agent)) return []
    // Staggered, so they don't all start together.
    const t = now + i * 53
    const cycle = Math.floor(t / LIVE_CYCLE)
    const elapsed = Math.floor(t % LIVE_CYCLE)
    // A gap between calls: some of the time a line is quiet.
    if (elapsed > 110) return []
    const agent = AGENTS.find((a) => a.id === s.agent)!
    const r = rng(hash(`${s.agent}:${i}:${cycle}`))
    const id = `live_${i}_${cycle}`
    return [
      {
        id,
        agentId: agent.id,
        agentName: agent.name,
        line: agent.line,
        callerPhone: maskPhone(phone(r)),
        startedAt: new Date((now - elapsed) * 1000).toISOString(),
        language: s.language,
        intent: elapsed >= 8 ? s.intent : null,
        step: [...s.steps].reverse().find(([at]) => at <= elapsed)?.[1] ?? null,
        turns: s.turns.filter((turn) => turn.at <= elapsed),
        flagged: s.flagged && elapsed >= 4,
        takenBy: taken[id] ?? null,
      },
    ]
  })
}

// ---------------------------------------------------------------- handoffs, callbacks, appointments

export function seedHandoffs(orgSlug: string): Handoff[] {
  if (orgSlug !== 'arogya-demo') return []
  const min = (m: number) => ago(m / 1440)
  return [
    {
      id: 'ho_1',
      callId: 'live_handoff_1',
      agentName: 'Main reception',
      line: '+91 00000 01200',
      callerPhone: '+91 ••••• 21877',
      reason: 'The caller asked for a person.',
      summary: 'Wants to know why the insurance claim for his father (discharged on Monday) isn’t settled. Has called three times; sounds frustrated.',
      details: [
        { label: 'Patient name', value: 'Ramasamy K', personal: true },
        { label: 'Policy number', value: 'SH-88213-02', personal: true },
      ],
      language: 'english',
      waitingSince: min(2),
      status: 'waiting',
      takenBy: null,
      takenAt: null,
      emergency: false,
    },
    {
      id: 'ho_2',
      callId: 'live_handoff_2',
      agentName: 'OPD appointments',
      line: '+91 00000 01210',
      callerPhone: '+91 ••••• 50442',
      reason: 'No slot suited the caller.',
      summary: 'Needs a cardiology review this week; both offered slots clash with dialysis. Asks if Dr. Ramachandran can see her on Saturday.',
      details: [
        { label: 'Patient name', value: 'Selvi Murugan', personal: true },
        { label: 'Department', value: 'Cardiology', personal: false },
        { label: 'Visit type', value: 'Review', personal: false },
      ],
      language: 'tamil',
      waitingSince: min(4.5),
      status: 'waiting',
      takenBy: null,
      takenAt: null,
      emergency: false,
    },
    {
      id: 'ho_3',
      callId: 'live_handoff_3',
      agentName: 'Main reception',
      line: '+91 00000 01200',
      callerPhone: '+91 ••••• 77310',
      reason: 'The agent couldn’t answer twice.',
      summary: 'Asking whether the hospital does home sample collection in Saibaba Colony. Not in the knowledge base.',
      details: [],
      language: 'tanglish',
      waitingSince: min(0.7),
      status: 'waiting',
      takenBy: null,
      takenAt: null,
      emergency: false,
    },
    {
      id: 'ho_4',
      callId: 'call_prev_4',
      agentName: 'OPD appointments',
      line: '+91 00000 01210',
      callerPhone: '+91 ••••• 13308',
      reason: 'The caller asked for a person.',
      summary: 'Wanted to book for two family members at once.',
      details: [{ label: 'Patient name', value: 'Divya Prakash', personal: true }],
      language: 'tanglish',
      waitingSince: min(38),
      status: 'taken',
      takenBy: 'Meena S',
      takenAt: min(37),
      emergency: false,
    },
    {
      id: 'ho_5',
      callId: 'call_prev_5',
      agentName: 'Main reception',
      line: '+91 00000 01200',
      callerPhone: '+91 ••••• 66120',
      reason: 'The caller hung up before anyone answered.',
      summary: 'Asked about visiting a patient in the ICU after hours.',
      details: [],
      language: 'tamil',
      waitingSince: min(75),
      status: 'missed',
      takenBy: null,
      takenAt: null,
      emergency: false,
    },
  ]
}

export function seedCallbacks(orgSlug: string): Callback[] {
  if (orgSlug !== 'arogya-demo') return []
  const h = (x: number) => ago(x / 24)
  const due = (x: number) => ahead(x / 24)
  const meena = { id: 'u_frontdesk', name: 'Meena S' }
  const suresh = { id: 'u_frontdesk2', name: 'Suresh B' }
  const cb = (c: Partial<Callback> & Pick<Callback, 'id' | 'callerPhone' | 'reason' | 'requestedAt' | 'dueBy'>): Callback => ({
    callerName: null,
    assignedTo: null,
    status: 'open',
    attempts: 0,
    notes: [],
    callId: null,
    ...c,
  })
  return [
    cb({ id: 'cb_1', callerName: 'Fathima B', callerPhone: '+91 98402 33415', reason: 'Wants a call back about her mother’s MRI preparation (fasting, metal implants).', requestedAt: h(1.5), dueBy: due(0.5), assignedTo: meena }),
    cb({ id: 'cb_2', callerName: 'Joseph Antony', callerPhone: '+91 99620 18834', reason: 'Asked for the final bill amount before discharge tomorrow.', requestedAt: h(3), dueBy: h(0.5), assignedTo: suresh, attempts: 1, notes: [{ id: 'n_1', by: 'Suresh B', at: h(1), text: 'No answer. Will try after lunch.' }] }),
    cb({ id: 'cb_3', callerPhone: '+91 90031 77452', reason: 'Missed call from the OPD line at 7:52 PM; the caller hung up during the greeting.', requestedAt: h(14), dueBy: due(2) }),
    cb({ id: 'cb_4', callerName: 'Revathi M', callerPhone: '+91 94440 61208', reason: 'Wants to move her son’s paediatrics review to an evening slot; none were free.', requestedAt: h(5), dueBy: due(3), assignedTo: meena, callId: null }),
    cb({ id: 'cb_5', callerName: 'Anand Kumar', callerPhone: '+91 98945 30017', reason: 'Asked whether his company insurance (MD India) covers the master health check-up.', requestedAt: h(26), dueBy: h(2) }),
    cb({ id: 'cb_6', callerName: 'Senthil Kumar', callerPhone: '+91 97890 44125', reason: 'Lab report question for the doctor.', requestedAt: h(30), dueBy: h(6), assignedTo: meena, status: 'done', attempts: 0, notes: [{ id: 'n_2', by: 'Meena S', at: h(20), text: 'Explained the report would be reviewed at his appointment on Thursday.' }] }),
    cb({ id: 'cb_7', callerPhone: '+91 90254 88103', reason: 'Missed call after hours.', requestedAt: h(50), dueBy: h(30), assignedTo: suresh, status: 'unreachable', attempts: 3 }),
  ]
}

const dayFrom = (offset: number) => localDay(offset)

export function seedAppointments(orgSlug: string): Appointment[] {
  if (orgSlug !== 'arogya-demo') return []
  const r = rng(hash(`${orgSlug}:appointments`))
  const times = ['09:00', '09:30', '10:00', '10:30', '11:15', '12:00', '15:00', '16:30', '17:15', '18:00']
  const out: Appointment[] = []
  let n = 0
  for (let day = -2; day <= 6; day++) {
    const count = day < 0 ? 2 : 3 + Math.floor(r() * 3)
    for (let i = 0; i < count; i++) {
      const [department, doctor] = pick(r, DEPARTMENTS)
      const byAgent = r() > 0.25
      const check = byAgent && day >= 0 && r() > 0.8
      n++
      out.push({
        id: `apt_${n}`,
        patientName: pick(r, NAMES),
        phone: formatPhone(phone(r)),
        department,
        doctor,
        date: dayFrom(day),
        time: pick(r, times),
        status: day < 0 ? 'confirmed' : check ? 'needs_check' : r() > 0.5 ? 'confirmed' : r() > 0.15 ? 'booked' : 'cancelled',
        checkReason: check ? pick(r, ['The caller wasn’t sure of the date.', 'The name was hard to hear; check the spelling.', 'Booked outside the doctor’s usual hours.']) : undefined,
        bookedBy: byAgent ? 'agent' : 'staff',
        agentName: byAgent ? 'OPD appointments' : null,
        callId: null,
        createdAt: ago(Math.max(0.1, -day + 1 + r() * 3)),
      })
    }
  }
  return out
}
