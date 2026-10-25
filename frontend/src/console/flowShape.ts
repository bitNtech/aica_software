import type { FlowNode } from './types'

/** A list in order: branches as they were, the plain step last. */
export const orderedAlternatives = (list: FlowNode[]): FlowNode[] => [...list.filter((n) => n.kind === 'branch'), ...list.filter((n) => n.kind !== 'branch')]

/**
 * The flow in its branching shape. Older flows listed an intent's steps as
 * siblings, one after another, with a branch forking off the step before
 * it; here each step's children are what follows it. A list in the
 * branching shape has branches first and at most one plain step, last, and
 * is left as it is, so this is safe to run on any flow, any number of
 * times.
 */
export function normaliseFlow(nodes: FlowNode[]): FlowNode[] {
  return nodes.map((n) => ({ ...n, children: chain(n.children) }))
}

function chain(list: FlowNode[]): FlowNode[] {
  const lead: FlowNode[] = []
  let i = 0
  for (; i < list.length && list[i].kind === 'branch'; i++) lead.push({ ...list[i], children: chain(list[i].children) })
  // Each step with the branches written after it, which fork off it.
  const groups: { node: FlowNode; branches: FlowNode[] }[] = []
  for (; i < list.length; i++) {
    const n = list[i]
    if (n.kind === 'branch') groups[groups.length - 1].branches.push({ ...n, children: chain(n.children) })
    else groups.push({ node: n, branches: [] })
  }
  let next: FlowNode[] = []
  for (let g = groups.length - 1; g >= 0; g--) {
    const { node, branches } = groups[g]
    next = [{ ...node, children: orderedAlternatives([...branches, ...chain(node.children), ...next]) }]
  }
  return [...lead, ...next]
}

