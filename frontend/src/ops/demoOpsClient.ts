import { AuthError, type OrgStatus, type PlatformRole } from '../auth/types'
import { seedAgents } from '../console/demo/agents'
import { seedCalls } from '../console/demo/calls'
import { seedKnowledge } from '../console/demo/library'
import { seedBilling } from '../console/demo/manage'
import { callLog, hash, liveCalls, rng, seedHandoffs, seedMembers, type LogContext } from '../console/demo/operations'
import { currentPlans, MODEL_OPTIONS, platform, savePlatform } from '../console/demo/platform'
import { copy, DAY, makeWait } from '../console/demo/runtime'
import { seedDetail } from '../console/demo/specs'
import { VOICES } from '../console/demo/templates'
import type { CallOutcome, Plan } from '../console/types'
import type {
  AgentHealth,
  Deployment,
  IncidentRecord,
  IncidentStatus,
  SecurityPolicy,
  Health,
  Incident,
  LiveOps,
  LiveOpsFailure,
  OpsDataClient,
  OpsTemplate,
  OrgAttention,
  OrgDetail,
  OrgJob,
  OrgStatusChange,
  OrgUsage,
  OverviewActivity,
  OverviewAgent,
  OverviewBucket,
  OverviewDays,
  OverviewOutcome,
  PlatformAlert,
  PlatformOverview,
  PlatformService,
  ServiceFailure,
  ServiceHealth,
  UsageDays,
} from './types'

/**
 * Sample data for the Ops pages without an API yet. No request leaves the
 * browser. Template, voice, plan and model changes go to the shared platform
 * store, so the organisation console's builder and billing follow them.
 */

const IST = 5.5 * 36e5
const istDay = (ms: number) => Math.floor((ms + IST) / DAY)
const isoDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)

/** The sample organisations (as the demo sign-in store has them). */
const ORGS: Record<string, { name: string; status: OrgStatus; createdDays: number; owner: string; suspendedDays?: number; reason?: string }> = {
  'arogya-demo': { name: 'Arogya Demo Hospital', status: 'active', createdDays: 120, owner: 'Lakshmi K' },
  'nila-eye-demo': { name: 'Nila Eye Clinic (demo)', status: 'active', createdDays: 60, owner: 'Karthik R' },
  'kaveri-scan-demo': { name: 'Kaveri Scans (demo)', status: 'pending_review', createdDays: 2, owner: 'Sathish V' },
  'thendral-demo': { name: 'Thendral Child Clinic (demo)', status: 'pending_review', createdDays: 0.2, owner: 'Dr. Anitha M' },
  'marutham-demo': {
    name: 'Marutham Hospital (demo)',
    status: 'suspended',
    createdDays: 400,
    owner: 'Ravi P',
    suspendedDays: 14,
    reason: 'The annual licence lapsed on 30 September. Renew it to restore access.',
  },
}

const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const notFound = (what: string) => new AuthError('invalid_input', `That ${what} doesn't exist any more.`)

/** The organisation's call log, with the lab-report agent paused 9 days ago. */
const logCtx = (slug: string): LogContext => ({ orgSlug: slug, paused: new Set(), pauses: { agt_reports: [{ from: Date.now() - 9 * DAY, to: null }] } })

/** Call minutes and counts per IST day for one organisation, oldest first. */
function dailyUse(slug: string, days: number): { calls: number[]; minutes: number[] } {
  const today = istDay(Date.now())
  const calls = new Array<number>(days).fill(0)
  const seconds = new Array<number>(days).fill(0)
  if (slug === 'arogya-demo') {
    // The same call log the organisation's own reports read.
    for (const c of callLog(logCtx(slug), days)) {
      const i = days - 1 - (today - istDay(Date.parse(c.startedAt)))
      if (i < 0 || i >= days) continue
      calls[i]++
      seconds[i] += c.durationSec
    }
  } else if (slug === 'marutham-demo') {
    // Busy until its suspension.
    const stop = today - (ORGS[slug].suspendedDays ?? 0)
    for (let i = 0; i < days; i++) {
      const d = today - (days - 1 - i)
      if (d >= stop) continue
      const r = rng(hash(`${slug}:${d}`))
      calls[i] = Math.round(38 + r() * 30)
      seconds[i] = calls[i] * (110 + r() * 40)
    }
  }
  return { calls, minutes: seconds.map((s) => Math.round(s / 60)) }
}

const uploadHours = (slug: string, fromMs: number, toMs = Date.now()) =>
  Math.round((seedCalls(slug).filter((c) => Date.parse(c.addedAt) >= fromMs && Date.parse(c.addedAt) < toMs).reduce((s, c) => s + c.durationSec, 0) / 3600) * 10) / 10

function history(slug: string): OrgStatusChange[] {
  const o = ORGS[slug]
  const out: OrgStatusChange[] = [{ at: ago(o.createdDays), status: 'created', by: `${o.owner} (signed up)` }]
  if (o.status !== 'pending_review') out.push({ at: ago(o.createdDays - 0.4), status: 'active', by: 'Vikram S' })
  if (o.status === 'suspended') out.push({ at: ago(o.suspendedDays!), status: 'suspended', by: 'Vikram S', reason: o.reason })
  return out.reverse()
}

/** Failures the organisation's jobs show, on top of the seeded library. */
const FAILED: Record<string, OrgJob[]> = {
  'arogya-demo': [
    { id: 'job_silent', kind: 'recording', name: 'Reception 12 Oct, 4.12 pm.mp3', status: 'failed', addedAt: ago(2.2), error: 'Silent after the first 4 seconds. The phone system may have saved only one side.' },
    { id: 'job_kb_ins', kind: 'knowledge', name: 'Insurance partners (web page)', status: 'failed', addedAt: ago(2.3), error: 'The page asked for a sign-in, so nothing could be read.' },
  ],
}

// ---------------------------------------------------------------- service status

