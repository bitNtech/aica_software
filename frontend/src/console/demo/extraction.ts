import type { Attribute, FlowNode, GlobalFlow, SourceCall } from '../types'
import { findSubType } from './platform'

/**
 * Stands in for AICA's extraction: from the chosen calls and the agent's
 * job, a first draft of the conversation flow, the details to collect and
 * the global flows. The real extraction runs on AICA's servers; this only
 * shapes believable output for the builder to edit.
 */

let n = 0
const id = (p: string) => `${p}_${Date.now().toString(36)}_${(n++).toString(36)}`

type Spec = { label: string; say?: string; condition?: string; kids?: Spec[] }

function build(kind: FlowNode['kind'], s: Spec, calls: string[], confidence?: number): FlowNode {
  const childKind = (c: Spec): FlowNode['kind'] => (c.condition !== undefined ? 'branch' : 'step')
  return {
    id: id('node'),
    kind,
    label: s.label,
    say: kind === 'step' ? (s.say ?? '') : undefined,
    condition: kind === 'branch' ? (s.condition ?? '') : undefined,
    confidence,
    sourceCallIds: calls,
    children: (s.kids ?? []).map((c) => build(childKind(c), c, calls.slice(0, 2), confidence === undefined ? undefined : Math.min(0.97, confidence + 0.03))),
  }
}

const APPOINTMENTS: (Spec & { topic: string; confidence: number })[] = [
  {
    label: 'Book an appointment',
    topic: 'Booking an appointment',
    confidence: 0.94,
    kids: [
      { label: 'Ask for the doctor or department', say: 'Which doctor or department would you like to see?' },
      { label: 'Ask if it’s a first visit or a review', say: 'Is this your first visit, or a review visit?' },
      { label: 'Take the patient’s name and number', say: 'May I have the patient’s name and the registered phone number?' },
      { label: 'Offer two slots', say: 'Dr. {doctor} has {slot 1} or {slot 2}. Which suits you?' },
      {
        label: 'No slot suits the caller',
        condition: 'The caller can’t make either slot',
        kids: [
          { label: 'Offer the next available day', say: 'The next free day is {date}. Shall I book that?' },
          { label: 'Offer a callback', say: 'I can ask the front desk to call you back with more options. Is this number fine?' },
        ],
      },
      { label: 'Confirm the booking', say: 'Booked: {date} at {time} with Dr. {doctor}. Please come 15 minutes early with your old reports.' },
    ],
  },
  {
    label: 'Reschedule an appointment',
    topic: 'Booking an appointment',
    confidence: 0.82,
    kids: [
      { label: 'Find the booking', say: 'Can you tell me the patient’s name and the current appointment date?' },
      { label: 'Offer new slots', say: 'I can move it to {slot 1} or {slot 2}.' },
      { label: 'Confirm the change', say: 'Done. Your appointment is now on {date} at {time}.' },
    ],
  },
  {
    label: 'Cancel an appointment',
    topic: 'Booking an appointment',
    confidence: 0.74,
    kids: [
      { label: 'Find the booking', say: 'Which appointment would you like to cancel?' },
      { label: 'Confirm the cancellation', say: 'I’ve cancelled the appointment on {date}. Would you like to book another time?' },
    ],
  },
  {
    label: 'Ask about timings and directions',
    topic: 'Timings and directions',
    confidence: 0.58,
    kids: [{ label: 'Answer from the knowledge base', say: 'The OPD is open {hours}. Parking is {parking}.' }],
  },
]

const REPORTS: (Spec & { topic: string; confidence: number })[] = [
  {
    label: 'Check if a report is ready',
    topic: 'Report status',
    confidence: 0.91,
    kids: [
      { label: 'Ask for the patient ID', say: 'Can you tell me the patient ID printed on the bill?' },
      {
        label: 'Report is ready',
        condition: 'All tests are reported',
        kids: [{ label: 'Offer email or collection', say: 'Your reports are ready. Shall I email them, or will you collect them?' }],
      },
      {
        label: 'Report is pending',
        condition: 'Some tests are still pending',
        kids: [{ label: 'Give the expected time', say: 'The {test} will be ready by {time}. We’ll send everything together.' }],
      },
    ],
  },
  {
    label: 'Ask how to collect a report',
    topic: 'Report status',
    confidence: 0.7,
    kids: [{ label: 'Explain collection', say: 'You can collect reports at the lab counter from 8 AM to 8 PM, or get them by email.' }],
  },
]

