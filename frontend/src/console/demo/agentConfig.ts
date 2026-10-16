import type { AnalysisSettings, PipelineSettings } from '../types'

/**
 * Starting values for an agent's voice pipeline and call analysis. The
 * pipeline follows the platform's default models; the timings suit a busy
 * hospital line where callers pause mid-sentence and the line is noisy.
 */

export const defaultPipeline = (): PipelineSettings => ({
  speechModel: 'default',
  languageModel: 'default',
  voiceModel: 'default',
  turnDetection: 'semantic',
  minEndpointMs: 500,
  maxEndpointMs: 3000,
  interruptMinWords: 2,
  interruptMinMs: 500,
  resumeAfterFalseInterruption: true,
  backchannel: false,
  fillerPhrases: ['One moment, let me check.', 'Oru nimisham.'],
  preemptiveReplies: true,
  noiseCancellation: 'standard',
  ambience: 'none',
  keypadInput: true,
  silenceReprompts: 2,
  temperature: 0.4,
})

const FIELDS: Record<string, AnalysisSettings['fields']> = {
  appointments: [
    { id: 'fld_dept', label: 'Department', type: 'choice', description: 'The department the caller wanted.', options: ['Cardiology', 'General medicine', 'Orthopaedics', 'Paediatrics', 'ENT', 'Other'] },
    { id: 'fld_first', label: 'First visit', type: 'yes_no', description: 'Whether it was the patient’s first visit.' },
  ],
  reports: [{ id: 'fld_ready', label: 'Report ready', type: 'yes_no', description: 'Whether every test on the report was ready.' }],
  enquiries: [{ id: 'fld_topic', label: 'Topic', type: 'choice', description: 'What the caller asked about.', options: ['Timings', 'Doctors', 'Prices', 'Billing', 'Other'] }],
}

const CRITERIA: Record<string, string> = {
  appointments: 'The caller booked, changed or cancelled an appointment without needing a person.',
  reports: 'The caller found out whether the report was ready, and when to collect it.',
  enquiries: 'The caller got an answer from the knowledge, or was put through to the right desk.',
}

export const defaultAnalysis = (subTypeId: string | null): AnalysisSettings => ({
  summary: true,
  sentiment: true,
  successCriteria: CRITERIA[subTypeId ?? ''] ?? 'The caller got what they called for without needing a person.',
  fields: structuredClone(FIELDS[subTypeId ?? ''] ?? []),
})
