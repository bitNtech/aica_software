import type { AnswerFlag, DoctorChange, Notice } from '../types'
import { localDay } from '../../lib/time'
import { ago, ahead } from './runtime'

/** Sample bot desk: a notice running today, a doctor away, a flagged answer. */

/** A line switched to staff: numberId → when, why, who. */
export interface LineMode {
  until: string | null
  reason: string
  by: string
}

export function seedNotices(orgSlug: string): Notice[] {
  if (orgSlug !== 'arogya-demo') return []
  return [
    {
      id: 'ntc_lift',
      text: 'The lift in Block B is under repair today. Patients for physiotherapy can use the ramp near the pharmacy.',
      agentId: null,
      from: ago(0.2),
      until: ahead(0.5),
      createdBy: 'Meena S',
      createdAt: ago(0.2),
    },
  ]
}

export function seedDoctorChanges(orgSlug: string): DoctorChange[] {
  if (orgSlug !== 'arogya-demo') return []
  return [
    { id: 'doc_senthil', doctor: 'Dr. V. Senthil', department: 'ENT', date: localDay(0), kind: 'away', detail: 'On leave today. Dr. Kavitha sees ENT patients in room 12.', createdBy: 'Meena S', createdAt: ago(0.15) },
    { id: 'doc_arvind', doctor: 'Dr. K. Arvind', department: 'Orthopaedics', date: localDay(1), kind: 'late', detail: 'Seeing patients from 11 AM tomorrow, after surgery.', createdBy: 'Priya N', createdAt: ago(0.1) },
  ]
}

export function seedFlags(orgSlug: string): AnswerFlag[] {
  if (orgSlug !== 'arogya-demo') return []
  return [
    {
      id: 'flag_sunday',
      callId: null,
      agentName: 'Main reception',
      text: 'Told a caller the pharmacy closes at 8 PM on Sundays.',
      correction: 'The pharmacy is open 24 hours, every day.',
      by: 'Suresh B',
      at: ago(0.3),
      status: 'open',
    },
    {
      id: 'flag_fee',
      callId: null,
      agentName: 'Main reception',
      text: 'Gave the old consultation fee (₹400).',
      correction: 'It is ₹500 from 1 October.',
      by: 'Meena S',
      at: ago(5),
      status: 'fixed',
      resolution: { by: 'Karthik R', at: ago(4.5), note: 'Updated the OPD and lab price list.' },
    },
  ]
}
