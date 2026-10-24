import type { OrgStatus, PlatformRole } from '../auth/types'
import type { AgentStatus, AgentSubType, Member, Plan, SourceCallStatus, Voice } from '../console/types'

/**
 * bitNtech Ops pages that have no API yet: organisation detail, the template
 * library, usage, platform settings and service status. Provisional shapes,
 * on sample data (labelled "Demo data") until the backend exists. Methods
 * reject with an AuthError whose message is written for the user.
 */
export interface OpsDataClient {
  readonly isDemo: boolean
  /** What's behind one organisation: team, agents, usage, jobs, history. */
  getOrgDetail(slug: string): Promise<OrgDetail>
  /** Master admin: process a failed upload or knowledge job again. */
  retryJob(slug: string, jobId: string): Promise<OrgJob>

  /** Starting agents by industry and use case, as builder step 1 offers them. */
  listTemplates(): Promise<OpsTemplate[]>
  /** Master admin: creates (no `id`) or changes a template. */
  saveTemplate(input: TemplateInput): Promise<OpsTemplate>
  /** Master admin: shows or hides a template in the builder. */
  setTemplatePublished(typeId: string, id: string, published: boolean): Promise<OpsTemplate>

  getUsage(days: UsageDays): Promise<UsageReport>

  /** Master admin only. */
  getPlatformSettings(): Promise<PlatformSettings>
  updatePlatformSettings(input: PlatformSettingsInput): Promise<PlatformSettings>

  getServiceStatus(): Promise<ServiceStatus>

  /** The overview's figures across every organisation, for a period. */
  getOverview(days: OverviewDays): Promise<PlatformOverview>
  /** What's happening now: calls in progress, handoffs, failures, health. Polled. */
  getLiveOps(): Promise<LiveOps>

  /** Who is asking (a real server knows from the session). */
  setViewer?(viewer: { id: string; name: string; platformRole: PlatformRole | null } | null): void
}

export interface OrgAgent {
  id: string
  name: string
  useCase: string
  status: AgentStatus
  phoneNumber: string | null
  version: number | null
  versions: { version: number; publishedAt: string; publishedBy: string; note: string }[]
}

export type OrgJobStatus = SourceCallStatus | 'indexing'

export interface OrgJob {
  id: string
  kind: 'recording' | 'knowledge'
  name: string
  status: OrgJobStatus
  addedAt: string
  /** Why it failed, in words. */
  error?: string
}

export interface OrgStatusChange {
  at: string
  status: OrgStatus | 'created'
  by: string
  reason?: string
}

export interface OrgDetail {
  slug: string
  plan: string
  members: Member[]
  agents: OrgAgent[]
  /** The last 30 days. */
  usage: { calls: number; minutes: number; uploadHours: number }
  jobs: OrgJob[]
  history: OrgStatusChange[]
}

export interface OpsTemplate extends AgentSubType {
  typeId: string
  /** The industry, e.g. "Hospital". */
  typeLabel: string
  /** Offered in builder step 1. Hidden ones stay for agents built from them. */
  published: boolean
  updatedAt: string
  updatedBy: string
}

export interface TemplateInput {
  typeId: string
  /** Absent for a new template. */
  id?: string
  label: string
  description: string
  covers: string[]
}

export type UsageDays = 7 | 30 | 90

export interface OrgUsage {
  slug: string
  name: string
  status: OrgStatus
  plan: string
  /** The plan's minutes a month, for the share used. */
  planMinutes: number
  calls: number
  minutes: number
  uploadHours: number
  /** Call minutes per day, oldest first, matching `days`. */
  minutesByDay: number[]
  /** Caller stops → agent starts, across the period, ms: typical and slowest 1 in 20. */
  replyP50Ms: number
  replyP95Ms: number
}

export interface UsageReport {
  /** "YYYY-MM-DD" in India, oldest first. */
  days: string[]
  orgs: OrgUsage[]
  totals: { calls: number; minutes: number; uploadHours: number }
  /** The same length of time just before. */
  previous: { calls: number; minutes: number; uploadHours: number }
}

export interface ModelOption {
  id: string
  label: string
  note: string
}

/** Which model each external service runs by default. Names only: service
 * addresses and keys live in server configuration, never in the browser. */
export interface ModelChoice {
  speech: string
  voice: string
  language: string
}

export interface PlatformSettings {
  models: ModelChoice
  modelOptions: Record<keyof ModelChoice, ModelOption[]>
  voices: (Voice & { enabled: boolean })[]
  plans: Plan[]
  updatedAt: string
  updatedBy: string
}

export interface PlatformSettingsInput {
  models: ModelChoice
  /** Voice id → offered to organisations. */
  voices: Record<string, boolean>
  plans: Plan[]
}

export type Health = 'ok' | 'degraded' | 'down'

export interface ServiceHealth {
  id: 'speech' | 'voice' | 'language'
  name: string
  /** What it does, in a few words. */
  role: string
  health: Health
  /** Milliseconds, the last 15 minutes. */
  p50: number
  p95: number
  /** Share of requests that failed in the last hour, 0 to 1. */
  errorRate: number
  requestsLastHour: number
  /** p95 per minute, the last 30 minutes, oldest first. */
  p95ByMinute: number[]
  /** What's wrong, when it isn't ok. */
  note?: string
}

export interface QueueHealth {
  health: Health
  waiting: number
  /** Seconds the oldest waiting job has waited. */
  oldestWaitSec: number
  processedLastHour: number
  failedLastHour: number
}

export interface ServiceFailure {
  id: string
  at: string
  service: string
  org: string
  what: string
}