const SERVICES: { id: ServiceHealth['id']; name: string; role: string; p50: number; p95: number; perHour: number }[] = [
  { id: 'speech', name: 'Speech recognition', role: 'Turns callers’ speech into text', p50: 280, p95: 640, perHour: 5200 },
  { id: 'voice', name: 'Voice', role: 'Speaks the agents’ replies', p50: 190, p95: 420, perHour: 4100 },
  { id: 'language', name: 'Language model', role: 'Decides what the agent says', p50: 720, p95: 1600, perHour: 3900 },
]

/** Voice runs slow for 20 minutes every 3 hours, so the page shows a problem. */
const slowVoice = (minute: number) => minute % 180 >= 100 && minute % 180 < 120

function serviceAt(s: (typeof SERVICES)[number], minute: number) {
  const r = rng(hash(`${s.id}:${minute}`))
  const slow = s.id === 'voice' && slowVoice(minute)
  const k = slow ? 2.6 : 1
  return { p50: Math.round(s.p50 * k * (0.9 + r() * 0.2)), p95: Math.round(s.p95 * k * (0.85 + r() * 0.3)), errors: slow ? 0.031 + r() * 0.01 : 0.002 + r() * 0.004 }
}

const ORG_NAMES = ['Arogya Demo Hospital', 'Marutham Hospital (demo)', 'Nila Eye Clinic (demo)']
const FAILURE_TEXT: Record<ServiceHealth['id'], string[]> = {
  speech: ['No speech heard for 8 seconds', 'Audio stream closed early'],
  voice: ['Reply took over 3 seconds to start', 'Timed out after 5 seconds'],
  language: ['Timed out after 8 seconds', 'Reply was cut off'],
}

/** One service over the last 30 minutes and hour, as the status page shows it. */
function serviceHealth(s: (typeof SERVICES)[number], minute: number): ServiceHealth {
  const recent = Array.from({ length: 30 }, (_, i) => serviceAt(s, minute - 29 + i))
  const last15 = recent.slice(-15)
  const hour = Array.from({ length: 60 }, (_, i) => serviceAt(s, minute - 59 + i))
  const errorRate = hour.reduce((a, x) => a + x.errors, 0) / hour.length
  const p95 = Math.round(last15.reduce((a, x) => a + x.p95, 0) / last15.length)
  const health: Health = p95 > s.p95 * 2 || errorRate > 0.02 ? 'degraded' : 'ok'
  return {
    id: s.id,
    name: s.name,
    role: s.role,
    health,
    p50: Math.round(last15.reduce((a, x) => a + x.p50, 0) / last15.length),
    p95,
    errorRate,
    requestsLastHour: Math.round(s.perHour * (0.9 + rng(hash(`${s.id}:${Math.floor(minute / 10)}`))() * 0.2)),
    p95ByMinute: recent.map((x) => x.p95),
    ...(health !== 'ok' ? { note: 'Replies are slow to start. Agents still answer; callers hear a longer pause.' } : {}),
  }
}

/** Failures in the `minutes` up to `minute`, newest first, at most `max`. */
function failuresBack(minute: number, minutes: number, max: number): ServiceFailure[] {
  const out: ServiceFailure[] = []
  for (let m = minute; m > minute - minutes && out.length < max; m -= 1) {
    const r = rng(hash(`fail:${m}`))
    const slow = slowVoice(m)
    if (r() > (slow ? 0.55 : 0.985)) {
      const svc = slow && r() < 0.8 ? SERVICES[1] : SERVICES[Math.floor(r() * 3)]
      const texts = FAILURE_TEXT[svc.id]
      out.push({ id: `f_${m}`, at: new Date(m * 60_000 + Math.floor(r() * 59_000)).toISOString(), service: svc.name, org: ORG_NAMES[Math.floor(r() * 2)], what: texts[Math.floor(r() * texts.length)] })
    }
  }
  return out
}

/** The phone lines: time to connect a call, steady apart from noise. */
function telephony(minute: number): PlatformService {
  const at = (m: number) => {
    const r = rng(hash(`tel:${m}`))
    return { p50: Math.round(140 * (0.9 + r() * 0.2)), p95: Math.round(380 * (0.85 + r() * 0.3)), errors: 0.001 + r() * 0.003 }
  }
  const recent = Array.from({ length: 30 }, (_, i) => at(minute - 29 + i))
  const last15 = recent.slice(-15)
  const hour = Array.from({ length: 60 }, (_, i) => at(minute - 59 + i))
  return {
    id: 'telephony',
    name: 'Telephony',
    health: 'ok',
    errorRate: hour.reduce((a, x) => a + x.errors, 0) / hour.length,
    p50: Math.round(last15.reduce((a, x) => a + x.p50, 0) / last15.length),
    p95: Math.round(last15.reduce((a, x) => a + x.p95, 0) / last15.length),
    p95ByMinute: recent.map((x) => x.p95),
  }
}

// ---------------------------------------------------------------- overview

/** Calls in each IST hour, relative: quiet at night, busiest late morning. */
const HOUR_WEIGHT = [0.2, 0.1, 0.1, 0.1, 0.2, 0.4, 1, 2, 4, 6, 7, 7, 6, 5, 5, 5.5, 6, 5, 4, 3, 2, 1.2, 0.6, 0.3]
const OUTCOMES: CallOutcome[] = ['resolved', 'booked', 'callback', 'handed_over', 'emergency', 'dropped']
const OUTCOME_WEIGHT = [38, 27, 9, 12, 1, 5]

function pick<T>(r: () => number, xs: T[], weights: number[]): T {
  let x = r() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < xs.length; i++) {
    x -= weights[i]
    if (x < 0) return xs[i]
  }
  return xs[xs.length - 1]
}

const hourOf = (ms: number) => Math.floor(((ms + IST) % DAY) / 36e5)
const clock = (h: number) => `${h % 12 || 12} ${h % 24 < 12 ? 'am' : 'pm'}`

interface CallRec {
  at: number
  day: number
  hour: number
  agentId: string
  outcome: OverviewOutcome
  sec: number
}

/** A technical failure on top of how the call went. The booking system
 * behind the appointments line fails more often, so one agent shows errors. */
