import type { AgentDraft, AgentSpec, AnalysisSettings, Guardrails, SpeechSettings } from './types'

/** Starting values for the parts of an agent's setup a draft may not have
 * yet (drafts saved before the builder covered them), so every screen has
 * something to show and edit. */

export const defaultSpeech = (): SpeechSettings => ({
  pronunciations: [],
  hints: [],
  allowInterruptions: true,
  silenceSec: 8,
})

export const defaultGuardrails = (): Guardrails => ({
  handoffAfterFailures: 2,
  transferTo: 'Front desk',
  emergencyTo: 'Emergency desk, extension 108',
  refuseTopics: ['Diagnosis or medical advice', 'Medicine doses'],
  recordingNotice: true,
  recordingNoticeText: 'This call may be recorded to improve our service.',
  maxCallMinutes: 10,
})

/** What's noted after each call when nothing more specific is set. */
export const defaultAnalysisSettings = (): AnalysisSettings => ({
  summary: true,
  sentiment: true,
  successCriteria: 'The caller got what they called for without needing a person.',
  fields: [],
})

/** A draft's setup as an agent's, with defaults for what it doesn't have. */
export const specOfDraft = (d: AgentDraft): AgentSpec => ({
  typeId: d.typeId,
  subTypeId: d.subTypeId,
  redact: d.redact,
  behaviour: d.behaviour,
  speech: d.speech ?? defaultSpeech(),
  flow: d.flow,
  attributes: d.attributes,
  globalFlows: d.globalFlows,
  context: d.context,
  guardrails: d.guardrails ?? defaultGuardrails(),
  pipeline: d.pipeline,
  analysis: d.analysis ?? defaultAnalysisSettings(),
})
