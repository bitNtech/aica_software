import { describe, expect, it } from 'vitest'
import type { FlowNode } from '../console/types'
import { completePath, compareSteps, normaliseLabel } from '../components/console/flow/compare'
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

/** Intents with steps and branches, as the extraction makes them. */
function sample(): FlowNode[] {
  return [
    node('intent', 'Book an appointment', [
      step('Ask for the doctor or department'),
      step('Ask if it is a first visit or a review'),
      step('Take the patient’s name and number'),
      step('Offer two slots'),
      node('branch', 'No slot suits the caller', [step('Offer the next available day'), step('Offer a callback')], { condition: 'The caller can’t make either slot' }),
      step('Confirm the booking'),
    ]),
    node('intent', 'Reschedule an appointment', [
      step('Find the booking'),
      step('Offer new slots'),
      node('branch', 'Wants a different doctor', [step('Offer another doctor'), node('branch', 'Doctor on leave', [step('Say sorry')])]),
      step('Confirm the change'),
    ]),
    node('intent', 'Cancel an appointment', [step('Find the booking'), step('Confirm the cancellation')]),
    node('intent', 'Ask about timings and directions', [step('Answer from the knowledge base')]),
  ]
}

function big(count: number): FlowNode[] {
  const out: FlowNode[] = []
  let made = 0
  let i = 0
  while (made < count) {
    const kids: FlowNode[] = []
    for (let k = 0; k < 8; k++) kids.push(step(`Step ${i}.${k} with a rather long label to wrap onto lines`))
    kids.splice(3, 0, node('branch', `Branch ${i}`, [step(`Branch ${i} first`), step(`Branch ${i} second`)]))
    out.push(node('intent', `Intent ${i}`, kids))
    made += kids.length + 3 + 1
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

/** The straight runs of an edge's path (curves are cut to their end points). */
function runs(d: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  let x = 0
  let y = 0
  for (const m of d.matchAll(/([MHVLQ])([^MHVLQ]*)/g)) {
    const v = m[2].trim().split(/[\s,]+/).map(Number)
    const [px, py] = [x, y]
    if (m[1] === 'M') [x, y] = v
    else if (m[1] === 'H') x = v[0]
    else if (m[1] === 'V') y = v[0]
    else if (m[1] === 'L') [x, y] = v
    else [x, y] = [v[2], v[3]]
    if (m[1] !== 'M') out.push([Math.min(px, x), Math.min(py, y), Math.max(px, x), Math.max(py, y)])
  }
  return out
}

/** No arrow runs through a box that isn't one of its two ends. */
function expectEdgesClear(l: FlowLayout) {
  for (const e of l.edges) {
    for (const [x0, y0, x1, y1] of runs(e.d)) {
      for (const b of l.nodes) {
        if (b.id === e.from || b.id === e.to) continue
        const hit = x0 < b.x + b.w - 1 && x1 > b.x + 1 && y0 < b.y + b.h - 1 && y1 > b.y + 1
        expect(hit, `${e.id} crosses ${b.node.label}`).toBe(false)
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

  it('chains steps in order and forks a branch from the step before it', () => {
    const tree = sample()
    const l = layoutFlow(tree, { direction: 'TB' })
    const [book] = tree
    const ids = book.children.map((c) => c.id)
    const edge = (from: string, to: string) => l.edges.find((e) => e.from === from && e.to === to)
    // intent -> step 1 -> step 2 -> ... : a chain, not a fan.
    expect(edge(book.id, ids[0])?.kind).toBe('next')
    expect(edge(ids[0], ids[1])?.kind).toBe('next')
    expect(edge(ids[2], ids[3])?.kind).toBe('next')
    // The branch hangs off "Offer two slots", and the chain goes on past it.
    expect(edge(ids[3], ids[4])?.kind).toBe('branch')
    expect(edge(ids[3], ids[5])?.kind).toBe('next')
    expect(edge(ids[4], ids[5])).toBeUndefined()
    // Down the page the chain stays in one column; the branch is beside it.
    const by = l.byId
    expect(Math.abs(by.get(ids[1])!.x + by.get(ids[1])!.w / 2 - (by.get(ids[0])!.x + by.get(ids[0])!.w / 2))).toBeLessThanOrEqual(1)
    expect(by.get(ids[0])!.y).toBeLessThan(by.get(ids[1])!.y)
    expect(by.get(ids[4])!.x).toBeGreaterThan(by.get(ids[3])!.x + by.get(ids[3])!.w)
  })

  it('runs the chain left to right in LR, branches below', () => {
    const tree = sample()
    const l = layoutFlow(tree, { direction: 'LR' })
    const ids = tree[0].children.map((c) => c.id)
    const a = l.byId.get(ids[0])!
    const b = l.byId.get(ids[1])!
    expect(b.x).toBeGreaterThan(a.x + a.w)
    expect(Math.abs(b.y + b.h / 2 - (a.y + a.h / 2))).toBeLessThanOrEqual(1)
    expect(l.byId.get(ids[4])!.y).toBeGreaterThan(l.byId.get(ids[3])!.y + l.byId.get(ids[3])!.h)
  })

  it('labels a branch’s edge with its condition, and its own name if it has none', () => {
    const tree = sample()
    const l = layoutFlow(tree)
    const into = (id: string) => l.edges.find((e) => e.to === id)
    expect(into(tree[0].children[4].id)?.label?.text).toBe('The caller can’t make either slot')
    expect(into(tree[0].children[3].id)?.label).toBeNull()
    const bare = node('intent', 'X', [step('a'), node('branch', 'Other way', [step('b')], { condition: '' })])
    expect(layoutFlow([bare]).edges.find((e) => e.to === bare.children[1].id)?.label?.text).toBe('Other way')
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
    // 6 children, 2 inside the branch.
    expect(intent.hiddenCount).toBe(8)
    expect(folded.edges.some((e) => e.from === tree[0].id)).toBe(false)
    expect(folded.nodes.length).toBe(open.nodes.length - 8)
    expect(folded.height).toBeLessThan(open.height)
    expectClear(folded)
    // A node with nothing in it can't be collapsed.
    const leaf = tree[2].children[0]
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

  it('makes marked nodes taller and long text wider, to a limit', () => {
    const tree = [node('intent', 'A', [step('Short'), step('A very long step name that has to wrap across more than one line for sure')])]
    const plain = layoutFlow(tree)
    const marked = layoutFlow(tree, { marked: new Set([tree[0].children[0].id]) })
    expect(marked.byId.get(tree[0].children[0].id)!.h).toBeGreaterThan(plain.byId.get(tree[0].children[0].id)!.h)
    const long = plain.byId.get(tree[0].children[1].id)!
    expect(long.lines.length).toBeGreaterThan(1)
    expect(long.w).toBeLessThanOrEqual(190 + 28)
    expect(long.h).toBeGreaterThan(plain.byId.get(tree[0].children[0].id)!.h)
  })

  it('gives each node its keyboard neighbours and tree position', () => {
    const tree = sample()
    const l = layoutFlow(tree)
    const [book] = tree
    const ids = book.children.map((c) => c.id)
    const offer = l.byId.get(ids[3])!
    // Next along the chain, the step before, and the alternatives from the same fork.
    expect(offer.nav.next).toBe(ids[5])
    expect(offer.nav.prev).toBe(ids[2])
    const fork = l.byId.get(ids[5])!
    expect(fork.nav.prev).toBe(ids[3])
    expect(fork.nav.lane).toEqual([ids[5], ids[4]])
    expect(l.byId.get(book.id)!.nav.lane).toEqual(tree.map((t) => t.id))
    expect(offer).toMatchObject({ depth: 1, posInSet: 4, setSize: 6, parentId: book.id })
    expect(l.nodes.map((x) => x.order)).toEqual(l.nodes.map((_, i) => i))
  })

  it('chains the top-level nodes when asked, for a detected sequence', () => {
    const steps = ['a', 'b', 'c'].map(step)
    const l = layoutFlow(steps, { sequence: true })
    expect(l.edges.map((e) => [e.from, e.to])).toEqual([[steps[0].id, steps[1].id], [steps[1].id, steps[2].id]])
    expectClear(l)
    expect(l.byId.get(steps[1].id)!.nav.prev).toBe(steps[0].id)
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
    const tree = sample()
    const branchStep = tree[0].children[4].children[1]
    expect(ancestorIds(tree, branchStep.id)).toEqual([tree[0].id, tree[0].children[4].id])
    expect(ancestorIds(tree, tree[0].id)).toEqual([])
    expect(foldable(tree)).toContain(tree[0].children[4].id)
    expect(foldable(tree)).not.toContain(tree[0].children[0].id)
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
    const tree = sample()
    const [book, resched, cancel] = tree
    const cmp = compareSteps(['Ask for the doctor or department', 'Offer two slots', 'Confirm the booking', 'Check insurance'], tree)
    expect(cmp.rootId).toBe(book.id)
    expect(cmp.matches.map((m) => [m.index, m.nodeId])).toEqual([
      [0, book.children[0].id],
      [1, book.children[3].id],
      [2, book.children[5].id],
    ])
    expect(cmp.unmatched).toEqual([{ index: 3, step: 'Check insurance' }])
    expect(cmp.matchedIds).toEqual([book.children[0].id, book.children[3].id, book.children[5].id])
    expect(cmp.coverage).toBe(0.75)
    expect(resched).toBeTruthy()
    expect(cancel).toBeTruthy()
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
    expect(mixed.unmatched).toEqual([{ index: 2, step: 'Confirm the cancellation', elsewhereId: cancel.children[1].id }])
  })

  it('handles nothing matching, and nothing to match', () => {
    const tree = sample()
    expect(compareSteps(['Sing a song'], tree)).toMatchObject({ rootId: null, matches: [], matchedIds: [], coverage: 0 })
    expect(compareSteps([], tree).coverage).toBe(1)
    expect(compareSteps(['x'], []).unmatched).toEqual([{ index: 0, step: 'x' }])
  })

  it('puts each match’s intent and branch in front of it for a highlighted path', () => {
    const tree = sample()
    const [book] = tree
    const inBranch = book.children[4].children[0]
    expect(completePath(tree, [book.children[3].id, inBranch.id, 'gone'])).toEqual([book.id, book.children[3].id, book.children[4].id, inBranch.id])
  })
})
