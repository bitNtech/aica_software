import type { AgentContext, AgentDraft, AgentSpec, AgentSummary, AgentVersion, Guardrails, SpeechSettings, SourceCall } from '../types'
import { defaultGlobalFlows, extractAttributes, extractFlow } from './extraction'
import { ago } from './runtime'
import { defaultBehaviour } from './templates'

/** Sample setups and version history for the sample agents, so the agent
 * workspace has something real-looking to show. */

const ORG_NAME: Record<string, string> = { 'arogya-demo': 'Arogya Demo Hospital' }

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

/** A builder draft's setup, as version 1. */
export function specFromDraft(d: AgentDraft): AgentSpec {
  return {
    typeId: d.typeId,
    subTypeId: d.subTypeId,
    redact: d.redact,
    behaviour: d.behaviour,
    speech: defaultSpeech(),
    flow: d.flow,
    attributes: d.attributes,
    globalFlows: d.globalFlows,
    context: d.context,
    guardrails: defaultGuardrails(),
  }
}

interface Seed {
  subTypeId: string
  /** Who published each version shown, newest first. */
  publishedBy: string[]
  /** Matches which agents seedKnowledge() says use each source. */
  context: Partial<AgentContext>
  transferTo: string
}

const SEEDS: Record<string, Seed> = {
  agt_reception: {
    subTypeId: 'enquiries',
    publishedBy: ['Karthik R', 'Karthik R', 'Lakshmi K'],
    context: { knowledgeSourceIds: ['kb_doctors', 'kb_prices', 'kb_faq'], toolIds: ['tool_transfer', 'tool_end'] },
    transferTo: 'Front desk',
  },
  agt_appointments: {
    subTypeId: 'appointments',
    publishedBy: ['Lakshmi K', 'Karthik R', 'Karthik R', 'Lakshmi K'],
    context: { knowledgeSourceIds: ['kb_doctors', 'kb_faq'], toolIds: ['tool_transfer', 'tool_end', 'tool_sms', 'tool_book', 'tool_slots'] },
    transferTo: 'OPD desk',
  },
  agt_reports: {
    subTypeId: 'reports',
    publishedBy: ['Karthik R', 'Lakshmi K'],
    context: { knowledgeSourceIds: ['kb_faq'], toolIds: ['tool_transfer', 'tool_end', 'tool_report'] },
    transferTo: 'Lab counter',
  },
}

/** The agent's current setup and its last few versions (newest first).
 * Each older version undoes one change, and each version's note says what
 * it changed, so comparing versions agrees with the notes. */
export function seedDetail(orgSlug: string, agent: AgentSummary, calls: SourceCall[]): { working: AgentSpec; versions: AgentVersion[] } | null {
  const seed = SEEDS[agent.id]
  if (!seed) return null
  const orgName = ORG_NAME[orgSlug] ?? 'our hospital'
  const ready = calls.filter((c) => c.status === 'ready')
  const behaviour = defaultBehaviour(orgName)
  const latest: AgentSpec = {
    typeId: 'hospital',
    subTypeId: seed.subTypeId,
    redact: true,
    // The languages the Agents list shows for it.
    behaviour: { ...behaviour, languages: agent.languages, startLanguage: agent.languages[0] ?? behaviour.startLanguage },
    speech: {
      ...defaultSpeech(),
      pronunciations: [{ word: 'Dr. Ramachandran', sayAs: 'Doctor Raa-ma-chan-dran' }],
      hints: ['Ramachandran', 'Cardiology', 'Gandhipuram', 'OPD'],
    },
    flow: extractFlow(seed.subTypeId, 'hospital', ready),
    attributes: extractAttributes(seed.subTypeId),
    globalFlows: defaultGlobalFlows(),
    context: { knowledgeSourceIds: [], answerOnlyFromKnowledge: true, topK: 4, minScore: 0.6, toolIds: [], confirmBeforeActions: true, ...seed.context },
    guardrails: { ...defaultGuardrails(), transferTo: seed.transferTo },
  }

  /** The version before `v`, and the note for `v` saying what it changed. */
  const undo = (v: AgentSpec, i: number): { before: AgentSpec; note: string } => {
    const s = structuredClone(v)
    if (i === 0) {
      s.attributes = s.attributes.map((a) => ({ ...a, confirm: false }))
      return { before: s, note: 'Reads details back to the caller before going on.' }
    }
    if (i === 1 && s.flow.length > 1) {
      // The cancel intent where there is one, else the last.
      const k = s.flow.findIndex((n) => /cancel/i.test(n.label))
      const [gone] = s.flow.splice(k >= 0 ? k : s.flow.length - 1, 1)
      return { before: s, note: `Added “${gone.label}”.` }
    }
    if (i === 2) {
      const langs = s.behaviour.languages.filter((l) => l !== 'tanglish')
      s.behaviour = { ...s.behaviour, greeting: `Hello, ${orgName}. How may I help you?`, languages: langs.length ? langs : s.behaviour.languages }
      if (!s.behaviour.languages.includes(s.behaviour.startLanguage)) s.behaviour.startLanguage = s.behaviour.languages[0]
      const added = v.behaviour.languages.length !== s.behaviour.languages.length
      return { before: s, note: added ? 'New greeting, and speaks Tanglish now.' : 'New greeting.' }
    }
    s.guardrails = { ...s.guardrails, handoffAfterFailures: 3 }
    return { before: s, note: `Hands over after ${v.guardrails.handoffAfterFailures} tries, not 3.` }
  }

  const version = agent.version ?? 1
  const versions: AgentVersion[] = []
  let spec = latest
  seed.publishedBy.forEach((by, i) => {
    const n = version - i
    if (n < 1) return
    const { before, note } = undo(spec, i)
    const days = i === 0 ? (agent.lastPublishedAt ? (Date.now() - Date.parse(agent.lastPublishedAt)) / 864e5 : 1) : 6 + i * 9
    versions.push({ version: n, publishedAt: ago(days), publishedBy: by, note, spec })
    spec = before
  })
  return { working: structuredClone(latest), versions }
}
