import { indexFlow, joinTarget } from '../flowGraph'
import type { DetectedFlowPattern, FlowNode } from '../types'

/** Every label path a call can take through the flow, to a leaf or to a
 * node whose ways on are all conditional (so the call can end there),
 * following branches where they join back up. Branches aren't named: a
 * call's path lists what was said, not the fork it took. */
export function flattenKnownSequences(flow: FlowNode[]): string[][] {
  const index = indexFlow(flow)
  const out: string[][] = []
  const visit = (n: FlowNode, prefix: string[], onPath: ReadonlySet<string>) => {
    if (onPath.has(n.id)) return
    const path = n.kind === 'branch' ? prefix : [...prefix, n.label]
    const joins = joinTarget(index, n)
    if (n.kind !== 'branch' && !joins && n.children.every((c) => c.kind === 'branch')) out.push(path)
    const next = new Set(onPath).add(n.id)
    for (const c of n.children) visit(c, path, next)
    if (joins) visit(joins, path, next)
  }
  for (const n of flow) visit(n, [], new Set())
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
