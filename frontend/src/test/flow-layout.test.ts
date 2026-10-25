import { describe, expect, it } from 'vitest'
import type { FlowNode } from '../console/types'
import { completePath, compareSteps, graftPattern, normaliseLabel } from '../components/console/flow/compare'
import { ancestorIds, flatten, foldable, layoutFlow, wrapText, type FlowLayout } from '../components/console/flow/layout'
import { NEEDS_REVIEW } from '../pages/console/builder/flowTree'
import { LOW_CONFIDENCE } from '../components/console/flow/FlowCanvas'

let n = 0
const node = (kind: FlowNode['kind'], label: string, children: FlowNode[] = [], extra: Partial<FlowNode> = {}): FlowNode => ({
  id: `n${++n}`,
  kind,
  label,
  say: kind === 'step' ? `Say ${label}` : undefined,
  condition: kind === 'branch' ? `When ${label}` : undefined,
  sourceCallIds: [],
  children,
  ...extra,
})
const step = (label: string) => node('step', label)

/** `a`, then `b`, then … : each node's only child is the next. */
function seq(...nodes: FlowNode[]): FlowNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].children = [...nodes[i].children, nodes[i + 1]]
  return nodes[0]
}

/** A branching flow as the extraction makes it, with the nodes named. */
function named() {
  const ask = step('Ask for the doctor or department')
  const visit = step('Ask if it is a first visit or a review')
  const name = step('Take the patient’s name and number')
  const offer = step('Offer two slots')
  const noSlot = node('branch', 'No slot suits the caller', [], { condition: 'The caller can’t make either slot' })
  const nextDay = step('Offer the next available day')
  const callback = step('Offer a callback')
  const confirm = step('Confirm the booking')
  seq(noSlot, nextDay, callback)
  seq(ask, visit, name, offer)
  offer.children = [noSlot, confirm]
  const book = node('intent', 'Book an appointment', [ask])

  const find = step('Find the booking')
  const newSlots = step('Offer new slots')
  const other = node('branch', 'Wants a different doctor', [])
  const otherDoc = step('Offer another doctor')
  const leave = node('branch', 'Doctor on leave', [step('Say sorry')])
  const change = step('Confirm the change')
  otherDoc.children = [leave]
  other.children = [otherDoc]
  seq(find, newSlots)
  newSlots.children = [other, change]
  const resched = node('intent', 'Reschedule an appointment', [find])

  const cancel = node('intent', 'Cancel an appointment', [seq(step('Find the booking'), step('Confirm the cancellation'))])
  const timings = node('intent', 'Ask about timings and directions', [step('Answer from the knowledge base')])
  return { tree: [book, resched, cancel, timings], book, ask, visit, name, offer, noSlot, nextDay, callback, confirm, resched, other }
}
const sample = () => named().tree

function big(count: number): FlowNode[] {
  const out: FlowNode[] = []
  let made = 0
  let i = 0
  while (made < count) {
    const kids: FlowNode[] = []
    for (let k = 0; k < 8; k++) kids.push(step(`Step ${i}.${k} with a rather long label to wrap onto lines`))
    const branch = node('branch', `Branch ${i}`, [seq(step(`Branch ${i} first`), step(`Branch ${i} second`))])
    seq(...kids.slice(0, 3))
    seq(...kids.slice(3))
    kids[2].children = [branch, kids[3]]
    // A second fork further down, three ways.
    kids[5].children = [node('branch', `Branch ${i}b`, [step(`Branch ${i}b only`)]), node('branch', `Branch ${i}c`, [step(`Branch ${i}c only`)]), kids[6]]
    out.push(node('intent', `Intent ${i}`, [kids[0]]))
    made += kids.length + 3 + 4 + 1
    i++
  }
  return out
}

const PAD = 4
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w + PAD && b.x < a.x + a.w + PAD && a.y < b.y + b.h + PAD && b.y < a.y + a.h + PAD

