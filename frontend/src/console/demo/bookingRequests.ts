import { isOpen, nowKey, startsAt } from '../appointmentRecords'
import type { Appointment, AppointmentType, AutoConfirmResult, BookingSettings, PatientUpdate, PriorityLevel } from '../types'
import { localDay } from '../../lib/time'
import { ago, newId } from './runtime'
import { formatPhone, hash, NAMES, phone, pick, rng } from './operations'

/**
 * The agent's requests in the demo: several patients asking for one doctor
 * at one time, ranked (a stand-in for the LLM, which reads the same things:
 * what the patient said, the kind of visit, who asked first), the evening's
 * automatic confirmation, and the callback and WhatsApp message that tell
 * the patient. None of this calls anything: updates move on with the clock.
 */

/** Who the automatic confirmation is, in the history. */
export const AUTO_BY = 'Automatic confirmation'

export function seedBookingSettings(): BookingSettings {
  return { confirm: 'staff', autoAt: '19:00', autoSkipUrgent: true, autoSkipFlagged: true, others: 'offer', callback: true, whatsapp: true, retryCallback: true }
}

export const LEVEL_ORDER: Record<PriorityLevel, number> = { urgent: 0, high: 1, normal: 2, routine: 3 }
const URGENT = /chest pain|breath|bleed|faint|severe|drowsy|pregnan|accident|seizure/i
const HIGH = /pain|fever|infection|surgery|swelling|child|vomit|injur|fall/i
const ROUTINE = /review|check-?up|routine|results|test|x-ray|echo|mri|dressing/i

function judge(a: Appointment): { level: PriorityLevel; why: string } {
  const said = a.visitReason?.trim()
  if (!said) return { level: 'normal', why: 'Gave no reason for the visit, so ranked as an ordinary one' }
  const q = `“${said}”`
  if (URGENT.test(said)) return { level: 'urgent', why: `Said ${q} on the call: a symptom that should be seen soon` }
  if (HIGH.test(said)) return { level: 'high', why: `Said ${q}: needs to be seen, though nothing suggests an emergency` }
  if (ROUTINE.test(said) || a.type === 'test') return { level: 'routine', why: `${q}: a routine visit that could move to another time` }
  return { level: 'normal', why: `${q}: an ordinary visit` }
}

const slotKey = (a: Appointment) => `${a.doctor.toLowerCase().replace(/[^a-z0-9]/g, '')}|${a.date}|${a.time}`

/**
 * Ranks every time that more than one pending request asks for. A request
 * left alone loses its rank; settled ones keep theirs, as a record.
 */
export function refreshRanks(all: Appointment[], nowIso = new Date().toISOString()): void {
  const groups = new Map<string, Appointment[]>()
  for (const a of all) if (a.status === 'pending' && a.source === 'ai_call') groups.set(slotKey(a), [...(groups.get(slotKey(a)) ?? []), a])
  for (const a of all) if (a.rank && a.status === 'pending' && a.source !== 'ai_call') delete a.rank
  for (const group of groups.values()) {
    if (group.length < 2) {
      delete group[0].rank
      continue
    }
    const judged = group.map((a) => ({ a, ...judge(a) })).sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level] || x.a.createdAt.localeCompare(y.a.createdAt) || x.a.id.localeCompare(y.a.id))
    judged.forEach((j, i) => {
      const above = judged[i - 1]
      const next = judged[i + 1]
      const then =
        i === 0
          ? next && next.level === j.level
            ? 'Asked first among requests that are as pressing.'
            : `More pressing than the other ${group.length - 1 === 1 ? 'request' : `${group.length - 1} requests`} for this time.`
          : above.level === j.level
            ? 'As pressing as the one above, which was asked for earlier.'
            : 'Less pressing than the one above.'
      const old = j.a.rank
      j.a.rank = { position: i + 1, of: group.length, level: j.level, reasons: `${j.why}. ${then}`, rankedAt: old && old.position === i + 1 && old.of === group.length ? old.rankedAt : nowIso }
    })
  }
}

/* ------------------------------------------------------------ telling the patient */

const ABOUT_TEXT: Record<PatientUpdate['about'], string> = { confirmed: 'it’s confirmed', declined: 'the request was declined', moved: 'about the new time offered' }

