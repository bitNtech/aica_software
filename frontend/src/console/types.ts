import type { Language, Permission, PlatformRole, Role } from '../auth/types'

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
  /** Who set it up, e.g. "bitNtech (Vikram S)". */
  builtBy?: string
  /** How it comes across on a call, for showing the agent itself. Absent
   * when the server doesn't send them. */
  persona?: string
  voiceName?: string
  greeting?: string
  /** What it handles: its intents, in order. */
  intents?: string[]
  /** Drafts only: the organisation's own, being written or sent to bitNtech. */
  request?: { state: 'drafting' | 'sent'; by: string; requestId: string | null }
  /** Published agents: changes drafted in the builder, not published yet. */
  change?: { draftId: string; state: 'drafting' | 'sent'; by: string; requestId: string | null; step: BuilderStep }
}

/** The parts of the console that move from demo data to the API one at a
 * time (docs/backend-workflow.md). */
export type ConsoleSection = 'team' | 'settings' | 'activity' | 'requests' | 'calls' | 'callbacks' | 'appointments' | 'handoffs' | 'reports' | 'numbers' | 'tools' | 'knowledge' | 'uploads' | 'agents'

/** Methods reject with an `AuthError` (auth/types.ts), whose message is
 * written for the person using the console. Pages show it as-is, so a real
 * client must map its failures to one too. */
export interface ConsoleClient {
  /** True while every console page runs on built-in sample data. The UI
   * labels it, so nobody mistakes it for their real configuration. */
  readonly isDemo: boolean
  /** True for a section served by the API while the rest is still demo
   * data. Its pages drop the "Demo data" note. Absent: nothing is live. */
  isLive?(section: ConsoleSection): boolean
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
  /** The platform's model catalogue, for an agent's voice pipeline. Names
   * only: service addresses and keys never reach the browser. */
  listModels(): Promise<ModelCatalogue>
  /** `orgName` personalises the starting greeting. */
  createDraft(orgSlug: string, orgName: string): Promise<AgentDraft>
  getDraft(orgSlug: string, draftId: string): Promise<AgentDraft>
  saveDraft(orgSlug: string, draft: AgentDraft): Promise<AgentDraft>
  discardDraft(orgSlug: string, draftId: string): Promise<void>
  /** Builder step 3: reads the draft's calls into `flowGroups`, one flow per
   * group of related calls. A new agent also takes the suggested group's
   * flow, attributes and global flows (replacing what's there); changes to
   * a published agent keep their flow, and the person adds from a group.
   * Real API: a job (start, then poll or stream progress, cancellable),
   * with a draft revision so autosave can't overwrite its result. */
  extractFlow(orgSlug: string, draftId: string): Promise<AgentDraft>
  /** Builder step 7: turns the draft into a live agent on `numberId`, or a
   * paused one with no number; a draft of changes becomes the agent's next
   * version instead (`numberId` is ignored). Either way a request it was
   * sent with is marked done. Safe to retry: a draft that's already been
   * published returns the agent it became (real API: an idempotency key). */
  publishDraft(orgSlug: string, draftId: string, numberId: string | null): Promise<AgentSummary>
  /** A builder draft of changes to a published agent, starting from its
   * current setup; an open one is returned instead of making another. */
  startAgentChange?(orgSlug: string, agentId: string): Promise<AgentDraft>
  /** Sends the organisation's draft to bitNtech as a request. The draft is
   * locked until the request is withdrawn or declined. */
  submitDraft?(orgSlug: string, draftId: string, input: DraftSubmission): Promise<ChangeRequest>

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
  /** Asks bitNtech for another number: a change request of kind "number". */
  requestNumber(orgSlug: string, note: string): Promise<void>

  // ---- requests to bitNtech (a hospital asks; the master admin does it)
  /** Newest first. */
  listChangeRequests(orgSlug: string): Promise<ChangeRequest[]>
  createChangeRequest(orgSlug: string, input: NewChangeRequest): Promise<ChangeRequest>
  /** A reply in the request's thread, from either side. */
  replyChangeRequest(orgSlug: string, id: string, text: string): Promise<ChangeRequest>
  /** The person who asked withdraws an open request. */
  withdrawChangeRequest(orgSlug: string, id: string): Promise<ChangeRequest>
  /** Master admin: moves a request on, with a note to the hospital. */
  updateChangeRequest(orgSlug: string, id: string, patch: ChangeRequestPatch): Promise<ChangeRequest>
  /** bitNtech: every organisation's open requests and recent ones, in one
   * call. Absent: Ops asks each organisation in turn. */
  listAllChangeRequests?(): Promise<(ChangeRequest & { orgName: string })[]>