export interface ServiceStatus {
  checkedAt: string
  services: ServiceHealth[]
  queue: QueueHealth
  failures: ServiceFailure[]
}

// ---------------------------------------------------------------- overview

/** Today (by hour), or the last 7 or 30 days (by day). Days are in India. */
export type OverviewDays = 1 | 7 | 30

/**
 * How calls ended. `failed` is a technical failure (a service error, the
 * line dropping on our side); `dropped` is the caller hanging up before
 * anything was settled. A call succeeds when it is neither.
 */
export type OverviewOutcome = 'resolved' | 'booked' | 'callback' | 'handed_over' | 'emergency' | 'dropped' | 'failed'

export interface OverviewBucket {
  /** Short, under a column: "10 am", "6 Oct". */
  label: string
  /** In full, for the readout: "10 to 11 am", "Monday 6 October". */
  name: string
}

/** One organisation's calls in the period. Active and suspended ones only. */
export interface OverviewOrgUsage {
  slug: string
  name: string
  status: OrgStatus
  calls: number
  minutes: number
  /** 0 to 1. Null with no calls. */
  successRate: number | null
  /** Handed to a person (including emergencies), 0 to 1. Null with no calls. */
  handoffRate: number | null
}

export type AgentHealth = 'ok' | 'degraded' | 'errors'

export interface OverviewAgent {
  orgSlug: string
  orgName: string
  id: string
  name: string
  status: AgentStatus
  /** Its organisation is suspended, so it isn't answering whatever its status. */
  orgSuspended: boolean
  version: number | null
  updatedAt: string
  calls: number
  successRate: number | null
  handoffRate: number | null
  /** Caller stops → agent starts, ms. Null with no calls. */
  replyP50Ms: number | null
  replyP95Ms: number | null
  /** Calls that ended on a technical failure, 0 to 1. */
  errorRate: number | null
  /** `errors`: over 5% of calls failed. `degraded`: slowest replies over twice its usual. */
  health: AgentHealth
  /** What's wrong, in words, when health isn't ok. */
  issue?: string
}

export type ActivityKind = 'agent_created' | 'agent_published' | 'admin'

/** An event across the platform. Sign-ups come from the organisation list. */
export interface OverviewActivity {
  id: string
  at: string
  kind: ActivityKind
  /** Who did it, e.g. "Vikram S" or "Lakshmi K (Arogya Demo Hospital)". */
  who: string
  /** What happened, in words, without callers' details. */
  what: string
  orgSlug?: string
}

export interface OrgAttention {
  slug: string
  name: string
  tone: 'warn' | 'danger'
  /** Why, in words: "Used 92% of its plan's minutes". */
  reason: string
}

export interface PlatformOverview {
  days: OverviewDays
  generatedAt: string
  buckets: OverviewBucket[]
  /** Per bucket, oldest first. Succeeded + failed = all calls. */
  succeeded: number[]
  failed: number[]
  /** Slowest 1 in 20 and typical replies per bucket, ms; null with no calls. */
  replyP50ByBucket: (number | null)[]
  replyP95ByBucket: (number | null)[]
  totals: { calls: number; succeeded: number; minutes: number; replyP50Ms: number | null; replyP95Ms: number | null }
  /** The same length of time just before (for today: yesterday to the same hour). */
  previous: { calls: number; succeeded: number; replyP95Ms: number | null }
  outcomes: Record<OverviewOutcome, number>
  /** Calls so far today, by hour, and yesterday up to the same hour. Whatever the period. */
  today: { calls: number; byHour: number[]; yesterdaySoFar: number }
  orgs: OverviewOrgUsage[]
  agents: OverviewAgent[]
  attention: OrgAttention[]
  /** Newest first. Admin actions are left out for anyone but the master admin. */
  activity: OverviewActivity[]
}

export interface LiveOpsCall {
  id: string
  orgSlug: string
  orgName: string
  agentName: string
  startedAt: string
  /** What the caller wants, once the agent knows. */
  intent: string | null
  /** The caller sounds upset or stuck. */
  flagged: boolean
  takenBy: string | null
}

export interface LiveOpsHandoff {
  id: string
  orgSlug: string
  orgName: string
  agentName: string
  /** Why the agent handed over, in words. */
  reason: string
  waitingSince: string
  emergency: boolean
}

export interface LiveOpsFailure extends ServiceFailure {
  orgSlug: string | null
}

export type PlatformServiceId = ServiceHealth['id'] | 'telephony'

export interface PlatformService {
  id: PlatformServiceId
  name: string
  health: Health
  /** The last hour, 0 to 1. */
  errorRate: number
  /** The last 15 minutes, ms. */
  p50: number
  p95: number
  /** p95 per minute, the last 30 minutes, oldest first. */
  p95ByMinute: number[]
  note?: string
}

export interface Incident {
  id: string
  title: string
  service: PlatformServiceId
  startedAt: string
  status: 'investigating' | 'monitoring'
  /** The latest update, in words. */
  update: string
}

export interface PlatformAlert {
  id: string
  severity: 'critical' | 'warning'
  title: string
  detail: string
  at: string
  /** Where to go about it, inside the Ops app. */
  href?: string
}

export interface LiveOps {
  checkedAt: string
  calls: LiveOpsCall[]
  handoffs: LiveOpsHandoff[]
  /** The last 2 hours, newest first. */
  failures: LiveOpsFailure[]
  services: PlatformService[]
  incidents: Incident[]
  /** Worst first. */
  alerts: PlatformAlert[]
}