/** Queues the callback and WhatsApp message the settings ask for. Only the agent's bookings: the desk tells its own patients. */
export function queueUpdates(a: Appointment, about: PatientUpdate['about'], s: BookingSettings, nowIso: string): void {
  if (a.source !== 'ai_call') return
  const channels = [...(s.callback ? (['callback'] as const) : []), ...(s.whatsapp ? (['whatsapp'] as const) : [])]
  if (channels.length === 0) return
  a.updates = [...channels.map((channel): PatientUpdate => ({ id: newId('upd'), about, channel, state: 'queued', at: nowIso, updatedAt: nowIso, attempts: 1 })), ...(a.updates ?? [])]
  const how = channels.map((c) => (c === 'callback' ? 'the agent calls back' : 'a WhatsApp message')).join(' and ')
  a.history = [{ at: nowIso, by: a.agentName ?? 'The agent', kind: 'notified', text: `Telling the patient ${ABOUT_TEXT[about]}: ${how}` }, ...(a.history ?? [])]
}

/** Drops what hasn't gone yet (Undo): returns whether anything was. */
export function withdrawQueued(a: Appointment): boolean {
  const before = a.updates?.length ?? 0
  a.updates = (a.updates ?? []).filter((u) => u.state !== 'queued')
  if (a.updates.length === 0) delete a.updates
  return (a.updates?.length ?? 0) < before
}

const S = 1000
const RETRY_AFTER = 30 * 60 * S
const fails = (u: PatientUpdate) => u.attempts === 1 && hash(`${u.id}`) % 7 === 0

/** Moves each update on with the clock: a callback rings and ends, a message is sent, delivered and read. */
export function advanceUpdates(a: Appointment, s: BookingSettings, now = Date.now()): void {
  for (const u of a.updates ?? []) {
    const start = Date.parse(u.at)
    const t = now - start
    const at = (ms: number) => new Date(start + ms).toISOString()
    if (u.channel === 'callback') {
      if (u.state === 'no_answer' && s.retryCallback && u.attempts === 1 && t >= 75 * S + RETRY_AFTER) Object.assign(u, { state: 'done', attempts: 2, updatedAt: at(75 * S + RETRY_AFTER + 60 * S), detail: 'Answered the second call.' })
      if (u.state !== 'queued' && u.state !== 'in_progress') continue
      if (t < 15 * S) continue
      if (t < 75 * S) Object.assign(u, { state: 'in_progress', updatedAt: at(15 * S) })
      else if (fails(u)) Object.assign(u, { state: 'no_answer', updatedAt: at(75 * S), detail: s.retryCallback ? `Calling again at ${new Date(start + 75 * S + RETRY_AFTER).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.` : 'Nobody answered.' })
      else Object.assign(u, { state: 'done', updatedAt: at(75 * S), detail: undefined })
    } else {
      if (u.state === 'read' || u.state === 'failed') continue
      if (t < 10 * S) continue
      if (fails(u)) Object.assign(u, { state: 'failed', updatedAt: at(10 * S), detail: 'This number isn’t on WhatsApp.' })
      else if (t < 30 * S) Object.assign(u, { state: 'sent', updatedAt: at(10 * S) })
      else if (t < 120 * S) Object.assign(u, { state: 'delivered', updatedAt: at(30 * S) })
      else Object.assign(u, { state: 'read', updatedAt: at(120 * S) })
    }
  }
}

/* ------------------------------------------------------------ the evening's automatic confirmation */

const pad = (n: number) => String(n).padStart(2, '0')
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** The doctor's next free half hour from the request's day, a week at most (Sundays closed, 9 am to 6 pm). */
export function nextFreeTime(all: Appointment[], a: Appointment, now = Date.now()): { date: string; time: string } | null {
  const nk = nowKey(now)
  for (let d = 0; d < 7; d++) {
    const date = localDay(d, new Date(`${a.date}T12:00:00`).getTime())
    if (new Date(`${date}T12:00:00`).getDay() === 0) continue
    for (let m = 9 * 60; m < 18 * 60; m += 30) {
      const time = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
      if (`${date} ${time}` <= nk || (date === a.date && time === a.time)) continue
      if (all.some((o) => o.id !== a.id && isOpen(o) && o.doctor === a.doctor && o.date === date && Math.abs(toMin(o.time) - m) < 30)) continue
      return { date, time }
    }
  }
  return null
}

