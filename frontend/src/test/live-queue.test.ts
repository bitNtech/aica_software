import { describe, expect, it } from 'vitest'
import type { Handoff, LiveCall } from '../console/types'
import { buildQueue, factsOf, filterOptions, filterQueue, newArrivals, NO_FILTER, RECENT_MS, summarize, trackEnded, type GoneCall } from '../pages/console/operate/live/queue'

/**
 * The ordering behind Live calls: emergencies, then people waiting for a
 * person (longest first), then calls that sound upset, then the others in
 * progress, then "Recently". Times are fixed, so nothing depends on the clock.
 */
const NOW = Date.parse('2026-10-24T10:00:00Z')
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString()

function call(id: string, over: Partial<LiveCall> = {}): LiveCall {
  return {
    id,
    agentId: 'agt_reception',
    agentName: 'Main reception',
    line: '+91 00000 01200',
    callerPhone: '+91 ••••• 21877',
    startedAt: at(120),
    language: 'english',
    intent: null,
    step: null,
    turns: [],
    flagged: false,
    takenBy: null,
    whispers: [],
    ...over,
  }
}

function handoff(id: string, callId: string, over: Partial<Handoff> = {}): Handoff {
  return {
    id,
    callId,
    agentName: 'Main reception',
    line: '+91 00000 01200',
    callerPhone: '+91 ••••• 21877',
    reason: 'The caller asked for a person.',
    summary: 'Summary.',
    details: [],
    language: 'english',
    waitingSince: at(60),
    status: 'waiting',
    takenBy: null,
    takenAt: null,
    emergency: false,
    ...over,
  }
}

const keys = (items: { key: string }[]) => items.map((i) => i.key)

describe('queue order', () => {
  it('puts emergencies first, then the longest waiting, then upset callers, then the rest', () => {
    const calls = [
      call('plain-old', { startedAt: at(600) }),
      call('plain-new', { startedAt: at(30) }),
      call('upset', { flagged: true, startedAt: at(200) }),
      call('w-short', { startedAt: at(100) }),
      call('w-long', { startedAt: at(400) }),
      call('emergency', { startedAt: at(90) }),
    ]
    const handoffs = [
      handoff('h1', 'w-short', { waitingSince: at(40) }),
      handoff('h2', 'w-long', { waitingSince: at(300) }),
      handoff('h3', 'emergency', { waitingSince: at(20), emergency: true }),
    ]
    const q = buildQueue(calls, handoffs, [], NOW)
    // Emergency even though it waited least; then 300 s before 40 s; then upset; then the longest call first.
    expect(keys(q)).toEqual(['emergency', 'w-long', 'w-short', 'upset', 'plain-old', 'plain-new'])
    expect(q.map((i) => i.section)).toEqual(['emergency', 'waiting', 'waiting', 'flagged', 'active', 'active'])
  })

  it('joins a handover to its live call by call id, as one row', () => {
    const q = buildQueue([call('c1', { intent: 'Book a visit', step: 'Offer two slots' })], [handoff('h1', 'c1')], [], NOW)
    expect(q).toHaveLength(1)
    expect(q[0].call?.id).toBe('c1')
    expect(q[0].handoff?.id).toBe('h1')
    expect(factsOf(q[0])).toMatchObject({ intent: 'Book a visit', step: 'Offer two slots', reason: 'The caller asked for a person.', waiting: true })
  })

  it('still lists a waiting handover that has no live call, from its own fields', () => {
    const q = buildQueue([], [handoff('h9', 'no-such-call', { agentName: 'OPD appointments', waitingSince: at(500) })], [], NOW)
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ key: 'no-such-call', section: 'waiting', call: null })
    expect(factsOf(q[0])).toMatchObject({ agentName: 'OPD appointments', callerPhone: '+91 ••••• 21877', waiting: true })
  })

  it('keeps taken and missed handovers, and taken calls, under Recently, newest first', () => {
    const calls = [call('live-taken', { takenBy: 'Meena S' }), call('active')]
    const handoffs = [
      handoff('old', 'x1', { status: 'taken', takenBy: 'Suresh B', takenAt: at(3000), waitingSince: at(3100) }),
      handoff('missed', 'x2', { status: 'missed', waitingSince: at(900) }),
      handoff('fresh', 'x3', { status: 'taken', takenBy: 'Meena S', takenAt: at(100), waitingSince: at(200) }),
    ]
    const q = buildQueue(calls, handoffs, [], NOW)
    expect(q[0].key).toBe('active')
    // Newest first: taken 100 s ago, the call taken by Meena (started 120 s ago), hung up 900 s ago, taken 3000 s ago.
    expect(keys(q.filter((i) => i.section === 'recent'))).toEqual(['x3', 'live-taken', 'x2', 'x1'])
  })

  it('moves a taken handover out of the waiting group even while its call is still on the line', () => {
    const q = buildQueue([call('c1')], [handoff('h1', 'c1', { status: 'taken', takenBy: 'Meena S', takenAt: at(5) })], [], NOW)
    expect(q[0].section).toBe('recent')
    expect(factsOf(q[0]).takenBy).toBe('Meena S')
  })

  it('shows calls that dropped off the live list for 15 minutes, and then not', () => {
    const gone: GoneCall[] = [
      { call: call('just-ended'), endedAt: NOW - 60_000 },
      { call: call('long-ago'), endedAt: NOW - RECENT_MS - 1000 },
    ]
    const q = buildQueue([], [], gone, NOW)
    expect(keys(q)).toEqual(['just-ended'])
    expect(q[0]).toMatchObject({ section: 'recent', ended: true })
  })

  it('keeps an ended call among those waiting if its caller never got a person', () => {
    const gone: GoneCall[] = [{ call: call('c1'), endedAt: NOW - 5000 }]
    const q = buildQueue([], [handoff('h1', 'c1')], gone, NOW)
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ section: 'waiting', ended: true })
  })

  it('counts waiting, on calls and recent', () => {
    const q = buildQueue([call('a'), call('b', { flagged: true }), call('w')], [handoff('h', 'w'), handoff('t', 'z', { status: 'taken', takenBy: 'X', takenAt: at(1) })], [], NOW)
    expect(summarize(q)).toEqual({ waiting: 1, onCalls: 2, recent: 1 })
  })
})

