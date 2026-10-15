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
