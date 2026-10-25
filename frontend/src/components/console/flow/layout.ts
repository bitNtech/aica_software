import { indexFlow, joinProblems, joinTarget, numberFlow } from '../../../console/flowGraph'
import { normaliseFlow } from '../../../console/flowShape'
import type { FlowNode, FlowNodeKind } from '../../../console/types'

/**
 * Lays a conversation flow out as a conditional branching flowchart. Pure
 * and deterministic: the same flow and options always give the same cards,
 * so it is cheap to memoise and easy to test. Nothing here touches the DOM;
 * text is measured by character count, which over-estimates a little so
 * cards never clip.
 *
 * Each node is a card. What can happen next hangs below it: a step carries
 * the call straight on; a fork's ways out sit side by side, each line
 * carrying its branch's condition ("Otherwise" for the plain step). Where
 * branches join back up (`joinsAt`), their lines meet at the one step they
 * carry on at, which sits centred under all of them.
 *
 *                 1  Ask how they feel
 *          ┌──────────┼──────────┐
 *     (happy)    (neutral)    (unhappy)
 *        1a          1b          1c
 *          └──────────┼──────────┘
 *                 2  Ask about the visit
 *
 * The cards sit in rows (top to bottom) or columns (left to right): a card
 * is one row below the lowest card that leads to it. A line that has to
 * cross a row passes through a gap kept for it in that row. Within a row
 * cards keep the outline's order where they can, and each is pulled
 * towards the cards it comes from and leads to. Intents are independent and
 * sit side by side (top to bottom) or stacked (left to right).
 */

export type FlowDirection = 'TB' | 'LR'

/** `next`: into a step, the way the call carries on. `branch`: into a
 * branch, one way out of a fork, labelled with its condition. `join`: from
 * a node back to the step it carries on at. */
export type FlowEdgeKind = 'next' | 'branch' | 'join'

export interface LayoutOptions {
  direction?: FlowDirection
  /** Nodes whose children are hidden behind a "+n" stub. */
  collapsed?: ReadonlySet<string>
  /** Nodes that carry a one-line mark under their text (it makes them taller). */
  marked?: ReadonlySet<string>
  /** Widest a line of text may run, in px. Default 190. */
  maxTextWidth?: number
  /** Cards get room for an Edit button. */
  editable?: boolean
}

