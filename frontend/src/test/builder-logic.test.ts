import { describe, expect, it } from 'vitest'
import { defaultGlobalFlows } from '../console/demo/extraction'
import type { AgentDraft, FlowNode } from '../console/types'
import { checkFlow, confidenceLabel, lowConfidence, mergeIntents, moveNode, neighbour, position, removeNode } from '../pages/console/builder/flowTree'
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

const tree = (): FlowNode[] => [
  node('a', 'intent', [node('a1', 'step'), node('a2', 'step')]),
  node('b', 'intent', [node('b1', 'step')], { confidence: 0.9 }),
  node('c', 'intent', [node('c1', 'step', [], { confidence: 0.6 })], { confidence: 0.75 }),
]

describe('flow tree edits', () => {
  it('moves within siblings and stops at the edges', () => {
    const t = tree()
    expect(moveNode(t, 'a', -1).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(moveNode(t, 'c', 1).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(moveNode(t, 'a2', -1)[0].children.map((n) => n.id)).toEqual(['a2', 'a1'])
    expect(position(t, 'a1')).toEqual({ first: true, last: false })
    expect(t.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('merges into an intent, and leaves the tree alone when the target is gone', () => {
    const merged = mergeIntents(tree(), 'b', 'a')
    expect(merged.map((n) => n.id)).toEqual(['a', 'c'])
    expect(merged[0].children.map((n) => n.id)).toEqual(['a1', 'a2', 'b1'])
    expect(mergeIntents(tree(), 'b', 'missing').map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('removes at any depth, and finds where focus should go next', () => {
    expect(removeNode(tree(), 'a2')[0].children.map((n) => n.id)).toEqual(['a1'])
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

  it('checks names, steps, lines and conditions', () => {
    const e = checkFlow([node('x', 'intent'), node('y', 'intent', [node('s', 'step', [], { say: ' ' }), node('br', 'branch')])])
    expect(e.x).toMatch(/no steps/)
    expect(e.s).toMatch(/doesn’t say what the agent says/)
    expect(e.br).toMatch(/has no steps/)
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

  it('follows only the first branch', () => {
    const flow = [node('Book appointment', 'intent', [node('first', 'branch', [node('f1', 'step')]), node('second', 'branch', [node('s1', 'step')])])]
    let state = SIM_START
    const said: string[] = []
    for (let i = 0; i < 3; i++) {
      const out = simulate(draft(flow), [], [], state, 'book appointment')
      said.push(out.reply.text)
      state = out.state
    }
    expect(said).not.toContain('say s1')
  })

  it('treats “thank you, can I book…” as a request, not a goodbye', () => {
    const flow = [node('Book appointment', 'intent', [node('ask', 'step')])]
    expect(run(flow, 'Thank you, can I book an appointment?').global).toBeUndefined()
    expect(run(flow, 'Thank you').global).toBe('end_call')
    expect(run(flow, 'sorry?').global).toBe('repeat')
  })
})
