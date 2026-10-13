import type { Language } from '../auth/types'

/**
 * The organisation console's data, as the pages expect it. Provisional: the
 * shapes follow docs/pages-and-access.md and change once the voice
 * pipeline's real contracts (agent format, call records) are agreed.
 */

/** draft: never published, or edits since. live: answering a number.
 * paused: published, but not answering. */
export type AgentStatus = 'draft' | 'live' | 'paused'

export interface AgentSummary {
  id: string
  name: string
  /** From builder step 1, e.g. "Appointments". */
  useCase: string
  status: AgentStatus
  /** The number it answers, formatted for display; null until assigned. */
  phoneNumber: string | null
  languages: Language[]
  /** The published version, or null if never published. */
  version: number | null
  /** ISO timestamp, or null if never published. */
  lastPublishedAt: string | null
  /** ISO timestamp of the last edit. */
  updatedAt: string
  callsThisWeek: number
  /** Set while the agent is still being built: the step to continue at. */
  setupStep?: BuilderStep
  /** Published, with saved edits not published yet. */
  hasChanges?: boolean
}

/** Methods reject with an `AuthError` (auth/types.ts), whose message is
 * written for the person using the console. Pages show it as-is, so a real
 * client must map its failures to one too. */
export interface ConsoleClient {
  /** True while every console page runs on built-in sample data. The UI
   * labels it, so nobody mistakes it for their real configuration. */
  readonly isDemo: boolean
  /** Published agents, plus drafts still being built (with `setupStep`). */
  listAgents(orgSlug: string): Promise<AgentSummary[]>

  // ---- call library (builder step 0, Call uploads)
  listCalls(orgSlug: string): Promise<SourceCall[]>
  /** Starts processing; poll listCalls for progress. */
  addRecordings(orgSlug: string, files: NewRecording[]): Promise<SourceCall[]>
  getTranscript(orgSlug: string, callId: string): Promise<Transcript>

  // ---- builder
  listAgentTypes(): Promise<AgentType[]>
  listVoices(): Promise<Voice[]>
  /** `orgName` personalises the starting greeting. */
  createDraft(orgSlug: string, orgName: string): Promise<AgentDraft>
  getDraft(orgSlug: string, draftId: string): Promise<AgentDraft>
  saveDraft(orgSlug: string, draft: AgentDraft): Promise<AgentDraft>
  discardDraft(orgSlug: string, draftId: string): Promise<void>
  /** Builder step 3: reads the draft's calls and fills in its flow,
   * attributes and global flows (replacing what's there).
   * Real API: a job (start, then poll or stream progress, cancellable),
   * with a draft revision so autosave can't overwrite its result. */
  extractFlow(orgSlug: string, draftId: string): Promise<AgentDraft>
  /** Builder step 7: turns the draft into a live agent on `numberId`, or a
   * paused one with no number. Safe to retry: a draft that's already been
   * published returns the agent it became (real API: an idempotency key). */
  publishDraft(orgSlug: string, draftId: string, numberId: string | null): Promise<AgentSummary>

  // ---- library
  listKnowledge(orgSlug: string): Promise<KnowledgeSource[]>
  listTools(orgSlug: string): Promise<AgentTool[]>
  listNumbers(orgSlug: string): Promise<PhoneNumber[]>

  /** Removes a recording from the library. Flows already read from it keep working. */
  deleteCall(orgSlug: string, callId: string): Promise<void>

  // ---- knowledge library
  addKnowledge(orgSlug: string, source: NewKnowledge): Promise<KnowledgeSource>
  updateKnowledge(orgSlug: string, id: string, patch: KnowledgePatch): Promise<KnowledgeSource>
  /** Reads the file or page again (indexing), e.g. after it changed. */
  refreshKnowledge(orgSlug: string, id: string): Promise<KnowledgeSource>
  /** Refused while an agent uses it. */
  deleteKnowledge(orgSlug: string, id: string): Promise<void>
  /** The first passages of a source, to check it was read right. */
  listPassages(orgSlug: string, id: string): Promise<Passage[]>
  /** The passages an agent would find for `question` in these sources. */
  searchKnowledge(orgSlug: string, sourceIds: string[], question: string): Promise<Passage[]>

