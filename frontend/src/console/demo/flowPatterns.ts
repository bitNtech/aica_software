import type { DetectedFlowPattern, FlowNode } from '../types'

/** Every root-to-leaf label path through the flow tree. */
export function flattenKnownSequences(flow: FlowNode[]): string[][] {
  const out: string[][] = []
  const walk = (nodes: FlowNode[], prefix: string[]) => {
    for (const n of nodes) {
      const path = [...prefix, n.label]
      if (n.children.length === 0) out.push(path)
      else walk(n.children, path)
    }
  }
  walk(flow, [])
  return out
}

const sameSequence = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i])

/** Finds step sequences repeated in an agent's recent calls that aren't
 * part of its designed flow. `calls` is assumed already sorted
 * most-recent-first; only the first `windowSize` are looked at. */
export function detectFlowPatterns(params: { agentId: string; agentName: string; calls: { id: string; path: string[] }[]; knownFlow: FlowNode[]; windowSize: number; now: string }): DetectedFlowPattern[] {
  const { agentId, agentName, calls, knownFlow, windowSize, now } = params
  const window = calls.slice(0, windowSize)
  const known = flattenKnownSequences(knownFlow)

  const groups = new Map<string, { path: string[]; callIds: string[] }>()
  for (const c of window) {
    const key = c.path.join('→')
    const g = groups.get(key)
    if (g) g.callIds.push(c.id)
    else groups.set(key, { path: c.path, callIds: [c.id] })
  }

  const out: DetectedFlowPattern[] = []
  for (const { path, callIds } of groups.values()) {
    if (callIds.length < Math.min(2, windowSize)) continue
    if (known.some((k) => sameSequence(k, path))) continue
    out.push({
      id: `fp_${agentId}_${callIds.join('_')}`,
      agentId,
      agentName,
      steps: path,
      occurrences: callIds.length,
      windowSize,
      callIds,
      firstSeenAt: now,
      lastSeenAt: now,
      summary: `${callIds.length} of the last ${windowSize} calls to ${agentName} followed a flow step sequence that isn't part of its current design: ${path.join(' → ')}.`,
    })
  }
  return out
}
