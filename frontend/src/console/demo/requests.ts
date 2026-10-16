import type { ChangeRequest } from '../types'
import { ago } from './runtime'

/** Sample requests to bitNtech: one being worked on, one waiting, one done. */
export function seedChangeRequests(orgSlug: string): ChangeRequest[] {
  if (orgSlug !== 'arogya-demo') return []
  const req = (r: Omit<ChangeRequest, 'orgSlug'>): ChangeRequest => ({ orgSlug, ...r })
  return [
    req({
      id: 'cr_sms_reports',
      kind: 'flow_change',
      agentId: 'agt_reports',
      agentName: 'Lab report status',
      title: 'Text the report link when it’s ready',
      detail: 'When a caller asks about a report that is ready, offer to send the download link by SMS instead of asking them to come in.',
      urgency: 'soon',
      status: 'in_progress',
      createdAt: ago(3),
      createdBy: 'Karthik R',
      createdById: 'u_admin',
      updatedAt: ago(1),
      replies: [
        { id: 'crr_1', by: 'Vikram S', byKind: 'bitntech', at: ago(2), text: 'We’ll add a step after “Say when it’s ready”. Does your lab system give a link we can send, or should the SMS say to log in to the patient portal?' },
        { id: 'crr_2', by: 'Karthik R', byKind: 'member', at: ago(1.5), text: 'The portal gives a link per report. Our IT team will share the API details.' },
        { id: 'crr_3', by: 'Vikram S', byKind: 'bitntech', at: ago(1), text: 'Thanks. Building it now; we’ll publish once it passes the test scenarios.' },
      ],
    }),
    req({
      id: 'cr_health_check',
      kind: 'new_agent',
      agentId: null,
      agentName: null,
      title: 'An agent for master health check-up packages',
      detail: 'Callers ask which package suits them, the price, fasting rules and booking. About 40 calls a week. Recordings are in Call uploads (“Health check” calls).',
      urgency: 'normal',
      status: 'open',
      createdAt: ago(0.6),
      createdBy: 'Lakshmi K',
      createdById: 'u_owner',
      updatedAt: ago(0.6),
      replies: [],
    }),
    req({
      id: 'cr_cancel',
      kind: 'flow_change',
      agentId: 'agt_appointments',
      agentName: 'OPD appointments',
      title: 'Let callers cancel an appointment',
      detail: 'Add cancelling to the appointments agent, reading the booking back before cancelling.',
      urgency: 'normal',
      status: 'done',
      createdAt: ago(24),
      createdBy: 'Karthik R',
      createdById: 'u_admin',
      updatedAt: ago(20),
      replies: [{ id: 'crr_4', by: 'Vikram S', byKind: 'bitntech', at: ago(20), text: 'Added “Cancel an appointment” and published it. It reads the booking back before cancelling.' }],
    }),
  ]
}
