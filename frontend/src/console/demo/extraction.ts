import type { Attribute, FlowGroup, FlowNode, GlobalFlow, SourceCall } from '../types'
import { findSubType } from './platform'

/**
 * Stands in for AICA's extraction: from the chosen calls and the agent's
 * job, a first draft of the conversation flow, the details to collect and
 * the global flows. The real extraction runs on AICA's servers; this only
 * shapes believable output for the builder to edit.
 */

let n = 0
const id = (p: string) => `${p}_${Date.now().toString(36)}_${(n++).toString(36)}`

/** A node of a template flow: `next` is what can follow it (several: a
 * fork, each with a `when` unless it's the "otherwise" step, which goes
 * last). `joins` names a step further on in the same intent where the call
 * carries on, so branches can join back up. */
type Spec = { label: string; say?: string; when?: string; next?: Spec[]; joins?: string }

/** `a`, then `b`, then … : a path, whose last node may fork. */
function path(...specs: Spec[]): Spec[] {
  const [first, ...rest] = specs
  if (!first) return []
  return [rest.length ? { ...first, next: path(...rest) } : first]
}

function build(kind: FlowNode['kind'], s: Spec, calls: string[], confidence?: number, depth = 0): FlowNode {
  const childKind = (c: Spec): FlowNode['kind'] => (c.when !== undefined ? 'branch' : 'step')
  // Deeper in the tree, fewer calls went that way, so AICA is a little less sure.
  const conf = confidence === undefined ? undefined : Math.max(0.5, Math.min(0.97, confidence - (depth > 3 ? 0.04 : 0)))
  const node: FlowNode = {
    id: id('node'),
    kind,
    label: s.label,
    say: kind === 'step' ? (s.say ?? '') : undefined,
    condition: kind === 'branch' ? (s.when ?? '') : undefined,
    confidence: conf,
    sourceCallIds: calls,
    children: (s.next ?? []).map((c) => build(childKind(c), c, depth >= 2 ? calls.slice(0, 2) : calls, conf, depth + 1)),
    ...(s.joins ? { joinsAt: s.joins } : {}),
  }
  return depth === 0 ? linkJoins(node) : node
}

/** Turns the step names in an intent's joins into the steps' ids. */
function linkJoins(intent: FlowNode): FlowNode {
  const byLabel = new Map<string, string>()
  const collect = (n: FlowNode) => {
    if (n.kind === 'step' && !byLabel.has(n.label)) byLabel.set(n.label, n.id)
    n.children.forEach(collect)
  }
  collect(intent)
  const fix = (n: FlowNode): FlowNode => {
    const children = n.children.map(fix)
    if (!n.joinsAt) return { ...n, children }
    const to = byLabel.get(n.joinsAt)
    const { joinsAt: _, ...rest } = n
    return to ? { ...rest, children, joinsAt: to } : { ...rest, children }
  }
  return fix(intent)
}

type Template = Spec & { topic: string; confidence: number }

const APPOINTMENTS: Template[] = [
  {
    label: 'Book an appointment',
    topic: 'Booking an appointment',
    confidence: 0.94,
    next: [
      {
        label: 'Ask for the doctor or department',
        say: 'Which doctor or department would you like to see?',
        next: [
          {
            label: 'The doctor is away',
            when: 'The doctor the caller asked for isn’t seeing patients that day',
            next: path({
              label: 'Offer another doctor in the department',
              say: 'Dr. {doctor} is away on {date}. Dr. {doctor 2} in the same department has slots. Shall I check them?',
              joins: 'Ask if it’s a first visit or a review',
            }),
          },
          ...path(
            { label: 'Ask if it’s a first visit or a review', say: 'Is this your first visit, or a review visit?' },
            { label: 'Take the patient’s name and number', say: 'May I have the patient’s name and the registered phone number?' },
            {
              label: 'Offer two slots',
              say: 'Dr. {doctor} has {slot 1} or {slot 2}. Which suits you?',
              next: [
                {
                  label: 'No slot suits the caller',
                  when: 'The caller can’t make either slot',
                  next: path({
                    label: 'Offer the next available day',
                    say: 'The next free day is {date}. Shall I book that?',
                    next: [
                      { label: 'Takes the next day', when: 'The caller agrees to the next free day', joins: 'Confirm the booking' },
                      { label: 'Still can’t make it', when: 'The next day doesn’t suit either', next: path({ label: 'Offer a callback', say: 'I can ask the front desk to call you back with more options. Is this number fine?' }) },
                    ],
                  }),
                },
                { label: 'Confirm the booking', say: 'Booked: {date} at {time} with Dr. {doctor}. Please come 15 minutes early with your old reports.' },
              ],
            },
          ),
        ],
      },
    ],
  },
  {
    label: 'Reschedule an appointment',
    topic: 'Booking an appointment',
    confidence: 0.82,
    next: [
      {
        label: 'Find the booking',
        say: 'Can you tell me the patient’s name and the current appointment date?',
        next: [
          {
            label: 'No booking found',
            when: 'Nothing matches the name and date',
            next: path({ label: 'Check the details again', say: 'I couldn’t find that booking. Could you give me the registered phone number instead?', joins: 'Offer new slots' }),
          },
          ...path({ label: 'Offer new slots', say: 'I can move it to {slot 1} or {slot 2}.' }, { label: 'Confirm the change', say: 'Done. Your appointment is now on {date} at {time}.' }),
        ],
      },
    ],
  },
  {
    label: 'Cancel an appointment',
    topic: 'Booking an appointment',
    confidence: 0.74,
    next: path(
      { label: 'Find the booking', say: 'Which appointment would you like to cancel?' },
      {
        label: 'Confirm the cancellation',
        say: 'I’ve cancelled the appointment on {date}. Would you like to book another time?',
        next: [{ label: 'Wants another time', when: 'The caller wants to book again', next: path({ label: 'Offer new slots', say: 'I can offer {slot 1} or {slot 2}.' }) }],
      },
    ),
  },
  {
    label: 'Ask about timings and directions',
    topic: 'Timings and directions',
    confidence: 0.58,
    next: [
      {
        label: 'Answer from the knowledge base',
        say: 'The OPD is open {hours}.',
        next: [
          { label: 'Asks about parking', when: 'The caller asks where to park', next: path({ label: 'Explain parking', say: 'Parking is {parking}.' }) },
          { label: 'Asks for directions', when: 'The caller asks how to get there', next: path({ label: 'Give directions', say: 'Here’s how to reach us: {answer}' }) },
        ],
      },
    ],
  },
]