  // ---- bot desk (front desk run the agents day to day)
  getDesk(orgSlug: string): Promise<Desk>
  /** Sends a line's calls to staff instead of the agent, or back. */
  setLineMode(orgSlug: string, numberId: string, change: LineModeChange): Promise<Desk>
  /** Creates (no id) or changes a notice. */
  saveNotice(orgSlug: string, notice: NoticeInput): Promise<Desk>
  removeNotice(orgSlug: string, id: string): Promise<Desk>
  saveDoctorChange(orgSlug: string, change: DoctorChangeInput): Promise<Desk>
  removeDoctorChange(orgSlug: string, id: string): Promise<Desk>
  /** Reports an answer the agent got wrong, for whoever looks after it. */
  flagAnswer(orgSlug: string, input: NewAnswerFlag): Promise<AnswerFlag>
  /** `open` puts a fixed or dismissed answer back (an undo, or it came back). */
  resolveFlag(orgSlug: string, id: string, resolution: { status: 'fixed' | 'dismissed' | 'open'; note: string }): Promise<Desk>

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
  /** Master admin only. */
  deleteAgent(orgSlug: string, agentId: string): Promise<void>

  // ---- test scenarios (scripted callers, run against the agent's setup)
  listScenarios(orgSlug: string, agentId: string): Promise<Scenario[]>
  /** Creates (no id) or changes a scenario. */
  saveScenario(orgSlug: string, agentId: string, scenario: ScenarioInput): Promise<Scenario>
  deleteScenario(orgSlug: string, agentId: string, id: string): Promise<void>
  /** Runs every scenario against the saved setup (draft changes included). */
  runScenarios(orgSlug: string, agentId: string): Promise<Scenario[]>

  // ---- operate: calls as they happen, and after
  listLiveCalls(orgSlug: string): Promise<LiveCall[]>
  /** Puts the caller through to the person asking (their desk phone). */
  takeOverCall(orgSlug: string, callId: string): Promise<LiveCall>
  /** A note only the agent hears, e.g. "Offer Saturday with Dr. Arvind". */
  whisperToAgent(orgSlug: string, callId: string, text: string): Promise<LiveCall>
  /** Hands the call to a colleague. Warm: the agent tells them about it first. */
  transferCall(orgSlug: string, callId: string, to: string, warm: boolean): Promise<LiveCall>
  listHandoffs(orgSlug: string): Promise<Handoff[]>
  /** The person asking takes the waiting caller. */
  takeHandoff(orgSlug: string, id: string): Promise<Handoff>
  /** The caller hung up before anyone answered: turn it into a callback. */
  handoffToCallback(orgSlug: string, id: string): Promise<Callback>
  /** Front desk see their own and unassigned ones; others see all. */
  listCallbacks(orgSlug: string): Promise<Callback[]>
  updateCallback(orgSlug: string, id: string, patch: CallbackPatch): Promise<Callback>
  listAppointments(orgSlug: string, from: string, to: string): Promise<Appointment[]>
  updateAppointment(orgSlug: string, id: string, patch: AppointmentPatch): Promise<Appointment>
  /** A booking made by hand (an agent's arrive on their own, from its calls). */
  createAppointment(orgSlug: string, input: NewAppointment): Promise<Appointment>
  /** Absent: the console can't read them (an older client). */
  getBookingSettings?(orgSlug: string): Promise<BookingSettings>
  updateBookingSettings?(orgSlug: string, input: BookingSettings): Promise<BookingSettings>
  /** Runs the end-of-day automatic confirmation now. */
  runAutoConfirm?(orgSlug: string): Promise<AutoConfirmResult>
  /** Sends a failed callback or message to the patient again. */
  retryPatientUpdate?(orgSlug: string, appointmentId: string, updateId: string): Promise<Appointment>
  /** Front desk see only calls they handled. */
  listCallLog(orgSlug: string, query: CallQuery): Promise<CallLogPage>
  getCallRecord(orgSlug: string, id: string): Promise<CallRecord>
  addCallNote(orgSlug: string, callId: string, text: string): Promise<CallNote>
  getReport(orgSlug: string, query: ReportQuery): Promise<Report>
  /** The call list for a period as a CSV file (reports.export). Absent: the
   * console can't make one (demo). */
  exportCallLog?(orgSlug: string, query: ReportQuery): Promise<Blob>
  /** Looks at the agent's last `windowSize` calls for a step sequence
   * repeated outside its current design. */
  detectNewFlowPatterns(orgSlug: string, agentId: string, opts: { windowSize: number }): Promise<DetectedFlowPattern[]>
  /** Same, across every agent in the org (for nav/agents-list badges). */
  listNewFlowPatterns(orgSlug: string, opts: { windowSize: number }): Promise<DetectedFlowPattern[]>

  // ---- people
  /** The organisation's team, for assigning work (and the Team page). */
  listMembers(orgSlug: string): Promise<Member[]>

