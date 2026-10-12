import type { AgentSummary, ConsoleClient } from './types'
import { seedAgents } from './demo/agents'
import { copy, makeWait } from './demo/runtime'

/**
 * Sample data for the organisation console until the real API exists. No
 * request leaves the browser. Each organisation's data is seeded on first
 * use and kept in memory, so changes last until the page reloads. The UI
 * labels all of it "Demo data".
 */

/** One organisation's sample data. Grows as console pages are added. */
interface OrgData {
  agents: AgentSummary[]
}

export interface DemoConsoleOptions {
  /** Simulated round trip, in ms. Tests pass 0. */
  latency?: number
}

export function createDemoConsoleClient({ latency = 600 }: DemoConsoleOptions = {}): ConsoleClient {
  const wait = makeWait(latency)
  const orgs = new Map<string, OrgData>()
  const org = (slug: string): OrgData => {
    let d = orgs.get(slug)
    if (!d) {
      d = { agents: seedAgents(slug) }
      orgs.set(slug, d)
    }
    return d
  }

  return {
    isDemo: true,

    async listAgents(orgSlug) {
      await wait()
      return copy(org(orgSlug).agents)
    },
  }
}
