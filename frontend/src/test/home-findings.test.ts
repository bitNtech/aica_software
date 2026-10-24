import { describe, expect, it } from 'vitest'
import { findings, MIN_CALLS, SECTION, topicGap } from '../pages/console/home/findings'
import { makeReport, NO_QUALITY } from './homeFixtures'

const PREV = 'the 7 days before'
const ids = (r = makeReport()) => findings(r, { previous: PREV }).map((f) => f.id)

describe('findings', () => {
  it('says nothing for a period with no calls, or too few to mean anything', () => {
    expect(findings(makeReport({ totals: { calls: 0, byAgent: 0, handedOver: 0, dropped: 0, avgDurationSec: 0 }, intents: [], agents: [], byHour: Array(24).fill(0) }), { previous: PREV })).toEqual([])
    const few = makeReport({ totals: { calls: MIN_CALLS - 1, byAgent: 20, handedOver: 5, dropped: 4, avgDurationSec: 60 } })
    expect(findings(few, { previous: PREV })).toEqual([])
  })

  it('finds what changed in a busy period, each with its number and the card that holds the evidence', () => {
    const found = findings(makeReport(), { previous: PREV })
    expect(found.map((f) => f.id)).toEqual(['topic-gap', 'answered', 'agent-low', 'slow-stage', 'busiest-hour'])
    const by = Object.fromEntries(found.map((f) => [f.id, f]))
    // 40% of billing calls answered against 70% overall: 30 points below.
    expect(by['topic-gap'].text).toContain('“Billing question”')
    expect(by['topic-gap'].text).toContain('40%')
    expect(by['topic-gap'].text).toContain('30 points below the 70%')
    expect(by['topic-gap'].evidence).toBe(SECTION.topics)
    // 70% now against 78% before.
    expect(by.answered.text).toBe('The agents answered 70% of calls on their own, 8 points lower than the 7 days before (78%).')
    expect(by.answered.tone).toBe('warn')
    // 75% against 63%.
    expect(by['agent-low'].text).toContain('Appointments answered 63% of its 40 calls')
    expect(by['agent-low'].text).toContain('12 points below Reception (75%)')
    expect(by['slow-stage'].text).toContain('working out the reply: 800 ms of about 1,450 ms (55%)')
    expect(by['busiest-hour'].text).toBe('The busiest hour was 10 am–11 am: 18 calls, 18% of the period’s calls.')
    expect(found.every((f) => f.evidence && f.evidenceLabel)).toBe(true)
  })

  it('names a topic only when it has enough calls and is far enough below the average', () => {
    const small = makeReport({ intents: [{ label: 'Rare', calls: 9, byAgent: 0 }] })
    expect(ids(small)).not.toContain('topic-gap')
    // Overall is 70%: 60% is 10 below (counts), 61% is 9 below (does not).
    const edge = (byAgent: number) => makeReport({ intents: [{ label: 'Edge', calls: 100, byAgent }] })
    expect(ids(edge(60))).toContain('topic-gap')
    expect(ids(edge(61))).not.toContain('topic-gap')
  })

  it('only compares with the period before when that had enough calls too', () => {
    const r = makeReport({ previous: { calls: MIN_CALLS - 1, byAgent: 28, handedOver: 1, dropped: 0, avgDurationSec: 70 } })
    const found = ids(r)
    expect(found).not.toContain('answered')
    expect(found).not.toContain('hangups')
  })

  it('reports hang-ups by their share of calls, either way', () => {
    const worse = findings(makeReport({ totals: { calls: 100, byAgent: 70, handedOver: 10, dropped: 20, avgDurationSec: 95 } }), { previous: PREV }).find((f) => f.id === 'hangups')
    expect(worse?.text).toBe('Callers hung up on 20% of calls, 11 points higher than the 7 days before (9%).')
    expect(worse?.tone).toBe('warn')
    const better = findings(makeReport({ totals: { calls: 100, byAgent: 80, handedOver: 15, dropped: 5, avgDurationSec: 95 } }), { previous: PREV }).find((f) => f.id === 'hangups')
    expect(better?.text).toContain('5% of calls, 4 points lower')
    expect(better?.tone).toBe('good')
    // 10% against 9%: not enough of a move.
    expect(ids()).not.toContain('hangups')
  })

  it('compares agents only when there are two with enough calls', () => {
    expect(ids(makeReport({ agents: [{ agentId: 'ag_1', name: 'Reception', calls: 100, byAgent: 70, success: null, replyP50Ms: null }] }))).not.toContain('agent-low')
    const oneBusy = makeReport({
      agents: [
        { agentId: 'ag_1', name: 'Reception', calls: 90, byAgent: 80, success: null, replyP50Ms: null },
        { agentId: 'ag_2', name: 'Night line', calls: 10, byAgent: 1, success: null, replyP50Ms: null },
      ],
    })
    expect(ids(oneBusy)).not.toContain('agent-low')
    const close = makeReport({
      agents: [
        { agentId: 'ag_1', name: 'Reception', calls: 50, byAgent: 36, success: null, replyP50Ms: null },
        { agentId: 'ag_2', name: 'Appointments', calls: 50, byAgent: 34, success: null, replyP50Ms: null },
      ],
    })
    expect(ids(close)).not.toContain('agent-low')
  })

  it('skips the reply stage until all three are measured, and when none stands out', () => {
    expect(ids(makeReport({ quality: NO_QUALITY }))).not.toContain('slow-stage')
    const partial = makeReport({ quality: { ...makeReport().quality, voiceMs: null } })
    expect(ids(partial)).not.toContain('slow-stage')
    const even = makeReport({ quality: { ...makeReport().quality, speechMs: 400, languageMs: 450, voiceMs: 400 } })
    expect(ids(even)).not.toContain('slow-stage')
  })

  it('names the busiest hour only when it is a real peak', () => {
    const flat = Array.from({ length: 24 }, (_, h) => (h < 20 ? 5 : 0))
    expect(ids(makeReport({ byHour: flat }))).not.toContain('busiest-hour')
    const tiny = Array.from({ length: 24 }, () => 0)
    tiny[3] = 4
    expect(ids(makeReport({ byHour: tiny }))).not.toContain('busiest-hour')
  })
})

describe('topicGap', () => {
  it('is the points a topic’s answered share is above or below the overall share', () => {
    expect(topicGap({ calls: 25, byAgent: 10 }, 70)).toBe(-30)
    expect(topicGap({ calls: 40, byAgent: 36 }, 70)).toBe(20)
    expect(topicGap({ calls: 10, byAgent: 7 }, 70)).toBe(0)
  })
  it('is null without an overall figure or with too few calls', () => {
    expect(topicGap({ calls: 25, byAgent: 10 }, null)).toBeNull()
    expect(topicGap({ calls: 4, byAgent: 0 }, 70)).toBeNull()
  })
})
