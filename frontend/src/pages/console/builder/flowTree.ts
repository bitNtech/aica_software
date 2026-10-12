import type { FlowNode, FlowNodeKind } from '../../../console/types'

/** Pure edits to the conversation-flow tree. Every function returns a new
 * tree and leaves the old one untouched. */

export function findNode(nodes: FlowNode[], id: string): FlowNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findNode(n.children, id)
    if (hit) return hit
  }
  return null
}

/** The parent of `id`, or null at the top level (or when not found). */
export function findParent(nodes: FlowNode[], id: string, parent: FlowNode | null = null): FlowNode | null | undefined {
  for (const n of nodes) {
    if (n.id === id) return parent
    const hit = findParent(n.children, id, n)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** The sibling list that holds `id`. */
function siblingsOf(nodes: FlowNode[], id: string): FlowNode[] | null {
  if (nodes.some((n) => n.id === id)) return nodes
  for (const n of nodes) {
    const hit = siblingsOf(n.children, id)
    if (hit) return hit
  }
  return null
}

function mapTree(nodes: FlowNode[], fn: (n: FlowNode) => FlowNode): FlowNode[] {
  return nodes.map((n) => fn({ ...n, children: mapTree(n.children, fn) }))
}

export function updateNode(nodes: FlowNode[], id: string, patch: Partial<Omit<FlowNode, 'id' | 'children'>>): FlowNode[] {
  return mapTree(nodes, (n) => (n.id === id ? { ...n, ...patch } : n))
}

export function removeNode(nodes: FlowNode[], id: string): FlowNode[] {
  return nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: removeNode(n.children, id) }))
}

/** Adds `child` as the last child of `parentId`, or at the top level. */
export function addNode(nodes: FlowNode[], parentId: string | null, child: FlowNode): FlowNode[] {
  if (parentId === null) return [...nodes, child]
  return mapTree(nodes, (n) => (n.id === parentId ? { ...n, children: [...n.children, child] } : n))
}

/** Moves `id` one place up or down among its siblings. */
export function moveNode(nodes: FlowNode[], id: string, dir: -1 | 1): FlowNode[] {
  const reorder = (list: FlowNode[]): FlowNode[] => {
    const i = list.findIndex((n) => n.id === id)
    if (i >= 0) {
      const j = i + dir
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    }
    return list.map((n) => ({ ...n, children: reorder(n.children) }))
  }
  return reorder(nodes)
}

/** Where `id` sits among its siblings: can it move up or down? */
export function position(nodes: FlowNode[], id: string): { first: boolean; last: boolean } {
  const list = siblingsOf(nodes, id) ?? []
  const i = list.findIndex((n) => n.id === id)
  return { first: i <= 0, last: i === list.length - 1 }
}

/** Merges intent `from` into intent `into`: its steps go after `into`'s,
 * their source calls are combined, and `from` goes. */
export function mergeIntents(nodes: FlowNode[], from: string, into: string): FlowNode[] {
  const source = nodes.find((n) => n.id === from)
  if (!source || from === into) return nodes
  return nodes
    .filter((n) => n.id !== from)
    .map((n) =>
      n.id === into
        ? {
            ...n,
            children: [...n.children, ...source.children],
            sourceCallIds: [...new Set([...n.sourceCallIds, ...source.sourceCallIds])],
          }
        : n,
    )
}

export function countNodes(nodes: FlowNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0)
}

export function allIds(nodes: FlowNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...allIds(n.children)])
}

let seq = 0
export function blankNode(kind: FlowNodeKind): FlowNode {
  seq += 1
  return {
    id: `node_new_${Date.now().toString(36)}_${seq}`,
    kind,
    label: '',
    say: kind === 'step' ? '' : undefined,
    condition: kind === 'branch' ? '' : undefined,
    sourceCallIds: [],
    children: [],
  }
}

export const KIND_LABEL: Record<FlowNodeKind, string> = { intent: 'Intent', step: 'Step', branch: 'Branch' }

/** Problems that stop the flow being used, keyed by node id. */
export function checkFlow(nodes: FlowNode[]): Record<string, string> {
  const e: Record<string, string> = {}
  const walk = (list: FlowNode[]) => {
    for (const n of list) {
      if (!n.label.trim()) e[n.id] = `A ${KIND_LABEL[n.kind].toLowerCase()} has no name.`
      else if (n.kind === 'intent' && n.children.length === 0) e[n.id] = `“${n.label}” has no steps, so the agent can’t handle it.`
      else if (n.kind === 'step' && !n.say?.trim()) e[n.id] = `The step “${n.label}” doesn’t say what the agent says.`
      else if (n.kind === 'branch' && !n.condition?.trim()) e[n.id] = `The branch “${n.label}” doesn’t say when it applies.`
      else if (n.kind === 'branch' && n.children.length === 0) e[n.id] = `The branch “${n.label}” has no steps.`
      walk(n.children)
    }
  }
  walk(nodes)
  return e
}

/** Confidence in words, for chips and screen readers. */
export function confidenceLabel(c: number): { level: 'high' | 'medium' | 'low'; text: string } {
  const pct = Math.round(c * 100)
  if (c >= 0.8) return { level: 'high', text: `High confidence, ${pct}%` }
  if (c >= 0.6) return { level: 'medium', text: `Medium confidence, ${pct}%` }
  return { level: 'low', text: `Low confidence, ${pct}%` }
}
