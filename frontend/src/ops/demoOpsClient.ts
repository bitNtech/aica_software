import { AuthError, type OrgStatus, type PlatformRole } from '../auth/types'
import { seedAgents } from '../console/demo/agents'
import { seedCalls } from '../console/demo/calls'
import { seedKnowledge } from '../console/demo/library'
import { seedBilling } from '../console/demo/manage'
import { callLog, hash, rng, seedMembers, type LogContext } from '../console/demo/operations'
import { currentPlans, MODEL_OPTIONS, platform, savePlatform } from '../console/demo/platform'
import { copy, DAY, makeWait } from '../console/demo/runtime'
import { seedDetail } from '../console/demo/specs'
import { VOICES } from '../console/demo/templates'
import type { Plan } from '../console/types'
import type { Health, OpsDataClient, OpsTemplate, OrgDetail, OrgJob, OrgStatusChange, OrgUsage, ServiceFailure, ServiceHealth, UsageDays } from './types'

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

/** Call minutes and counts per IST day for one organisation, oldest first. */
function dailyUse(slug: string, days: number): { calls: number[]; minutes: number[] } {
  const today = istDay(Date.now())
  const calls = new Array<number>(days).fill(0)
  const seconds = new Array<number>(days).fill(0)
  if (slug === 'arogya-demo') {
    // The same call log the organisation's own reports read.
    const ctx: LogContext = { orgSlug: slug, paused: new Set(), pauses: { agt_reports: [{ from: Date.now() - 9 * DAY, to: null }] } }
    for (const c of callLog(ctx, days)) {
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

export function createDemoOpsClient({ latency = 500 }: { latency?: number } = {}): OpsDataClient {
  const wait = makeWait(latency)
  let viewer: { id: string; name: string; platformRole: PlatformRole | null } | null = null
  /** Jobs retried in this tab: id → when. */
  const retried: Record<string, number> = {}

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
      const services: ServiceHealth[] = SERVICES.map((s) => {
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
      })
      const qr = rng(hash(`queue:${Math.floor(minute / 2)}`))
      const waiting = Math.floor(qr() * 6)
      const failures: ServiceFailure[] = []
      for (let m = minute; m > minute - 24 * 60 && failures.length < 12; m -= 1) {
        const r = rng(hash(`fail:${m}`))
        const slow = slowVoice(m)
        if (r() > (slow ? 0.55 : 0.985)) {
          const svc = slow && r() < 0.8 ? SERVICES[1] : SERVICES[Math.floor(r() * 3)]
          const texts = FAILURE_TEXT[svc.id]
          failures.push({ id: `f_${m}`, at: new Date(m * 60_000 + Math.floor(r() * 59_000)).toISOString(), service: svc.name, org: ORG_NAMES[Math.floor(r() * 2)], what: texts[Math.floor(r() * texts.length)] })
        }
      }
      return copy({
        checkedAt: new Date(now).toISOString(),
        services,
        queue: { health: waiting > 4 ? 'degraded' : 'ok', waiting, oldestWaitSec: waiting ? Math.round(20 + qr() * 160) : 0, processedLastHour: Math.round(30 + qr() * 25), failedLastHour: Math.floor(qr() * 2) },
        failures,
      })
    },
  }
}
