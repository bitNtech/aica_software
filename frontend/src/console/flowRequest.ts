import { indexFlow, joinTarget, type Placed } from './flowGraph'
import { normaliseFlow } from './flowShape'
import type { DetectedFlowPattern, FlowNode } from './types'
/** The request bitNtech gets for a detected pattern. Requests hold up to
 * 2,000 characters, so long step lists and call lists are cut short. */
export function flowRequestDetail(pattern: DetectedFlowPattern, max = 2000): string {
  const head = `${pattern.occurrences} of the last ${pattern.windowSize} calls to ${pattern.agentName} followed this step sequence, which isn't part of its current flow:`
  const steps = pattern.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  let calls = pattern.callIds
  const build = (ids: string[], more: number) => `${head}\n${steps}\n\nCalls: ${ids.join(', ')}${more ? ` and ${more} more` : ''}`
  let text = build(calls, 0)
  while (text.length > max && calls.length > 1) {
    calls = calls.slice(0, -1)
    text = build(calls, pattern.callIds.length - calls.length)
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const KIND_WORD = { intent: 'Intent', step: 'Step', branch: 'Branch' } as const

/**
 * A flow as an indented outline: each intent, then its path numbered step
 * by step; where the call can go more than one way, each way is a "-" line
 * (a branch with when it applies, or "Otherwise") with its own path
 * numbered under it. What the agent says is under each step, and where a
 * path joins back up, a "Then carries on at" line says where.
 */
export function flowOutline(nodes: FlowNode[]): string[] {
  const flow = normaliseFlow(nodes)
  const index = indexFlow(flow)
  return flow.flatMap((n) => [`${KIND_WORD.intent}: ${n.label.trim() || 'Unnamed'}`, ...path(index, n.children, 1, 1)])
}

/** Where `n` joins back up: after its step, or, under a fork of
 * branches, the way on when none of them applies. `pad` is that of the
 * lines under it. */
function joinLine(index: Map<string, Placed>, n: FlowNode, pad: string): string[] {
  const j = joinTarget(index, n)
  if (!j) return []
  const label = j.label.trim() || 'Unnamed'
  return n.children.length ? [`${pad}- Otherwise, carries on at: ${label}`] : [`${pad}   Then carries on at: ${label}`]
}

function path(index: Map<string, Placed>, list: FlowNode[], depth: number, at: number): string[] {
  const pad = '  '.repeat(depth)
  if (!list.length) return []
  if (list.length === 1 && list[0].kind !== 'branch') {
    const s = list[0]
    const says = s.say?.trim() ? [`${pad}   The agent says: “${s.say.trim()}”`] : []
    return [`${pad}${at}. ${KIND_WORD[s.kind]}: ${s.label.trim() || 'Unnamed'}`, ...says, ...path(index, s.children, depth, at + 1), ...joinLine(index, s, pad)]
  }
  return list.flatMap((alt) =>
    alt.kind === 'branch'
      ? [
          `${pad}- ${KIND_WORD.branch}: ${alt.label.trim() || 'Unnamed'}${alt.condition?.trim() ? ` (when ${alt.condition.trim()})` : ''}`,
          ...path(index, alt.children, depth + 1, 1),
          ...joinLine(index, alt, `${pad}  `),
        ]
      : [`${pad}- Otherwise:`, ...path(index, [alt], depth + 1, 1)],
  )
}

/**
 * The request when the hospital has changed the detected pattern first:
 * their version of the flow (an outline), their note, and what was
 * detected for comparison. Cut to `max` characters in the order that keeps
 * the most useful part: the call list goes first, then the detected
 * steps; their version and note are kept whole where they fit, and only
 * cut as a last resort.
 */
export function editedFlowRequestDetail(pattern: DetectedFlowPattern, edit: { flow: FlowNode[]; note?: string }, max = 2000): string {
  const head = `${pattern.occurrences} of the last ${pattern.windowSize} calls to ${pattern.agentName} followed a step sequence that isn't part of its current flow. We changed it, and would like this version built:`
  const ours = flowOutline(edit.flow).join('\n')
  const note = edit.note?.trim() ? `\n\nOur note: ${edit.note.trim()}` : ''
  const detected = (on: boolean) => (on ? `\n\nAs detected: ${pattern.steps.join(' > ')}` : '')
  const build = (withDetected: boolean, ids: string[], more: number) =>
    `${head}\n${ours}${note}${detected(withDetected)}\n\nCalls: ${ids.join(', ')}${more ? ` and ${more} more` : ''}`
  let calls = pattern.callIds
  let withDetected = true
  let text = build(withDetected, calls, 0)
  while (text.length > max && calls.length > 1) {
    calls = calls.slice(0, -1)
    text = build(withDetected, calls, pattern.callIds.length - calls.length)
  }
  if (text.length > max) {
    withDetected = false
    text = build(withDetected, calls, pattern.callIds.length - calls.length)
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
