import type { FlowNode, FlowNodeKind } from '../../../console/types'

/**
 * Lays a conversation flow out as a diagram. Pure and deterministic: the
 * same tree and options always give the same boxes, so it is cheap to
 * memoise and easy to test. Nothing here touches the DOM; text is measured
 * by character count, which over-estimates a little so boxes never clip.
 *
 * The flow is an ordered script, not a fan-out. An intent's children are
 * its steps in the order they happen, so the diagram chains them: each step
 * leads to the next. A branch is a side path: it forks off the step before
 * it (its condition is the label on that edge) and runs its own steps,
 * while the main chain carries on past it.
 *
 *   intent
 *     step 1 ── step 2 ── step 3 ── step 4        (the "main" path)
 *                  └─ branch (condition) ── step a ── step b
 *
 * Top-level nodes (intents) are independent: they sit side by side (top to
 * bottom) or stacked (left to right), unless `sequence` chains them.
 */

export type FlowDirection = 'TB' | 'LR'

/** `next`: the following step. `branch`: a side path, labelled with its
 * condition. `child`: a step's own nested items (rare; the editor never
 * makes them, but the data may hold them). */
export type FlowEdgeKind = 'next' | 'branch' | 'child'

export interface LayoutOptions {
  direction?: FlowDirection
  /** Nodes whose children are hidden behind a "+n" stub. */
  collapsed?: ReadonlySet<string>
  /** Nodes that carry a one-line mark under their text (it makes them taller). */
  marked?: ReadonlySet<string>
  /** Chain the top-level nodes one after another, e.g. a detected sequence
   * of steps, instead of drawing them as separate flows. */
  sequence?: boolean
  /** Widest a line of text may run, in px. Default 190. */
  maxTextWidth?: number
}

export interface LayoutNode {
  id: string
  node: FlowNode
  kind: FlowNodeKind
  /** Top-left corner and size of the box, in diagram px. */
  x: number
  y: number
  w: number
  h: number
  /** How deep in the tree (0 for intents), for `aria-level`. */
  depth: number
  /** Position in the diagram's reading order (the outline's order). */
  order: number
  /** The tree parent, which owns the collapse state; null at the top. */
  parentId: string | null
  /** 1-based place among its tree siblings, for `aria-posinset`. */
  posInSet: number
  setSize: number
  /** The kind in words, drawn on the node ("Intent", "Step", "Branch"). */
  caption: string
  /** The label, wrapped. */
  lines: string[]
  /** What the agent says (steps), or when it applies (a branch with no edge
   * to carry it), wrapped. */
  detail: string[]
  hasChildren: boolean
  collapsed: boolean
  /** How many nodes are behind the stub when collapsed. */
  hiddenCount: number
  /** Where the arrow into this node comes from, if anywhere. */
  fromId: string | null
  /** Arrow keys: the next step, the one before, and the nodes beside it
   * (the alternatives out of the same fork), in left-to-right order. */
  nav: { next: string | null; prev: string | null; lane: string[] }
  /** The reserved rows: a mark line under the text. */
  marked: boolean
}