export interface LayoutNode {
  id: string
  node: FlowNode
  kind: FlowNodeKind
  /** Top-left corner and size of the card, in diagram px. */
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
  /** The kind in words, drawn on the card ("Intent", "Step", "Branch"). */
  caption: string
  /** Its number on the card (1, 1a, 2); null for intents. */
  number: string | null
  /** The label, wrapped. */
  lines: string[]
  /** What the agent says (steps), or when it applies (a branch with no line
   * to carry it), wrapped. */
  detail: string[]
  /** A line at the foot of the card: where the call ends, or carries on. */
  foot: string | null
  /** The step it carries on at, when it joins back up. */
  joins: { id: string; number: string | null; label: string } | null
  hasChildren: boolean
  collapsed: boolean
  /** How many nodes are behind the stub when collapsed. */
  hiddenCount: number
  /** Where the line into this card comes from in the tree, if anywhere. */
  fromId: string | null
  /** Arrow keys: the first thing that follows, the node before, and the
   * nodes beside it (the alternatives out of the same fork), in order. */
  nav: { next: string | null; prev: string | null; lane: string[] }
  /** The reserved rows: a mark line under the text. */
  marked: boolean
  /** Room for the Edit button. */
  editable: boolean
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
  /** SVG path, from the foot of one card to the head of the other. */
  d: string
  /** A branch's condition, or "Otherwise", drawn on the line. */
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

/** A card's rows, top to bottom, in px. FlowSvg draws from the same numbers. */
export const CARD = {
  padX: 16,
  top: 10,
  head: 22,
  afterHead: 8,
  label: 17,
  detailGap: 4,
  detail: 15,
  markGap: 6,
  mark: 18,
  footGap: 6,
  foot: 16,
  editGap: 8,
  edit: 24,
  bottom: 10,
} as const

const CHAR = { label: 7.3, detail: 6.5, edge: 6.1 }
const LINE_EDGE = 14
const EDGE_LABEL_W = 124
const MARGIN = 20
const ROOT_GAP = 56
/** Least room between rows (columns) for a line to curve in. */
const CURVE = { TB: 40, LR: 52 }
/** Room on either side of a label on a line. */
const LABEL_PAD = 6
const LANE_GAP = { TB: 28, LR: 32 }
/** How wide a line passing through a row is kept clear. */
const PASS_W = 12

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

/** What a line into this node says: a branch's condition, else its name. */
export function edgeLabelText(n: FlowNode): string {
  return (n.condition?.trim() || n.label.trim() || 'Branch').trim()
}

/** The card's height for what it holds. */
export function cardHeight(c: { lines: string[]; detail: string[]; marked: boolean; foot: string | null; editable: boolean }): number {
  return (
    CARD.top +
    CARD.head +
    CARD.afterHead +
    c.lines.length * CARD.label +
    (c.detail.length ? CARD.detailGap + c.detail.length * CARD.detail : 0) +
    (c.marked ? CARD.markGap + CARD.mark : 0) +
    (c.foot ? CARD.footGap + CARD.foot : 0) +
    (c.editable ? CARD.editGap + CARD.edit : 0) +
    CARD.bottom
  )
}

/* ---- the graph being laid out ---- */

/** A card, or a gap kept in a row for a line passing through it. */
interface Item {
  g: G | null
  /** For a gap: the edge passing through. */
  edge: E | null
  comp: number
  rank: number
  /** Room across the flow, and along it. */
  band: number
  main: number
  key: number
  weight: number
  preds: Item[]
  succs: Item[]
  /** Centre across the flow. */
  c: number
}

interface G {
  n: LayoutNode
  /** Tree children shown, in order. */
  kids: G[]
  item: Item
}

type LabelAt = 'target' | 'source' | 'pass' | 'mid'

interface E {
  from: G
  to: G
  kind: FlowEdgeKind
  label: EdgeLabel | null
  at: LabelAt
  /** The gaps it passes through, row by row. */
  pass: Item[]
}

/** Places a row's items, in their order, as close to where each wants to
 * be (`want`) as they can get without overlapping: the least squared
 * distance, by pooling neighbours that push into each other. */
function settleRow(items: Item[], want: number[], gap: number) {
  const n = items.length
  if (!n) return
  const off = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) off[i] = off[i - 1] + items[i - 1].band / 2 + gap + items[i].band / 2
  const blocks: { w: number; sum: number; from: number; to: number }[] = []
  for (let i = 0; i < n; i++) {
    const w = items[i].weight
    blocks.push({ w, sum: w * (want[i] - off[i]), from: i, to: i })
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]
      const a = blocks[blocks.length - 2]
      if (a.sum / a.w <= b.sum / b.w) break
      blocks.splice(blocks.length - 2, 2, { w: a.w + b.w, sum: a.sum + b.sum, from: a.from, to: b.to })
    }
  }
  for (const b of blocks) for (let i = b.from; i <= b.to; i++) items[i].c = b.sum / b.w + off[i]
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

