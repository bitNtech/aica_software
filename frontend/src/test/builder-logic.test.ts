import { describe, expect, it } from 'vitest'
import { defaultPipeline } from '../console/demo/agentConfig'
import { defaultGlobalFlows } from '../console/demo/extraction'
import type { AgentDraft, FlowNode } from '../console/types'
import { addNode, canRemoveOnly, checkFlow, confidenceLabel, countForks, countPaths, lowConfidence, mergeIntents, moveNode, neighbour, normaliseFlow, position, removeNode, removeOnly } from '../pages/console/builder/flowTree'
import { SIM_START, simulate } from '../pages/console/builder/simulate'
import { checkContext } from '../pages/console/builder/steps/StepContext'
import { seedTools } from '../console/demo/library'
import { defaultBehaviour } from '../console/demo/templates'

const node = (id: string, kind: FlowNode['kind'], children: FlowNode[] = [], extra: Partial<FlowNode> = {}): FlowNode => ({
  id,
  kind,
  label: id,
  say: kind === 'step' ? `say ${id}` : undefined,
  condition: kind === 'branch' ? `when ${id}` : undefined,
  sourceCallIds: [],
  children,
  ...extra,
})

/** Intent a forks: two branches, then a plain step. */
const tree = (): FlowNode[] => [
  node('a', 'intent', [node('a1', 'branch', [node('a1s', 'step')]), node('a2', 'branch', [node('a2s', 'step')]), node('a3', 'step')]),
  node('b', 'intent', [node('b1', 'step')], { confidence: 0.9 }),
  node('c', 'intent', [node('c1', 'step', [], { confidence: 0.6 })], { confidence: 0.75 }),
]