  // ---- manage (owners and admins; billing owners only)
  /** Sends an invitation email; they appear as invited until they accept. */
  inviteMember(orgSlug: string, invite: NewInvite): Promise<Member>
  /** Sends the invitation email again, with a fresh 7-day link. */
  resendInvite(orgSlug: string, memberId: string): Promise<Member>
  /** Nobody changes their own role; only owners make or change owners.
   * A new role starts from its default permissions. */
  changeRole(orgSlug: string, memberId: string, role: Role): Promise<Member>
  /** What one person may do. `null`: their role's defaults. Nobody changes
   * their own; only owners change an owner's. */
  setPermissions(orgSlug: string, memberId: string, permissions: Permission[] | null): Promise<Member>
  /** Removes a member, or cancels an invitation. Their open callbacks go
   * back to nobody. */
  removeMember(orgSlug: string, memberId: string): Promise<void>
  /** This organisation's audit log, newest first. */
  listActivity(orgSlug: string, query: ActivityQuery): Promise<ActivityPage>
  getOrgSettings(orgSlug: string): Promise<OrgSettings>
  updateOrgSettings(orgSlug: string, settings: OrgSettingsInput): Promise<OrgSettings>
  getBilling(orgSlug: string): Promise<Billing>
  /** Upgrades apply now; downgrades at renewal. `null` cancels a pending change. */
  changePlan(orgSlug: string, planId: PlanId | null): Promise<Billing>
  updateBillingDetails(orgSlug: string, details: BillingDetails): Promise<Billing>

  /** Who gets the organisation's alerts, by email. */
  getAlertSettings(orgSlug: string): Promise<AlertSettings>
  updateAlertSettings(orgSlug: string, input: AlertSettingsInput): Promise<AlertSettings>

  /** Who is using the console, for "by" fields and what front desk see.
   * A real server knows this from the session. */
  setViewer?(viewer: Viewer | null): void
  /** Forget everything held for the previous user (demo data on sign-out). */
  reset?(): void
}

