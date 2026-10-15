import { LANGUAGE_LABEL } from '../../../auth/roles'
import type { AgentSpec, Attribute, FlowNode } from '../../../console/types'
import { GLOBAL_META } from '../builder/steps/StepGlobal'

/** One area of an agent's setup, and what changed in it, in words. */
export interface SpecChange {
  area: string
  changes: string[]
}

/** Names to show for ids in the setup (knowledge sources, tools, voices). */
export interface NameLookup {
  knowledge(id: string): string
  tool(id: string): string
  voice(id: string): string
}

const quote = (s: string) => `“${s}”`
const list = (xs: string[]) => xs.map(quote).join(', ')

/** Items added and removed between two lists, by key. */
function addedRemoved<T>(before: T[], after: T[], key: (x: T) => string, name: (x: T) => string, noun: string): string[] {
  const was = new Map(before.map((x) => [key(x), x]))
  const now = new Map(after.map((x) => [key(x), x]))
  const added = after.filter((x) => !was.has(key(x)))
  const removed = before.filter((x) => !now.has(key(x)))
  const out: string[] = []
  if (added.length) out.push(`Added ${noun}: ${list(added.map(name))}.`)
  if (removed.length) out.push(`Removed ${noun}: ${list(removed.map(name))}.`)
  return out
}

/** Flow nodes by id, with their path and the intent they sit under. */
function flatten(nodes: FlowNode[], path: string[] = [], top?: string): Map<string, { node: FlowNode; path: string[]; top: string }> {
  const m = new Map<string, { node: FlowNode; path: string[]; top: string }>()
  for (const n of nodes) {
    const intent = top ?? n.id
    m.set(n.id, { node: n, path, top: intent })
    for (const [k, v] of flatten(n.children, [...path, n.label], intent)) m.set(k, v)
  }
  return m
}

/** Ids of `nodes` that are also in `other`, in order. */
const sharedOrder = (nodes: FlowNode[], other: Set<string>) => nodes.filter((n) => other.has(n.id)).map((n) => n.id).join()

function flowChanges(before: FlowNode[], after: FlowNode[]): string[] {
  const out = addedRemoved(before, after, (n) => n.id, (n) => n.label, 'intents')
  const was = flatten(before)
  const now = flatten(after)
  const tops = (ns: FlowNode[]) => new Set(ns.map((n) => n.id))
  const keptIntents = [...tops(before)].filter((id) => tops(after).has(id))
  let edited = 0
  let added = 0
  let removed = 0
  for (const [id, { node, path, top }] of now) {
    const old = was.get(id)
    // Steps that came with a whole new intent are counted as that intent.
    if (!old) {
      if (path.length && keptIntents.includes(top)) added++
    } else if (old.node.label !== node.label || old.node.say !== node.say || old.node.condition !== node.condition) {
      if (path.length === 0 && old.node.label !== node.label) out.push(`Renamed the intent ${quote(old.node.label)} to ${quote(node.label)}.`)
      else edited++
    }
  }
  // Likewise steps that went with a whole intent (or moved by a merge).
  for (const [id, { path, top }] of was) if (!now.has(id) && path.length && keptIntents.includes(top)) removed++
  if (sharedOrder(before, tops(after)) !== sharedOrder(after, tops(before))) out.push('Changed the order of the intents.')
  // Order within each intent or branch both versions have.
  const reordered = [...now.values()].filter(({ node }) => {
    const old = was.get(node.id)?.node
    if (!old || !node.children.length) return false
    const a = new Set(node.children.map((c) => c.id))
    const b = new Set(old.children.map((c) => c.id))
    return sharedOrder(old.children, a) !== sharedOrder(node.children, b)
  })
  if (reordered.length) out.push(`Changed the order of steps in ${list(reordered.map(({ node }) => node.label))}.`)
  if (edited) out.push(`Edited ${edited} ${edited === 1 ? 'step or branch' : 'steps and branches'}.`)
  if (added) out.push(`Added ${added} ${added === 1 ? 'step' : 'steps'}.`)
  if (removed) out.push(`Removed ${removed} ${removed === 1 ? 'step' : 'steps'}.`)
  return out
}

/** What changed in one detail, in a few words. */
function detailChanges(a: Attribute, b: Attribute): string[] {
  const out: string[] = []
  if (a.label !== b.label) out.push(`renamed to ${quote(b.label)}`)
  if (a.type !== b.type) out.push('a different type')
  if (a.ask !== b.ask) out.push('asked differently')
  if (a.required !== b.required) out.push(b.required ? 'now required' : 'now optional')
  if (a.personal !== b.personal) out.push(b.personal ? 'now marked personal' : 'no longer marked personal')
  if (a.confirm !== b.confirm) out.push(b.confirm ? 'now read back' : 'no longer read back')
  if ((a.options ?? []).join() !== (b.options ?? []).join()) out.push('different options')
  return out
}

/**
 * What changed from `before` to `after`, area by area, in plain words. Empty
 * when they're the same. Not a line-by-line diff: enough to decide whether to
 * publish or roll back.
 */
