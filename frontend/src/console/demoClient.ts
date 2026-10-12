import { AuthError } from '../auth/types'
import type { AgentSummary, ConsoleClient } from './types'

/**
 * Sample data for the organisation console until the real API exists. No
 * request leaves the browser. Every organisation gets the same sample
 * agents unless it has its own set below, labelled "Demo data" in the UI.
 * Phone numbers are deliberately undialable (+91 00000 …), so nobody takes
 * a sample for a real line.
 */

const DAY = 864e5
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const SAMPLE_AGENTS: AgentSummary[] = [
  {
    id: 'agt_reception',
    name: 'Main reception',
    useCase: 'General enquiries',
    status: 'live',
    phoneNumber: '+91 00000 01200',
    languages: ['tamil', 'english', 'tanglish'],
    version: 7,
    lastPublishedAt: ago(3),
    updatedAt: ago(3),
    callsThisWeek: 1284,
  },
  {
    id: 'agt_appointments',
    name: 'OPD appointments',
    useCase: 'Appointments',
    status: 'live',
    phoneNumber: '+91 00000 01210',
    languages: ['tamil', 'tanglish'],
    version: 12,
    lastPublishedAt: ago(1),
    updatedAt: ago(0.2),
    callsThisWeek: 862,
  },
  {
    id: 'agt_reports',
    name: 'Lab report status',
    useCase: 'Report status',
    status: 'paused',
    phoneNumber: '+91 00000 01220',
    languages: ['tamil', 'english'],
    version: 3,
    lastPublishedAt: ago(21),
    updatedAt: ago(9),
    callsThisWeek: 0,
  },
  {
    id: 'agt_billing',
    name: 'Billing and insurance',
    useCase: 'Billing status',
    status: 'draft',
    phoneNumber: null,
    languages: ['english', 'tanglish'],
    version: null,
    lastPublishedAt: null,
    updatedAt: ago(0.5),
    callsThisWeek: 0,
  },
]

/** Organisations with their own sample set. Empty shows the first-run state. */
const BY_ORG: Record<string, AgentSummary[]> = {
  'nila-eye-demo': [],
}

export interface DemoConsoleOptions {
  /** Simulated round trip, in ms. Tests pass 0. */
  latency?: number
}

export function createDemoConsoleClient({ latency = 600 }: DemoConsoleOptions = {}): ConsoleClient {
  const wait = () =>
    new Promise<void>((resolve, reject) => {
      const ms = latency ? latency * (0.8 + Math.random() * 0.5) : 0
      setTimeout(() => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          reject(new AuthError('network', "We couldn't reach AICA. Check your connection and try again."))
        } else resolve()
      }, ms)
    })

  return {
    isDemo: true,

    async listAgents(orgSlug) {
      await wait()
      return structuredClone(BY_ORG[orgSlug] ?? SAMPLE_AGENTS)
    },
  }
}