const REPORTS: Template[] = [
  {
    label: 'Check if a report is ready',
    topic: 'Report status',
    confidence: 0.91,
    next: path(
      { label: 'Ask for the patient ID', say: 'Can you tell me the patient ID printed on the bill?' },
      {
        label: 'Look up the report',
        say: 'One moment while I check.',
        next: [
          {
            label: 'Report is ready',
            when: 'All tests are reported',
            next: path({
              label: 'Offer email or collection',
              say: 'Your reports are ready. Shall I email them, or will you collect them?',
              next: [
                { label: 'Wants it by email', when: 'The caller asks for email', next: path({ label: 'Confirm the email on file', say: 'I’ll send them to the email address on file. They should arrive in a few minutes.' }) },
                { label: 'Will collect', when: 'The caller will come in', next: path({ label: 'Give the counter hours', say: 'The lab counter is open from 8 AM to 8 PM.' }) },
              ],
            }),
          },
          { label: 'Patient ID not found', when: 'No report matches the ID', next: path({ label: 'Ask them to read the bill again', say: 'I couldn’t find that ID. Could you read it again from the top of the bill?' }) },
          { label: 'Say when it’s ready', say: 'The {test} will be ready by {time}. We’ll send everything together.' },
        ],
      },
    ),
  },
  {
    label: 'Ask how to collect a report',
    topic: 'Report status',
    confidence: 0.7,
    next: [{ label: 'Explain collection', say: 'You can collect reports at the lab counter from 8 AM to 8 PM, or get them by email.' }],
  },
]

const BILLING: Template[] = [
  {
    label: 'Ask about an insurance claim',
    topic: 'Bill and insurance',
    confidence: 0.86,
    next: path(
      { label: 'Take the patient’s name and policy number', say: 'May I have the patient’s name and the policy number?' },
      {
        label: 'Look up the claim',
        say: 'Let me check the claim.',
        next: [
          { label: 'Claim approved', when: 'The insurer has approved it', next: path({ label: 'Tell them what’s left to pay', say: 'The claim is approved. The balance to pay is {amount}.' }) },
          { label: 'Claim rejected', when: 'The insurer turned it down', next: path({ label: 'Hand over to the billing desk', say: 'I’ll put you through to our billing desk, who can help with the next steps.' }) },
          { label: 'Say how long approval takes', say: 'The claim was sent to the insurer. Approval usually takes two working days.' },
        ],
      },
    ),
  },
  {
    label: 'Ask about a bill',
    topic: 'Bill and insurance',
    confidence: 0.72,
    next: path(
      { label: 'Find the bill', say: 'Can you tell me the patient’s name and the bill date?' },
      {
        label: 'Read out the total',
        say: 'The bill comes to {amount}.',
        next: [{ label: 'Wants to pay online', when: 'The caller asks how to pay', next: path({ label: 'Send a payment link', say: 'I’ll send a payment link by SMS to this number.' }) }],
      },
    ),
  },
]

/**
 * Call topics that belong together. Calls about one family make one flow;
 * a family with no calls is left out, and families are never mixed, so
 * unrelated calls give separate flows to choose from.
 */