describe('flow tree edits', () => {
  it('moves branches among the ways out of a fork, and stops at the edges and at the plain step', () => {
    const t = tree()
    expect(moveNode(t, 'a', -1).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(moveNode(t, 'c', 1).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(moveNode(t, 'a2', -1)[0].children.map((n) => n.id)).toEqual(['a2', 'a1', 'a3'])
    // The plain step stays last: a branch can't pass it, and it can't move.
    expect(moveNode(t, 'a2', 1)[0].children.map((n) => n.id)).toEqual(['a1', 'a2', 'a3'])
    expect(moveNode(t, 'a3', -1)[0].children.map((n) => n.id)).toEqual(['a1', 'a2', 'a3'])
    expect(position(t, 'a1')).toEqual({ first: true, last: false })
    expect(position(t, 'a2')).toEqual({ first: false, last: true })
    expect(position(t, 'a3')).toEqual({ first: true, last: true })
    expect(t.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('adds a branch to the fork before the plain step, and a step in between so nothing is lost', () => {
    const withBranch = addNode(tree(), 'a', node('nb', 'branch'))
    expect(withBranch[0].children.map((n) => n.id)).toEqual(['a1', 'a2', 'nb', 'a3'])
    const withStep = addNode(tree(), 'a', node('ns', 'step'))
    expect(withStep[0].children.map((n) => n.id)).toEqual(['a1', 'a2', 'ns'])
    expect(withStep[0].children[2].children.map((n) => n.id)).toEqual(['a3'])
    // After a leaf, a step simply follows.
    expect(addNode(tree(), 'a1s', node('x', 'step'))[0].children[0].children[0].children.map((n) => n.id)).toEqual(['x'])
  })

  it('deletes a step on its own, what followed it moving up; or with everything after it', () => {
    const t = [node('i', 'intent', [node('s1', 'step', [node('br', 'branch', [node('bs', 'step')]), node('s2', 'step')])])]
    expect(canRemoveOnly(t, 's1')).toBe(true)
    expect(removeOnly(t, 's1')[0].children.map((n) => n.id)).toEqual(['br', 's2'])
    expect(removeNode(t, 's1')[0].children).toEqual([])
    // A branch whose plain step would clash with the fork's own can't go alone.
    expect(canRemoveOnly(t, 'br')).toBe(false)
    expect(canRemoveOnly(t, 'i')).toBe(false)
    expect(canRemoveOnly(t, 'bs')).toBe(false)
  })

  it('merges into an intent: its ways on join the fork, its plain path as a branch when both have one', () => {
    const merged = mergeIntents(tree(), 'b', 'a')
    expect(merged.map((n) => n.id)).toEqual(['a', 'c'])
    const kids = merged[0].children
    expect(kids.map((n) => n.kind)).toEqual(['branch', 'branch', 'branch', 'step'])
    expect(kids[2]).toMatchObject({ label: 'b', condition: 'The caller wants to b' })
    expect(kids[2].children.map((n) => n.id)).toEqual(['b1'])
    expect(kids[3].id).toBe('a3')
    expect(mergeIntents(tree(), 'b', 'missing').map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('turns an older flow, whose steps were siblings, into the branching shape, and leaves a branching one alone', () => {
    const old = [node('i', 'intent', [node('s1', 'step'), node('s2', 'step'), node('br', 'branch', [node('x1', 'step'), node('x2', 'step')]), node('s3', 'step')])]
    const now = normaliseFlow(old)
    const s1 = now[0].children
    expect(s1.map((n) => n.id)).toEqual(['s1'])
    expect(s1[0].children.map((n) => n.id)).toEqual(['s2'])
    // The branch forks off the step before it; the path carries on past it.
    expect(s1[0].children[0].children.map((n) => n.id)).toEqual(['br', 's3'])
    expect(s1[0].children[0].children[0].children[0].children.map((n) => n.id)).toEqual(['x2'])
    expect(normaliseFlow(now)).toEqual(now)
    expect(normaliseFlow(tree())).toEqual(tree())
  })

  it('counts forks and the ways a call can end', () => {
    expect(countForks(tree())).toBe(1)
    expect(countPaths(tree())).toBe(5)
  })

  it('removes at any depth, and finds where focus should go next', () => {
    expect(removeNode(tree(), 'a2')[0].children.map((n) => n.id)).toEqual(['a1', 'a3'])
    expect(neighbour(tree(), 'a')).toBe('b')
    expect(neighbour(tree(), 'b')).toBe('a')
    expect(neighbour(tree(), 'b1')).toBe('b')
    expect(neighbour([node('only', 'intent')], 'only')).toBeNull()
  })

  it('flags low confidence at any depth, below 70%', () => {
    expect(lowConfidence(tree()).map((n) => n.id)).toEqual(['c1'])
    expect(confidenceLabel(0.65).level).toBe('low')
    expect(confidenceLabel(0.72).level).toBe('medium')
    expect(confidenceLabel(0.8).level).toBe('high')
  })

  it('checks names, steps, lines and conditions, and that a fork says which way to go', () => {
    const e = checkFlow([node('x', 'intent'), node('y', 'intent', [node('br', 'branch'), node('s', 'step', [], { say: ' ' })])])
    expect(e.x).toMatch(/no steps/)
    expect(e.s).toMatch(/doesn’t say what the agent says/)
    expect(e.br).toMatch(/has no steps/)
    const two = checkFlow([node('z', 'intent', [node('p', 'step'), node('q', 'step')])])
    expect(two.z).toMatch(/several steps follow/i)
  })
})

describe('checkContext', () => {
  const tools = seedTools()
  const transfer = tools.find((t) => t.builtin === 'transfer')!
  const context = { knowledgeSourceIds: [], answerOnlyFromKnowledge: false, topK: 4, minScore: 0.6, toolIds: [], confirmBeforeActions: true }

  it('needs the transfer tool for emergencies even with handing over off', () => {
    const globals = defaultGlobalFlows().map((g) => (g.kind === 'handoff' ? { ...g, enabled: false } : g))
    expect(checkContext(context, globals, tools).tools).toMatch(/is needed/)
    expect(checkContext({ ...context, toolIds: [transfer.id] }, globals, tools).tools).toBeUndefined()
  })

  it('says so when the transfer tool is switched off for the organisation', () => {
    const off = tools.map((t) => (t.id === transfer.id ? { ...t, enabled: false } : t))
    expect(checkContext(context, defaultGlobalFlows(), off).tools).toMatch(/switched off/)
  })
})

describe('simulate', () => {
  const draft = (flow: FlowNode[]): AgentDraft => ({
    id: 'd',
    reached: 'review',
    sourceCallIds: [],
    consent: true,
    redact: true,
    typeId: 'hospital',
    subTypeId: 'appointments',
    name: 'Test',
    behaviour: defaultBehaviour('Test hospital'),
    flow,
    attributes: [],
    globalFlows: defaultGlobalFlows(),
    context: { knowledgeSourceIds: [], answerOnlyFromKnowledge: false, topK: 4, minScore: 0.6, toolIds: [], confirmBeforeActions: true },
    pipeline: defaultPipeline(),
    updatedAt: '',
  })
  const run = (flow: FlowNode[], message: string) => simulate(draft(flow), [], [], SIM_START, message).reply

  it('falls back to out of scope with no flow', () => {
    expect(run([], 'book an appointment').global).toBe('out_of_scope')
  })

  it('copes with an intent that has no steps', () => {
    const r = run([node('Book appointment', 'intent')], 'I want to book')
    expect(r.text).toBe('Sure.')
    expect(r.path).toEqual(['Book appointment'])
  })

  it('walks down the tree, taking the branch whose condition the caller’s words match, else the plain step', () => {
    const flow = [
      node('Book appointment', 'intent', [
        node('ask', 'step', [
          node('away', 'branch', [node('other', 'step')], { condition: 'the doctor is on leave' }),
          node('slots', 'step', [node('done', 'step')]),
        ]),
      ]),
    ]
    let out = simulate(draft(flow), [], [], SIM_START, 'book appointment')
    expect(out.reply.text).toBe('say ask')
    const at = out.state
    out = simulate(draft(flow), [], [], at, 'tomorrow is fine')
    expect(out.reply.text).toBe('say slots')
    out = simulate(draft(flow), [], [], out.state, 'yes')
    expect(out.reply.text).toBe('say done')
    // At the end of the path it says the last step again.
    expect(simulate(draft(flow), [], [], out.state, 'ok').reply.text).toBe('say done')
    const leave = simulate(draft(flow), [], [], at, 'the doctor is on leave that day?')
    expect(leave.reply.text).toBe('say other')
    expect(leave.reply.path).toEqual(['Book appointment', 'away', 'other'])
  })

  it('treats “thank you, can I book…” as a request, not a goodbye', () => {
    const flow = [node('Book appointment', 'intent', [node('ask', 'step')])]
    expect(run(flow, 'Thank you, can I book an appointment?').global).toBeUndefined()
    expect(run(flow, 'Thank you').global).toBe('end_call')
    expect(run(flow, 'sorry?').global).toBe('repeat')
  })
})