/** A first flow for the agent's job, citing the calls it came from. */
export function extractFlow(subTypeId: string | null, typeId: string | null, calls: SourceCall[]): FlowNode[] {
  const forTopic = (topic: string) => {
    const hits = calls.filter((c) => c.topic === topic).map((c) => c.id)
    return hits.length ? hits : calls.slice(0, 2).map((c) => c.id)
  }
  const specific = subTypeId === 'appointments' ? APPOINTMENTS : subTypeId === 'reports' ? REPORTS : null
  if (specific) return specific.map((s) => build('intent', s, forTopic(s.topic), s.confidence))

  // Other jobs: one intent per thing the template covers.
  const sub = findSubType(typeId, subTypeId)
  const covers = sub?.covers ?? ['General question']
  return covers.map((c, i) =>
    build(
      'intent',
      {
        label: c,
        kids: [
          { label: 'Understand the question', say: 'Sure, I can help with that. Could you tell me a little more?' },
          { label: 'Answer from the knowledge base', say: 'Here’s what I found: {answer}' },
        ],
      },
      calls.slice(i % Math.max(calls.length, 1), (i % Math.max(calls.length, 1)) + 2).map((x) => x.id),
      Math.max(0.52, 0.9 - i * 0.09),
    ),
  )
}

const attr = (a: Omit<Attribute, 'id'>): Attribute => ({ id: id('attr'), ...a })

export function extractAttributes(subTypeId: string | null): Attribute[] {
  const name = attr({ label: 'Patient name', type: 'name', required: true, personal: true, confirm: true, ask: 'May I have the patient’s name?' })
  const phone = attr({ label: 'Phone number', type: 'phone', required: true, personal: true, confirm: true, ask: 'What’s the registered phone number?' })
  if (subTypeId === 'appointments') {
    return [
      name,
      phone,
      attr({
        label: 'Department',
        type: 'choice',
        required: true,
        personal: false,
        confirm: false,
        ask: 'Which department would you like to see?',
        options: ['Cardiology', 'Orthopaedics', 'General medicine', 'Paediatrics', 'ENT'],
      }),
      attr({ label: 'Visit type', type: 'choice', required: true, personal: false, confirm: false, ask: 'Is this a first visit or a review?', options: ['First visit', 'Review'] }),
      attr({ label: 'Preferred date', type: 'date', required: true, personal: false, confirm: true, ask: 'Which day suits you?' }),
    ]
  }
  if (subTypeId === 'reports') {
    return [attr({ label: 'Patient ID', type: 'patient_id', required: true, personal: true, confirm: true, ask: 'Can you tell me the patient ID on the bill?' }), phone]
  }
  return [attr({ label: 'Caller name', type: 'name', required: false, personal: true, confirm: false, ask: 'May I know your name?' })]
}

export function defaultGlobalFlows(): GlobalFlow[] {
  return [
    {
      kind: 'handoff',
      enabled: true,
      trigger: 'The caller asks for a person, is upset, or the agent fails to help twice.',
      response: 'Let me connect you to our front desk. Please stay on the line.',
    },
    {
      kind: 'emergency',
      enabled: true,
      trigger: 'The caller describes chest pain, breathing trouble, heavy bleeding, an accident or any emergency.',
      response: 'This sounds urgent. Please call 108 or come to our emergency department now. I’m connecting you to the emergency desk.',
    },
    { kind: 'repeat', enabled: true, trigger: 'The caller asks the agent to repeat or slow down.', response: 'Of course. {repeat the last answer, slower}' },
    {
      kind: 'out_of_scope',
      enabled: true,
      trigger: 'The question isn’t something this agent handles.',
      response: 'I can’t help with that on this line, but I can connect you to someone who can.',
    },
    { kind: 'silence', enabled: true, trigger: 'The caller says nothing for 8 seconds.', response: 'Are you still there? Take your time.' },
    { kind: 'end_call', enabled: true, trigger: 'The caller is done, or says goodbye.', response: 'Thank you for calling. Take care!' },
  ]
}