const slotWords = (x: Pick<Appointment, 'date' | 'time' | 'doctor'>) => `${new Date(`${x.date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${x.time} with ${x.doctor}`
const LOST = 'The requested time went to a patient who needed it more.'

/**
 * Confirms the top-ranked request for each time still to come, and offers
 * the others the next free time (or declines them), as the settings say.
 * Urgent or flagged requests can be left for a person.
 */
export function runAuto(all: Appointment[], s: BookingSettings, now = Date.now()): AutoConfirmResult {
  const nowIso = new Date(now).toISOString()
  refreshRanks(all, nowIso)
  const nk = nowKey(now)
  const groups = new Map<string, Appointment[]>()
  for (const a of all) if (a.status === 'pending' && a.source === 'ai_call' && startsAt(a) > nk) groups.set(slotKey(a), [...(groups.get(slotKey(a)) ?? []), a])
  const out: AutoConfirmResult = { confirmed: 0, offered: 0, declined: 0, left: 0 }
  for (const g of groups.values()) {
    const [top, ...rest] = [...g].sort((x, y) => (x.rank?.position ?? 1) - (y.rank?.position ?? 1))
    const level = top.rank?.level
    if ((s.autoSkipUrgent && level === 'urgent') || (s.autoSkipFlagged && top.checkReason)) {
      out.left += g.length
      continue
    }
    top.status = 'confirmed'
    top.confirmedBy = 'auto'
    delete top.checkReason
    top.history = [{ at: nowIso, by: AUTO_BY, kind: 'confirmed', text: g.length > 1 ? `Confirmed automatically: ranked first of ${g.length} for this time` : 'Confirmed automatically' }, ...(top.history ?? [])]
    Object.assign(top, { updatedAt: nowIso, updatedBy: AUTO_BY })
    queueUpdates(top, 'confirmed', s, nowIso)
    out.confirmed++
    for (const o of rest) {
      const free = s.others === 'offer' ? nextFreeTime(all, o, now) : null
      if (free) {
        const was = slotWords(o)
        Object.assign(o, free, { status: 'rescheduled', updatedAt: nowIso, updatedBy: AUTO_BY })
        o.history = [{ at: nowIso, by: AUTO_BY, kind: 'rescheduled', text: `Offered ${slotWords(o)} instead of ${was}`, reason: LOST }, ...(o.history ?? [])]
        queueUpdates(o, 'moved', s, nowIso)
        out.offered++
      } else {
        const why = s.others === 'offer' ? `${LOST} No other time was free that week.` : LOST
        Object.assign(o, { status: 'declined', declineReason: why, updatedAt: nowIso, updatedBy: AUTO_BY })
        o.history = [{ at: nowIso, by: AUTO_BY, kind: 'declined', text: 'Declined automatically', reason: why }, ...(o.history ?? [])]
        queueUpdates(o, 'declined', s, nowIso)
        out.declined++
      }
      delete o.checkReason
    }
  }
  return out
}

/* ------------------------------------------------------------ the demo's own requests */

interface Ask {
  day: number
  dept: [string, string]
  time: string
  asks: { reason: string; type: AppointmentType; hoursAgo: number; check?: string }[]
}

const CONTESTED: Ask[] = [
  {
    day: 1,
    dept: ['Cardiology', 'Dr. R. Ramachandran'],
    time: '10:45',
    asks: [
      { reason: 'Review after starting BP tablets', type: 'follow_up', hoursAgo: 20 },
      { reason: 'Chest pain on climbing stairs, getting worse', type: 'new_visit', hoursAgo: 6 },
      { reason: 'Echo before the review', type: 'test', hoursAgo: 3 },
    ],
  },
  {
    day: 1,
    dept: ['Paediatrics', 'Dr. P. Lakshmi'],
    time: '16:45',
    asks: [
      { reason: 'Child not eating well', type: 'new_visit', hoursAgo: 9 },
      { reason: 'High fever since last night, child is drowsy', type: 'new_visit', hoursAgo: 2, check: 'The caller wasn’t sure of the child’s age.' },
    ],
  },
  {
    day: 2,
    dept: ['Orthopaedics', 'Dr. K. Arvind'],
    time: '11:45',
    asks: [
      { reason: 'X-ray of the knee', type: 'test', hoursAgo: 26 },
      { reason: 'Knee pain after a fall', type: 'new_visit', hoursAgo: 5 },
    ],
  },
  {
    day: 3,
    dept: ['General medicine', 'Dr. S. Meenakshi'],
    time: '09:45',
    asks: [
      { reason: 'Diabetes review', type: 'follow_up', hoursAgo: 30 },
      { reason: 'Fever for three days', type: 'new_visit', hoursAgo: 12 },
      { reason: 'Thyroid blood test', type: 'test', hoursAgo: 8 },
    ],
  },
]

/**
 * Requests that share a time (ranked), and two the hospital declined,
 * numbered after the other appointments. Settled agent bookings get the
 * callback and message that told the patient.
 */
export function seedRequests(orgSlug: string, appts: Appointment[]): Appointment[] {
  if (orgSlug !== 'arogya-demo') return appts
  const r = rng(hash(`${orgSlug}:requests`))
  let n = appts.length
  const agent = 'OPD appointments'
  const made = (day: number, dept: [string, string], time: string, reason: string, type: AppointmentType, hoursAgo: number): Appointment => {
    const createdAt = ago(hoursAgo / 24)
    return {
      id: `apt_${++n}`,
      patientName: pick(r, NAMES),
      phone: formatPhone(phone(r)),
      department: dept[0],
      doctor: dept[1],
      date: localDay(day),
      time,
      status: 'pending',
      source: 'ai_call',
      bookedBy: 'agent',
      agentName: agent,
      callId: null,
      type,
      visitReason: reason,
      createdAt,
      updatedAt: createdAt,
      updatedBy: agent,
      history: [{ at: createdAt, by: agent, kind: 'created', text: 'Booked on a call by the agent' }],
    }
  }
  const extra: Appointment[] = []
  for (const g of CONTESTED) for (const a of g.asks) extra.push({ ...made(g.day, g.dept, g.time, a.reason, a.type, a.hoursAgo), ...(a.check ? { checkReason: a.check } : {}) })
  for (const [day, dept, time, reason, why] of [
    [-2, ['ENT', 'Dr. V. Senthil'], '10:00', 'Ear blocked for a week', 'Dr. Senthil was in theatre all morning; offered Thursday instead.'],
    [-5, ['Cardiology', 'Dr. R. Ramachandran'], '12:00', 'Results of last week’s tests', 'The time went to a patient with chest pain.'],
  ] as const) {
    const a = made(day, [dept[0], dept[1]], time, reason, 'follow_up', -day * 24 + 20)
    const at = ago(-day + 0.6)
    a.status = 'declined'
    a.declineReason = why
    a.history = [{ at, by: 'Meena S', kind: 'declined', text: 'Declined', reason: why }, ...a.history!]
    a.updatedAt = at
    a.updatedBy = 'Meena S'
    a.updates = told('declined', at)
    extra.push(a)
  }
  refreshRanks(extra)

  // Settled agent bookings: the patient was told once it was confirmed.
  let k = 0
  for (const a of appts) {
    if (a.source !== 'ai_call') continue
    const confirm = a.history?.find((h) => h.kind === 'confirmed')
    if (!confirm) continue
    a.confirmedBy = 'staff'
    a.updates = told('confirmed', confirm.at)
    // A few to show what goes wrong: no WhatsApp on the number, and a callback answered the second time.
    if (a.status === 'confirmed' && k < 2) {
      if (k === 0) Object.assign(a.updates[1], { state: 'failed', detail: 'This number isn’t on WhatsApp.' })
      else Object.assign(a.updates[0], { attempts: 2, detail: 'Answered the second call.' })
      k++
    }
  }
  const auto = appts.find((a) => a.source === 'ai_call' && a.status === 'confirmed' && a.confirmedBy === 'staff')
  if (auto) {
    auto.confirmedBy = 'auto'
    const h = auto.history!.find((x) => x.kind === 'confirmed')!
    Object.assign(h, { by: AUTO_BY, text: 'Confirmed automatically' })
  }
  for (const a of [...appts, ...extra]) {
    for (const u of a.updates ?? []) if (a.history && !a.history.some((h) => h.kind === 'notified')) a.history.unshift({ at: u.at, by: agent, kind: 'notified', text: `Told the patient ${ABOUT_TEXT[u.about]}: the agent called back and a WhatsApp message` })
    a.history?.sort((x, y) => y.at.localeCompare(x.at))
  }
  return [...appts, ...extra]
}

/** A callback that was answered and a WhatsApp message that was read, a few minutes after `at`. */
function told(about: PatientUpdate['about'], at: string): PatientUpdate[] {
  const t = Date.parse(at)
  const iso = (min: number) => new Date(t + min * 60e3).toISOString()
  return [
    { id: `upd_${hash(at + 'c')}`, about, channel: 'callback', state: 'done', at, updatedAt: iso(2), attempts: 1 },
    { id: `upd_${hash(at + 'w')}`, about, channel: 'whatsapp', state: 'read', at, updatedAt: iso(9), attempts: 1 },
  ]
}
