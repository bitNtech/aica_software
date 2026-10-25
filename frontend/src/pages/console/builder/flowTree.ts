import type { FlowNode, FlowNodeKind } from '../../../console/types'
import { orderedAlternatives } from '../../../console/flowShape'
import { joinProblems, tidyJoins } from '../../../console/flowGraph'
export { normaliseFlow } from '../../../console/flowShape'
export { countForks, countPaths } from '../../../console/flowCounts'
export { joinOptions, numberFlow } from '../../../console/flowGraph'

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

/** Removes `id` and everything that follows it. Joins at anything removed
 * end there instead. */
export function removeNode(nodes: FlowNode[], id: string): FlowNode[] {
  const cut = (list: FlowNode[]): FlowNode[] => list.filter((n) => n.id !== id).map((n) => ({ ...n, children: cut(n.children) }))
  return tidyJoins(cut(nodes))
}

/** The plain step that carries a list on (the "otherwise" path), if any. */
export const plainStep = (list: FlowNode[]): FlowNode | undefined => list.find((n) => n.kind !== 'branch')

const ordered = orderedAlternatives

/**
 * Adds `child` after `parentId` (null: a new intent at the top).
 *
 * A branch joins the fork there, before the plain step. A step carries the
 * call on: if a step already does, the new one goes in between, so nothing
 * that followed is lost.
 */
export function addNode(nodes: FlowNode[], parentId: string | null, child: FlowNode): FlowNode[] {
  if (parentId === null) return [...nodes, child]
  return mapTree(nodes, (n) => {
    if (n.id !== parentId) return n
    if (child.kind === 'branch') return { ...n, children: ordered([...n.children, child]) }
    const next = plainStep(n.children)
    // A node that carried on elsewhere now goes to the new step, which
    // carries on there in its place.
    if (!next && n.joinsAt && child.kind === 'step') {
      const { joinsAt, ...rest } = n
      return { ...rest, children: ordered([...n.children, { ...child, joinsAt }]) }
    }
    if (!next || child.kind === 'intent') return { ...n, children: ordered([...n.children, child]) }
    return { ...n, children: n.children.map((c) => (c === next ? { ...child, children: [...child.children, next] } : c)) }
  })
}

/** Whether `id` can go on its own, its followers taking its place: a step
 * can; a branch only when that leaves one plain step at its fork; an
 * intent can't (what follows it isn't an intent). */
export function canRemoveOnly(nodes: FlowNode[], id: string): boolean {
  const node = findNode(nodes, id)
  if (!node || node.kind === 'intent' || !node.children.length) return false
  if (node.kind === 'step') return true
  const siblings = siblingsOf(nodes, id) ?? []
  return !(plainStep(node.children) && plainStep(siblings.filter((s) => s.id !== id)))
}

/** Removes `id` alone: what followed it takes its place. See canRemoveOnly.
 * Joins at it go on to the step that followed it, if one did; if it
 * carried on somewhere itself, the node before it now does. */
export function removeOnly(nodes: FlowNode[], id: string): FlowNode[] {
  const gone = findNode(nodes, id)
  if (!gone) return nodes
  const lift = (list: FlowNode[]): FlowNode[] => {
    const i = list.findIndex((n) => n.id === id)
    if (i >= 0) return ordered([...list.slice(0, i), ...list[i].children, ...list.slice(i + 1)])
    return list.map((n) => {
      const children = lift(n.children)
      const handOn = gone.joinsAt && n.children.some((c) => c.id === id) && !n.joinsAt && !plainStep(children)
      return handOn ? { ...n, children, joinsAt: gone.joinsAt } : { ...n, children }
    })
  }
  return tidyJoins(lift(nodes), new Map([[id, plainStep(gone.children)?.id ?? null]]))
}

/** Moves `id` one place up or down among the alternatives at its fork.
 * Only intents and branches move: the plain step stays last. */
export function moveNode(nodes: FlowNode[], id: string, dir: -1 | 1): FlowNode[] {
  const reorder = (list: FlowNode[]): FlowNode[] => {
    const i = list.findIndex((n) => n.id === id)
    if (i >= 0) {
      const j = i + dir
      if (list[i].kind === 'step' || j < 0 || j >= list.length || list[j].kind === 'step') return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    }
    return list.map((n) => ({ ...n, children: reorder(n.children) }))
  }
  return reorder(nodes)
}

