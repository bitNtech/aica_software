import type { FlowNode } from './types'

/**
 * The flow as a graph. The tree (types.ts) owns every node once; joins
 * (`joinsAt`) let a node carry on at a step somewhere else in its intent,
 * so branches can come back together. Everything that follows the call,
 * not the tree, reads the flow through here.
 */

export interface Placed {
  node: FlowNode
  /** The intent it belongs to. */
  intentId: string
  /** Its tree parent; null for an intent. */
  parentId: string | null
}

/** Every node by id, with its intent and tree parent. */
export function indexFlow(nodes: FlowNode[]): Map<string, Placed> {
  const out = new Map<string, Placed>()
  const walk = (list: FlowNode[], intentId: string, parentId: string | null) => {
    for (const n of list) {
      out.set(n.id, { node: n, intentId, parentId })
      walk(n.children, intentId, n.id)
    }
  }
  for (const intent of nodes) {
    out.set(intent.id, { node: intent, intentId: intent.id, parentId: null })
    walk(intent.children, intent.id, intent.id)
  }
  return out
}

/** Whether a node may carry on somewhere else: not an intent, and no plain
 * step of its own already carries it on. */
export const canJoin = (n: FlowNode): boolean => n.kind !== 'intent' && !n.children.some((c) => c.kind !== 'branch')

/** The step `n` carries on at, if its join is one that can be followed. */
export function joinTarget(index: Map<string, Placed>, n: FlowNode): FlowNode | null {
  if (!n.joinsAt || !canJoin(n)) return null
  const at = index.get(n.joinsAt)
  const self = index.get(n.id)
  if (!at || !self || at.intentId !== self.intentId || at.node.kind !== 'step' || at.node.id === n.id) return null
  return at.node
}

/** What can come right after `n`: its children, then where it joins. */
export function successors(index: Map<string, Placed>, n: FlowNode): FlowNode[] {
  const j = joinTarget(index, n)
  return j ? [...n.children, j] : n.children
}

/** Ids reachable from `from` by following the call (children and joins),
 * `from` itself included. `skipJoinOf` leaves one node's join out. */
function reachable(index: Map<string, Placed>, from: FlowNode, skipJoinOf?: string): Set<string> {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const n = stack.pop()!
    if (seen.has(n.id)) continue
    seen.add(n.id)
    stack.push(...(n.id === skipJoinOf ? n.children : successors(index, n)))
  }
  return seen
}

/** The steps `id` can carry on at: in its intent, not itself, not what
 * already follows it, and not anything that leads back to it (the call
 * would go round in a circle). In the outline's order. */
export function joinOptions(nodes: FlowNode[], id: string): FlowNode[] {
  const index = indexFlow(nodes)
  const me = index.get(id)
  if (!me || !canJoin(me.node)) return []
  const intent = index.get(me.intentId)!.node
  const below = new Set<string>()
  const mark = (n: FlowNode) => {
    below.add(n.id)
    n.children.forEach(mark)
  }
  mark(me.node)
  const out: FlowNode[] = []
  const walk = (list: FlowNode[]) => {
    for (const n of list) {
      if (n.kind === 'step' && !below.has(n.id) && !reachable(index, n, id).has(id)) out.push(n)
      walk(n.children)
    }
  }
  walk(intent.children)
  return out
}

/** What's wrong with the joins, keyed by node id. */
export function joinProblems(nodes: FlowNode[]): Record<string, string> {
  const index = indexFlow(nodes)
  const out: Record<string, string> = {}
  const name = (n: FlowNode) => `“${n.label.trim() || 'Unnamed'}”`
  for (const { node: n, intentId } of index.values()) {
    if (!n.joinsAt) continue
    const at = index.get(n.joinsAt)
    if (n.kind === 'intent') out[n.id] = `${name(n)} is a conversation of its own, so it can’t carry on at a step.`
    else if (!canJoin(n)) out[n.id] = `${name(n)} goes on to its next step and also carries on somewhere else. Keep one of them.`
    else if (!at || at.intentId !== intentId) out[n.id] = `${name(n)} carries on at a step that isn’t in this conversation any more.`
    else if (at.node.kind !== 'step' || at.node.id === n.id) out[n.id] = `${name(n)} has to carry on at a step.`
  }
  // A join back to something that leads to it never lets the call end.
  for (const { node: n } of index.values()) {
    const j = out[n.id] ? null : joinTarget(index, n)
    if (j && reachable(index, j).has(n.id)) out[n.id] = `After ${name(n)} the call comes back round to it, so it would never end. Carry on at a later step.`
  }
  return out
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(97 + i) : `z${i - 25}`)

/**
 * Numbers for the nodes, as they're drawn on the diagram: the steps along
 * a line are numbered (1, 2, 3), the ways out of a fork are lettered after
 * the step they leave (1a, 1b), and a branch's own steps go on from its
 * number (1a.1, 1a.2). The step everyone carries on at after a fork is the
 * fork's plain step, so it takes the next number (2). Intents have none.
 */
export function numberFlow(nodes: FlowNode[]): Map<string, string> {
  const out = new Map<string, string>()
  /** `list`: what follows a node numbered `base`, on a line whose numbers
   * start with `line` and that has reached `k`. */
  const alts = (list: FlowNode[], base: string, line: string, k: number) => {
    let b = 0
    for (const n of list) {
      if (n.kind === 'branch') {
        const l = letter(b++)
        const num = !base ? l : /\d$/.test(base) ? `${base}${l}` : `${base}.${l}`
        out.set(n.id, num)
        alts(n.children, num, num, 0)
      } else {
        const num = line ? `${line}.${k + 1}` : String(k + 1)
        out.set(n.id, num)
        alts(n.children, num, line, k + 1)
      }
    }
  }
  for (const intent of nodes) alts(intent.children, '', '', 0)
  return out
}

/**
 * Keeps the joins pointing somewhere real after an edit: `moved` sends
 * joins at a removed node on to another (or ends them, with null), and a
 * join whose step is gone is dropped.
 */
export function tidyJoins(nodes: FlowNode[], moved: Map<string, string | null> = new Map()): FlowNode[] {
  const ids = new Set<string>()
  const collect = (list: FlowNode[]) =>
    list.forEach((n) => {
      ids.add(n.id)
      collect(n.children)
    })
  collect(nodes)
  const fix = (list: FlowNode[]): FlowNode[] =>
    list.map((n) => {
      const children = fix(n.children)
      if (!n.joinsAt) return { ...n, children }
      let to: string | null = n.joinsAt
      if (moved.has(to)) to = moved.get(to) ?? null
      if (to && !ids.has(to)) to = null
      const { joinsAt: _, ...rest } = n
      return to ? { ...rest, children, joinsAt: to } : { ...rest, children }
    })
  return fix(nodes)
}