const failedCall = (id: string, agentId: string) => rng(hash(`${id}:fail`))() < (agentId === 'agt_appointments' ? 0.08 : 0.02)

/** Every call one organisation took from IST day `from` until now. */
function orgCalls(slug: string, from: number): CallRec[] {
  const today = istDay(Date.now())
  const out: CallRec[] = []
  if (slug === 'arogya-demo') {
    for (const c of callLog(logCtx(slug), today - from + 1)) {
      const at = Date.parse(c.startedAt)
      const day = istDay(at)
      if (day < from) continue
      out.push({ at, day, hour: hourOf(at), agentId: c.agentId, outcome: failedCall(c.id, c.agentId) ? 'failed' : c.outcome, sec: c.durationSec })
    }
  } else if (slug === 'marutham-demo') {
    // As many a day as the usage page counts, until its suspension.
    const stop = today - (ORGS[slug].suspendedDays ?? 0)
    for (let d = from; d < stop; d++) {
      const r = rng(hash(`${slug}:${d}`))
      const calls = Math.round(38 + r() * 30)
      const sec = Math.round(110 + r() * 40)
      for (let i = 0; i < calls; i++) {
        const q = rng(hash(`${slug}:${d}:${i}`))
        const hour = pick(q, [...HOUR_WEIGHT.keys()], HOUR_WEIGHT)
        const agentId = q() < 0.6 ? 'agt_reception' : 'agt_appointments'
        const outcome = pick(q, OUTCOMES, OUTCOME_WEIGHT)
        out.push({ at: d * DAY - IST + hour * 36e5 + Math.floor(q() * 36e5), day: d, hour, agentId, outcome: failedCall(`${slug}:${d}:${i}`, agentId) ? 'failed' : outcome, sec })
      }
    }
  }
  return out
}

/** Typical and slowest-1-in-20 reply for some calls: steady, a little noise. */
function reply(key: string, base: number) {
  const r = rng(hash(key))
  const p50 = Math.round(base * (0.92 + r() * 0.16))
  return { p50, p95: Math.round(p50 * (1.7 + r() * 0.3)) }
}

const ok = (c: CallRec) => c.outcome !== 'failed' && c.outcome !== 'dropped'
const rate = (part: number, all: number) => (all ? part / all : null)

/** Builder drafts the console seeds for organisations with agents (demoClient's seedDrafts). */
const DRAFT = { id: 'draft_billing', name: 'Billing and insurance', useCase: 'Billing and insurance', startedDaysAgo: 2, updatedHoursAgo: 12 }

/** Two past incidents, so the history isn't empty. */
function seedIncidents(): IncidentRecord[] {
  const at = (d: number, h = 0) => new Date(Date.now() - d * DAY + h * 36e5).toISOString()
  const u = (d: number, h: number, by: string, status: IncidentStatus, text: string) => ({ at: at(d, h), by, status, text })
  return [
    {
      id: 'inc_lang_cut',
      title: 'Language model replies cut off mid-sentence',
      service: 'language',
      severity: 'major',
      status: 'resolved',
      startedAt: at(6),
      resolvedAt: at(6, 2),
      automatic: false,
      updates: [
        u(6, 2, 'Vikram S', 'resolved', 'The provider rolled back. Replies are complete again; we watched for an hour.'),
        u(6, 0.7, 'Vikram S', 'identified', 'A provider change shortened replies. They are rolling it back.'),
        u(6, 0, 'Vikram S', 'investigating', 'Some agents stop mid-sentence. Callers hear silence, then the agent carries on.'),
      ],
    },
    {
      id: 'inc_tel_circle',
      title: 'Calls from one mobile network not connecting',
      service: 'telephony',
      severity: 'critical',
      status: 'resolved',
      startedAt: at(12),
      resolvedAt: at(12, 1.5),
      automatic: false,
      updates: [
        u(12, 1.5, 'Divya K', 'resolved', 'The carrier fixed their routing. Calls connect normally.'),
        u(12, 0, 'Divya K', 'investigating', 'Callers on one network hear an engaged tone. Other networks are fine.'),
      ],
    },
  ]
}