export function diffSpecs(before: AgentSpec, after: AgentSpec, names: NameLookup): SpecChange[] {
  const areas: SpecChange[] = []
  const push = (area: string, changes: string[]) => changes.length && areas.push({ area, changes })
  const b = before.behaviour
  const a = after.behaviour

  const behaviour: string[] = []
  if (b.persona !== a.persona) behaviour.push(`Spoken name: ${quote(b.persona)} to ${quote(a.persona)}.`)
  if (b.tone !== a.tone) behaviour.push(`Tone: ${b.tone} to ${a.tone}.`)
  if (b.languages.join() !== a.languages.join()) behaviour.push(`Languages: ${a.languages.map((l) => LANGUAGE_LABEL[l]).join(', ')} (was ${b.languages.map((l) => LANGUAGE_LABEL[l]).join(', ')}).`)
  if (b.startLanguage !== a.startLanguage) behaviour.push(`Greets in ${LANGUAGE_LABEL[a.startLanguage]} (was ${LANGUAGE_LABEL[b.startLanguage]}).`)
  if (b.followCaller !== a.followCaller) behaviour.push(a.followCaller ? 'Follows the caller’s language.' : 'No longer follows the caller’s language.')
  if (b.greeting !== a.greeting) behaviour.push(`New greeting: ${quote(a.greeting)}`)
  if (b.closing !== a.closing) behaviour.push('New closing.')
  if (b.voiceId !== a.voiceId) behaviour.push(`Voice: ${names.voice(b.voiceId)} to ${names.voice(a.voiceId)}.`)
  if (b.rate !== a.rate) behaviour.push(`Speaking speed: ${b.rate} to ${a.rate}.`)
  behaviour.push(...addedRemoved(b.rules, a.rules, (r) => r, (r) => r, 'rules'))
  push('Behaviour', behaviour)

  const speech: string[] = []
  speech.push(...addedRemoved(before.speech.pronunciations, after.speech.pronunciations, (p) => p.word, (p) => p.word, 'pronunciations'))
  for (const p of after.speech.pronunciations) {
    const old = before.speech.pronunciations.find((o) => o.word === p.word)
    if (old && old.sayAs !== p.sayAs) speech.push(`Says ${quote(p.word)} as ${quote(p.sayAs)} (was ${quote(old.sayAs)}).`)
  }
  speech.push(...addedRemoved(before.speech.hints, after.speech.hints, (h) => h, (h) => h, 'words to listen for'))
  if (before.speech.allowInterruptions !== after.speech.allowInterruptions) speech.push(after.speech.allowInterruptions ? 'Callers can interrupt.' : 'Callers can no longer interrupt.')
  if (before.speech.silenceSec !== after.speech.silenceSec) speech.push(`Checks on silence after ${after.speech.silenceSec} seconds (was ${before.speech.silenceSec}).`)
  push('Speech', speech)

  push('Conversation flow', flowChanges(before.flow, after.flow))

  const details = addedRemoved(before.attributes, after.attributes, (x) => x.id, (x) => x.label, 'details')
  for (const x of after.attributes) {
    const old = before.attributes.find((o) => o.id === x.id)
    const what = old ? detailChanges(old, x) : []
    if (what.length) details.push(`${quote(old!.label)}: ${what.join(', ')}.`)
  }
  const ids = (xs: Attribute[], keep: Attribute[]) => xs.filter((x) => keep.some((k) => k.id === x.id)).map((x) => x.id).join()
  if (ids(before.attributes, after.attributes) !== ids(after.attributes, before.attributes)) details.push('Changed the order they’re asked in.')
  push('Details to collect', details)

  const globals: string[] = []
  for (const g of after.globalFlows) {
    const old = before.globalFlows.find((o) => o.kind === g.kind)
    const label = GLOBAL_META[g.kind].label
    if (!old) continue
    if (old.enabled !== g.enabled) globals.push(`${label}: turned ${g.enabled ? 'on' : 'off'}.`)
    else if (old.trigger !== g.trigger || old.response !== g.response) globals.push(`${label}: reworded.`)
  }
  push('Anywhere in a call', globals)

  const c0 = before.context
  const c1 = after.context
  const knowledge = addedRemoved(c0.knowledgeSourceIds, c1.knowledgeSourceIds, (k) => k, names.knowledge, 'sources')
  if (c0.answerOnlyFromKnowledge !== c1.answerOnlyFromKnowledge) knowledge.push(c1.answerOnlyFromKnowledge ? 'Answers only from its knowledge.' : 'May answer beyond its knowledge.')
  if (c0.topK !== c1.topK || c0.minScore !== c1.minScore) knowledge.push('Changed how it looks things up.')
  push('Knowledge', knowledge)

  const tools = addedRemoved(c0.toolIds, c1.toolIds, (t) => t, names.tool, 'tools')
  if (c0.confirmBeforeActions !== c1.confirmBeforeActions) tools.push(c1.confirmBeforeActions ? 'Asks the caller before acting.' : 'No longer asks the caller before acting.')
  push('Tools', tools)

  const g0 = before.guardrails
  const g1 = after.guardrails
  const rules: string[] = []
  if (g0.handoffAfterFailures !== g1.handoffAfterFailures) rules.push(`Hands over after ${g1.handoffAfterFailures} failed answers (was ${g0.handoffAfterFailures}).`)
  if (g0.transferTo !== g1.transferTo) rules.push(`Hands over to ${quote(g1.transferTo)} (was ${quote(g0.transferTo)}).`)
  if (g0.emergencyTo !== g1.emergencyTo) rules.push(`Emergencies go to ${quote(g1.emergencyTo)}.`)
  rules.push(...addedRemoved(g0.refuseTopics, g1.refuseTopics, (t) => t, (t) => t, 'topics it refuses'))
  if (g0.recordingNotice !== g1.recordingNotice) rules.push(g1.recordingNotice ? 'Tells callers the call is recorded.' : 'No longer says the call is recorded.')
  else if (g1.recordingNotice && g0.recordingNoticeText !== g1.recordingNoticeText) rules.push('Reworded the recording notice.')
  if (g0.maxCallMinutes !== g1.maxCallMinutes) rules.push(`Longest call: ${g1.maxCallMinutes} minutes (was ${g0.maxCallMinutes}).`)
  if (before.redact !== after.redact) rules.push(after.redact ? 'Hides personal details in transcripts.' : 'Shows personal details in transcripts.')
  push('Handoff and guardrails', rules)

  return areas
}
