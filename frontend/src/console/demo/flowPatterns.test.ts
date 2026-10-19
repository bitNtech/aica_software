import { describe, expect, it } from 'vitest'
import { detectFlowPatterns } from './flowPatterns'
import type { FlowNode } from '../types'

const node = (label: string, children: FlowNode[] = []): FlowNode => ({ id: label, kind: 'step', label, sourceCallIds: [], children })

const knownFlow: FlowNode[] = [node('Ask for the department', [node('Offer two slots', [node('Confirm the booking')])])]

const now = '2026-10-18T00:00:00.000Z'

describe('detectFlowPatterns', () => {
  it('returns nothing when all calls match a known flow sequence', () => {
    const calls = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, path: ['Ask for the department', 'Offer two slots', 'Confirm the booking'] }))
    const out = detectFlowPatterns({ agentId: 'agt_1', agentName: 'Reception', calls, knownFlow, windowSize: 5, now })
    expect(out).toEqual([])
  })

  it('flags a sequence shared by at least 2 of the last N calls that is not in the flow', () => {
    const calls = [
      { id: 'c0', path: ['Ask for the department', 'Transfer to billing'] },
      { id: 'c1', path: ['Ask for the department', 'Transfer to billing'] },
      { id: 'c2', path: ['Ask for the department', 'Offer two slots', 'Confirm the booking'] },
    ]
    const out = detectFlowPatterns({ agentId: 'agt_1', agentName: 'Reception', calls, knownFlow, windowSize: 3, now })
    expect(out).toHaveLength(1)
    expect(out[0].steps).toEqual(['Ask for the department', 'Transfer to billing'])
    expect(out[0].occurrences).toBe(2)
    expect(out[0].callIds).toEqual(['c0', 'c1'])
    expect(out[0].summary).toContain('2 of the last 3 calls')
  })

  it('ignores calls outside the window', () => {
    const calls = [
      { id: 'c0', path: ['Ask for the department', 'Offer two slots', 'Confirm the booking'] },
      { id: 'c1', path: ['Ask for the department', 'Transfer to billing'] },
      { id: 'c2', path: ['Ask for the department', 'Transfer to billing'] },
    ]
    const out = detectFlowPatterns({ agentId: 'agt_1', agentName: 'Reception', calls, knownFlow, windowSize: 2, now })
    expect(out).toEqual([])
  })
})
