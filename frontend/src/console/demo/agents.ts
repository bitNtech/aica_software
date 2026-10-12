import type { AgentSummary } from '../types'
import { ago } from './runtime'

/** Sample agents. Phone numbers are deliberately undialable (+91 00000 …),
 * so nobody takes a sample for a real line. */

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

export function seedAgents(orgSlug: string): AgentSummary[] {
  return structuredClone(BY_ORG[orgSlug] ?? SAMPLE_AGENTS)
}

