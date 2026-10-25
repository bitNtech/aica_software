import type { FlowNode } from './types'

/** Ways a call can end: the nodes nothing follows, neither a step of their
 * own nor a step they join back at. */
export function countPaths(nodes: FlowNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.children.length ? countPaths(n.children) : n.joinsAt ? 0 : 1), 0)
}

/** Points where the call can go more than one way. */
export function countForks(nodes: FlowNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.children.length + (n.joinsAt ? 1 : 0) > 1 ? 1 : 0) + countForks(n.children), 0)
}