export interface Viewer {
  id: string
  name: string
  /** Their role in each organisation, by slug. */
  roles: Record<string, Role>
  /** Their permissions in each organisation, by slug. */
  permissions?: Record<string, Permission[]>
  /** bitNtech accounts, working on organisations from Ops. */
  platformRole?: PlatformRole | null
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
  /** Agent turns: ms from the caller stopping to the agent starting to speak. */
  latencyMs?: number
  /** The caller talked over this turn. */
  interrupted?: boolean
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

export interface ModelCatalogue {
  speech: { id: string; label: string; note: string }[]
  language: { id: string; label: string; note: string }[]
  voice: { id: string; label: string; note: string }[]
  /** What "default" means today, by id. */
  defaults: { speech: string; language: string; voice: string }
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

/**
 * A node in the conversation flow, which is a tree. Intents are the top
 * level. A node's children are what can happen next: one child carries the
 * call on; several are a fork, and each is a branch that says when it
 * applies, except at most one plain step, last, for "otherwise". Every
 * branch then runs on with children of its own, and can fork again.
 * normaliseFlow (builder/flowTree.ts) turns the older shape, where siblings
 * followed one another, into this one.
 *
 * Branches can join back up: a node with no plain step after it can name,
 * in `joinsAt`, a step elsewhere in the same intent where the call carries
 * on (the step after a fork that every branch comes back to). The tree
 * still owns each node once; console/flowGraph.ts reads the joins.
 */
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
  /** Where the call carries on after this node: the id of a step in the
   * same intent. Only on a node with no plain step among its children; with
   * branches there, it is the way on when none of them applies. */
  joinsAt?: string
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
  /** How it listens and replies (set in step 3, with its voice). */
  pipeline: PipelineSettings
  /** How it sounds and listens (behaviour step); absent: the defaults. */
  speech?: SpeechSettings
  /** Handing over and what it won't do (global step); absent: the defaults. */
  guardrails?: Guardrails
  /** What AICA notes after each call (review step); absent: the defaults. */
  analysis?: AnalysisSettings
  /** What reading the calls found: one flow per group of related calls.
   * Unrelated calls make separate groups, and one is chosen. */
  flowGroups?: FlowGroup[]
  /** The group the flow was taken from or added from, if any. */
  flowGroupId?: string | null
  /** Set when the draft changes a published agent instead of making a new
   * one: that agent, and the version the changes started from. */
  baseAgentId?: string | null
  baseVersion?: number | null
  /** The organisation's own draft: sent to bitNtech as a request, not
   * published. Absent or null: bitNtech's own draft. */
  requestedBy?: { id: string; name: string } | null
  /** Once sent: the request it became and when. The organisation can't
   * change it then, unless the request is withdrawn or declined. */
  requestId?: string | null
  submittedAt?: string | null
  /** ISO timestamp of the last save. */
  updatedAt: string
}

/** A conversation found in a group of related calls. */
export interface FlowGroup {
  id: string
  title: string
  /** In words, e.g. "8 calls about booking and directions". */
  summary: string
  /** The call topics it covers. */
  topics: string[]
  callIds: string[]
  flow: FlowNode[]
  /** Fits the job chosen for the agent, so it's the one suggested. */
  matchesJob: boolean
}

/** What the organisation sends with a draft it asks bitNtech to build. */
export interface DraftSubmission {
  title: string
  /** Anything bitNtech should know, in their words. */
  note: string
  urgency: 'normal' | 'soon' | 'urgent'
  /** Changes to an agent: what differs from the version callers get, in words. */
  changes?: string[]
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
  /** The header the secret is sent in. Absent or null: "Authorization: Bearer <secret>". */
  credentialHeader?: string | null
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

/**
 * How the agent listens and replies: the speech, language and voice models,
 * turn-taking and interruptions. The master admin's. Models are named from
 * the platform catalogue (Ops → Platform); "default" follows it. The voice
 * servers apply these; their contract is still to be agreed, so the shape
 * may change.
 */
export interface PipelineSettings {
  /** Model ids, or "default". */
  speechModel: string
  languageModel: string
  voiceModel: string
  /** vad: replies after a pause · semantic: also listens for whether the
   * caller sounds finished, so it waits through "umm…". */
  turnDetection: 'vad' | 'semantic'
  /** Waits at least this long after the caller stops, and at most this long. */
  minEndpointMs: number
  maxEndpointMs: number
  /** Words the caller must say before the agent stops for them. */
  interruptMinWords: number
  /** Speech shorter than this doesn't count as an interruption. */
  interruptMinMs: number
  /** If an interruption turns out to be noise, carry on where it stopped. */
  resumeAfterFalseInterruption: boolean
  /** Small sounds while listening ("mm", "sari"). */
  backchannel: boolean
  /** Said while a tool runs, so the line isn't silent. */
  fillerPhrases: string[]
  /** Starts working on a reply before the caller has quite finished. */
  preemptiveReplies: boolean
  noiseCancellation: 'off' | 'standard' | 'strong'
  /** Quiet sound behind the agent, so silence doesn't sound like a drop. */
  ambience: 'none' | 'office' | 'reception'
  /** Callers can press keys, e.g. for a patient ID. */
  keypadInput: boolean
  /** Times it checks the caller is there before ending the call. */
  silenceReprompts: number
  /** 0–1: higher varies the wording more. */
  temperature: number
}

/** What AICA notes about each call once it ends. The fields are set up by
 * bitNtech; a hospital words what counts as a successful call. */
export interface AnalysisSettings {
  summary: boolean
  sentiment: boolean
  /** In words, e.g. "The caller booked, or got their answer without a person." */
  successCriteria: string
  fields: AnalysisField[]
}

export interface AnalysisField {
  id: string
  label: string
  type: 'text' | 'yes_no' | 'number' | 'choice'
  /** What to look for, in words. */
  description: string
  options?: string[]
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
  pipeline: PipelineSettings
  analysis: AnalysisSettings
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

/* ---------------------------------------------------------------- operate
 * Calls as they happen and after: live calls, the handoff queue, callbacks,
 * appointments booked on calls, the call log and reports. */

export type CallOutcome = 'resolved' | 'booked' | 'handed_over' | 'callback' | 'dropped' | 'emergency'

export interface Member {
  id: string
  name: string
  email: string
  role: Role
  /** Changed from the role's defaults; null when it has them. */
  permissions: Permission[] | null
  /** ISO timestamp, or null if they've never signed in. */
  lastActiveAt: string | null
  status: 'active' | 'invited' | 'disabled'
  /** Invitations: when it was (last) sent, and by whom. The link lasts 7 days. */
  invitedAt?: string
  invitedBy?: string
}

export interface LiveCall {
  id: string
  agentId: string
  agentName: string
  /** The line it came in on, formatted. */
  line: string
  /** Masked, e.g. "+91 ••••• 43210". */
  callerPhone: string
  startedAt: string
  language: Language | 'mixed'
  /** What the caller wants, once the agent knows. */
  intent: string | null
  /** Where in the flow the agent is now. */
  step: string | null
  /** The conversation so far. */
  turns: TranscriptTurn[]
  /** The caller sounds upset or stuck: worth a person's ear. */
  flagged: boolean
  /** Who took it over, by name, once someone has. */
  takenBy: string | null
  /** Notes staff gave the agent during the call; the caller doesn't hear them. */
  whispers: { by: string; at: string; text: string }[]
  /** Handed to a colleague: who, and whether the agent briefed them first. */
  transferredTo?: { name: string; warm: boolean } | null
}

export interface CollectedDetail {
  label: string
  value: string
  personal: boolean
}

export interface Handoff {
  id: string
  callId: string
  agentName: string
  line: string
  callerPhone: string
  /** Why the agent handed over, in words. */
  reason: string
  /** The agent's summary of the call so far. */
  summary: string
  details: CollectedDetail[]
  language: Language | 'mixed'
  waitingSince: string
  status: 'waiting' | 'taken' | 'missed'
  takenBy: string | null
  takenAt: string | null
  emergency: boolean
}

export interface Callback {
  id: string
  callerName: string | null
  /** In full: whoever calls back needs it. */
  callerPhone: string
  reason: string
  requestedAt: string
  /** When to call back by. */
  dueBy: string
  assignedTo: { id: string; name: string } | null
  status: 'open' | 'done' | 'unreachable'
  /** Times tried without reaching them. */
  attempts: number
  notes: CallNote[]
  /** The call it came from, if any. */
  callId: string | null
}

export interface CallbackPatch {
  /** A member's id, or null to unassign. */
  assignedTo?: string | null
  /** A try: reached them (done), or no answer (three of those: unreachable). */
  attempt?: 'reached' | 'no_answer'
  /** Back to open, e.g. after "done" by mistake. */
  reopen?: boolean
  note?: string
}

/**
 * pending: booked, not yet confirmed with the patient. rescheduled: moved to
 * a new date, time or doctor, and the new slot not yet confirmed. completed
 * and no_show are recorded after the appointment's time. declined: a
 * request the hospital turned down (the agent tells the patient why).
 */
export type AppointmentStatus = 'pending' | 'confirmed' | 'rescheduled' | 'completed' | 'no_show' | 'cancelled' | 'declined'

/** How it was booked: by an agent on a call, by the front desk on a phone call, or entered by hand. */
export type BookingSource = 'ai_call' | 'front_desk' | 'manual'

export type AppointmentType = 'new_visit' | 'follow_up' | 'procedure' | 'test'

/** One thing that happened to an appointment, newest first in `history`. */
export interface AppointmentChange {
  at: string
  /** Who, by name: a person, or the agent that booked it. */
  by: string
  kind: 'created' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed' | 'no_show' | 'restored' | 'edited' | 'undone' | 'declined' | 'notified'
  /** What changed, in words: "Moved from Tue 4 Nov, 10:00 am with Dr. Rao". */
  text: string
  /** Why, when one was given (rescheduling and cancelling ask). */
  reason?: string
}

/** How soon the patient needs to be seen, as the ranking judged it. */
export type PriorityLevel = 'urgent' | 'high' | 'normal' | 'routine'

/**
 * Where a request stands among others for the same doctor and time, set by
 * the LLM from what the agent gathered on each call. Only requests that
 * share a time are ranked.
 */
export interface AppointmentRank {
  /** 1 is the patient who most needs the time. */
  position: number
  of: number
  level: PriorityLevel
  /** The LLM's reasons, in a sentence or two. */
  reasons: string
  rankedAt: string
}

/** How the patient is told: the agent calls back, or a WhatsApp message. */
export type PatientUpdateChannel = 'callback' | 'whatsapp'
/** callback: queued → in_progress → done | no_answer | failed. whatsapp: queued → sent → delivered → read | failed. */
export type PatientUpdateState = 'queued' | 'in_progress' | 'done' | 'no_answer' | 'sent' | 'delivered' | 'read' | 'failed'

/** One message to the patient about their booking, after the hospital decided on it. */
export interface PatientUpdate {
  id: string
  about: 'confirmed' | 'declined' | 'moved'
  channel: PatientUpdateChannel
  state: PatientUpdateState
  /** When it was queued (this attempt). */
  at: string
  /** When its state last changed. */
  updatedAt?: string
  attempts: number
  /** Why it failed, or what happens next: "Not on WhatsApp", "Trying again at 7:30 pm". */
  detail?: string
}

export interface Appointment {
  id: string
  patientName: string
  phone: string
  department: string
  doctor: string
  /** yyyy-mm-dd and HH:mm, local to the hospital. */
  date: string
  time: string
  status: AppointmentStatus
  /** Why it needs a person to check it, e.g. "The caller wasn't sure of the
   * date." Set by the agent; only shown while pending or rescheduled. */
  checkReason?: string
  /** Absent from older records: read as ai_call when an agent booked it, else front_desk. */
  source?: BookingSource
  /** Older field, kept in step with `source`: agent for ai_call, staff otherwise. */
  bookedBy: 'agent' | 'staff'
  agentName: string | null
  callId: string | null
  type?: AppointmentType
  /** Why the patient is coming, in their words or the desk's. */
  visitReason?: string
  /** Why it was cancelled, when it was. */
  cancelReason?: string
  /** Why the request was turned down, when it was. */
  declineReason?: string
  /** Its place among requests for the same doctor and time (agent bookings). */
  rank?: AppointmentRank
  /** Who confirmed it: a person, or the end-of-day automatic confirmation. */
  confirmedBy?: 'staff' | 'auto'
  /** What the patient has been told, newest first. */
  updates?: PatientUpdate[]
  createdAt: string
  updatedAt?: string
  updatedBy?: string
  history?: AppointmentChange[]
  note?: string
}

export interface AppointmentPatch {
  status?: AppointmentStatus
  date?: string
  time?: string
  department?: string
  doctor?: string
  note?: string
  type?: AppointmentType
  visitReason?: string
  /** Why: required to reschedule or cancel; kept in the history. */
  changeReason?: string
  /** Puts back an earlier state exactly (Undo), skipping the usual order of statuses. */
  undo?: boolean
}

/**
 * How an organisation handles the agent's requests: confirmed by staff, or
 * automatically each evening (the top-ranked request in each time), and how
 * the patient is told afterwards.
 */
export interface BookingSettings {
  confirm: 'staff' | 'auto'
  /** HH:mm, local: when the automatic confirmation runs each day. */
  autoAt: string
  /** Leave urgent requests for a person to confirm. */
  autoSkipUrgent: boolean
  /** Leave requests the agent flagged for a check for a person. */
  autoSkipFlagged: boolean
  /** The other requests for a time that went to someone else: offered the next free time, or declined. */
  others: 'offer' | 'decline'
  /** The agent calls the patient back to tell them. */
  callback: boolean
  /** A WhatsApp message as well. */
  whatsapp: boolean
  /** An unanswered callback is tried once more, 30 minutes later. */
  retryCallback: boolean
  updatedAt?: string
  updatedBy?: string
}

/** What an automatic confirmation run did. */
export interface AutoConfirmResult {
  confirmed: number
  offered: number
  declined: number
  /** Left for a person (urgent or flagged, as the settings say). */
  left: number
}

export interface NewAppointment {
  patientName: string
  phone: string
  doctor: string
  department: string
  date: string
  time: string
  type: AppointmentType
  visitReason: string
  /** front_desk when booked during a phone call; manual otherwise. */
  source: Exclude<BookingSource, 'ai_call'>
  /** Confirmed with the patient already. */
  confirmed: boolean
  note?: string
}

export interface CallNote {
  id: string
  by: string
  at: string
  text: string
}

export interface CallQuery {
  /** Last this many days (1 = today). */
  days: 1 | 7 | 30 | 90
  agentId?: string
  outcome?: CallOutcome
  /** Matches the caller's number, name, intent or agent. */
  q?: string
  /** Up to this many, newest first. */
  limit?: number
}

export interface CallSummary {
  id: string
  agentId: string
  agentName: string
  line: string
  callerPhone: string
  callerName: string | null
  startedAt: string
  durationSec: number
  language: Language | 'mixed'
  intent: string
  outcome: CallOutcome
  /** The person who took it over, if anyone. */
  handledBy: string | null
}

export interface CallLogPage {
  calls: CallSummary[]
  /** All matches, of which `calls` is the newest. */
  total: number
}

export interface ToolCallRecord {
  name: string
  ok: boolean
  /** What it did or returned, in words. */
  summary: string
  /** Seconds from the start of the call. */
  at: number
}

export interface CallRecord extends CallSummary {
  /** The agent's summary. */
  summary: string
  /** The flow steps it went through, in order. */
  path: string[]
  details: CollectedDetail[]
  toolCalls: ToolCallRecord[]
  knowledgeUsed: string[]
  transcript: TranscriptTurn[]
  notes: CallNote[]
  /** The recording can be played (the demo has none). */
  hasRecording: boolean
  /** Id of the person who took it over, for "own" access. */
  handledById: string | null
  analysis: CallAnalysis
  metrics: CallMetrics
}

/** A step sequence repeated across an agent's recent calls that isn't part
 * of its designed flow (FlowNode tree). Demo-only: a templated summary, not
 * a real analysis. */
export interface DetectedFlowPattern {
  id: string
  agentId: string
  agentName: string
  steps: string[]
  occurrences: number
  windowSize: number
  callIds: string[]
  firstSeenAt: string
  lastSeenAt: string
  summary: string
}

/** What AICA noted once the call ended (AnalysisSettings). */
export interface CallAnalysis {
  sentiment: Sentiment
  /** Against the agent's success criteria. */
  success: boolean
  /** Why, in a line. */
  successReason: string
  fields: { label: string; value: string }[]
}

export type Sentiment = 'positive' | 'neutral' | 'negative'

/** How quickly it answered, from the voice servers' timings. */
export interface CallMetrics {
  /** From answering to the greeting starting. */
  firstWordMs: number
  /** Caller stops → agent starts, across the call. */
  replyP50Ms: number
  replyP95Ms: number
  /** The average share of a reply's wait, by service. */
  speechMs: number
  languageMs: number
  voiceMs: number
  interruptions: number
}

export interface ReportQuery {
  days: 1 | 7 | 30 | 90
  agentId?: string
}

export interface ReportDay {
  /** yyyy-mm-dd */
  date: string
  resolved: number
  handedOver: number
  dropped: number
}

export interface Report {
  days: number
  totals: { calls: number; byAgent: number; handedOver: number; dropped: number; avgDurationSec: number }
  /** The same, for the period before, to compare. */
  previous: { calls: number; byAgent: number; handedOver: number; dropped: number; avgDurationSec: number }
  byDay: ReportDay[]
  /** Calls per hour of the day, 0–23. */
  byHour: number[]
  /** Calls by weekday then hour: 7 rows (0 = Monday) of 24. */
  byDayHour: number[][]
  languages: { language: Language | 'mixed'; calls: number }[]
  intents: { label: string; calls: number; byAgent: number }[]
  /** Where callers hung up or were handed over, by flow step. */
  dropOff: { step: string; calls: number }[]
  quality: ReportQuality
  /** One row per agent, busiest first. */
  agents: { agentId: string; name: string; calls: number; byAgent: number; success: number | null; replyP50Ms: number | null }[]
}

/** From each call's analysis and the voice servers' timings. Null until
 * calls in the period carry them (the voice pipeline sends them). */
export interface ReportQuality {
  /** Calls that carried an analysis: success and sentiment are out of these.
   * Absent (the demo): every call. */
  analysed?: number
  /** Calls that met their agent's success criteria. */
  success: number | null
  sentiment: Record<Sentiment, number> | null
  /** Medians across calls, ms. */
  firstWordMs: number | null
  replyP50Ms: number | null
  replyP95Ms: number | null
  speechMs: number | null
  languageMs: number | null
  voiceMs: number | null
  interruptionsPerCall: number | null
}

/* ---------------------------------------------------------------- manage
 * The team, the organisation's audit log, its settings and billing. */

export interface NewInvite {
  email: string
  role: Role
}

/* ---------------------------------------------------------------- requests
 * What a hospital asks bitNtech for: new agents and structural changes it
 * can't make itself. The master admin does the work and replies. */

export type ChangeKind = 'new_agent' | 'flow_change' | 'integration' | 'number' | 'other'
export type ChangeStatus = 'open' | 'in_progress' | 'done' | 'declined' | 'withdrawn'

export interface ChangeReply {
  id: string
  by: string
  /** member: the hospital · bitntech: bitNtech (always says so). */
  byKind: 'member' | 'bitntech'
  at: string
  text: string
}

export interface ChangeRequest {
  id: string
  orgSlug: string
  kind: ChangeKind
  /** The agent it's about, if any. */
  agentId: string | null
  agentName: string | null
  title: string
  detail: string
  urgency: 'normal' | 'soon' | 'urgent'
  /** The builder draft it was sent with: a new agent, or changes to one. */
  draftId?: string | null
  status: ChangeStatus
  createdAt: string
  createdBy: string
  createdById: string | null
  updatedAt: string
  replies: ChangeReply[]
}

export interface NewChangeRequest {
  kind: ChangeKind
  agentId: string | null
  title: string
  detail: string
  urgency: ChangeRequest['urgency']
}

export interface ChangeRequestPatch {
  status?: Exclude<ChangeStatus, 'withdrawn'>
  /** Shown to the hospital in the thread. */
  reply?: string
}

/* ---------------------------------------------------------------- bot desk
 * The front desk's controls over the agents: send a line to staff, post a
 * notice, mark a doctor away, flag a wrong answer. */

export interface DeskLine {
  numberId: string
  number: string
  label: string
  agentId: string | null
  agentName: string | null
  agentStatus: AgentStatus | null
  /** agent: the agent answers · staff: calls ring at the desk instead. */
  mode: 'agent' | 'staff'
  /** While on staff: until when (ISO; null until switched back), why, and who. */
  staffUntil: string | null
  staffReason: string | null
  staffBy: string | null
  /** Calls on the line now. */
  liveCalls: number
}

export interface LineModeChange {
  mode: 'agent' | 'staff'
  /** ISO; null: until someone switches it back. */
  until?: string | null
  reason?: string
}

export interface Notice {
  id: string
  /** What the agent tells callers, in plain words. */
  text: string
  /** null: every agent. */
  agentId: string | null
  /** ISO. Notices stop by themselves at `until`. */
  from: string
  until: string
  createdBy: string
  createdAt: string
}

export type NoticeInput = Omit<Notice, 'id' | 'createdBy' | 'createdAt'> & { id?: string }

export interface DoctorChange {
  id: string
  doctor: string
  department: string
  /** yyyy-mm-dd, IST. */
  date: string
  kind: 'away' | 'late' | 'moved'
  /** E.g. "Seeing patients from 11 AM" or "In OPD room 4 today". */
  detail: string
  createdBy: string
  createdAt: string
}

export type DoctorChangeInput = Omit<DoctorChange, 'id' | 'createdBy' | 'createdAt'> & { id?: string }

export interface AnswerFlag {
  id: string
  callId: string | null
  agentName: string | null
  /** What the agent said, or did, wrong. */
  text: string
  /** What it should have said. */
  correction: string
  by: string
  at: string
  status: 'open' | 'fixed' | 'dismissed'
  resolution?: { by: string; at: string; note: string }
}

export interface NewAnswerFlag {
  callId: string | null
  agentName: string | null
  text: string
  correction: string
}

export interface Desk {
  lines: DeskLine[]
  /** Current and upcoming, soonest ending first. */
  notices: Notice[]
  /** Today and later, soonest first. */
  doctorChanges: DoctorChange[]
  /** Open first, then the last few resolved. */
  flags: AnswerFlag[]
  /** Doctors from the knowledge library, for choosing. */
  doctors: { doctor: string; department: string }[]
}

/* ---------------------------------------------------------------- scenarios
 * Scripted callers that check an agent behaves before its changes go live. */

export interface Scenario {
  id: string
  name: string
  /** What the caller says, one line per turn. */
  callerSays: string[]
  expect: {
    /** The flow it should end up in, by intent label; empty for any. */
    intent: string
    /** Words the agent's replies must include, e.g. "slot". */
    mustSay: string[]
    /** It should hand over to a person (true), not hand over (false), or either (null). */
    handover: boolean | null
  }
  lastRun: ScenarioRun | null
}

export interface ScenarioRun {
  at: string
  passed: boolean
  /** What didn't match, in words; empty when it passed. */
  problems: string[]
  /** The replies it gave, in order. */
  replies: string[]
  /** The agent version it ran against, or null for the draft changes. */
  version: number | null
}

export type ScenarioInput = Omit<Scenario, 'id' | 'lastRun'> & { id?: string }

/** What an activity entry is about, for filtering. */
export type ActivityArea = 'team' | 'agents' | 'library' | 'settings' | 'billing' | 'access'

export interface ActivityEntry {
  id: string
  /** ISO timestamp. */
  at: string
  /** Who did it, by name. */
  actor: string
  /** member: someone in the organisation · bitntech: bitNtech staff
   * (always says so) · aica: AICA itself, e.g. a failed import. */
  actorKind: 'member' | 'bitntech' | 'aica'
  /** The member's id, to filter by person; absent for bitNtech and AICA. */
  actorId?: string
  area: ActivityArea
  /** What happened, in a sentence, e.g. "Published OPD appointments, version 4". */
  text: string
  /** More, e.g. the publish note or a reason. Never a secret's value. */
  detail?: string
}

export interface ActivityQuery {
  area?: ActivityArea
  actorId?: string
  /** The `nextBefore` of the previous page. */
  before?: string
}

export interface ActivityPage {
  entries: ActivityEntry[]
  nextBefore: string | null
}

/** One weekday's hours, Monday first. Times are "HH:MM", 24-hour, IST. */
export interface DayHours {
  open: boolean
  from: string
  to: string
}

export interface ClosedDay {
  /** "YYYY-MM-DD". */
  date: string
  label: string
}

export interface OrgSettings {
  name: string
  city: string
  /** Languages callers may use; agents choose from these. */
  languages: Language[]
  /** Seven entries, Monday to Sunday: when people are in to take handovers. */
  hours: DayHours[]
  /** Holidays and other days the whole organisation is closed. */
  closed: ClosedDay[]
  updatedAt: string
  updatedBy: string
}

export type OrgSettingsInput = Omit<OrgSettings, 'updatedAt' | 'updatedBy'>

export type PlanId = 'starter' | 'growth' | 'scale'

export interface Plan {
  id: PlanId
  name: string
  /** Rupees a month, before GST. */
  price: number
  minutes: number
  agents: number
  numbers: number
  /** Rupees for each minute over the plan's minutes. */
  extraMinute: number
}

export interface Invoice {
  id: string
  number: string
  /** ISO date issued. */
  issuedAt: string
  period: string
  /** Rupees, GST included. */
  amount: number
  status: 'paid' | 'due' | 'failed'
}

export interface BillingDetails {
  legalName: string
  email: string
  /** GST number, or empty. */
  gstin: string
}

export interface Billing {
  plan: PlanId
  /** A downgrade waiting for the renewal date. */
  pendingPlan: PlanId | null
  plans: Plan[]
  /** ISO date the current period ends and the next charge is made. */
  renewsOn: string
  /** This period so far. */
  usage: { minutes: number; calls: number; uploadHours: number }
  /** How they pay, as shown by the payment provider, e.g. "Visa ending 4242". */
  paymentMethod: string | null
  details: BillingDetails
  invoices: Invoice[]
}

/** Organisation-wide alerts, sent by email. Each person can still turn
 * their own emails off on their profile. */
export type AlertKey =
  | 'emergency'
  | 'handoff_waiting'
  | 'handoff_missed'
  | 'callback_overdue'
  | 'agent_failing'
  | 'usage_threshold'
  | 'invoice'
  | 'daily_summary'
  | 'weekly_report'
  | 'agent_published'
  | 'team_changes'

export interface AlertRule {
  key: AlertKey
  enabled: boolean
  /** Everyone with these roles gets it… */
  roles: Role[]
  /** …and these people too, by member id. */
  memberIds: string[]
  /** handoff_waiting: minutes waiting; callback_overdue: minutes overdue;
   * usage_threshold: percent of the plan's minutes. */
  threshold?: number
}

export interface AlertSettings {
  rules: AlertRule[]
  /** No alerts between these times (local), except emergencies. */
  quietHours: { enabled: boolean; from: string; to: string }
  updatedAt: string
  updatedBy: string
}

export type AlertSettingsInput = Pick<AlertSettings, 'rules' | 'quietHours'>
