import type { AgentDraft, AgentTool, FlowNode, GlobalFlowKind, KnowledgeSource } from '../../../console/types'

/**
 * A text stand-in for testing an agent in the browser: it picks the intent
 * whose words best match what the tester typed, then walks that intent's
 * steps one reply at a time. It shows the path, tools and knowledge the real
 * agent would use; the real agent (speech, the LLM) runs on AICA's servers.
 */

export interface SimReply {
  text: string
  /** Where in the flow the reply came from, e.g. ["Book an appointment", "Offer two slots"]. */
  path: string[]
  /** A global flow that took over, if any. */
  global?: GlobalFlowKind
  tool?: { name: string; asksFirst: boolean }
  knowledge?: string[]
}

export interface SimState {
  intentId: string | null
  /** Index of the next step to say within the intent. */
  next: number
}

export const SIM_START: SimState = { intentId: null, next: 0 }

const GLOBAL_WORDS: [GlobalFlowKind, RegExp][] = [
  ['emergency', /chest pain|breath|bleed|accident|unconscious|emergency|faint|stroke/i],
  ['handoff', /\b(person|human|staff|someone|operator|reception(ist)?)\b|talk to/i],
  ['end_call', /\b(bye|thank(s| you)|that'?s all|nandri)\b/i],
  ['repeat', /\b(repeat|again|slow(ly|er)?|pardon)\b|\bsorry\?/i],
]

/** Tamil/Tanglish words callers use, mapped to the English the flows use. */
const SYNONYMS: [RegExp, string][] = [
  [/appointment|booking|book|token/i, 'book appointment'],
  [/report|result|ready/i, 'report ready'],
  [/cancel|vendam/i, 'cancel'],
  [/reschedule|change|maathanum|move|postpone/i, 'reschedule'],
  [/timing|time|open|hours|parking|where|address|direction/i, 'timings directions'],
  [/bill|insurance|claim|payment|amount/i, 'bill insurance'],
  [/price|cost|fee|evlo/i, 'prices fees'],
]

const words = (s: string) => s.toLowerCase().match(/[a-z]{3,}/g) ?? []

function steps(intent: FlowNode): FlowNode[] {
  // The simulator can't tell which branch applies: it follows the first.
  const first = intent.children.find((c) => c.kind === 'branch')
  return intent.children.flatMap((c) => (c.kind !== 'branch' ? [c] : c === first ? c.children : []))
}

function bestIntent(flow: FlowNode[], message: string): FlowNode | null {
  const said = new Set([...words(message), ...SYNONYMS.filter(([re]) => re.test(message)).flatMap(([, w]) => words(w))])
  let best: FlowNode | null = null
  let score = 0
  for (const intent of flow) {
    const s = words(intent.label).filter((w) => said.has(w)).length
    if (s > score) {
      best = intent
      score = s
    }
  }
  return best
}

export function simulate(draft: AgentDraft, tools: AgentTool[], knowledge: KnowledgeSource[], state: SimState, message: string): { reply: SimReply; state: SimState } {
  const global = (kind: GlobalFlowKind) => draft.globalFlows.find((g) => g.kind === kind && g.enabled)

  const asking = bestIntent(draft.flow, message)
  for (const [kind, re] of GLOBAL_WORDS) {
    const g = global(kind)
    // "Thank you, can I book…" is a request, not a goodbye.
    if (kind === 'end_call' && asking) continue
    if (g && re.test(message)) {
      const transfer = (kind === 'handoff' || kind === 'emergency') && tools.find((t) => t.builtin === 'transfer' && draft.context.toolIds.includes(t.id))
      return {
        reply: { text: g.response, path: [], global: kind, tool: transfer ? { name: transfer.name, asksFirst: false } : undefined },
        state: kind === 'end_call' ? SIM_START : state,
      }
    }
  }

  // Carry on with the current intent unless the caller clearly changed topic.
  const current = state.intentId ? draft.flow.find((n) => n.id === state.intentId) : null
  const matched = asking
  const intent = matched && matched.id !== current?.id ? matched : (current ?? matched)
  if (!intent) {
    const g = global('out_of_scope')
    return { reply: { text: g?.response ?? 'Sorry, I can’t help with that here.', path: [], global: 'out_of_scope' }, state: SIM_START }
  }

  const fresh = intent.id !== state.intentId
  const list = steps(intent)
  const i = fresh ? 0 : Math.min(state.next, list.length - 1)
  const step = list[i]
  const text = step?.say?.trim() || 'Sure.'

  const usesKnowledge = /knowledge|\{answer\}|\{hours\}|\{parking\}/i.test(`${step?.label} ${step?.say}`)
  const chosen = knowledge.filter((k) => draft.context.knowledgeSourceIds.includes(k.id))
  // A tool whose name shares a word with the step or intent.
  const toolWords = new Set(words(`${intent.label} ${step?.label ?? ''}`))
  const tool = tools.find((t) => t.kind === 'http' && draft.context.toolIds.includes(t.id) && words(t.name).some((w) => toolWords.has(w) && w.length > 3))

  return {
    reply: {
      text,
      path: [intent.label, ...(step ? [step.label] : [])],
      knowledge: usesKnowledge && chosen.length ? chosen.map((k) => k.name) : undefined,
      tool: tool ? { name: tool.name, asksFirst: tool.acts && draft.context.confirmBeforeActions } : undefined,
    },
    state: { intentId: intent.id, next: i + 1 },
  }
}
