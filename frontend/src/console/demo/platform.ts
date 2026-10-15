import type { ModelChoice, ModelOption } from '../../ops/types'
import type { AgentSubType, AgentType, Plan, Voice } from '../types'
import { PLANS } from './manage'
import { AGENT_TYPES, VOICES } from './templates'

/**
 * bitNtech's platform-wide sample settings: the template library, the voice
 * catalogue, plans and default models. Shared by the Ops pages (which change
 * them) and the organisation console (builder step 1, voices, billing), so a
 * change in Ops shows in the builder. Kept in this browser tab only.
 */

const KEY = 'aica.demo.platform.v1'

export interface TemplateMeta {
  published: boolean
  updatedAt: string
  updatedBy: string
}

export interface PlatformState {
  types: AgentType[]
  /** By `${typeId}/${subTypeId}`. */
  meta: Record<string, TemplateMeta>
  voices: Record<string, boolean>
  plans: Plan[]
  models: ModelChoice
  updatedAt: string
  updatedBy: string
}

export const MODEL_OPTIONS: Record<keyof ModelChoice, ModelOption[]> = {
  speech: [
    { id: 'asr-ta-en-v2', label: 'Tamil–English v2', note: 'Current. Handles Tanglish.' },
    { id: 'asr-ta-en-v3', label: 'Tamil–English v3 (trial)', note: 'Better on numbers and names; slower.' },
  ],
  voice: [
    { id: 'tts-ta-en-v1', label: 'Natural voices v1', note: 'Current.' },
    { id: 'tts-ta-en-v2', label: 'Natural voices v2 (trial)', note: 'More natural Tamil; costs more.' },
  ],
  language: [
    { id: 'llm-standard', label: 'Standard', note: 'Current. Fast enough for live calls.' },
    { id: 'llm-large', label: 'Large', note: 'Better at long calls; slower to reply.' },
  ],
}

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString()

function seed(): PlatformState {
  const meta: Record<string, TemplateMeta> = {}
  for (const t of AGENT_TYPES) for (const s of t.subTypes) meta[`${t.id}/${s.id}`] = { published: true, updatedAt: ago(30), updatedBy: 'Vikram S' }
  return {
    types: structuredClone(AGENT_TYPES),
    meta,
    voices: Object.fromEntries(VOICES.map((v) => [v.id, true])),
    plans: structuredClone(PLANS),
    models: { speech: 'asr-ta-en-v2', voice: 'tts-ta-en-v1', language: 'llm-standard' },
    updatedAt: ago(14),
    updatedBy: 'Vikram S',
  }
}

let state: PlatformState | null = null

export function platform(): PlatformState {
  if (state) return state
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (raw) state = JSON.parse(raw) as PlatformState
  } catch {
    /* storage blocked or corrupt */
  }
  return (state ??= seed())
}

export function savePlatform() {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* changes last until reload */
  }
}

/** Back to the sample settings (tests). */
export function resetPlatform() {
  state = seed()
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing kept */
  }
}

/** What builder step 1 offers: published templates only. */
export function publishedTypes(): AgentType[] {
  const p = platform()
  return p.types.map((t) => ({ ...t, subTypes: t.subTypes.filter((s) => p.meta[`${t.id}/${s.id}`]?.published !== false) })).filter((t) => t.subTypes.length > 0)
}

/** Any template, published or not: agents built from a hidden one still need it. */
export function findSubType(typeId: string | null | undefined, subId: string | null | undefined): AgentSubType | undefined {
  return platform().types.find((t) => t.id === typeId)?.subTypes.find((s) => s.id === subId)
}

export function enabledVoices(): Voice[] {
  const p = platform()
  return VOICES.filter((v) => p.voices[v.id] !== false)
}

export function currentPlans(): Plan[] {
  return platform().plans
}