/** Where `id` sits among the alternatives it can move between. */
export function position(nodes: FlowNode[], id: string): { first: boolean; last: boolean } {
  const list = siblingsOf(nodes, id) ?? []
  const node = list.find((n) => n.id === id)
  if (!node || node.kind === 'step') return { first: true, last: true }
  const movable = list.filter((n) => n.kind !== 'step')
  const i = movable.findIndex((n) => n.id === id)
  return { first: i <= 0, last: i === movable.length - 1 }
}

/** Merges intent `from` into intent `into`: its paths become alternatives
 * under `into` (its plain path as a branch, if `into` has one already),
 * their source calls are combined, and `from` goes. */
export function mergeIntents(nodes: FlowNode[], from: string, into: string): FlowNode[] {
  const source = nodes.find((n) => n.id === from)
  const target = nodes.find((n) => n.id === into)
  if (!source || !target || from === into) return nodes
  const theirs = plainStep(source.children)
  const clash = !!theirs && !!plainStep(target.children)
  const moved = clash
    ? [
        ...source.children.filter((c) => c !== theirs),
        { ...blankNode('branch'), label: source.label, condition: `The caller wants to ${source.label.charAt(0).toLowerCase()}${source.label.slice(1)}`, sourceCallIds: source.sourceCallIds, children: [theirs] },
      ]
    : source.children
  return nodes
    .filter((n) => n.id !== from)
    .map((n) =>
      n.id === into
        ? {
            ...n,
            children: ordered([...n.children, ...moved]),
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
  const e: Record<string, string> = { ...joinProblems(nodes) }
  const walk = (list: FlowNode[]) => {
    for (const n of list) {
      if (e[n.id]) {
        /* a join that can't be followed says so already */
      } else if (!n.label.trim()) e[n.id] = `A ${KIND_LABEL[n.kind].toLowerCase()} has no name.`
      else if (n.kind === 'intent' && n.children.length === 0) e[n.id] = `“${n.label}” has no steps, so the agent can’t handle it.`
      else if (n.kind === 'step' && !n.say?.trim()) e[n.id] = `The step “${n.label}” doesn’t say what the agent says.`
      else if (n.kind === 'branch' && !n.condition?.trim()) e[n.id] = `The branch “${n.label}” doesn’t say when it applies.`
      else if (n.kind === 'branch' && n.children.length === 0 && !n.joinsAt) e[n.id] = `The branch “${n.label}” has no steps.`
      else if (n.children.filter((c) => c.kind !== 'branch').length > 1)
        e[n.id] = `Several steps follow “${n.label}” without saying when. Make all but one of them branches, so the agent knows which way to go.`
      walk(n.children)
    }
  }
  walk(nodes)
  return e
}

/** Below this, a node is flagged to check against its calls. */
export const NEEDS_REVIEW = 0.7

/** Confidence in words, for chips and screen readers. Low is exactly what
 * the copy asks people to check: below 70%. */
export function confidenceLabel(c: number): { level: 'high' | 'medium' | 'low'; text: string } {
  const pct = Math.round(c * 100)
  if (c >= 0.8) return { level: 'high', text: `High confidence, ${pct}%` }
  if (c >= NEEDS_REVIEW) return { level: 'medium', text: `Medium confidence, ${pct}%` }
  return { level: 'low', text: `Low confidence, ${pct}%` }
}

/** Every node, at any depth, AICA wasn't sure about. */
export function lowConfidence(nodes: FlowNode[]): FlowNode[] {
  return nodes.flatMap((n) => [...((n.confidence ?? 1) < NEEDS_REVIEW ? [n] : []), ...lowConfidence(n.children)])
}

/** The node just before or after `id` among its siblings, or its parent. */
export function neighbour(nodes: FlowNode[], id: string): string | null {
  const list = siblingsOf(nodes, id) ?? []
  const i = list.findIndex((n) => n.id === id)
  return list[i - 1]?.id ?? list[i + 1]?.id ?? findParent(nodes, id)?.id ?? null
}
