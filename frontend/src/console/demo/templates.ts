import type { AgentType, BotBehaviour, Voice } from '../types'

/** Builder step 1's choices: what kind of business, and what this agent does. */
export const AGENT_TYPES: AgentType[] = [
  {
    id: 'hospital',
    label: 'Hospital',
    subTypes: [
      {
        id: 'appointments',
        label: 'Appointments',
        description: 'Books, moves and cancels OPD appointments.',
        covers: ['Book an appointment', 'Reschedule', 'Cancel', 'Doctor availability'],
      },
      {
        id: 'reports',
        label: 'Report status',
        description: 'Tells patients whether lab and scan reports are ready.',
        covers: ['Is my report ready?', 'How to collect it', 'Report delays'],
      },
      {
        id: 'enquiries',
        label: 'General enquiries',
        description: 'Answers the questions every reception hears: timings, directions, prices.',
        covers: ['Visiting hours', 'Directions and parking', 'Departments', 'Consultation fees'],
      },
      {
        id: 'billing',
        label: 'Billing and insurance',
        description: 'Explains bills, payment options and insurance claims.',
        covers: ['Bill amount', 'Payment options', 'Insurance claim status', 'Cashless approval'],
      },
    ],
  },
  {
    id: 'clinic',
    label: 'Clinic',
    subTypes: [
      {
        id: 'appointments',
        label: 'Appointments',
        description: 'Books and moves appointments with the clinic’s doctors.',
        covers: ['Book an appointment', 'Reschedule', 'Cancel', 'Clinic timings'],
      },
      {
        id: 'enquiries',
        label: 'General enquiries',
        description: 'Timings, fees, directions and what to bring.',
        covers: ['Timings', 'Fees', 'Directions', 'What to bring'],
      },
    ],
  },
  {
    id: 'diagnostics',
    label: 'Diagnostic centre',
    subTypes: [
      {
        id: 'reports',
        label: 'Report status',
        description: 'Tells patients whether their reports are ready and how to get them.',
        covers: ['Is my report ready?', 'Email or collect', 'Report delays'],
      },
      {
        id: 'home_collection',
        label: 'Home sample collection',
        description: 'Books home visits to collect samples.',
        covers: ['Book a home visit', 'Area served', 'Fasting and preparation', 'Charges'],
      },
      {
        id: 'prices',
        label: 'Tests and prices',
        description: 'Answers what a test costs and how to prepare.',
        covers: ['Test prices', 'Preparation', 'Packages', 'Timings'],
      },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    subTypes: [
      {
        id: 'enquiries',
        label: 'General enquiries',
        description: 'Answers common questions about your business.',
        covers: ['Timings', 'Location', 'Prices', 'Talk to a person'],
      },
    ],
  },
]

export const VOICES: Voice[] = [
  { id: 'kavya', name: 'Kavya', description: 'Warm, mid-pitched. Clear in Tamil and English.', languages: ['tamil', 'english', 'tanglish'] },
  { id: 'arun', name: 'Arun', description: 'Calm, lower-pitched. Steady pace.', languages: ['tamil', 'english', 'tanglish'] },
  { id: 'meera', name: 'Meera', description: 'Bright and quick. Suits short enquiries.', languages: ['english', 'tanglish'] },
  { id: 'selvi', name: 'Selvi', description: 'Gentle, slower. Suits older callers.', languages: ['tamil', 'tanglish'] },
]

export const DEFAULT_RULES = [
  'Never give medical advice, diagnoses or test interpretations.',
  'Never share a patient’s details with anyone but the patient or the person they named.',
  'Always repeat dates, times and phone numbers back to the caller.',
]

export function defaultBehaviour(orgName: string): BotBehaviour {
  return {
    persona: 'Kavya',
    tone: 'warm',
    languages: ['tamil', 'english', 'tanglish'],
    startLanguage: 'tamil',
    followCaller: true,
    greeting: `Vanakkam! This is Kavya from ${orgName}. How can I help you today?`,
    closing: 'Thank you for calling. Take care!',
    voiceId: 'kavya',
    rate: 'normal',
    rules: [...DEFAULT_RULES],
  }
}