  // ---- tools and integrations
  /** Creates (no id yet) or updates an HTTP tool, or switches a built-in one. */
  saveTool(orgSlug: string, tool: AgentTool): Promise<AgentTool>
  /** Refused while an agent uses it. */
  deleteTool(orgSlug: string, id: string): Promise<void>
  /** Runs the tool once with sample inputs, from AICA's servers. */
  testTool(orgSlug: string, id: string, inputs: Record<string, string>): Promise<ToolTestResult>
  listCredentials(orgSlug: string): Promise<Credential[]>
  /** Sets or replaces a secret's value; the value is never returned. */
  setCredential(orgSlug: string, name: string, value: string): Promise<Credential>
  /** Refused while a tool uses it. */
  deleteCredential(orgSlug: string, name: string): Promise<void>

  // ---- phone numbers
  updateNumber(orgSlug: string, id: string, patch: NumberPatch): Promise<PhoneNumber>
  /** Asks bitNtech for another number; they set it up and it appears here. */
  requestNumber(orgSlug: string, note: string): Promise<void>

  // ---- agent workspace (a published agent)
  getAgent(orgSlug: string, agentId: string): Promise<AgentDetail>
  /** Saves edits as unpublished changes; callers keep answering the live version. */
  saveAgent(orgSlug: string, agentId: string, working: AgentSpec): Promise<AgentDetail>
  /** Publishes the saved edits as the next version. */
  publishAgent(orgSlug: string, agentId: string, note: string): Promise<AgentDetail>
  /** Throws the unpublished changes away. */
  discardAgentChanges(orgSlug: string, agentId: string): Promise<AgentDetail>
  /** Publishes an earlier version's setup again, as the next version. */
  rollbackAgent(orgSlug: string, agentId: string, version: number): Promise<AgentDetail>
  /** Name, number and live/paused: they apply at once, outside versions. */
  updateAgent(orgSlug: string, agentId: string, patch: AgentPatch): Promise<AgentDetail>
  deleteAgent(orgSlug: string, agentId: string): Promise<void>

  /** Forget everything held for the previous user (demo data on sign-out). */
  reset?(): void
}

/* ---------------------------------------------------------------- builder
 * An agent is built in eight steps (docs/pages-and-access.md, "Builder
 * steps"). Until it's first published it's an AgentDraft; the builder saves
 * it as you go. */

export const BUILDER_STEPS = ['calls', 'type', 'behaviour', 'flow', 'attributes', 'global', 'context', 'review'] as const
export type BuilderStep = (typeof BUILDER_STEPS)[number]

/** A past call AICA learns from, in the organisation's call library. */
export type SourceCallStatus = 'queued' | 'transcribing' | 'extracting' | 'ready' | 'failed'

export interface SourceCall {
  id: string
  /** The file name, or a label for sample calls. */
  name: string
  durationSec: number
  language: Language | 'mixed'
  status: SourceCallStatus
  /** Why processing failed, in words for the user. */
  error?: string
  /** ISO timestamp. */
  addedAt: string
  /** What the call was mostly about, once processed. */
  topic?: string
  /** Bytes; absent for sample calls. */
  size?: number
  /** Agents and drafts whose flow was read from it, by name. */
  usedBy?: string[]
}

/** A call transcript. `text` may hold personal details marked as
 * {{kind:value}}, e.g. {{name:Lakshmi}}, so they can be shown or hidden. */
export interface TranscriptTurn {
  speaker: 'caller' | 'staff' | 'agent'
  /** Seconds from the start of the call. */
  at: number
  text: string
}

export interface Transcript {
  callId: string
  turns: TranscriptTurn[]
}

export interface AgentSubType {
  id: string
  label: string
  description: string
  /** What the extracted flow will start from. */
  covers: string[]
}

export interface AgentType {
  id: string
  label: string
  subTypes: AgentSubType[]
}

export interface Voice {
  id: string
  name: string
  description: string
  languages: Language[]
}

export type Tone = 'warm' | 'formal' | 'brisk'
export type SpeakingRate = 'slower' | 'normal' | 'faster'

export interface BotBehaviour {
  /** The name the agent introduces itself by, e.g. "Kavya". */
  persona: string
  tone: Tone
  languages: Language[]
  /** The language it greets in. One of `languages`. */
  startLanguage: Language
  /** Follow the caller when they switch language mid-call. */
  followCaller: boolean
  greeting: string
  closing: string
  voiceId: string
  rate: SpeakingRate
  /** Rules it must always follow, e.g. "Never give medical advice". */
  rules: string[]
}

/** A node in the conversation flow. Intents are the top level; steps and
 * branches nest under them. */
export type FlowNodeKind = 'intent' | 'step' | 'branch'

