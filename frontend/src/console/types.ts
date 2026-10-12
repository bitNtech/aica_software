import type { Language } from '../auth/types'

/**
 * The organisation console's data, as the pages expect it. Provisional: the
 * shapes follow docs/pages-and-access.md and change once the voice
 * pipeline's real contracts (agent format, call records) are agreed.
 */

/** draft: never published, or edits since. live: answering a number.
 * paused: published, but not answering. */
export type AgentStatus = 'draft' | 'live' | 'paused'

export interface AgentSummary {
  id: string
  name: string
  /** From builder step 1, e.g. "Appointments". */
  useCase: string
  status: AgentStatus
  /** The number it answers, formatted for display; null until assigned. */
  phoneNumber: string | null
  languages: Language[]
  /** The published version, or null if never published. */
  version: number | null
  /** ISO timestamp, or null if never published. */
  lastPublishedAt: string | null
  /** ISO timestamp of the last edit. */
  updatedAt: string
  callsThisWeek: number
}

/** Methods reject with an `AuthError` (auth/types.ts), whose message is
 * written for the person using the console. Pages show it as-is, so a real
 * client must map its failures to one too. */
export interface ConsoleClient {
  /** True while every console page runs on built-in sample data. The UI
   * labels it, so nobody mistakes it for their real configuration. */
  readonly isDemo: boolean
  listAgents(orgSlug: string): Promise<AgentSummary[]>
}
