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

/** A flow as an indented outline: numbered steps under their intent, a
 * branch with when it applies, and what the agent says on a step. */
function outline(nodes: FlowNode[], depth = 0): string[] {
  return nodes.flatMap((n, i) => {
    const pad = '  '.repeat(depth)
    const label = n.label.trim() || 'Unnamed'
    const head =
      n.kind === 'intent'
        ? `${pad}${KIND_WORD.intent}: ${label}`
        : `${pad}${i + 1}. ${KIND_WORD[n.kind]}: ${label}${n.kind === 'branch' && n.condition?.trim() ? ` (when ${n.condition.trim()})` : ''}`
    const says = n.kind === 'step' && n.say?.trim() ? [`${pad}   The agent says: “${n.say.trim()}”`] : []
    return [head, ...says, ...outline(n.children, depth + 1)]
  })
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
  const ours = outline(edit.flow).join('\n')
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