export interface FlowNode {
  id: string
  kind: FlowNodeKind
  label: string
  /** What the agent says at this point (steps). */
  say?: string
  /** When this branch applies, in words (branches). */
  condition?: string
  /** 0–1: how sure the extraction is. Absent for nodes added by hand. */
  confidence?: number
  /** Calls this node was seen in. */
  sourceCallIds: string[]
  children: FlowNode[]
}

export type AttributeType = 'text' | 'name' | 'phone' | 'date' | 'time' | 'number' | 'choice' | 'patient_id'

/** A detail the agent collects during a call. */
export interface Attribute {
  id: string
  label: string
  type: AttributeType
  required: boolean
  /** Personal data: hidden in transcripts when redaction is on. */
  personal: boolean
  /** Read it back to the caller before going on. */
  confirm: boolean
  /** How the agent asks for it. */
  ask: string
  /** For `choice`. */
  options?: string[]
}

export type GlobalFlowKind = 'handoff' | 'emergency' | 'repeat' | 'out_of_scope' | 'silence' | 'end_call'

/** Behaviour that applies anywhere in a call. */
export interface GlobalFlow {
  kind: GlobalFlowKind
  enabled: boolean
  /** When it happens, in words. */
  trigger: string
  /** What the agent says or does. */
  response: string
}

export interface AgentContext {
  knowledgeSourceIds: string[]
  /** Refuse rather than answer beyond the knowledge base. */
  answerOnlyFromKnowledge: boolean
  /** How many passages to use per answer. */
  topK: number
  /** 0–1: how close a passage must be to count. */
  minScore: number
  toolIds: string[]
  /** Ask the caller before a tool changes anything (e.g. booking). */
  confirmBeforeActions: boolean
}

export interface AgentDraft {
  id: string
  /** Furthest step reached; earlier steps can be revisited. */
  reached: BuilderStep
  sourceCallIds: string[]
  /** Callers' consent and personal-data handling confirmed for these calls. */
  consent: boolean
  redact: boolean
  typeId: string | null
  subTypeId: string | null
  /** Internal name, e.g. "OPD appointments". */
  name: string
  behaviour: BotBehaviour
  /** What the flow was last read from (step 3); unset until it's been read.
   * Reading again is then only on request, and a change of calls or job
   * since shows the flow may be out of date. */
  extraction?: { at: string; callIds: string[]; subTypeId: string | null }
  /** Empty until extracted from the source calls (step 3). */
  flow: FlowNode[]
  attributes: Attribute[]
  globalFlows: GlobalFlow[]
  context: AgentContext
  /** ISO timestamp of the last save. */
  updatedAt: string
}

export interface NewRecording {
  name: string
  size: number
  type: string
  /** The audio itself, for a client that uploads it. */
  file?: Blob
}

/* ---------------------------------------------------------------- library
 * Shared by an organisation's agents: knowledge sources (answered from),
 * tools (actions during a call) and phone numbers. */

export type KnowledgeKind = 'document' | 'web' | 'faq' | 'table'
export type KnowledgeStatus = 'ready' | 'indexing' | 'failed'

export interface KnowledgeSource {
  id: string
  name: string
  kind: KnowledgeKind
  /** The file name, URL, or "18 questions". */
  origin: string
  description: string
  status: KnowledgeStatus
  /** How many passages it was split into for retrieval. */
  passages: number
  /** ISO timestamp. */
  refreshedAt: string
  /** ISO timestamp after which it shouldn't be trusted, or null. */
  expiresAt: string | null
  /** Web pages can be re-read on a schedule. */
  refreshEvery: 'never' | 'daily' | 'weekly'
  usedByAgentIds: string[]
  /** Questions and answers, for an FAQ. */
  faq?: FaqEntry[]
  /** Why indexing failed, in words for the user. */
  error?: string
  /** Agents and drafts set up to use it, by name (any version). */
  usedBy?: string[]
}

export interface FaqEntry {
  q: string
  a: string
}

/** A new knowledge source: a file (document or table), a web page, or an FAQ written here. */
export type NewKnowledge =
  | { kind: 'document' | 'table'; name: string; description: string; fileName: string; size: number; file?: Blob; expiresAt: string | null }
  | { kind: 'web'; name: string; description: string; url: string; refreshEvery: KnowledgeSource['refreshEvery']; expiresAt: string | null }
  | { kind: 'faq'; name: string; description: string; faq: FaqEntry[]; expiresAt: string | null }

export interface KnowledgePatch {
  name?: string
  description?: string
  expiresAt?: string | null
  refreshEvery?: KnowledgeSource['refreshEvery']
  faq?: FaqEntry[]
}