export function createDemoOpsClient({ latency = 500 }: { latency?: number } = {}): OpsDataClient {
  const wait = makeWait(latency)
  let viewer: { id: string; name: string; platformRole: PlatformRole | null } | null = null
  /** Jobs retried in this tab: id → when. */
  const retried: Record<string, number> = {}
  /** Incidents declared or updated in this tab, and the two seeded past ones. */
  const incidents: IncidentRecord[] = seedIncidents()
  let security: SecurityPolicy = {
    passwordMinLength: 10,
    staffTwoStep: true,
    memberTwoStep: 'owners',
    staffSessionHours: 12,
    memberSessionDays: 14,
    idleMinutes: 60,
    staffIpRanges: [],
    actingMaxMinutes: 30,
    transcriptRetentionDays: 180,
    recordingRetentionDays: 90,
    updatedAt: ago(20),
    updatedBy: 'Vikram S',
  }

  /** Monitoring's own incident while the voice service is slow, unless someone has taken it over. */
  const autoIncident = (): IncidentRecord | null => {
    const minute = Math.floor(Date.now() / 60_000)
    if (!slowVoice(minute)) return null
    const began = minute - ((minute % 180) - 100)
    const id = `inc_voice_${began}`
    if (incidents.some((i) => i.id === id)) return null
    const at = new Date(began * 60_000).toISOString()
    return {
      id,
      title: 'Voice replies are slow to start',
      service: 'voice',
      severity: 'minor',
      status: 'investigating',
      startedAt: at,
      resolvedAt: null,
      automatic: true,
      updates: [{ at, by: 'Monitoring', status: 'investigating', text: 'The slowest 5% of voice replies are over twice their usual. Calls still connect; callers hear a longer pause.' }],
    }
  }
  const allIncidents = () => {
    const auto = autoIncident()
    return [...(auto ? [auto] : []), ...incidents].sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || b.startedAt.localeCompare(a.startedAt))
  }

  const staff = () => {
    if (viewer && !viewer.platformRole) throw new AuthError('forbidden', 'Only bitNtech staff can see this.')
  }
  const master = (what: string) => {
    if (viewer && viewer.platformRole !== 'master_admin') throw new AuthError('forbidden', `Only the master admin can ${what}.`)
  }
  const by = () => viewer?.name ?? 'You'

  const jobsOf = (slug: string): OrgJob[] => {
    const recordings: OrgJob[] = seedCalls(slug).map((c) => ({ id: c.id, kind: 'recording', name: c.name, status: c.status, addedAt: c.addedAt, ...(c.error ? { error: c.error } : {}) }))
    const knowledge: OrgJob[] =
      seedAgents(slug).length > 0 ? seedKnowledge().map((k) => ({ id: k.id, kind: 'knowledge', name: k.name, status: k.status === 'indexing' ? 'indexing' : k.status, addedAt: k.refreshedAt })) : []
    return [...(FAILED[slug] ?? []), ...recordings, ...knowledge]
      .map((j) => {
        const at = retried[j.id]
        if (at === undefined) return j
        // A retried job is queued for a few seconds, then done.
        const rest = { ...j }
        delete rest.error
        return { ...rest, status: Date.now() - at < 4000 ? ('queued' as const) : ('ready' as const) }
      })
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  }

  const template = (typeId: string, id: string): OpsTemplate => {
    const p = platform()
    const t = p.types.find((x) => x.id === typeId)
    const s = t?.subTypes.find((x) => x.id === id)
    if (!t || !s) throw notFound('template')
    const m = p.meta[`${typeId}/${id}`] ?? { published: true, updatedAt: p.updatedAt, updatedBy: p.updatedBy }
    return copy({ ...s, typeId, typeLabel: t.label, ...m })
  }

  const settings = () => {
    const p = platform()
    return copy({
      models: p.models,
      modelOptions: MODEL_OPTIONS,
      voices: VOICES.map((v) => ({ ...v, enabled: p.voices[v.id] !== false })),
      plans: p.plans,
      updatedAt: p.updatedAt,
      updatedBy: p.updatedBy,
    })
  }

  return {
    isDemo: true,

    setViewer(v) {
      viewer = v
    },

    async getOrgDetail(slug) {
      await wait()
      staff()
      if (!ORGS[slug]) throw notFound('organisation')
      const calls = seedCalls(slug)
      const agents = seedAgents(slug).map((a) => ({
        id: a.id,
        name: a.name,
        useCase: a.useCase,
        status: a.status,
        phoneNumber: a.phoneNumber,
        version: a.version,
        versions: (seedDetail(slug, a, calls)?.versions ?? []).map(({ version, publishedAt, publishedBy, note }) => ({ version, publishedAt, publishedBy, note })),
      }))
      const use = dailyUse(slug, 30)
      const plan = currentPlans().find((p) => p.id === seedBilling(slug).plan)
      const detail: OrgDetail = {
        slug,
        plan: plan?.name ?? 'Starter',
        members: ORGS[slug].status === 'pending_review' ? seedMembers(slug).filter((m) => m.role === 'owner') : seedMembers(slug),
        agents: ORGS[slug].status === 'pending_review' ? [] : agents,
        usage: {
          calls: use.calls.reduce((s, n) => s + n, 0),
          minutes: use.minutes.reduce((s, n) => s + n, 0),
          uploadHours: uploadHours(slug, Date.now() - 30 * DAY),
        },
        jobs: ORGS[slug].status === 'pending_review' ? [] : jobsOf(slug),
        history: history(slug),
      }
      return copy(detail)
    },

    async retryJob(slug, jobId) {
      await wait()
      master('retry jobs')
      const job = jobsOf(slug).find((j) => j.id === jobId)
      if (!job) throw notFound('job')
      if (job.status !== 'failed') throw new AuthError('invalid_input', 'Only a failed job can be tried again.')
      retried[jobId] = Date.now()
      return copy(jobsOf(slug).find((j) => j.id === jobId)!)
    },

    async listTemplates() {
      await wait()
      staff()
      return platform().types.flatMap((t) => t.subTypes.map((s) => template(t.id, s.id)))
    },

    async saveTemplate(input) {
      await wait()
      master('change templates')
      const p = platform()
      const t = p.types.find((x) => x.id === input.typeId)
      if (!t) throw new AuthError('invalid_input', 'Choose an industry.')
      const label = input.label.trim()
      const description = input.description.trim()
      const covers = input.covers.map((c) => c.trim()).filter(Boolean)
      if (label.length < 3 || label.length > 40) throw new AuthError('invalid_input', 'Give the template a name of 3 to 40 characters.')
      if (description.length < 10 || description.length > 160) throw new AuthError('invalid_input', 'Describe it in 10 to 160 characters.')
      if (covers.length < 2) throw new AuthError('invalid_input', 'List at least two things callers ask about.')
      if (covers.length > 8) throw new AuthError('invalid_input', 'List up to 8 things callers ask about.')
      if (new Set(covers.map((c) => c.toLowerCase())).size !== covers.length) throw new AuthError('invalid_input', 'One of the things callers ask about is listed twice.')
      if (t.subTypes.some((s) => s.id !== input.id && s.label.toLowerCase() === label.toLowerCase())) throw new AuthError('invalid_input', `${t.label} already has a template called “${label}”.`)
      const now = new Date().toISOString()
      let id = input.id
      if (id) {
        const s = t.subTypes.find((x) => x.id === id)
        if (!s) throw notFound('template')
        Object.assign(s, { label, description, covers })
      } else {
        const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'template'
        id = base
        for (let n = 2; t.subTypes.some((s) => s.id === id); n++) id = `${base}_${n}`
        t.subTypes.push({ id, label, description, covers })
      }
      const key = `${t.id}/${id}`
      // New templates start hidden, so they can be checked before builders see them.
      p.meta[key] = { published: p.meta[key]?.published ?? false, updatedAt: now, updatedBy: by() }
      savePlatform()
      return template(t.id, id)
    },

    async setTemplatePublished(typeId, id, published) {
      await wait()
      master('change templates')
      const p = platform()
      template(typeId, id)
      p.meta[`${typeId}/${id}`] = { published, updatedAt: new Date().toISOString(), updatedBy: by() }
      savePlatform()
      return template(typeId, id)
    },

    async getUsage(days: UsageDays) {
      await wait()
      staff()
      const today = istDay(Date.now())
      const dayList = Array.from({ length: days }, (_, i) => isoDay(today - (days - 1 - i)))
      const start = (today - days + 1) * DAY - IST
      const orgs: (OrgUsage & { prev: { calls: number; minutes: number; uploadHours: number } })[] = Object.entries(ORGS)
        .filter(([, o]) => o.status === 'active' || o.status === 'suspended')
        .map(([slug, o]) => {
          const use = dailyUse(slug, days * 2)
          const now = { calls: use.calls.slice(days), minutes: use.minutes.slice(days) }
          const plan = currentPlans().find((p) => p.id === seedBilling(slug).plan)!
          // Each organisation's reply times hold steady from day to day.
          const r = rng(hash(`${slug}:latency:${days}`))
          const replyP50Ms = Math.round(820 + r() * 260)
          return {
            slug,
            name: o.name,
            status: o.status,
            plan: plan.name,
            planMinutes: plan.minutes,
            calls: now.calls.reduce((s, n) => s + n, 0),
            minutes: now.minutes.reduce((s, n) => s + n, 0),
            uploadHours: uploadHours(slug, start),
            minutesByDay: now.minutes,
            replyP50Ms,
            replyP95Ms: Math.round(replyP50Ms * (1.6 + r() * 0.4)),
            prev: {
              calls: use.calls.slice(0, days).reduce((s, n) => s + n, 0),
              minutes: use.minutes.slice(0, days).reduce((s, n) => s + n, 0),
              uploadHours: uploadHours(slug, start - days * DAY, start),
            },
          }
        })
      const sum = (k: 'calls' | 'minutes' | 'uploadHours', xs: { calls: number; minutes: number; uploadHours: number }[]) => Math.round(xs.reduce((s, x) => s + x[k], 0) * 10) / 10
      const prev = orgs.map((o) => o.prev)
      return copy({
        days: dayList,
        orgs: orgs.map(({ prev: _prev, ...o }) => o).sort((a, b) => b.minutes - a.minutes),
        totals: { calls: sum('calls', orgs), minutes: sum('minutes', orgs), uploadHours: sum('uploadHours', orgs) },
        previous: { calls: sum('calls', prev), minutes: sum('minutes', prev), uploadHours: sum('uploadHours', prev) },
      })
    },

    async getPlatformSettings() {
      await wait()
      master('see platform settings')
      return settings()
    },

    async updatePlatformSettings(input) {
      await wait()
      master('change platform settings')
      // Check everything first: a refused change changes nothing.
      for (const k of Object.keys(MODEL_OPTIONS) as (keyof typeof MODEL_OPTIONS)[]) {
        if (!MODEL_OPTIONS[k].some((o) => o.id === input.models[k])) throw new AuthError('invalid_input', 'Choose a model for each service.')
      }
      const voices = Object.fromEntries(VOICES.map((v) => [v.id, input.voices[v.id] !== false]))
      if (!voices.kavya) throw new AuthError('invalid_input', 'Kavya is the voice new agents start with, so it can’t be switched off.')
      for (const lang of ['tamil', 'english'] as const) {
        if (!VOICES.some((v) => voices[v.id] && v.languages.includes(lang))) throw new AuthError('invalid_input', `Keep at least one voice that speaks ${lang === 'tamil' ? 'Tamil' : 'English'}.`)
      }
      const plans: Plan[] = input.plans.map((p) => ({ ...p }))
      if (plans.length !== platform().plans.length) throw new AuthError('invalid_input', 'Plans can be changed, not added or removed here.')
      for (const p of plans) {
        const whole = [p.price, p.minutes, p.agents, p.numbers, p.extraMinute].every((n) => Number.isInteger(n) && n >= 0)
        if (!whole) throw new AuthError('invalid_input', `${p.name}: use whole numbers, 0 or more.`)
        if (p.minutes < 100 || p.agents < 1 || p.numbers < 1) throw new AuthError('invalid_input', `${p.name} needs at least 100 minutes, 1 agent and 1 number.`)
      }
      for (let i = 1; i < plans.length; i++) {
        if (plans[i].price <= plans[i - 1].price || plans[i].minutes <= plans[i - 1].minutes)
          throw new AuthError('invalid_input', `${plans[i].name} must cost more, and include more minutes, than ${plans[i - 1].name}.`)
      }
      const p = platform()
      p.models = { ...input.models }
      p.voices = voices
      p.plans = plans.map((x, i) => ({ ...x, id: p.plans[i].id, name: p.plans[i].name }))
      p.updatedAt = new Date().toISOString()
      p.updatedBy = by()
      savePlatform()
      return settings()
    },

    async getServiceStatus() {
      await wait()
      staff()
      const now = Date.now()
      const minute = Math.floor(now / 60_000)
      const services = SERVICES.map((s) => serviceHealth(s, minute))
      const qr = rng(hash(`queue:${Math.floor(minute / 2)}`))
      const waiting = Math.floor(qr() * 6)
      const failures = failuresBack(minute, 24 * 60, 12)
      return copy({
        checkedAt: new Date(now).toISOString(),
        services,
        queue: { health: waiting > 4 ? 'degraded' : 'ok', waiting, oldestWaitSec: waiting ? Math.round(20 + qr() * 160) : 0, processedLastHour: Math.round(30 + qr() * 25), failedLastHour: Math.floor(qr() * 2) },
        failures,
      })
    },

    async getOverview(days: OverviewDays) {
      await wait()
      staff()
      const now = Date.now()
      const today = istDay(now)
      const hourNow = hourOf(now)
      const counted = Object.entries(ORGS).filter(([, o]) => o.status === 'active' || o.status === 'suspended')
      // One read of each organisation's calls covers the period, the one before, and the last 30 days.
      const from = today - Math.max(days * 2, 30) + 1
      const all = new Map(counted.map(([slug]) => [slug, orgCalls(slug, from)]))
      const flat = [...all.values()].flat()

      const start = today - days + 1
      const inPeriod = (c: CallRec) => c.day >= start
      // Today: up to this hour, against yesterday up to the same time.
      const inPrevious = (c: CallRec) => (days === 1 ? c.day === today - 1 && c.at <= now - DAY : c.day >= start - days && c.day < start)

      const buckets: OverviewBucket[] =
        days === 1
          ? Array.from({ length: hourNow + 1 }, (_, h) => ({ label: clock(h), name: `${clock(h)} to ${clock(h + 1)}` }))
          : Array.from({ length: days }, (_, i) => {
              const date = new Date(`${isoDay(start + i)}T12:00:00`)
              return { label: date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), name: date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) }
            })
      const bucketOf = (c: CallRec) => (days === 1 ? c.hour : c.day - start)
      const succeeded = new Array<number>(buckets.length).fill(0)
      const failed = new Array<number>(buckets.length).fill(0)
      const outcomes: Record<OverviewOutcome, number> = { resolved: 0, booked: 0, callback: 0, handed_over: 0, emergency: 0, dropped: 0, failed: 0 }
      const period = flat.filter(inPeriod)
      for (const c of period) {
        const b = bucketOf(c)
        if (b < 0 || b >= buckets.length) continue
        if (ok(c)) succeeded[b]++
        else failed[b]++
        outcomes[c.outcome]++
      }
      const replies = buckets.map((_, i) => (succeeded[i] + failed[i] ? reply(`overview:${days}:${i}:${start}`, 900) : null))
      const weighted = (k: 'p50' | 'p95') => {
        let sum = 0
        let n = 0
        replies.forEach((r, i) => {
          if (!r) return
          sum += r[k] * (succeeded[i] + failed[i])
          n += succeeded[i] + failed[i]
        })
        return n ? Math.round(sum / n) : null
      }
      const previous = flat.filter(inPrevious)

      const todayCalls = flat.filter((c) => c.day === today)
      const byHour = new Array<number>(hourNow + 1).fill(0)
      for (const c of todayCalls) if (c.hour <= hourNow) byHour[c.hour]++

      // Agents, judged for health on the last 7 days whatever the period.
      const minute = Math.floor(now / 60_000)
      const voiceSlow = slowVoice(minute)
      const agents: OverviewAgent[] = counted.flatMap(([slug, o]) => {
        const seeded = seedAgents(slug)
        if (seeded.length === 0) return []
        const calls = all.get(slug)!
        const rows: OverviewAgent[] = seeded.map((a) => {
          const mine = calls.filter((c) => c.agentId === a.id)
          const p = mine.filter(inPeriod)
          const week = mine.filter((c) => c.day > today - 7)
          const weekFailed = week.filter((c) => c.outcome === 'failed').length
          const r = p.length ? reply(`${slug}:${a.id}:reply`, 880) : null
          let health: AgentHealth = 'ok'
          let issue: string | undefined
          if (week.length >= 20 && weekFailed / week.length > 0.05) {
            health = 'errors'
            issue = `${Math.round((weekFailed / week.length) * 100)}% of calls in the last 7 days failed: the booking system didn’t answer, so callers were offered a callback.`
          } else if (voiceSlow && a.status === 'live' && o.status === 'active' && a.id === 'agt_reception') {
            health = 'degraded'
            issue = 'Its slowest replies are over twice its usual while the voice service is slow.'
          }
          return {
            orgSlug: slug,
            orgName: o.name,
            id: a.id,
            name: a.name,
            status: a.status,
            orgSuspended: o.status === 'suspended',
            version: a.version,
            updatedAt: a.updatedAt,
            calls: p.length,
            successRate: rate(p.filter(ok).length, p.length),
            handoffRate: rate(p.filter((c) => c.outcome === 'handed_over' || c.outcome === 'emergency').length, p.length),
            replyP50Ms: r?.p50 ?? null,
            replyP95Ms: r ? (health === 'degraded' ? r.p95 * 2 + 300 : r.p95) : null,
            errorRate: rate(p.filter((c) => c.outcome === 'failed').length, p.length),
            health,
            ...(issue ? { issue } : {}),
          }
        })
        rows.push({
          orgSlug: slug,
          orgName: o.name,
          id: DRAFT.id,
          name: DRAFT.name,
          status: 'draft',
          orgSuspended: o.status === 'suspended',
          version: null,
          updatedAt: new Date(now - DRAFT.updatedHoursAgo * 36e5).toISOString(),
          calls: 0,
          successRate: null,
          handoffRate: null,
          replyP50Ms: null,
          replyP95Ms: null,
          errorRate: null,
          health: 'ok',
        })
        return rows
      })

      const orgs = counted
        .map(([slug, o]) => {
          const p = all.get(slug)!.filter(inPeriod)
          return {
            slug,
            name: o.name,
            status: o.status,
            calls: p.length,
            minutes: Math.round(p.reduce((a, c) => a + c.sec, 0) / 60),
            successRate: rate(p.filter(ok).length, p.length),
            handoffRate: rate(p.filter((c) => c.outcome === 'handed_over' || c.outcome === 'emergency').length, p.length),
          }
        })
        .sort((a, b) => b.calls - a.calls)

      // Organisations that need someone at bitNtech to look.
      const attention: OrgAttention[] = []
      for (const [slug, o] of counted) {
        for (const a of agents) if (a.orgSlug === slug && a.health === 'errors') attention.push({ slug, name: o.name, tone: 'danger', reason: `${a.name}: ${a.issue}` })
        if (o.status === 'suspended') attention.push({ slug, name: o.name, tone: 'warn', reason: `Suspended ${o.suspendedDays} days ago. ${o.reason ?? ''}`.trim() })
        const failedJobs = jobsOf(slug).filter((j) => j.status === 'failed').length
        if (failedJobs) attention.push({ slug, name: o.name, tone: 'warn', reason: `${failedJobs} upload${failedJobs === 1 ? '' : 's'} couldn’t be processed.` })
        if (o.status === 'active') {
          const plan = currentPlans().find((x) => x.id === seedBilling(slug).plan)
          const minutes30 = all.get(slug)!.filter((c) => c.day > today - 30).reduce((a, c) => a + c.sec, 0) / 60
          const share = plan ? minutes30 / plan.minutes : 0
          if (share >= 0.8) attention.push({ slug, name: o.name, tone: share >= 1 ? 'danger' : 'warn', reason: `Used ${Math.round(share * 100)}% of the ${plan!.name} plan’s minutes in the last 30 days.` })
        }
      }
      attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1))

      // What happened: agents built and published, and admin decisions.
      const activity: OverviewActivity[] = []
      for (const [slug, o] of counted) {
        const seeded = seedAgents(slug)
        if (seeded.length === 0) continue
        const calls = seedCalls(slug)
        for (const a of seeded) {
          for (const v of seedDetail(slug, a, calls)?.versions ?? []) {
            activity.push({ id: `pub_${slug}_${a.id}_${v.version}`, at: v.publishedAt, kind: 'agent_published', who: v.publishedBy, what: `Published ${a.name} v${v.version} for ${o.name}${v.note ? `: ${v.note}` : ''}`, orgSlug: slug })
          }
        }
        activity.push({ id: `new_${slug}_${DRAFT.id}`, at: new Date(now - DRAFT.startedDaysAgo * DAY).toISOString(), kind: 'agent_created', who: 'Vikram S (bitNtech)', what: `Started a new agent, ${DRAFT.name}, for ${o.name}`, orgSlug: slug })
      }
      if (!viewer || viewer.platformRole === 'master_admin') {
        for (const [slug, o] of Object.entries(ORGS)) {
          for (const h of history(slug)) {
            if (h.status === 'active') activity.push({ id: `adm_${slug}_ok`, at: h.at, kind: 'admin', who: h.by, what: `Approved ${o.name}’s sign-up`, orgSlug: slug })
            if (h.status === 'suspended') activity.push({ id: `adm_${slug}_susp`, at: h.at, kind: 'admin', who: h.by, what: `Suspended ${o.name}${h.reason ? `: “${h.reason}”` : ''}`, orgSlug: slug })
          }
        }
        const p = platform()
        if (p.updatedBy) activity.push({ id: 'adm_platform', at: p.updatedAt, kind: 'admin', who: p.updatedBy, what: 'Changed the platform settings (models, voices or plans)' })
      }
      activity.sort((a, b) => b.at.localeCompare(a.at))

      const overview: PlatformOverview = {
        days,
        generatedAt: new Date(now).toISOString(),
        buckets,
        succeeded,
        failed,
        replyP50ByBucket: replies.map((r) => r?.p50 ?? null),
        replyP95ByBucket: replies.map((r) => r?.p95 ?? null),
        totals: {
          calls: period.length,
          succeeded: period.filter(ok).length,
          minutes: Math.round(period.reduce((a, c) => a + c.sec, 0) / 60),
          replyP50Ms: weighted('p50'),
          replyP95Ms: weighted('p95'),
        },
        previous: { calls: previous.length, succeeded: previous.filter(ok).length, replyP95Ms: previous.length ? reply(`overview-prev:${days}:${start}`, 900).p95 : null },
        outcomes,
        today: { calls: todayCalls.length, byHour, yesterdaySoFar: flat.filter((c) => c.day === today - 1 && c.at <= now - DAY).length },
        orgs,
        agents,
        attention,
        activity: activity.slice(0, 40),
      }
      return copy(overview)
    },

    async getLiveOps() {
      await wait()
      staff()
      const now = Date.now()
      const minute = Math.floor(now / 60_000)
      const slugOf = (name: string) => Object.entries(ORGS).find(([, o]) => o.name === name)?.[0] ?? null
      const live = Object.entries(ORGS)
        .filter(([, o]) => o.status === 'active')
        .flatMap(([slug, o]) =>
          liveCalls(slug, {}, new Set(['agt_reports'])).map((c) => ({ id: c.id, orgSlug: slug, orgName: o.name, agentName: c.agentName, startedAt: c.startedAt, intent: c.intent, flagged: c.flagged, takenBy: c.takenBy })),
        )
      const handoffs = Object.entries(ORGS)
        .filter(([, o]) => o.status === 'active')
        .flatMap(([slug, o]) =>
          seedHandoffs(slug)
            .filter((h) => h.status === 'waiting')
            .map((h) => ({ id: h.id, orgSlug: slug, orgName: o.name, agentName: h.agentName, reason: h.reason, waitingSince: h.waitingSince, emergency: h.emergency })),
        )
        .sort((a, b) => Number(b.emergency) - Number(a.emergency) || a.waitingSince.localeCompare(b.waitingSince))
      const failures: LiveOpsFailure[] = failuresBack(minute, 120, 20).map((f) => ({ ...f, orgSlug: slugOf(f.org) }))
      const services: PlatformService[] = [
        ...SERVICES.map((s) => {
          const h = serviceHealth(s, minute)
          return { id: h.id, name: h.name, health: h.health, errorRate: h.errorRate, p50: h.p50, p95: h.p95, p95ByMinute: h.p95ByMinute, ...(h.note ? { note: h.note } : {}) }
        }),
        telephony(minute),
      ]
      const incidents: Incident[] = []
      if (slowVoice(minute)) {
        const began = minute - ((minute % 180) - 100)
        incidents.push({
          id: `inc_voice_${began}`,
          title: 'Voice replies are slow to start',
          service: 'voice',
          startedAt: new Date(began * 60_000).toISOString(),
          status: minute - began < 10 ? 'investigating' : 'monitoring',
          update: minute - began < 10 ? 'The voice provider is looking into it. Calls still connect; callers hear a longer pause.' : 'The provider has moved traffic to another region. Watching replies come back to normal.',
        })
      }
      const alerts: PlatformAlert[] = []
      for (const h of handoffs.filter((x) => x.emergency))
        alerts.push({ id: `al_${h.id}`, severity: 'critical', title: 'An emergency call is waiting for a person', detail: `${h.orgName}, ${h.agentName}: ${h.reason}`, at: h.waitingSince, href: `/ops/orgs/${h.orgSlug}` })
      for (const s of services.filter((x) => x.health !== 'ok'))
        alerts.push({ id: `al_${s.id}`, severity: s.health === 'down' ? 'critical' : 'warning', title: `${s.name} is ${s.health === 'down' ? 'down' : 'slow'}`, detail: s.note ?? 'Replies are slower than usual.', at: new Date(now).toISOString(), href: '/ops/status' })
      const lastHour = failures.filter((f) => Date.parse(f.at) > now - 36e5).length
      if (lastHour >= 5) alerts.push({ id: 'al_failures', severity: 'warning', title: `${lastHour} call failures in the last hour`, detail: 'More than usual. See which service and organisation below.', at: new Date(now).toISOString(), href: '/ops/status' })
      alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
      const out: LiveOps = { checkedAt: new Date(now).toISOString(), calls: live, handoffs, failures, services, incidents, alerts }
      return copy(out)
    },

    async listDeployments() {
      await wait()
      staff()
      const out: Deployment[] = []
      for (const [slug, o] of Object.entries(ORGS)) {
        if (o.status !== 'active' && o.status !== 'suspended') continue
        const calls = seedCalls(slug)
        for (const a of seedAgents(slug)) {
          const versions = seedDetail(slug, a, calls)?.versions ?? []
          const latest = Math.max(...versions.map((v) => v.version))
          for (const v of versions)
            out.push({
              id: `dep_${slug}_${a.id}_${v.version}`,
              at: v.publishedAt,
              by: v.publishedBy,
              component: 'agent',
              title: `${a.name} v${v.version}`,
              note: v.note,
              status: v.version === latest && a.status === 'live' ? 'live' : 'superseded',
              orgSlug: slug,
              orgName: o.name,
              agentId: a.id,
              version: v.version,
            })
        }
      }
      const p = platform()
      out.push(
        { id: 'dep_app_3', at: ago(3), by: 'Vikram S', component: 'app', title: 'AICA web app, October release 3', note: 'Live calls and callbacks rebuilt; faster call history.', status: 'live' },
        { id: 'dep_app_2', at: ago(10), by: 'Vikram S', component: 'app', title: 'AICA web app, October release 2', note: 'Reports and agent versions.', status: 'superseded' },
        { id: 'dep_models', at: p.updatedAt, by: p.updatedBy || 'Vikram S', component: 'language', title: 'Platform settings: models, voices and plans', note: 'The defaults new agents start with.', status: 'live' },
      )
      return copy(out.sort((a, b) => b.at.localeCompare(a.at)))
    },

    async listIncidents() {
      await wait()
      staff()
      return copy(allIncidents())
    },

    async createIncident(input) {
      await wait()
      master('declare incidents')
      const title = input.title.trim()
      const text = input.text.trim()
      if (title.length < 5 || title.length > 100) throw new AuthError('invalid_input', 'Give the incident a title of 5 to 100 characters.')
      if (text.length < 10) throw new AuthError('invalid_input', 'Say what’s happening in at least a sentence.')
      const now = new Date().toISOString()
      const inc: IncidentRecord = { id: `inc_${Date.now().toString(36)}`, title, service: input.service, severity: input.severity, status: 'investigating', startedAt: now, resolvedAt: null, automatic: false, updates: [{ at: now, by: by(), status: 'investigating', text }] }
      incidents.unshift(inc)
      return copy(inc)
    },

    async updateIncident(id, update) {
      await wait()
      master('update incidents')
      let inc = incidents.find((i) => i.id === id)
      if (!inc) {
        // Taking over monitoring's incident keeps it.
        const auto = autoIncident()
        if (!auto || auto.id !== id) throw notFound('incident')
        inc = { ...auto, automatic: true }
        incidents.unshift(inc)
      }
      if (inc.status === 'resolved') throw new AuthError('invalid_input', 'This incident is resolved. Declare a new one if it’s back.')
      const text = update.text.trim()
      if (text.length < 5) throw new AuthError('invalid_input', 'Write what changed, in a sentence.')
      const now = new Date().toISOString()
      inc.status = update.status
      inc.updates.unshift({ at: now, by: by(), status: update.status, text })
      if (update.status === 'resolved') inc.resolvedAt = now
      return copy(inc)
    },

    async getSecurityPolicy() {
      await wait()
      staff()
      return copy(security)
    },

    async updateSecurityPolicy(input) {
      await wait()
      master('change security policies')
      const whole = (n: number, lo: number, hi: number, what: string) => {
        if (!Number.isInteger(n) || n < lo || n > hi) throw new AuthError('invalid_input', `${what}: a whole number from ${lo} to ${hi}.`)
      }
      whole(input.passwordMinLength, 8, 64, 'Shortest password')
      whole(input.staffSessionHours, 1, 72, 'bitNtech sign-in length')
      whole(input.memberSessionDays, 1, 90, 'Client sign-in length')
      whole(input.idleMinutes, 5, 480, 'Idle sign-out')
      whole(input.actingMaxMinutes, 5, 120, 'Acting as a user')
      whole(input.transcriptRetentionDays, 30, 3650, 'Keep transcripts')
      whole(input.recordingRetentionDays, 7, 3650, 'Keep recordings')
      const ranges = input.staffIpRanges.map((r) => r.trim()).filter(Boolean)
      const cidr = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/([0-9]|[12]\d|3[0-2])$/
      const bad = ranges.find((r) => !cidr.test(r))
      if (bad) throw new AuthError('invalid_input', `“${bad}” isn’t an address range. Write it like 203.0.113.0/24.`)
      security = { ...input, staffIpRanges: ranges, updatedAt: new Date().toISOString(), updatedBy: by() }
      return copy(security)
    },
  }
}
