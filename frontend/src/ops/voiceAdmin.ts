/**
 * The voice orchestrator's control plane, through the AICA API
 * (/api/ops/voice/…; backend app/routes/ops_voice.py). The API holds the
 * platform key; the browser never sees it. Changes carry the version the
 * page loaded, so a stale one is refused ("conflict") instead of
 * overwriting another admin's save. Secrets read back as "***", and "***"
 * sent back means "unchanged".
 */
import { request } from '../auth/httpClient'
import { apiBase } from '../lib/api'

/** Off in the demo build: there's no API to ask. */
export const voiceAdminAvailable = import.meta.env.VITE_AUTH_MODE !== 'demo'

export type JsonSchema = {
  type?: string | string[]
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  minimum?: number
  maximum?: number
  format?: string
  writeOnly?: boolean
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  additionalProperties?: JsonSchema | boolean
  anyOf?: JsonSchema[]
  $ref?: string
  $defs?: Record<string, JsonSchema>
}

export interface ConfigSchema {
  json_schema: JsonSchema
  /** Dotted paths set in the server's environment only. */
  locked: string[]
  secrets: string[]
  secrets_writable?: boolean
  /** Section → when a change takes effect, in words. */
  apply: Record<string, string>
  presets: string[]
}

export type Settings = Record<string, unknown>

export interface RuntimeConfig {
  version: number
  effective: Settings
  overrides: Settings
  overridden_paths?: string[]
  boot: Settings
  boot_error: string | null
  updated_at?: string | null
  updated_by?: string | null
}

export interface ComponentStatus {
  ok?: boolean
  url?: string
  detail?: Record<string, unknown>
  rtf_estimate?: number
  [k: string]: unknown
}

export interface VoiceStatus {
  instance_id?: string
  uptime_s?: number
  version?: string
  baseUrl: string
  ready?: { ok: boolean; status?: number; reasons?: unknown }
  config?: { version: number; overrides: number; boot_error: string | null; updated_at?: string | null }
  components: {
    llm?: ComponentStatus
    tts?: ComponentStatus
    asr?: { default?: string; providers?: Record<string, { loaded?: boolean; ready?: boolean; loading?: boolean; error?: string | null }> }
    prepipe?: { ok?: boolean; stages?: Record<string, { impl?: string; ready?: boolean; error?: string | null }> }
    store?: ComponentStatus
  }
  reloads?: Record<string, unknown>
  sessions: { live: number; max: number; accepting: boolean }
}

export interface CatalogueItem {
  id: string
  description?: string
  enabled: boolean
  in_use: string[]
  default?: boolean
  loaded?: boolean
  loading?: boolean
  load_error?: string | null
}

export interface ModelCatalogue {
  version: number
  kinds: Record<string, { scope?: string; items: CatalogueItem[] }>
}

export interface AdminSession {
  id: string
  tenant_id?: string
  voice_agent_id?: string | null
  llm_agent_id?: string | null
  started_at?: string
  channel?: string
  mode?: string
  state?: string
  org?: { slug: string; name: string } | null
  [k: string]: unknown
}

export interface HistoryEntry {
  id?: string
  at?: string
  ts?: string
  action?: string
  kind?: string
  actor?: string
  by?: string
  version?: number
  detail?: unknown
  [k: string]: unknown
}

export interface Preset {
  name: string
  settings: Settings
}

export interface VoiceAdmin {
  status(): Promise<VoiceStatus>
  config(): Promise<RuntimeConfig>
  schema(): Promise<ConfigSchema>
  patch(input: { set: Settings; reset: string[]; version: number; dryRun: boolean }): Promise<RuntimeConfig>
  resetAll(version: number): Promise<RuntimeConfig>
  presets(): Promise<{ data: Preset[] }>
  applyPreset(name: string, version: number, dryRun: boolean): Promise<RuntimeConfig>
  models(): Promise<ModelCatalogue>
  switchModel(kind: string, id: string, enabled: boolean, version?: number): Promise<unknown>
  asr(name: string, action: 'load' | 'unload'): Promise<unknown>
  testUpstream(which: 'llm' | 'tts', baseUrl: string, apiKey?: string): Promise<Record<string, unknown>>
  reload(component: 'asr' | 'prepipe' | 'llm' | 'tts'): Promise<unknown>
  admission(accepting: boolean): Promise<{ accepting: boolean }>
  sessions(): Promise<{ data: AdminSession[] }>
  endSession(id: string, reason: string): Promise<unknown>
  history(before?: string): Promise<{ data: HistoryEntry[]; next_before?: string | null }>
  orgVoice(slug: string): Promise<{ tenantId: string | null; connected: boolean; webhooks: boolean }>
  linkTenant(slug: string, tenantId: string | null): Promise<{ tenantId: string | null; connected: boolean; webhooks: boolean }>
}