export function layoutFlow(input: FlowNode[], opts: LayoutOptions = {}): FlowLayout {
  // Older flows are drawn in the branching shape too (ids are kept).
  const nodes = normaliseFlow(input)
  const direction = opts.direction ?? 'TB'
  const tb = direction === 'TB'
  const collapsed = opts.collapsed ?? new Set<string>()
  const marked = opts.marked ?? new Set<string>()
  const maxText = opts.maxTextWidth ?? 190
  const editable = !!opts.editable
  const index = indexFlow(nodes)
  const numbers = numberFlow(nodes)
  const broken = joinProblems(nodes)
  const cardW = maxText + CARD.padX * 2

  const all: G[] = []
  const byId = new Map<string, G>()
  let order = 0

  const joinOf = (node: FlowNode) => (broken[node.id] ? null : joinTarget(index, node))

  const make = (node: FlowNode, depth: number, parentId: string | null, posInSet: number, setSize: number, comp: number): G => {
    const isCollapsed = node.children.length > 0 && collapsed.has(node.id)
    const lines = wrapText(node.label.trim() || 'Unnamed', maxText, CHAR.label, 3)
    const detailText = node.kind === 'step' ? (node.say ?? '').trim() : node.kind === 'branch' && parentId === null && node.condition ? `When: ${node.condition.trim()}` : ''
    const detail = detailText ? wrapText(node.kind === 'step' ? `“${detailText}”` : detailText, maxText, CHAR.detail, 2) : []
    const j = joinOf(node)
    const joins = j ? { id: j.id, number: numbers.get(j.id) ?? null, label: j.label.trim() || 'Unnamed' } : null
    const foot = node.kind === 'intent' ? null : joins ? `${node.children.length ? 'Otherwise carries' : 'Carries'} on at ${joins.number ?? joins.label}` : node.children.length ? null : 'Ends the call'
    const isMarked = marked.has(node.id)
    const ln: LayoutNode = {
      id: node.id,
      node,
      kind: node.kind,
      x: 0,
      y: 0,
      w: cardW,
      h: cardHeight({ lines, detail, marked: isMarked, foot, editable }),
      depth,
      order: order++,
      parentId,
      posInSet,
      setSize,
      caption: KIND_CAPTION[node.kind],
      number: numbers.get(node.id) ?? null,
      lines,
      detail,
      foot,
      joins,
      hasChildren: node.children.length > 0,
      collapsed: isCollapsed,
      hiddenCount: isCollapsed ? countDescendants(node) : 0,
      fromId: parentId,
      nav: { next: null, prev: null, lane: [] },
      marked: isMarked,
      editable,
    }
    const item: Item = { g: null, edge: null, comp, rank: 0, band: tb ? ln.w : ln.h, main: tb ? ln.h : ln.w, key: ln.order, weight: 1, preds: [], succs: [], c: 0 }
    const g: G = { n: ln, kids: [], item }
    item.g = g
    all.push(g)
    byId.set(node.id, g)
    return g
  }

  const walk = (g: G, comp: number) => {
    if (g.n.collapsed) return
    const list = g.n.node.children
    list.forEach((child, i) => {
      const kid = make(child, g.n.depth + 1, g.n.id, i + 1, list.length, comp)
      g.kids.push(kid)
      walk(kid, comp)
    })
  }

  // Each intent is made and then walked, so `order` is the outline's.
  const roots = nodes.map((n, i) => {
    const g = make(n, 0, null, i + 1, nodes.length, i)
    walk(g, i)
    return g
  })

  /* ---- lines ---- */

  const edgeLabel = (text: string): EdgeLabel => {
    const lines = wrapText(text, EDGE_LABEL_W, CHAR.edge, 3)
    return { text, lines, x: 0, y: 0, w: Math.ceil(textWidth(lines, CHAR.edge)) + 16, h: lines.length * LINE_EDGE + 8 }
  }
  const edges: E[] = []
  for (const g of all) {
    const forks = g.kids.length > 1
    for (const kid of g.kids) {
      const branch = kid.n.kind === 'branch'
      edges.push({ from: g, to: kid, kind: branch ? 'branch' : 'next', label: branch ? edgeLabel(edgeLabelText(kid.n.node)) : forks ? edgeLabel('Otherwise') : null, at: 'target', pass: [] })
    }
  }
  for (const g of all) {
    const to = g.n.joins ? byId.get(g.n.joins.id) : undefined
    // A join into something folded away isn't drawn; the card still says it.
    if (!to) continue
    const otherwise = g.n.node.children.some((c) => c.kind === 'branch')
    edges.push({ from: g, to, kind: 'join', label: otherwise ? edgeLabel('Otherwise') : null, at: 'target', pass: [] })
  }
  const outs = new Map<G, E[]>()
  const ins = new Map<G, E[]>()
  for (const e of edges) {
    outs.set(e.from, [...(outs.get(e.from) ?? []), e])
    ins.set(e.to, [...(ins.get(e.to) ?? []), e])
  }

  /* ---- rows: one below the lowest card that leads here ---- */

  // The joins kept are never circular (joinProblems drops those), so a
  // card's row is settled once everything leading to it is.
  const rankOf = new Map<G, number>()
  const rank = (g: G): number => {
    const known = rankOf.get(g)
    if (known !== undefined) return known
    rankOf.set(g, 0)
    const r = Math.max(0, ...(ins.get(g) ?? []).map((e) => rank(e.from) + 1))
    rankOf.set(g, r)
    return r
  }
  for (const g of all) g.item.rank = rank(g)

  /* ---- where each label goes ---- */

  for (const e of edges) {
    const span = e.to.item.rank - e.from.item.rank
    e.at = span > 1 ? 'pass' : (ins.get(e.to)?.length ?? 0) === 1 ? 'target' : (outs.get(e.from)?.length ?? 0) === 1 ? 'source' : 'mid'
    const cross = e.label ? (tb ? e.label.w : e.label.h) : 0
    const along = e.label ? (tb ? e.label.h : e.label.w) : 0
    // A long line keeps a gap open in every row it crosses; its label sits
    // in the first.
    for (let r = e.from.item.rank + 1; r < e.to.item.rank; r++) {
      const first = r === e.from.item.rank + 1 && !!e.label
      const gap: Item = { g: null, edge: e, comp: e.from.item.comp, rank: r, band: first ? Math.max(PASS_W, cross) : PASS_W, main: first ? along : 0, key: e.to.n.order - 0.5, weight: 0.5, preds: [], succs: [], c: 0 }
      e.pass.push(gap)
    }
    const chain = [e.from.item, ...e.pass, e.to.item]
    for (let i = 1; i < chain.length; i++) {
      chain[i - 1].succs.push(chain[i])
      chain[i].preds.push(chain[i - 1])
    }
    if (e.at === 'target') e.to.item.band = Math.max(e.to.item.band, cross)
    if (e.at === 'source') e.from.item.band = Math.max(e.from.item.band, cross)
  }

  /* ---- across the flow, one intent at a time ---- */

  const ranks = Math.max(0, ...all.map((g) => g.item.rank)) + 1
  const items = [...all.map((g) => g.item), ...edges.flatMap((e) => e.pass)]
  const lane = LANE_GAP[direction]
  let cursor = 0
  const comps = roots.map((_, i) => items.filter((it) => it.comp === i))
  for (const compItems of comps) {
    const rows: Item[][] = Array.from({ length: ranks }, () => [])
    for (const it of compItems) rows[it.rank].push(it)
    // Order: the outline's in the first row; below, by where the items
    // they come from sit, the outline's order breaking ties.
    rows[0].sort((a, b) => a.key - b.key)
    for (let r = 1; r < ranks; r++) {
      const at = new Map(rows[r - 1].map((it, i) => [it, i]))
      const bary = (it: Item) => (it.preds.length ? mean(it.preds.map((p) => at.get(p) ?? 0)) : 0)
      rows[r].sort((a, b) => bary(a) - bary(b) || a.key - b.key)
    }
    for (const row of rows) settleRow(row, row.map(() => 0), lane)
    // Pull each item under what leads to it, then over what it leads to,
    // a few times; the last pass hangs everything from above.
    for (let pass = 0; pass < 4; pass++) {
      for (let r = 1; r < ranks; r++) settleRow(rows[r], rows[r].map((it) => (it.preds.length ? mean(it.preds.map((p) => p.c)) : it.c)), lane)
      if (pass === 3) break
      for (let r = ranks - 2; r >= 0; r--) settleRow(rows[r], rows[r].map((it) => (it.succs.length ? mean(it.succs.map((s) => s.c)) : it.c)), lane)
    }
    if (!compItems.length) continue
    const lo = Math.min(...compItems.map((it) => it.c - it.band / 2))
    const hi = Math.max(...compItems.map((it) => it.c + it.band / 2))
    for (const it of compItems) it.c += cursor - lo
    cursor += hi - lo + ROOT_GAP
  }
  const crossSpan = Math.max(0, cursor - ROOT_GAP)

  /* ---- along the flow: rows and the room between them ---- */

  const size = new Array<number>(ranks).fill(0)
  for (const it of items) size[it.rank] = Math.max(size[it.rank], it.main)
  const above = new Array<number>(ranks).fill(0)
  const below = new Array<number>(ranks).fill(0)
  for (const e of edges) {
    if (!e.label) continue
    const along = (tb ? e.label.h : e.label.w) + LABEL_PAD * 2
    if (e.at === 'target' || e.at === 'mid') above[e.to.item.rank] = Math.max(above[e.to.item.rank], along)
    else if (e.at === 'source') below[e.from.item.rank] = Math.max(below[e.from.item.rank], along)
  }
  const start = new Array<number>(ranks).fill(0)
  for (let r = 1; r < ranks; r++) start[r] = start[r - 1] + size[r - 1] + CURVE[direction] + above[r] + below[r - 1]
  const mainSpan = ranks && all.length ? start[ranks - 1] + size[ranks - 1] : 0

  const rowTop = (r: number) => MARGIN + start[r]
  const rowEnd = (r: number) => MARGIN + start[r] + size[r]
  const P = (c: number, m: number) => (tb ? `${c} ${m}` : `${m} ${c}`)

  for (const g of all) {
    const crossStart = MARGIN + g.item.c - (tb ? g.n.w : g.n.h) / 2
    g.n.x = Math.round(tb ? crossStart : rowTop(g.item.rank))
    g.n.y = Math.round(tb ? rowTop(g.item.rank) : crossStart)
  }
  const cOf = (it: Item) => MARGIN + it.c
  const width = Math.ceil(tb ? crossSpan : mainSpan) + MARGIN * 2
  const height = Math.ceil(tb ? mainSpan : crossSpan) + MARGIN * 2

  /* ---- the lines ---- */

  const out: LayoutEdge[] = edges.map((e) => {
    const a = e.from.item
    const b = e.to.item
    const along = e.label ? (tb ? e.label.h : e.label.w) + LABEL_PAD * 2 : 0
    // Card foot to the end of its row, so the curve starts clear of the row.
    const m0 = (tb ? e.from.n.y + e.from.n.h : e.from.n.x + e.from.n.w)
    let d = `M${P(cOf(a), m0)}L${P(cOf(a), rowEnd(a.rank))}`
    let mid: [number, number] | null = null
    const stops = [...e.pass, b]
    let c0 = cOf(a)
    let y0 = rowEnd(a.rank)
    stops.forEach((s, i) => {
      const last = i === stops.length - 1
      const leadA = i === 0 && e.at === 'source' ? along : 0
      const leadB = last && e.at === 'target' ? along : 0
      const c1 = cOf(s)
      const y1 = rowTop(s.rank)
      const ya = y0 + leadA
      const yb = y1 - leadB
      if (leadA) d += `L${P(c0, ya)}`
      if (Math.abs(c1 - c0) < 1) d += `L${P(c1, yb)}`
      else {
        const ym = (ya + yb) / 2
        d += `C${P(c0, ym)} ${P(c1, ym)} ${P(c1, yb)}`
      }
      if (leadB) d += `L${P(c1, y1)}`
      if (e.at === 'mid' && last) mid = [(c0 + c1) / 2, (ya + yb) / 2]
      if (!last) {
        d += `L${P(c1, rowEnd(s.rank))}`
        c0 = c1
        y0 = rowEnd(s.rank)
      }
    })

    let label: EdgeLabel | null = null
    if (e.label) {
      const l = e.label
      const [lc, lm]: [number, number] =
        e.at === 'target'
          ? [cOf(b), rowTop(b.rank) - along / 2]
          : e.at === 'source'
            ? [cOf(a), rowEnd(a.rank) + along / 2]
            : e.at === 'pass'
              ? [cOf(e.pass[0]), (rowTop(e.pass[0].rank) + rowEnd(e.pass[0].rank)) / 2]
              : (mid ?? [cOf(b), rowTop(b.rank) - along / 2])
      const [X, Y] = tb ? [lc, lm] : [lm, lc]
      label = { ...l, x: Math.round(X - l.w / 2), y: Math.round(Y - l.h / 2) }
    }
    return { id: `${e.from.n.id}>${e.to.n.id}`, from: e.from.n.id, to: e.to.n.id, kind: e.kind, d, label }
  })

  // Keyboard neighbours.
  const rootLane = roots.map((g) => g.n.id)
  for (const g of all) {
    g.n.nav.next = g.kids[0]?.n.id ?? (g.n.joins && byId.has(g.n.joins.id) ? g.n.joins.id : null)
    g.n.nav.prev = g.n.fromId
    const parent = g.n.fromId ? byId.get(g.n.fromId) : null
    g.n.nav.lane = parent ? parent.kids.map((k) => k.n.id) : rootLane
  }

  const list = all.map((g) => g.n)
  return { direction, nodes: list, edges: out, width, height, byId: new Map(list.map((n) => [n.id, n])) }
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