describe('calls that end', () => {
  it('notes calls that left the list, and forgets them after 15 minutes or when they return', () => {
    const a = call('a')
    const b = call('b')
    // The first look: nothing has ended yet.
    expect(trackEnded(null, [a, b], [], NOW)).toEqual([])
    // b left.
    const g1 = trackEnded([a, b], [a], [], NOW)
    expect(g1.map((g) => g.call.id)).toEqual(['b'])
    expect(g1[0].endedAt).toBe(NOW)
    // Still gone later: not added twice, and kept.
    expect(trackEnded([a], [a], g1, NOW + 60_000)).toHaveLength(1)
    // Past 15 minutes: dropped.
    expect(trackEnded([a], [a], g1, NOW + RECENT_MS + 1)).toEqual([])
    // Back on the list: no longer ended.
    expect(trackEnded([a], [a, b], g1, NOW + 1000)).toEqual([])
  })
})

describe('filters', () => {
  const q = buildQueue(
    [call('c1', { callerPhone: '+91 ••••• 21877', agentName: 'Main reception', intent: 'Billing question' }), call('c2', { callerPhone: '+91 ••••• 50442', agentName: 'OPD appointments', line: '+91 00000 01210', intent: 'Book a visit' }), call('c3', { flagged: true, callerPhone: '+91 ••••• 77310' })],
    [handoff('h1', 'c2', { reason: 'No slot suited the caller.', details: [{ label: 'Patient name', value: 'Selvi Murugan', personal: true }] })],
    [],
    NOW,
  )

  it('searches the number by its digits, and agent, intent and reason by words', () => {
    expect(keys(filterQueue(q, { ...NO_FILTER, text: '21877' }, false))).toEqual(['c1'])
    expect(keys(filterQueue(q, { ...NO_FILTER, text: '504 42' }, false))).toEqual(['c2'])
    expect(keys(filterQueue(q, { ...NO_FILTER, text: 'billing' }, false))).toEqual(['c1'])
    expect(keys(filterQueue(q, { ...NO_FILTER, text: 'no slot' }, false))).toEqual(['c2'])
    expect(keys(filterQueue(q, { ...NO_FILTER, text: 'opd' }, false))).toEqual(['c2'])
  })

  it('searches a name only for people who may see names', () => {
    expect(keys(filterQueue(q, { ...NO_FILTER, text: 'selvi' }, true))).toEqual(['c2'])
    expect(filterQueue(q, { ...NO_FILTER, text: 'selvi' }, false)).toEqual([])
  })

  it('filters by agent, by line and to those who need a person', () => {
    expect(keys(filterQueue(q, { ...NO_FILTER, agent: 'OPD appointments' }, false))).toEqual(['c2'])
    expect(keys(filterQueue(q, { ...NO_FILTER, line: '+91 00000 01210' }, false))).toEqual(['c2'])
    // Waiting for a person, or sounding upset; not the plain call.
    expect(keys(filterQueue(q, { ...NO_FILTER, needsPerson: true }, false)).sort()).toEqual(['c2', 'c3'])
    expect(filterOptions(q)).toEqual({ agents: ['Main reception', 'OPD appointments'], lines: ['+91 00000 01200', '+91 00000 01210'] })
  })
})

describe('new arrivals, for the opt-in alerts', () => {
  const waiting = (id: string, over: Partial<Handoff> = {}) => handoff(id, `call-${id}`, over)

  it('fires nothing on the first look, only learns', () => {
    const r = newArrivals(null, [waiting('a'), waiting('b', { emergency: true })])
    expect(r.requests).toEqual([])
    expect(r.emergencies).toEqual([])
    expect(r.seen.has('a')).toBe(true)
  })

  it('then fires for a new waiting caller, once', () => {
    const first = newArrivals(null, [waiting('a')])
    const next = newArrivals(first.seen, [waiting('a'), waiting('b')])
    expect(next.requests.map((h) => h.id)).toEqual(['b'])
    expect(newArrivals(next.seen, [waiting('a'), waiting('b')]).requests).toEqual([])
  })

  it('fires an emergency separately, and again when a waiting caller turns into one', () => {
    const first = newArrivals(null, [waiting('a')])
    const e = newArrivals(first.seen, [waiting('a'), waiting('e', { emergency: true })])
    expect(e.emergencies.map((h) => h.id)).toEqual(['e'])
    expect(e.requests).toEqual([])
    const turned = newArrivals(e.seen, [waiting('a', { emergency: true }), waiting('e', { emergency: true })])
    expect(turned.emergencies.map((h) => h.id)).toEqual(['a'])
  })

  it('does not fire for callers already taken or missed', () => {
    const first = newArrivals(null, [])
    const r = newArrivals(first.seen, [waiting('t', { status: 'taken', takenBy: 'X' }), waiting('m', { status: 'missed' })])
    expect(r.requests).toEqual([])
  })
})