export interface EdgeLabel {
  text: string
  lines: string[]
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutEdge {
  id: string
  from: string
  to: string
  kind: FlowEdgeKind
  /** SVG path, from the edge of one box to the edge of the other. */
  d: string
  /** A branch's condition, drawn on the edge. */
  label: EdgeLabel | null
}

export interface FlowLayout {
  direction: FlowDirection
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  /** The whole drawing, padding included. */
  width: number
  height: number
  byId: Map<string, LayoutNode>
}

/* ---- measurement ---- */

export const KIND_CAPTION: Record<FlowNodeKind, string> = { intent: 'Intent', step: 'Step', branch: 'Branch' }

const CHAR = { label: 7.3, detail: 6.5, edge: 6.1, caption: 6.6 }
const LINE = { caption: 14, label: 17, detail: 15, mark: 18, edge: 14 }
const PAD_X: Record<FlowNodeKind, number> = { intent: 24, step: 14, branch: 26 }
const PAD_Y = 8
const MIN_W = 124
const MIN_W_MARKED = 140
const EDGE_LABEL_W = 124
const MARGIN = 20
const ROOT_GAP = 56
const BASE_GAP = { TB: 44, LR: 60 }
const LANE_GAP = { TB: 28, LR: 44 }

/** Breaks `text` into lines of at most `maxWidth` px (at `charW` px a
 * character), at most `maxLines`; the last line ends with … when cut. */
export function wrapText(text: string, maxWidth: number, charW: number, maxLines: number): string[] {
  const per = Math.max(4, Math.floor(maxWidth / charW))
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (let word of words) {
    while (word.length > per) {
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push(word.slice(0, per))
      word = word.slice(per)
    }
    if (!line) line = word
    else if (line.length + 1 + word.length <= per) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const last = kept[maxLines - 1]
  kept[maxLines - 1] = `${last.length >= per ? last.slice(0, per - 1) : last}…`
  return kept
}

const textWidth = (lines: string[], charW: number) => lines.reduce((m, l) => Math.max(m, l.length * charW), 0)

export function countDescendants(n: FlowNode): number {
  return n.children.reduce((s, c) => s + 1 + countDescendants(c), 0)
}

/** What an edge into this node says: a branch's condition, else its name. */
export function edgeLabelText(n: FlowNode): string {
  return (n.condition?.trim() || n.label.trim() || 'Branch').trim()
}

/* ---- the layout tree ---- */

interface G {
  n: LayoutNode
  /** Layout children: the main path first, then side paths. */
  kids: { g: G; kind: FlowEdgeKind }[]
  label: EdgeLabel | null
  /** Space the node takes across the flow, edge label included. */
  band: number
  rank: number
  /** Centre across the flow, relative to the parent while placing. */
  offset: number
  centre: number
}

type Contour = { l: number; r: number }[]

export function layoutFlow(nodes: FlowNode[], opts: LayoutOptions = {}): FlowLayout {
  const direction = opts.direction ?? 'TB'
  const tb = direction === 'TB'
  const collapsed = opts.collapsed ?? new Set<string>()
  const marked = opts.marked ?? new Set<string>()
  const maxText = opts.maxTextWidth ?? 190

  const all: G[] = []
  let order = 0

  const make = (node: FlowNode, depth: number, parentId: string | null, posInSet: number, setSize: number, hasEdge: boolean): G => {
    const isCollapsed = node.children.length > 0 && collapsed.has(node.id)
    const lines = wrapText(node.label.trim() || 'Unnamed', maxText, CHAR.label, 3)
    const detailText = node.kind === 'step' ? (node.say ?? '').trim() : node.kind === 'branch' && !hasEdge ? (node.condition ? `When: ${node.condition.trim()}` : '') : ''
    const detail = detailText ? wrapText(detailText, maxText, CHAR.detail, 2) : []
    const isMarked = marked.has(node.id)
    const caption = KIND_CAPTION[node.kind]
    const padX = PAD_X[node.kind]
    const textW = Math.max(textWidth(lines, CHAR.label), textWidth(detail, CHAR.detail), caption.length * CHAR.caption + 16)
    const w = Math.round(Math.min(maxText + padX * 2, Math.max(isMarked ? MIN_W_MARKED : MIN_W, textW + padX * 2)))
    const h = PAD_Y * 2 + LINE.caption + lines.length * LINE.label + (detail.length ? 4 + detail.length * LINE.detail : 0) + (isMarked ? LINE.mark : 0)
    const ln: LayoutNode = {
      id: node.id,
      node,
      kind: node.kind,
      x: 0,
      y: 0,
      w,
      h,
      depth,
      order: order++,
      parentId,
      posInSet,
      setSize,
      caption,
      lines,
      detail,
      hasChildren: node.children.length > 0,
      collapsed: isCollapsed,
      hiddenCount: isCollapsed ? countDescendants(node) : 0,
      fromId: null,
      nav: { next: null, prev: null, lane: [] },
      marked: isMarked,
    }
    const g: G = { n: ln, kids: [], label: null, band: 0, rank: 0, offset: 0, centre: 0 }
    all.push(g)
    return g
  }

  const connect = (from: G, to: G, kind: FlowEdgeKind) => {
    from.kids.push({ g: to, kind })
    to.n.fromId = from.n.id
    if (to.n.kind === 'branch') {
      const text = edgeLabelText(to.n.node)
      const lines = wrapText(text, EDGE_LABEL_W, CHAR.edge, 3)
      to.label = { text, lines, x: 0, y: 0, w: Math.ceil(textWidth(lines, CHAR.edge)) + 16, h: lines.length * LINE.edge + 8 }
    }
  }

  /** Walks one list of siblings. `origin` is what they hang from. */
  const walk = (list: FlowNode[], origin: G, depth: number, parentId: string) => {
    let prev = origin
    list.forEach((child, i) => {
      const g = make(child, depth, parentId, i + 1, list.length, true)
      const own = origin.n.kind === 'step' && prev === origin
      connect(prev, g, own ? 'child' : child.kind === 'branch' ? 'branch' : 'next')
      if (child.kind !== 'branch') prev = g
      if (!g.n.collapsed) walk(child.children, g, depth + 1, child.id)
    })
  }

  // Each intent is made and then walked, so `order` is the outline's.
  const roots: G[] = []
  nodes.forEach((n, i) => {
    const g = make(n, 0, null, i + 1, nodes.length, false)
    roots.push(g)
    if (!g.n.collapsed) walk(n.children, g, 1, n.id)
  })
  // Chained roots: each leads to the next. They were made first, so the
  // chain edges are added after every node's own steps.
  const top = opts.sequence ? roots.slice(0, 1) : roots
  if (opts.sequence) for (let i = 1; i < roots.length; i++) connect(roots[i - 1], roots[i], 'next')

  const crossOf = (n: LayoutNode) => (tb ? n.w : n.h)
  const mainOf = (n: LayoutNode) => (tb ? n.h : n.w)
  for (const g of all) {
    const label = g.label ? (tb ? g.label.w : g.label.h) : 0
    g.band = Math.max(crossOf(g.n), label)
  }

  // Main path first, then side paths in the order they were written.
  const ordered = (g: G) => {
    const main = g.kids.findIndex((k) => k.kind === 'next')
    if (main > 0) g.kids.unshift(...g.kids.splice(main, 1))
  }
  all.forEach(ordered)

  /** Places `g` and its subtree; returns the subtree's extent at each rank,
   * across the flow, relative to g's centre. */
  const place = (g: G): Contour => {
    const own: Contour = [{ l: -g.band / 2, r: g.band / 2 }]
    const merged: Contour = []
    g.kids.forEach(({ g: kid }, i) => {
      const c = place(kid)
      let shift = 0
      if (i > 0) {
        shift = -Infinity
        c.forEach((e, r) => {
          if (merged[r]) shift = Math.max(shift, merged[r].r - e.l + LANE_GAP[direction])
        })
      }
      kid.offset = shift
      c.forEach((e, r) => {
        const s = { l: e.l + shift, r: e.r + shift }
        merged[r] = merged[r] ? { l: Math.min(merged[r].l, s.l), r: Math.max(merged[r].r, s.r) } : s
      })
    })
    // A side path leaves from the node's own row, running out to its centre:
    // nothing else may sit in that row until it's past.
    for (let i = 1; i < g.kids.length; i++) own[0].r = Math.max(own[0].r, g.kids[i].g.offset + 4)
    return [...own, ...merged]
  }

  let cursor = 0
  const spans = new Map<G, Contour>()
  for (const g of top) {
    const c = place(g)
    spans.set(g, c)
    const minL = Math.min(...c.map((e) => e.l))
    const maxR = Math.max(...c.map((e) => e.r))
    g.centre = cursor - minL
    cursor = g.centre + maxR + ROOT_GAP
  }
  const settle = (g: G, rank: number) => {
    g.rank = rank
    g.kids.forEach(({ g: kid }) => {
      kid.centre = g.centre + kid.offset
      settle(kid, rank + 1)
    })
  }
  top.forEach((g) => settle(g, 0))

  // Rows (top to bottom) or columns (left to right), one per rank.
  const ranks = Math.max(0, ...all.map((g) => g.rank)) + 1
  const size = new Array<number>(ranks).fill(0)
  const gap = new Array<number>(ranks).fill(BASE_GAP[direction])
  for (const g of all) {
    size[g.rank] = Math.max(size[g.rank], mainOf(g.n))
    if (g.label && g.rank > 0) {
      const need = tb ? g.label.h + 22 : g.label.w + 30
      gap[g.rank] = Math.max(gap[g.rank], need)
    }
  }
  const start = new Array<number>(ranks).fill(0)
  for (let r = 1; r < ranks; r++) start[r] = start[r - 1] + size[r - 1] + gap[r]

  let minCross = Infinity
  let maxCross = -Infinity
  for (const g of all) {
    minCross = Math.min(minCross, g.centre - g.band / 2)
    maxCross = Math.max(maxCross, g.centre + g.band / 2)
  }
  if (!all.length) {
    minCross = 0
    maxCross = 0
  }
  const mainEnd = ranks ? start[ranks - 1] + size[ranks - 1] : 0
  const crossShift = MARGIN - minCross

  for (const g of all) {
    const main = MARGIN + start[g.rank] + (size[g.rank] - mainOf(g.n)) / 2
    const crossStart = g.centre + crossShift - crossOf(g.n) / 2
    g.n.x = Math.round(tb ? crossStart : main)
    g.n.y = Math.round(tb ? main : crossStart)
  }
  const width = Math.ceil(tb ? maxCross - minCross : mainEnd) + MARGIN * 2
  const height = Math.ceil(tb ? mainEnd : maxCross - minCross) + MARGIN * 2

  // Keyboard neighbours.
  const lanes = (gs: G[]) => gs.map((g) => g.n.id)
  const rootLane = lanes(roots)
  const gById = new Map(all.map((g) => [g.n.id, g]))
  for (const g of all) {
    g.n.nav.next = g.kids[0]?.g.n.id ?? null
    g.n.nav.prev = g.n.fromId
    const parent = g.n.fromId ? gById.get(g.n.fromId) : null
    g.n.nav.lane = parent ? lanes(parent.kids.map((k) => k.g)) : opts.sequence ? [g.n.id] : rootLane
  }

  // Arrows.
  const R = 10
  const edges: LayoutEdge[] = []
  for (const g of all) {
    for (const { g: kid, kind } of g.kids) {
      const p = g.n
      const c = kid.n
      const straight = Math.abs(kid.offset) < 0.5
      let d: string
      if (tb) {
        const cx = c.x + c.w / 2
        if (straight) d = `M${cx} ${p.y + p.h}V${c.y}`
        else {
          const y1 = p.y + p.h / 2
          d = `M${p.x + p.w} ${y1}H${cx - R}Q${cx} ${y1} ${cx} ${y1 + R}V${c.y}`
        }
      } else {
        const cy = c.y + c.h / 2
        if (straight) d = `M${p.x + p.w} ${cy}H${c.x}`
        else {
          const x1 = p.x + p.w / 2
          d = `M${x1} ${p.y + p.h}V${cy - R}Q${x1} ${cy} ${x1 + R} ${cy}H${c.x}`
        }
      }
      let label: EdgeLabel | null = null
      if (kid.label) {
        const l = kid.label
        label = tb
          ? { ...l, x: Math.round(c.x + c.w / 2 - l.w / 2), y: Math.round(c.y - 8 - l.h) }
          : { ...l, x: Math.round(c.x - 10 - l.w), y: Math.round(c.y + c.h / 2 - l.h / 2) }
      }
      edges.push({ id: `${p.id}>${c.id}`, from: p.id, to: c.id, kind, d, label })
    }
  }

  const list = all.map((g) => g.n)
  return { direction, nodes: list, edges, width, height, byId: new Map(list.map((n) => [n.id, n])) }
}

/* ---- tree helpers ---- */

/** The tree ancestors of `id`, outermost first (not including `id`). */
export function ancestorIds(nodes: FlowNode[], id: string): string[] {
  const walk = (list: FlowNode[], trail: string[]): string[] | null => {
    for (const n of list) {
      if (n.id === id) return trail
      const hit = walk(n.children, [...trail, n.id])
      if (hit) return hit
    }
    return null
  }
  return walk(nodes, []) ?? []
}

/** Every node, in the outline's order. */
export function flatten(nodes: FlowNode[]): FlowNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

/** Ids of every node that has children: what "collapse all" would fold. */
export function foldable(nodes: FlowNode[]): string[] {
  return flatten(nodes).filter((n) => n.children.length > 0).map((n) => n.id)
}