export function createVoiceAdmin(base = apiBase()): VoiceAdmin {
  const get = <T>(p: string) => request<T>(base, 'GET', `/ops${p}`)
  const post = <T>(p: string, body?: unknown) => request<T>(base, 'POST', `/ops${p}`, body ?? {})
  const enc = encodeURIComponent
  return {
    status: () => get('/voice/status'),
    config: () => get('/voice/config'),
    schema: () => get('/voice/config/schema'),
    patch: (i) => post('/voice/config', i),
    resetAll: (version) => post('/voice/config/reset', { version }),
    presets: () => get('/voice/presets'),
    applyPreset: (name, version, dryRun) => post(`/voice/presets/${enc(name)}/apply`, { version, dryRun }),
    models: () => get('/voice/models'),
    // Model ids contain slashes (google/gemini-…): they stay as path segments.
    switchModel: (kind, id, enabled, version) => post(`/voice/models/${enc(kind)}/${id.split('/').map(enc).join('/')}/switch`, { enabled, version }),
    asr: (name, action) => post(`/voice/asr/${enc(name)}/${action}`),
    testUpstream: (which, baseUrl, apiKey) => post(`/voice/upstreams/${which}/test`, { baseUrl, apiKey: apiKey || undefined }),
    reload: (component) => post(`/voice/reload/${component}`),
    admission: (accepting) => post('/voice/admission', { accepting }),
    sessions: () => get('/voice/sessions'),
    endSession: (id, reason) => post(`/voice/sessions/${enc(id)}/end`, { reason }),
    history: (before) => get(`/voice/config/history${before ? `?before=${enc(before)}` : ''}`),
    orgVoice: (slug) => get(`/orgs/${enc(slug)}/voice`),
    linkTenant: (slug, tenantId) => post(`/orgs/${enc(slug)}/voice`, { tenantId }),
  }
}

// ---------------------------------------------------------------- settings paths

/** Resolves a `$ref` against the root schema's `$defs`. */
export function deref(s: JsonSchema | undefined, root: JsonSchema): JsonSchema {
  let cur = s ?? {}
  for (let i = 0; cur.$ref && i < 10; i++) {
    const name = cur.$ref.split('/').pop() ?? ''
    cur = { ...(root.$defs?.[name] ?? {}), ...Object.fromEntries(Object.entries(cur).filter(([k]) => k !== '$ref')) }
  }
  return cur
}

/** A nullable field (anyOf [X, null]) as X, and whether null is allowed. */
export function unwrapNullable(s: JsonSchema, root: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  if (s.anyOf?.length) {
    const nonNull = s.anyOf.filter((x) => x.type !== 'null')
    const nullable = nonNull.length < s.anyOf.length
    if (nonNull.length === 1) return { schema: { ...deref(nonNull[0], root), title: s.title, description: s.description, default: s.default }, nullable }
  }
  return { schema: deref(s, root), nullable: false }
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

/** {a.b: 1, a.c: 2} → {a: {b: 1, c: 2}} */
export function nest(flat: Record<string, unknown>): Settings {
  const out: Settings = {}
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split('.')
    let at: Record<string, unknown> = out
    for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>
    at[keys[keys.length - 1]] = value
  }
  return out
}

/** Every leaf path that's overridden, from the overrides document. */
export function leafPaths(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return prefix ? [prefix] : []
  const entries = Object.entries(obj as Record<string, unknown>)
  if (!entries.length) return prefix ? [prefix] : []
  return entries.flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k))
}

/** Locked or secret, by itself or because a parent section is. */
export function under(path: string, list: string[]): boolean {
  return list.some((p) => path === p || path.startsWith(`${p}.`))
}
