import type { SourceCall, Transcript, TranscriptTurn } from '../types'
import { ago } from './runtime'

/**
 * The sample call library: past calls already processed, as if the
 * organisation had uploaded them. Transcripts mark personal details as
 * {{kind:value}} so the UI can show or hide them. Names and numbers are
 * invented.
 */

type Topic = 'appointment' | 'report' | 'timings' | 'billing'

const TOPIC_LABEL: Record<Topic, string> = {
  appointment: 'Booking an appointment',
  report: 'Report status',
  timings: 'Timings and directions',
  billing: 'Bill and insurance',
}

const SCRIPTS: Record<Topic, TranscriptTurn[]> = {
  appointment: [
    { speaker: 'staff', at: 0, text: 'Vanakkam, Arogya Hospital, reception.' },
    { speaker: 'caller', at: 3, text: 'Hello, naan Dr. Suresh kitta appointment venum, cardiology.' },
    { speaker: 'staff', at: 9, text: 'Sure. Is this your first visit, or a review?' },
    { speaker: 'caller', at: 13, text: 'Review. Last month vandhen.' },
    { speaker: 'staff', at: 16, text: 'Can I have the patient’s name and your registered number?' },
    { speaker: 'caller', at: 21, text: '{{name:Lakshmi Narayanan}}, number {{phone:98400 12345}}.' },
    { speaker: 'staff', at: 29, text: 'Thank you. Dr. Suresh has Thursday 10:30 or Friday 4 PM. Which suits you?' },
    { speaker: 'caller', at: 36, text: 'Thursday 10:30 ok.' },
    { speaker: 'staff', at: 39, text: 'Booked: Thursday, 10:30 AM, Dr. Suresh, cardiology. Please come 15 minutes early with your old reports.' },
    { speaker: 'caller', at: 48, text: 'Ok, thank you.' },
  ],
  report: [
    { speaker: 'staff', at: 0, text: 'Arogya Hospital lab, good morning.' },
    { speaker: 'caller', at: 2, text: 'Blood test report ready-a nu theriyanum.' },
    { speaker: 'staff', at: 6, text: 'Can you tell me the patient ID on the bill?' },
    { speaker: 'caller', at: 10, text: 'ID {{patient_id:AR-204-5531}}.' },
    { speaker: 'staff', at: 16, text: 'The thyroid profile is ready. The lipid profile will be ready by 5 PM today.' },
    { speaker: 'caller', at: 23, text: 'Email-la anuppa mudiyuma?' },
    { speaker: 'staff', at: 26, text: 'Yes, to {{email:lak***@gmail.com}}, the address on file. You’ll get both together this evening.' },
  ],
  timings: [
    { speaker: 'staff', at: 0, text: 'Arogya Hospital, how can I help?' },
    { speaker: 'caller', at: 2, text: 'What are the OPD timings on Sunday?' },
    { speaker: 'staff', at: 5, text: 'On Sundays the OPD runs from 9 AM to 1 PM. Emergency is open all day.' },
    { speaker: 'caller', at: 11, text: 'Parking iruka?' },
    { speaker: 'staff', at: 13, text: 'Yes, there’s parking behind the main building, entry from Avinashi Road.' },
  ],
  billing: [
    { speaker: 'staff', at: 0, text: 'Billing desk, Arogya Hospital.' },
    { speaker: 'caller', at: 2, text: 'My father was discharged yesterday. Insurance claim status theriyanum.' },
    { speaker: 'staff', at: 8, text: 'May I have the patient’s name and the policy number?' },
    { speaker: 'caller', at: 12, text: '{{name:Ramasamy K}}, policy {{policy:SH-88213-02}}.' },
    { speaker: 'staff', at: 20, text: 'The claim was sent to the insurer this morning. Approval usually takes two working days.' },
    { speaker: 'caller', at: 28, text: 'Ok. Any balance to pay?' },
    { speaker: 'staff', at: 31, text: 'Nothing for now. If the insurer approves less, we’ll call you before billing anything.' },
  ],
}

const SAMPLES: { topic: Topic; days: number; duration: number; language: SourceCall['language'] }[] = [
  { topic: 'appointment', days: 2, duration: 52, language: 'tanglish' },
  { topic: 'appointment', days: 3, duration: 71, language: 'tamil' },
  { topic: 'report', days: 3, duration: 34, language: 'tanglish' },
  { topic: 'timings', days: 4, duration: 19, language: 'english' },
  { topic: 'appointment', days: 5, duration: 64, language: 'mixed' },
  { topic: 'billing', days: 6, duration: 45, language: 'tanglish' },
  { topic: 'report', days: 6, duration: 29, language: 'tamil' },
  { topic: 'timings', days: 8, duration: 22, language: 'tanglish' },
  { topic: 'appointment', days: 9, duration: 58, language: 'english' },
  { topic: 'billing', days: 11, duration: 61, language: 'english' },
  { topic: 'report', days: 12, duration: 31, language: 'tanglish' },
  { topic: 'appointment', days: 14, duration: 49, language: 'tamil' },
]

/** Organisations that start with an empty library (the first-run state). */
const EMPTY = new Set(['nila-eye-demo'])

export function seedCalls(orgSlug: string): SourceCall[] {
  if (EMPTY.has(orgSlug)) return []
  return SAMPLES.map((s, i) => {
    const at = new Date(Date.now() - s.days * 864e5 - i * 37 * 60e3)
    const stamp = at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    return {
      id: `call_${String(i + 1).padStart(3, '0')}`,
      name: `Reception call · ${stamp}`,
      durationSec: s.duration,
      language: s.language,
      status: 'ready',
      addedAt: ago(s.days),
      topic: TOPIC_LABEL[s.topic],
    }
  })
}

/** Uploaded calls get a transcript by size, so it's stable per file. */
export function transcriptFor(call: SourceCall): Transcript {
  const topics = Object.keys(SCRIPTS) as Topic[]
  const fromLabel = topics.find((t) => TOPIC_LABEL[t] === call.topic)
  const topic = fromLabel ?? topics[(call.size ?? call.name.length) % topics.length]
  return { callId: call.id, turns: SCRIPTS[topic].map((t) => ({ ...t })) }
}

export function topicFor(call: SourceCall): string {
  const topics = Object.keys(SCRIPTS) as Topic[]
  return TOPIC_LABEL[topics[(call.size ?? call.name.length) % topics.length]]
}
