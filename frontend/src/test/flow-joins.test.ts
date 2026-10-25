import { describe, expect, it } from 'vitest'
import { defaultPipeline } from '../console/demo/agentConfig'
import { defaultGlobalFlows } from '../console/demo/extraction'
import { defaultBehaviour } from '../console/demo/templates'
import { joinOptions, joinProblems, numberFlow, tidyJoins } from '../console/flowGraph'
import { flowOutline } from '../console/flowRequest'
import type { AgentDraft, FlowNode } from '../console/types'
import { compareSteps, completePath, graftPattern } from '../components/console/flow/compare'
import { layoutFlow } from '../components/console/flow/layout'
import { addNode, blankNode, checkFlow, countForks, countPaths, findNode, removeNode, removeOnly } from '../pages/console/builder/flowTree'
import { SIM_START, simulate } from '../pages/console/builder/simulate'

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

/**
 * The shape of a feedback survey: "ask" forks three ways, each branch has
 * its own question, and all three carry on at "rate" (the fork's plain
 * step), which forks again and ends.
 *
 *            ask (1)
 *     ┌────────┼────────┬──────────┐
 *   happy    meh      upset    (otherwise)
 *    1a       1b       1c          │
 *     └────────┴────────┴──→ rate (2)
 *                         ┌───┴───┐
 *                        good    poor
 */
function survey(): FlowNode[] {
  const rate = node('rate', 'step', [node('good', 'branch', [node('praise', 'step')]), node('poor', 'branch', [node('fix', 'step')])])
  const branch = (id: string) => node(id, 'branch', [node(`${id}-q`, 'step', [], { joinsAt: 'rate' })])
  return [node('Feedback', 'intent', [node('ask', 'step', [branch('happy'), branch('meh'), node('upset', 'branch', [], { joinsAt: 'rate' }), rate])])]
}

describe('reading joins', () => {
  it('numbers the cards: steps along a line, the ways out of a fork lettered after it', () => {
    const n = numberFlow(survey())
    expect(['ask', 'happy', 'happy-q', 'meh', 'upset', 'rate', 'good', 'praise', 'poor'].map((id) => n.get(id))).toEqual(['1', '1a', '1a.1', '1b', '1c', '2', '2a', '2a.1', '2b'])
    expect(n.has('Feedback')).toBe(false)
  })

  it('offers only steps of the same intent that don’t lead back to the node', () => {
    const flow = [...survey(), node('Other', 'intent', [node('o1', 'step')])]
    const ids = joinOptions(flow, 'happy-q').map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining(['rate', 'praise', 'fix', 'meh-q']))
    // Not itself, nor "ask" (it leads back here), nor another intent's step.
    expect(ids).not.toContain('happy-q')
    expect(ids).not.toContain('ask')
    expect(ids).not.toContain('o1')
    // A node with a plain step of its own already carries on.
    expect(joinOptions(flow, 'ask')).toEqual([])
  })

  it('reports joins that can’t be followed, or go round in a circle', () => {
    const flow = survey()
    expect(joinProblems(flow)).toEqual({})
    const loop = [node('I', 'intent', [node('s1', 'step', [node('s2', 'step', [], { joinsAt: 's1' })])])]
    expect(joinProblems(loop).s2).toMatch(/never end/)
    const gone = [node('I', 'intent', [node('s1', 'step', [], { joinsAt: 'nowhere' })])]
    expect(joinProblems(gone).s1).toMatch(/isn’t in this conversation/)
    const both = [node('I', 'intent', [node('s1', 'step', [node('s2', 'step')], { joinsAt: 's2' })])]
    expect(joinProblems(both).s1).toMatch(/keep one of them/i)
    expect(checkFlow(loop).s2).toMatch(/never end/)
  })

  it('counts a join as a way on, not an end', () => {
    // Ends: praise and fix. Forks: ask (four ways) and rate (two).
    expect(countPaths(survey())).toBe(2)
    expect(countForks(survey())).toBe(2)
  })

  it('lets a branch with no steps of its own carry on where it joins', () => {
    expect(checkFlow(survey())).toEqual({})
  })
})

describe('editing with joins', () => {
  it('ends joins at a step that is deleted', () => {
    const flow = removeNode(survey(), 'rate')
    expect(findNode(flow, 'happy-q')!.joinsAt).toBeUndefined()
    expect(findNode(flow, 'upset')!.joinsAt).toBeUndefined()
  })

  it('sends joins on to what followed a step deleted on its own', () => {
    const flow = [node('I', 'intent', [node('s1', 'step', [node('b', 'branch', [], { joinsAt: 's3' }), node('s3', 'step', [node('s4', 'step')])])])]
    const out = removeOnly(flow, 's3')
    expect(findNode(out, 'b')!.joinsAt).toBe('s4')
  })

  it('hands a join on to a step added after the node', () => {
    const flow = addNode(survey(), 'happy-q', { ...blankNode('step'), id: 'thanks' })
    expect(findNode(flow, 'happy-q')!.joinsAt).toBeUndefined()
    expect(findNode(flow, 'thanks')!.joinsAt).toBe('rate')
  })

  it('tidies joins whose step is gone, and moves them on', () => {
    const flow = tidyJoins(survey(), new Map([['rate', 'ask']]))
    expect(findNode(flow, 'upset')!.joinsAt).toBe('ask')
  })
})