/** Every node, and every edge label, clear of each other and inside the bounds. */
function expectClear(l: FlowLayout) {
  const boxes = [
    ...l.nodes.map((b) => ({ ...b, what: `node ${b.node.label}` })),
    ...l.edges.filter((e) => e.label).map((e) => ({ ...e.label!, what: `label ${e.label!.text}` })),
  ]
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]
    expect(a.x, a.what).toBeGreaterThanOrEqual(0)
    expect(a.y, a.what).toBeGreaterThanOrEqual(0)
    expect(a.x + a.w, a.what).toBeLessThanOrEqual(l.width)
    expect(a.y + a.h, a.what).toBeLessThanOrEqual(l.height)
    for (let j = i + 1; j < boxes.length; j++) {
      // A label sits on its own branch's edge: only labels and nodes can clash.
      expect(overlaps(a, boxes[j]), `${a.what} overlaps ${boxes[j].what}`).toBe(false)
    }
  }
}

/** An edge's path as short straight runs (curves are cut into pieces). */
function runs(d: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  let x = 0
  let y = 0
  const to = (nx: number, ny: number) => {
    out.push([Math.min(x, nx), Math.min(y, ny), Math.max(x, nx), Math.max(y, ny)])
    ;[x, y] = [nx, ny]
  }
  for (const m of d.matchAll(/([MHVLC])([^MHVLC]*)/g)) {
    const v = m[2].trim().split(/[\s,]+/).map(Number)
    if (m[1] === 'M') [x, y] = v
    else if (m[1] === 'H') to(v[0], y)
    else if (m[1] === 'V') to(x, v[0])
    else if (m[1] === 'L') to(v[0], v[1])
    else {
      const [x0, y0] = [x, y]
      for (let i = 1; i <= 12; i++) {
        const t = i / 12
        const u = 1 - t
        to(u ** 3 * x0 + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t ** 3 * v[4], u ** 3 * y0 + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t ** 3 * v[5])
      }
    }
  }
  return out
}

/** No arrow runs through a box that isn't one of its two ends. */
function expectEdgesClear(l: FlowLayout) {
  for (const e of l.edges) {
    for (const [x0, y0, x1, y1] of runs(e.d)) {
      for (const b of l.nodes) {
        if (b.id === e.from || b.id === e.to) continue
        // Checked by hand: expect() on every pair is slow for big flows.
        if (x0 < b.x + b.w - 1 && x1 > b.x + 1 && y0 < b.y + b.h - 1 && y1 > b.y + 1) expect.fail(`${e.id} crosses ${b.node.label}`)
      }
    }
  }
}