const FAMILIES: { id: string; title: string; topics: string[]; subTypes: string[]; templates: Template[] }[] = [
  { id: 'visits', title: 'Appointments and visits', topics: ['Booking an appointment', 'Timings and directions'], subTypes: ['appointments', 'enquiries'], templates: APPOINTMENTS },
  { id: 'reports', title: 'Lab reports', topics: ['Report status'], subTypes: ['reports', 'home_collection'], templates: REPORTS },
  { id: 'billing', title: 'Bills and insurance', topics: ['Bill and insurance'], subTypes: ['billing', 'prices'], templates: BILLING },
]

/** A template family's flow, citing the calls about each of its topics. */
function familyFlow(templates: Template[], calls: SourceCall[]): FlowNode[] {
  const forTopic = (topic: string) => {
    const hits = calls.filter((c) => c.topic === topic).map((c) => c.id)
    return hits.length ? hits : calls.slice(0, 2).map((c) => c.id)
  }
  // Only the parts some call was about (all of it, when no topic matched).
  const about = templates.filter((t) => calls.some((c) => c.topic === t.topic))
  return (about.length ? about : templates).map((t) => build('intent', t, forTopic(t.topic), t.confidence))
}

/** One intent per thing a job covers, for jobs without a template. */
function genericFlow(typeId: string | null, subTypeId: string | null, calls: SourceCall[]): FlowNode[] {
  const sub = findSubType(typeId, subTypeId)
  const covers = sub?.covers ?? ['General question']
  return covers.map((c, i) =>
    build(
      'intent',
      {
        label: c,
        next: path(
          { label: 'Understand the question', say: 'Sure, I can help with that. Could you tell me a little more?' },
          {
            label: 'Answer from the knowledge base',
            say: 'Here’s what I found: {answer}',
            next: [{ label: 'Not in the knowledge base', when: 'Nothing in the documents answers it', next: path({ label: 'Offer to hand over', say: 'Let me put you through to someone who can help with that.' }) }],
          },
        ),
      },
      calls.slice(i % Math.max(calls.length, 1), (i % Math.max(calls.length, 1)) + 2).map((x) => x.id),
      Math.max(0.52, 0.9 - i * 0.09),
    ),
  )
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * What reading the calls finds: a flow for each family of related calls
 * (booking and directions belong together; lab reports and bills don't).
 * The group that fits the agent's job is marked, and listed first; calls
 * that fit no family make a general group.
 */
export function extractFlowGroups(subTypeId: string | null, typeId: string | null, calls: SourceCall[]): FlowGroup[] {
  const groups: FlowGroup[] = []
  const used = new Set<string>()
  for (const f of FAMILIES) {
    const mine = calls.filter((c) => c.topic && f.topics.includes(c.topic))
    if (!mine.length) continue
    mine.forEach((c) => used.add(c.id))
    const topics = [...new Set(mine.map((c) => c.topic!))]
    groups.push({
      id: `group_${f.id}`,
      title: f.title,
      summary: `${plural(mine.length, 'call')} about ${topics.map((t) => t.toLowerCase()).join(' and ')}.`,
      topics,
      callIds: mine.map((c) => c.id),
      flow: familyFlow(f.templates, mine),
      matchesJob: !!subTypeId && f.subTypes.includes(subTypeId),
    })
  }
  const rest = calls.filter((c) => !used.has(c.id))
  if (rest.length || !groups.length) {
    const topics = [...new Set(rest.map((c) => c.topic).filter((t): t is string => !!t))]
    groups.push({
      id: 'group_general',
      title: 'General questions',
      summary: `${plural(rest.length, 'call')}${topics.length ? ` about ${topics.map((t) => t.toLowerCase()).join(' and ')}` : ''}.`,
      topics,
      callIds: rest.map((c) => c.id),
      flow: genericFlow(typeId, subTypeId, rest.length ? rest : calls),
      matchesJob: !groups.some((g) => g.matchesJob),
    })
  }
  return groups.sort((a, b) => Number(b.matchesJob) - Number(a.matchesJob) || b.callIds.length - a.callIds.length)
}

/** A first flow for the agent's job, citing the calls it came from: the
 * job's own template where there is one, else one intent per thing it covers. */
export function extractFlow(subTypeId: string | null, typeId: string | null, calls: SourceCall[]): FlowNode[] {
  const own: Record<string, Template[]> = { appointments: APPOINTMENTS, reports: REPORTS, billing: BILLING }
  const templates = subTypeId ? own[subTypeId] : undefined
  if (!templates) return genericFlow(typeId, subTypeId, calls)
  const forTopic = (topic: string) => {
    const hits = calls.filter((c) => c.topic === topic).map((c) => c.id)
    return hits.length ? hits : calls.slice(0, 2).map((c) => c.id)
  }
  return templates.map((t) => build('intent', t, forTopic(t.topic), t.confidence))
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