describe('following joins', () => {
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

  it('carries a simulated call on where its branch joins', () => {
    const flow = survey()
    let out = simulate(draft(flow), [], [], SIM_START, 'feedback')
    expect(out.reply.text).toBe('say ask')
    // "upset" has no steps of its own: straight on to "rate".
    out = simulate(draft(flow), [], [], out.state, 'when upset')
    expect(out.reply.text).toBe('say rate')
    expect(out.reply.path).toEqual(['Feedback', 'upset', 'rate'])
    out = simulate(draft(flow), [], [], { intentId: 'Feedback', at: 'happy-q' }, 'fine')
    expect(out.reply.text).toBe('say rate')
  })

  it('writes the join into the request outline', () => {
    const text = flowOutline(survey()).join('\n')
    expect(text).toContain('- Branch: happy (when when happy)')
    expect(text).toMatch(/1\. Step: happy-q\n\s+The agent says: “say happy-q”\n\s+Then carries on at: rate/)
    expect(text).toMatch(/- Branch: upset \(when when upset\)\n\s+Then carries on at: rate/)
  })

  it('matches a call that went down a branch and back up, and highlights the way it went', () => {
    const flow = survey()
    const cmp = compareSteps(['ask', 'happy-q', 'rate', 'praise'], flow)
    expect(cmp.matchedIds).toEqual(['ask', 'happy-q', 'rate', 'praise'])
    expect(completePath(flow, cmp.matchedIds)).toEqual(['Feedback', 'ask', 'happy', 'happy-q', 'rate', 'good', 'praise'])
    const g = graftPattern(['Feedback', 'ask', 'happy-q', 'rate', 'Something new'], flow, '2 calls')
    expect(g.stepIds).toEqual(['Feedback', 'ask', 'happy-q', 'rate', 'detected-4'])
  })
})

describe('drawing joins', () => {
  const PAD = 4
  it.each(['TB', 'LR'] as const)('draws the joined step once, below every branch, centred under them (%s)', (direction) => {
    const l = layoutFlow(survey(), { direction })
    const tb = direction === 'TB'
    expect(l.nodes.filter((x) => x.id === 'rate')).toHaveLength(1)
    const box = (id: string) => l.byId.get(id)!
    const along = (id: string) => (tb ? box(id).y : box(id).x)
    const end = (id: string) => (tb ? box(id).y + box(id).h : box(id).x + box(id).w)
    const centre = (id: string) => (tb ? box(id).x + box(id).w / 2 : box(id).y + box(id).h / 2)
    for (const id of ['happy-q', 'meh-q', 'upset']) expect(along('rate')).toBeGreaterThan(end(id))
    expect(centre('rate')).toBeGreaterThan(centre('happy'))
    expect(centre('rate')).toBeLessThan(centre('upset') + PAD)
    // The lines: three joins, the plain way out of "ask" marked Otherwise.
    const edge = (from: string, to: string) => l.edges.find((e) => e.from === from && e.to === to)
    expect(edge('happy-q', 'rate')).toMatchObject({ kind: 'join', label: null })
    expect(edge('upset', 'rate')).toMatchObject({ kind: 'join', label: null })
    expect(edge('ask', 'rate')).toMatchObject({ kind: 'next', label: expect.objectContaining({ text: 'Otherwise' }) })
    expect(edge('ask', 'happy')!.label!.text).toBe('when happy')
    // Cards say where they carry on, and where the call ends.
    expect(box('happy-q').foot).toBe('Carries on at 2')
    expect(box('praise').foot).toBe('Ends the call')
    expect(box('rate').foot).toBeNull()
    // Nothing overlaps, and no line runs through a card.
    const boxes = [...l.nodes, ...l.edges.filter((e) => e.label).map((e) => e.label!)]
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]]
        expect(a.x < b.x + b.w + PAD && b.x < a.x + a.w + PAD && a.y < b.y + b.h + PAD && b.y < a.y + a.h + PAD).toBe(false)
      }
  })

  it('leaves out a join into something folded away, and one that goes round in a circle', () => {
    const folded = layoutFlow(survey(), { collapsed: new Set(['happy']) })
    expect(folded.edges.some((e) => e.from === 'happy-q')).toBe(false)
    const loop = [node('I', 'intent', [node('s1', 'step', [node('s2', 'step', [], { joinsAt: 's1' })])])]
    const l = layoutFlow(loop)
    expect(l.edges.map((e) => e.id)).toEqual(['I>s1', 's1>s2'])
    expect(l.byId.get('s2')!.joins).toBeNull()
  })
})