/** A piece of a knowledge source, as the agent finds it when answering. */
export interface Passage {
  sourceId: string
  sourceName: string
  text: string
  /** 0–1: how close it is to the question; absent when just listing. */
  score?: number
}

/** A secret an HTTP tool uses, by name. Its value is set once and never
 * sent back to the browser. */
export interface Credential {
  name: string
  /** ISO timestamp of when the value was last set. */
  setAt: string
  /** Who set it, by name. */
  setBy: string
}

/** What a test run of a tool returned (from AICA's servers, not the browser). */
export interface ToolTestResult {
  ok: boolean
  /** HTTP status, for HTTP tools. */
  status?: number
  ms: number
  /** The reply, shortened, or what went wrong, in words. */
  summary: string
}

export interface NumberPatch {
  label?: string
  /** null to leave it unanswered by any agent. */
  agentId?: string | null
  hours?: string
  afterHours?: PhoneNumber['afterHours']
  transferTo?: string | null
}

export interface ToolParam {
  name: string
  type: 'string' | 'number' | 'date' | 'boolean'
  required: boolean
  description: string
}

export interface AgentTool {
  id: string
  name: string
  kind: 'builtin' | 'http'
  builtin?: 'transfer' | 'end_call' | 'sms' | 'whatsapp'
  description: string
  /** It changes something (books, sends): the caller can be asked first. */
  acts: boolean
  method?: 'GET' | 'POST'
  url?: string
  /** The name of a secret held by AICA's servers; its value is never sent
   * to the browser. */
  credentialName?: string | null
  timeoutMs?: number
  retries?: number
  params: ToolParam[]
  enabled: boolean
  /** ISO timestamp of the last successful test run, or null. */
  lastTestedAt?: string | null
  /** Agents (and drafts) set up to use it, by name. */
  usedBy?: string[]
}

export interface PhoneNumber {
  id: string
  number: string
  label: string
  /** The agent answering it, or null if unassigned. */
  agentId: string | null
  /** When the agent answers, in words, e.g. "8 AM to 8 PM". */
  hours: string
  afterHours: 'agent' | 'voicemail' | 'transfer'
  /** Where handoffs go. */
  transferTo: string | null
}

/* ---------------------------------------------------------------- workspace
 * After its first publish an agent is edited in the workspace. Its setup is
 * versioned: edits are saved as unpublished changes, and publishing makes
 * them the next version. */

/** How it sounds and listens, beyond the builder's behaviour step. */
export interface SpeechSettings {
  /** Words said a particular way, e.g. "Dr. Ramachandran" → "Raa-ma-chan-dran". */
  pronunciations: { word: string; sayAs: string }[]
  /** Words to listen out for: doctor names, departments, local places. */
  hints: string[]
  /** Callers can talk over the agent to cut it short. */
  allowInterruptions: boolean
  /** Seconds of silence before the agent checks the caller is there. */
  silenceSec: number
}

/** When and where it hands over, and what it won't do. */
export interface Guardrails {
  /** Hand over after this many turns where it couldn't help. */
  handoffAfterFailures: number
  /** Where handovers go, in words, e.g. "Front desk, extension 100". */
  transferTo: string
  /** Where emergencies go. */
  emergencyTo: string
  /** Subjects it declines, e.g. "Diagnosis or medical advice". */
  refuseTopics: string[]
  /** Tells callers at the start that the call is recorded. */
  recordingNotice: boolean
  recordingNoticeText: string
  /** Calls longer than this are handed over. */
  maxCallMinutes: number
}

/** Everything that decides how an agent behaves: what a version holds. */
export interface AgentSpec {
  typeId: string | null
  subTypeId: string | null
  /** Personal details hidden in its transcripts. */
  redact: boolean
  behaviour: BotBehaviour
  speech: SpeechSettings
  flow: FlowNode[]
  attributes: Attribute[]
  globalFlows: GlobalFlow[]
  context: AgentContext
  guardrails: Guardrails
}

export interface AgentVersion {
  version: number
  /** ISO timestamp. */
  publishedAt: string
  /** Who published it, by name. */
  publishedBy: string
  /** What changed, in the publisher's words. */
  note: string
  spec: AgentSpec
}

export interface AgentDetail {
  agent: AgentSummary
  /** The live version's setup plus any saved edits. */
  working: AgentSpec
  /** Newest first. The first is the one callers get. */
  versions: AgentVersion[]
}

export interface AgentPatch {
  name?: string
  status?: 'live' | 'paused'
  /** null to free the number. */
  numberId?: string | null
}