describe('layoutFlow', () => {
  it('wraps text to a width, cutting what is too long', () => {
    expect(wrapText('Ask for the doctor or department', 100, 7, 3)).toEqual(['Ask for the', 'doctor or', 'department'])
    expect(wrapText('one two three four five six seven eight nine ten', 60, 7, 2).at(-1)).toMatch(/…$/)
    // A word longer than a line is broken, not left to spill.
    expect(wrapText('Supercalifragilisticexpialidocious', 70, 7, 4).every((l) => l.length <= 10)).toBe(true)
    expect(wrapText('', 100, 7, 2)).toEqual([])
  })

  it.each(['TB', 'LR'] as const)('leaves no boxes overlapping, top to bottom and left to right (%s)', (direction) => {
    const l = layoutFlow(sample(), { direction })
    expect(l.nodes).toHaveLength(flatten(sample()).length)
    expectClear(l)
    expectEdgesClear(l)
  })

  it('carries the call straight on, and fans out at a fork', () => {
    const { tree, book, ask, visit, offer, noSlot, confirm } = named()
    const l = layoutFlow(tree, { direction: 'TB' })
    const edge = (from: string, to: string) => l.edges.find((e) => e.from === from && e.to === to)
    // intent -> step -> step: one way on, straight down.
    expect(edge(book.id, ask.id)?.kind).toBe('next')
    expect(edge(ask.id, visit.id)?.kind).toBe('next')
    // Two ways out of "Offer two slots": the branch, and the plain step.
    expect(edge(offer.id, noSlot.id)?.kind).toBe('branch')
    expect(edge(offer.id, confirm.id)?.kind).toBe('next')
    expect(edge(noSlot.id, confirm.id)).toBeUndefined()
    const by = l.byId
    const mid = (id: string) => by.get(id)!.x + by.get(id)!.w / 2
    expect(Math.abs(mid(visit.id) - mid(ask.id))).toBeLessThanOrEqual(1)
    expect(by.get(ask.id)!.y).toBeLessThan(by.get(visit.id)!.y)
    // The fork sits side by side on the next row, centred under its node.
    const below = by.get(offer.id)!.y + by.get(offer.id)!.h
    expect(by.get(noSlot.id)!.y).toBeGreaterThan(below)
    expect(by.get(noSlot.id)!.y).toBe(by.get(confirm.id)!.y)
    expect(by.get(confirm.id)!.x).toBeGreaterThan(by.get(noSlot.id)!.x + by.get(noSlot.id)!.w)
    expect(Math.abs((mid(noSlot.id) + mid(confirm.id)) / 2 - mid(offer.id))).toBeLessThanOrEqual(1)
  })

  it('runs left to right in LR, the ways out of a fork one above the other', () => {
    const { tree, ask, visit, offer, noSlot, confirm } = named()
    const l = layoutFlow(tree, { direction: 'LR' })
    const a = l.byId.get(ask.id)!
    const b = l.byId.get(visit.id)!
    expect(b.x).toBeGreaterThan(a.x + a.w)
    expect(Math.abs(b.y + b.h / 2 - (a.y + a.h / 2))).toBeLessThanOrEqual(1)
    expect(l.byId.get(confirm.id)!.y).toBeGreaterThan(l.byId.get(noSlot.id)!.y + l.byId.get(noSlot.id)!.h)
    expect(l.byId.get(noSlot.id)!.x).toBeGreaterThan(l.byId.get(offer.id)!.x + l.byId.get(offer.id)!.w)
  })

  it('labels a branch’s edge with its condition (its name if it has none), and the plain way out of a fork “Otherwise”', () => {
    const { tree, noSlot, confirm, visit } = named()
    const l = layoutFlow(tree)
    const into = (id: string) => l.edges.find((e) => e.to === id)
    expect(into(noSlot.id)?.label?.text).toBe('The caller can’t make either slot')
    expect(into(confirm.id)?.label?.text).toBe('Otherwise')
    expect(into(visit.id)?.label).toBeNull()
    const bare = node('intent', 'X', [node('branch', 'Other way', [step('b')], { condition: '' }), step('a')])
    expect(layoutFlow([bare]).edges.find((e) => e.to === bare.children[0].id)?.label?.text).toBe('Other way')
  })

  it('draws an older flow, whose steps were siblings, in the branching shape', () => {
    const a = step('a')
    const b = step('b')
    const side = node('branch', 'Side', [step('s')])
    const c = step('c')
    const old = node('intent', 'Old', [a, b, side, c])
    const l = layoutFlow([old])
    const pairs = l.edges.map((e) => [e.from, e.to])
    expect(pairs).toContainEqual([old.id, a.id])
    expect(pairs).toContainEqual([a.id, b.id])
    // The branch forks off the step before it; the chain goes on past it.
    expect(pairs).toContainEqual([b.id, side.id])
    expect(pairs).toContainEqual([b.id, c.id])
    expectClear(l)
  })

  it('stacks the top-level flows apart: side by side, then one above the other', () => {
    const tree = sample()
    const tb = layoutFlow(tree, { direction: 'TB' })
    const xs = tree.map((t) => tb.byId.get(t.id)!.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    const lr = layoutFlow(tree, { direction: 'LR' })
    const ys = tree.map((t) => lr.byId.get(t.id)!.y)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
  })

  it('hides a collapsed subtree behind a +n stub and shrinks the drawing', () => {
    const tree = sample()
    const open = layoutFlow(tree)
    const folded = layoutFlow(tree, { collapsed: new Set([tree[0].id]) })
    expect(folded.nodes.some((x) => x.id === tree[0].children[0].id)).toBe(false)
    const intent = folded.byId.get(tree[0].id)!
    expect(intent.collapsed).toBe(true)
    // Everything that follows it: 5 steps on the way, 3 in the branch.
    expect(intent.hiddenCount).toBe(8)
    expect(folded.edges.some((e) => e.from === tree[0].id)).toBe(false)
    expect(folded.nodes.length).toBe(open.nodes.length - 8)
    expect(folded.height).toBeLessThan(open.height)
    expectClear(folded)
    // A node with nothing after it can't be collapsed.
    const leaf = tree[3].children[0]
    expect(layoutFlow(tree, { collapsed: new Set([leaf.id]) }).byId.get(leaf.id)!.collapsed).toBe(false)
  })

  it('returns bounds that hold everything, and is deterministic', () => {
    const tree = sample()
    const a = layoutFlow(tree)
    const b = layoutFlow(tree)
    expect(JSON.stringify([a.nodes.map((x) => [x.id, x.x, x.y, x.w, x.h]), a.edges, a.width, a.height])).toBe(
      JSON.stringify([b.nodes.map((x) => [x.id, x.x, x.y, x.w, x.h]), b.edges, b.width, b.height]),
    )
    const maxX = Math.max(...a.nodes.map((x) => x.x + x.w))
    const maxY = Math.max(...a.nodes.map((x) => x.y + x.h))
    expect(a.width).toBeGreaterThanOrEqual(maxX)
    expect(a.height).toBeGreaterThanOrEqual(maxY)
    const empty = layoutFlow([])
    expect(empty.nodes).toEqual([])
    expect(empty.width).toBeGreaterThan(0)
  })

  it('makes marked nodes and long text taller, every card one width', () => {
    const tree = [node('intent', 'A', [step('Short'), step('A very long step name that has to wrap across more than one line for sure')])]
    const plain = layoutFlow(tree)
    const marked = layoutFlow(tree, { marked: new Set([tree[0].children[0].id]) })
    expect(marked.byId.get(tree[0].children[0].id)!.h).toBeGreaterThan(plain.byId.get(tree[0].children[0].id)!.h)
    const long = plain.byId.get(tree[0].children[1].id)!
    expect(long.lines.length).toBeGreaterThan(1)
    expect(long.w).toBe(190 + 32)
    expect(plain.byId.get(tree[0].children[0].id)!.w).toBe(long.w)
    expect(long.h).toBeGreaterThan(plain.byId.get(tree[0].children[0].id)!.h)
  })

  it('gives each node its keyboard neighbours and tree position', () => {
    const { tree, book, ask, name, offer, noSlot, confirm } = named()
    const l = layoutFlow(tree)
    const at = l.byId.get(offer.id)!
    // What follows (the first way on), the step before, and the ways out of the same fork.
    expect(at.nav.next).toBe(noSlot.id)
    expect(at.nav.prev).toBe(name.id)
    const plain = l.byId.get(confirm.id)!
    expect(plain.nav.prev).toBe(offer.id)
    expect(plain.nav.lane).toEqual([noSlot.id, confirm.id])
    expect(l.byId.get(book.id)!.nav.lane).toEqual(tree.map((t) => t.id))
    expect(l.byId.get(ask.id)).toMatchObject({ depth: 1, posInSet: 1, setSize: 1, parentId: book.id })
    expect(plain).toMatchObject({ depth: 5, posInSet: 2, setSize: 2, parentId: offer.id })
    expect(l.nodes.map((x) => x.order)).toEqual(l.nodes.map((_, i) => i))
  })

  it('stays clear of overlaps for about 200 nodes, and fast', () => {
    const tree = big(200)
    const t0 = performance.now()
    const tb = layoutFlow(tree, { direction: 'TB' })
    const lr = layoutFlow(tree, { direction: 'LR' })
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(tb.nodes.length).toBeGreaterThanOrEqual(190)
    expectClear(tb)
    expectClear(lr)
    expectEdgesClear(tb)
    expectEdgesClear(lr)
  })

  it('has tree helpers that agree with the outline', () => {
    const { tree, book, ask, visit, name, offer, noSlot, nextDay, callback } = named()
    expect(ancestorIds(tree, callback.id)).toEqual([book.id, ask.id, visit.id, name.id, offer.id, noSlot.id, nextDay.id])
    expect(ancestorIds(tree, book.id)).toEqual([])
    expect(foldable(tree)).toContain(noSlot.id)
    expect(foldable(tree)).not.toContain(callback.id)
  })

  it('shares the low-confidence threshold with the builder', () => {
    expect(LOW_CONFIDENCE).toBe(NEEDS_REVIEW)
  })
})

describe('comparing steps with the designed flow', () => {
  it('normalises labels for matching', () => {
    expect(normaliseLabel('  1. Confirm the booking! ')).toBe('confirm booking')
    expect(normaliseLabel('Step 2: “Offer two slots”')).toBe('offer two slots')
    expect(normaliseLabel('Ask for the doctor, or department')).toBe('ask doctor or department')
  })

  it('maps steps onto designed nodes by label, and reports the rest', () => {
    const { tree, book, ask, offer, confirm } = named()
    const cmp = compareSteps(['Ask for the doctor or department', 'Offer two slots', 'Confirm the booking', 'Check insurance'], tree)
    expect(cmp.rootId).toBe(book.id)
    expect(cmp.matches.map((m) => [m.index, m.nodeId])).toEqual([
      [0, ask.id],
      [1, offer.id],
      [2, confirm.id],
    ])
    expect(cmp.unmatched).toEqual([{ index: 3, step: 'Check insurance' }])
    expect(cmp.matchedIds).toEqual([ask.id, offer.id, confirm.id])
    expect(cmp.coverage).toBe(0.75)
  })

  it('picks the intent a repeated label belongs to, and says where a stray step lives', () => {
    const tree = sample()
    const [, resched, cancel] = tree
    // "Find the booking" is under Reschedule and Cancel: the rest of the sequence decides.
    const cmp = compareSteps(['find the booking', 'Confirm the cancellation'], tree)
    expect(cmp.rootId).toBe(cancel.id)
    expect(cmp.matches[0].nodeId).toBe(cancel.children[0].id)
    const mixed = compareSteps(['Find the booking', 'Offer new slots', 'Confirm the cancellation'], tree)
    expect(mixed.rootId).toBe(resched.id)
    expect(mixed.unmatched).toEqual([{ index: 2, step: 'Confirm the cancellation', elsewhereId: cancel.children[0].children[0].id }])
  })

  it('handles nothing matching, and nothing to match', () => {
    const tree = sample()
    expect(compareSteps(['Sing a song'], tree)).toMatchObject({ rootId: null, matches: [], matchedIds: [], coverage: 0 })
    expect(compareSteps([], tree).coverage).toBe(1)
    expect(compareSteps(['x'], []).unmatched).toEqual([{ index: 0, step: 'x' }])
  })

  it('puts each match’s intent, the steps before it and its branch in front of it for a highlighted path', () => {
    const { tree, book, ask, visit, name, offer, noSlot, nextDay } = named()
    expect(completePath(tree, [offer.id, nextDay.id, 'gone'])).toEqual([book.id, ask.id, visit.id, name.id, offer.id, noSlot.id, nextDay.id])
  })
})

describe('a detected pattern on the designed flow', () => {
  it('follows the design down its intent, then hangs the rest of the pattern off it as a new branch', () => {
    const { tree, book, ask, visit, name } = named()
    const g = graftPattern(['Book an appointment', 'Ask for the doctor or department', 'Ask if it is a first visit or a review', 'Take the patient’s name and number', 'Check insurance', 'Hand over'], tree, '3 calls went this way')
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0].id).toBe(book.id)
    expect(g.stepIds).toEqual([book.id, ask.id, visit.id, name.id, 'detected-4', 'detected-5'])
    expect(g.branchId).toBe('detected-branch')
    expect(g.path).toEqual([book.id, ask.id, visit.id, name.id, 'detected-branch', 'detected-4', 'detected-5'])
    // The branch is a new way out of the last step the calls shared, before the design's own.
    const at = flatten(g.nodes).find((n) => n.id === name.id)!
    expect(at.children.map((c) => c.id)).toEqual(['detected-branch', ...name.children.map((c) => c.id)])
    expect(at.children[0]).toMatchObject({ kind: 'branch', condition: '3 calls went this way' })
    // The design itself is untouched.
    expect(name.children.some((c) => c.id === 'detected-branch')).toBe(false)
  })

  it('draws the whole pattern as a path when nothing in the design fits', () => {
    const g = graftPattern(['Sing a song', 'Dance'], sample(), 'x')
    expect(g.nodes).toEqual([expect.objectContaining({ id: 'detected-0', kind: 'intent', children: [expect.objectContaining({ id: 'detected-1' })] })])
    expect(g.path).toEqual(['detected-0', 'detected-1'])
  })

  it('adds nothing when the calls followed the design all the way', () => {
    const { tree, book, ask } = named()
    const g = graftPattern(['Book an appointment', 'Ask for the doctor or department'], tree, 'x')
    expect(g.branchId).toBeNull()
    expect(g.path).toEqual([book.id, ask.id])
  })
})
