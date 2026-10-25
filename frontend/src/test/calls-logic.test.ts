import { describe, expect, it } from 'vitest'
import { editedFlowRequestDetail, flowRequestDetail } from '../console/flowRequest'
import type { CallOutcome, CallSummary, DetectedFlowPattern, FlowNode, TranscriptTurn } from '../console/types'
import { pathOnFlow, searchTurns, splitMatches, turnForNode, turnForStep } from '../pages/console/operate/calls/detail/logic'
import { applyClientFilters, countWording, NO_FILTERS, readParams, summarise, writeParams, type CallFilters } from '../pages/console/operate/calls/logic'
import { changesText, describeChanges, firstCallerLine, patternCallsIn, patternToFlow, stepCounts, stepStatuses } from '../pages/console/operate/calls/patterns/logic'

const call = (id: string, over: Partial<CallSummary> = {}): CallSummary => ({
  id,
  agentId: 'agt_1',
  agentName: 'OPD appointments',
  line: '+91 44 0000 0000',
  callerPhone: '+91 ••••• 43210',
  callerName: 'Lakshmi K',
  startedAt: '2026-10-24T05:30:00.000Z',
  durationSec: 120,
  language: 'english',
  intent: 'Book an appointment',
  outcome: 'resolved',
  handledBy: null,
  ...over,
})

const turn = (speaker: TranscriptTurn['speaker'], text: string, at = 0): TranscriptTurn => ({ speaker, at, text })

describe('call history address', () => {
  it('reads the filters and the open call from the address', () => {
    const { filters, callId } = readParams(new URLSearchParams('q=billing&days=30&outcome=dropped&agent=agt_1&lang=tamil&sentiment=negative&success=no&call=c9'))
    expect(filters).toEqual({ days: 30, agentId: 'agt_1', outcome: 'dropped', q: 'billing', language: 'tamil', sentiment: 'negative', success: 'no' })
    expect(callId).toBe('c9')
  })

  it('ignores a period, outcome, language or choice it does not know', () => {
    const { filters, callId } = readParams(new URLSearchParams('days=12&outcome=nonsense&lang=klingon&sentiment=ecstatic&success=maybe'))
    expect(filters).toEqual(NO_FILTERS)
    expect(callId).toBeNull()
  })

  it('writes back what it read, leaving out defaults and keeping parameters it does not own', () => {
    const filters: CallFilters = { days: 90, agentId: 'agt_2', outcome: 'handed_over', q: ' fees ', language: 'mixed', sentiment: 'positive', success: 'yes' }
    const out = writeParams(new URLSearchParams('utm=keep&call=old'), filters, 'c1')
    expect(out.get('utm')).toBe('keep')
    expect(readParams(out)).toEqual({ filters: { ...filters, q: 'fees' }, callId: 'c1' })
    // The plain page has a plain address.
    expect(writeParams(new URLSearchParams('days=30&q=x&call=c1'), NO_FILTERS, null).toString()).toBe('')
    expect(writeParams(new URLSearchParams('days=7'), NO_FILTERS, null).has('days')).toBe(false)
  })
})

describe('call history filters the server cannot do', () => {
  const calls = [call('a', { language: 'tamil' }), call('b', { language: 'english' }), call('c', { language: 'english' })]
  const known = new Map([
    ['a', { sentiment: 'negative' as const, success: false }],
    ['b', { sentiment: 'positive' as const, success: true }],
  ])

  it('filters by language over the loaded calls', () => {
    const r = applyClientFilters(calls, { language: 'english', sentiment: '', success: '' }, known)
    expect(r.shown.map((c) => c.id)).toEqual(['b', 'c'])
    expect(r.unknown).toBe(0)
  })

  it('matches sentiment and success only for calls whose analysis is known, and counts the rest', () => {
    const r = applyClientFilters(calls, { language: '', sentiment: 'positive', success: '' }, known)
    expect(r.shown.map((c) => c.id)).toEqual(['b'])
    expect(r.unknown).toBe(1)
    expect(applyClientFilters(calls, { language: '', sentiment: '', success: 'no' }, known).shown.map((c) => c.id)).toEqual(['a'])
    expect(applyClientFilters(calls, { language: 'tamil', sentiment: 'positive', success: '' }, known).shown).toEqual([])
  })

  it('shows everything when nothing is set', () => {
    expect(applyClientFilters(calls, { language: '', sentiment: '', success: '' }, known)).toEqual({ shown: calls, unknown: 0 })
  })
})

describe('call history summary', () => {
  const of = (...o: CallOutcome[]) => o.map((outcome) => ({ outcome }))

  it('counts answered by the agents and handed over the way Reports does', () => {
    const s = summarise(of('resolved', 'booked', 'handed_over', 'emergency', 'callback', 'dropped', 'resolved', 'dropped'))
    expect(s).toMatchObject({ calls: 8, answered: 3, answeredPct: 38, handed: 3, handedPct: 38 })
  })

  it('does not divide by nothing', () => {
    expect(summarise([])).toEqual({ calls: 0, answered: 0, answeredPct: 0, handed: 0, handedPct: 0 })
  })

  it('says how much is loaded, in words', () => {
    expect(countWording(50, 50, 50, false)).toBe('50 calls')
    expect(countWording(1, 1, 1, false)).toBe('1 call')
    expect(countWording(50, 50, 120, false)).toBe('50 of 120 calls')
    expect(countWording(3, 50, 120, true)).toBe('3 of the 50 loaded calls (120 in the period)')
    expect(countWording(3, 50, 50, true)).toBe('3 of the 50 loaded calls')
  })
})

describe('a call on the designed flow', () => {
  let n = 0
  const node = (kind: FlowNode['kind'], label: string, children: FlowNode[] = []): FlowNode => ({ id: `n${++n}`, kind, label, sourceCallIds: [], children })
  const greet = node('step', 'Greet the caller')
  const ask = node('step', 'Ask for the doctor')
  const confirm = node('step', 'Confirm the booking')
  const book = node('intent', 'Book an appointment', [greet, ask, confirm])
  const find = node('step', 'Find the booking')
  const cancel = node('intent', 'Cancel an appointment', [find])
  const designed = [book, cancel]

  it('matches the path to the flow and marks where a hand-over left it', () => {
    const on = pathOnFlow(['Book an appointment', 'Greet the caller', 'Ask for the doctor', 'Hand over to a person'], designed, 'handed_over')
    expect(on.matches.map((m) => m.nodeId)).toEqual([book.id, greet.id, ask.id])
    expect(on.unmatched.map((u) => u.step)).toEqual(['Hand over to a person'])
    expect(on.highlight).toEqual([book.id, greet.id, ask.id])
    expect(on.exitId).toBe(ask.id)
    expect(on.exitText).toBe('Handed over here')
  })

  it('has no exit for a call that finished, and flags a hang-up', () => {
    const done = pathOnFlow(['Book an appointment', 'Greet the caller', 'Ask for the doctor', 'Confirm the booking'], designed, 'booked')
    expect(done.exitId).toBeUndefined()
    expect(done.coverage).toBe(1)
    expect(pathOnFlow(['Book an appointment', 'Greet the caller'], designed, 'dropped').exitText).toBe('Caller hung up here')
  })

  it('has no exit when no step matched at all', () => {
    const on = pathOnFlow(['Something else'], designed, 'dropped')
    expect(on.matches).toEqual([])
    expect(on.exitId).toBeUndefined()
  })
})

describe('which turn a step belongs to', () => {
  const turns = [turn('agent', 'Hello'), turn('caller', 'Hi'), turn('agent', 'Which doctor?'), turn('caller', 'Dr Rao'), turn('agent', 'Two slots'), turn('caller', 'First'), turn('agent', 'Booked')]

  it('spreads the steps over the agent’s turns, first to first and last to last', () => {
    expect(turnForStep(0, 4, turns)).toBe(0)
    expect(turnForStep(3, 4, turns)).toBe(6)
    expect(turnForStep(1, 4, turns)).toBe(2)
    expect(turnForStep(2, 4, turns)).toBe(4)
  })

  it('goes to the first agent turn for a one-step path and to nothing for a step outside it', () => {
    expect(turnForStep(0, 1, turns)).toBe(0)
    expect(turnForStep(4, 4, turns)).toBeNull()
    expect(turnForStep(-1, 4, turns)).toBeNull()
  })

  it('has nowhere to go when the agent never spoke', () => {
    expect(turnForStep(0, 2, [turn('caller', 'Hello?')])).toBeNull()
  })

  it('finds the turn for a node of the flow the call went through, and none for one it did not', () => {
    const matches = [
      { index: 0, step: 'a', nodeId: 'x' },
      { index: 2, step: 'c', nodeId: 'z' },
    ]
    expect(turnForNode('z', matches, 3, turns)).toBe(6)
    expect(turnForNode('x', matches, 3, turns)).toBe(0)
    expect(turnForNode('nope', matches, 3, turns)).toBeNull()
  })
})

describe('searching the conversation', () => {
  const turns = [turn('agent', 'Hello, this is the hospital.'), turn('caller', 'I am {{name:Lakshmi}} and I need Hospital timings, hospital please.')]

  it('finds every match, whatever the case', () => {
    const m = searchTurns(turns, 'HOSPITAL', false)
    expect(m).toEqual([
      { turn: 0, start: 19, end: 27 },
      { turn: 1, start: 24, end: 32 },
      { turn: 1, start: 42, end: 50 },
    ])
  })

  it('searches the text as it is shown: a hidden name cannot be found', () => {
    expect(searchTurns(turns, 'Lakshmi', false)).toHaveLength(1)
    expect(searchTurns(turns, 'Lakshmi', true)).toEqual([])
    expect(searchTurns(turns, '[name]', true)).toHaveLength(1)
  })

  it('finds nothing for an empty search', () => {
    expect(searchTurns(turns, '   ', false)).toEqual([])
  })

  it('cuts a turn into plain and matched parts', () => {
    expect(splitMatches('aXbXc', [{ start: 1, end: 2, index: 0 }, { start: 3, end: 4, index: 1 }])).toEqual([{ text: 'a' }, { text: 'X', match: 0 }, { text: 'b' }, { text: 'X', match: 1 }, { text: 'c' }])
  })
})

describe('detected patterns', () => {
  const pattern: DetectedFlowPattern = {
    id: 'fp_1',
    agentId: 'agt_1',
    agentName: 'OPD appointments',
    steps: ['Book an appointment', 'Greet the caller', 'Ask about insurance', 'Hand over to a person'],
    occurrences: 3,
    windowSize: 5,
    callIds: ['c1', 'c2', 'c3'],
    firstSeenAt: '2026-10-24T05:00:00.000Z',
    lastSeenAt: '2026-10-24T06:00:00.000Z',
    summary: '3 of the last 5 calls followed a sequence outside the design.',
  }
  let n = 0
  const node = (kind: FlowNode['kind'], label: string, children: FlowNode[] = []): FlowNode => ({ id: `d${++n}`, kind, label, sourceCallIds: [], children })
  const designed = [node('intent', 'Book an appointment', [node('step', 'Greet the caller')]), node('intent', 'Ask about insurance', [node('step', 'Check cover')])]

  it('says which steps are in the designed flow, which are new, and which sit under another intent', () => {
    const s = stepStatuses(pattern.steps, designed)
    expect(s.map((x) => x.status)).toEqual(['in', 'in', 'elsewhere', 'new'])
  })

  it('counts the calls that went through each step', () => {
    expect(
      stepCounts(pattern.steps, [
        ['Book an appointment', 'Greet the caller', 'Ask about insurance'],
        ['Book an appointment', 'Greet the caller'],
        ['book an appointment.', 'Greet the caller', 'Ask about insurance', 'Hand over to a person'],
      ]),
    ).toEqual([3, 3, 2, 1])
  })

  it('finds the pattern’s calls among those loaded', () => {
    expect(patternCallsIn(pattern, [call('c2'), call('zzz'), call('c3')]).map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it('takes the caller’s first words as evidence, redacted when it should be', () => {
    const record = { transcript: [turn('agent', 'Hello'), turn('caller', 'This is {{name:Lakshmi}} calling about my insurance')] }
    expect(firstCallerLine(record, false)).toBe('This is Lakshmi calling about my insurance')
    expect(firstCallerLine(record, true)).toBe('This is [name] calling about my insurance')
    expect(firstCallerLine(record, false, 12)).toBe('This is Lak…')
    expect(firstCallerLine({ transcript: [turn('agent', 'Hello')] }, false)).toBeNull()
  })

  it('turns the pattern into a flow to edit: the first step is the intent, and each step follows the one before', () => {
    const flow = patternToFlow(pattern)
    expect(flow).toHaveLength(1)
    expect(flow[0]).toMatchObject({ id: 'detected-0', kind: 'intent', label: 'Book an appointment' })
    const path: [string, string, string][] = []
    for (let n = flow[0].children[0]; n; n = n.children[0]) path.push([n.id, n.kind, n.label])
    expect(path).toEqual([
      ['detected-1', 'step', 'Greet the caller'],
      ['detected-2', 'step', 'Ask about insurance'],
      ['detected-3', 'step', 'Hand over to a person'],
    ])
    expect(patternToFlow({ steps: [] })).toEqual([])
  })

  describe('what the hospital changed', () => {
    const original = patternToFlow(pattern)
    const [greet, ask, hand] = [original[0].children[0], original[0].children[0].children[0], original[0].children[0].children[0].children[0]]
    const leaf = (n: FlowNode, children: FlowNode[] = []): FlowNode => ({ ...n, children })

    it('sees no change in an untouched copy', () => {
      const c = describeChanges(original, original)
      expect(c.total).toBe(0)
      expect(changesText(c)).toBe('No changes yet')
    })

    it('counts added, removed, renamed and reworded items', () => {
      const noInsurance: FlowNode = { id: 'new_1', kind: 'branch', label: 'No insurance', condition: 'They say no', sourceCallIds: [], children: [] }
      const edited = [leaf(original[0], [leaf({ ...greet, label: 'Say hello' }, [leaf({ ...ask, say: 'Do you have insurance?' }, [noInsurance])])])]
      const c = describeChanges(original, edited)
      expect(c.added).toEqual(['No insurance'])
      expect(c.removed).toEqual(['Hand over to a person'])
      expect(c.renamed).toEqual([{ from: 'Greet the caller', to: 'Say hello' }])
      expect(c.reworded).toEqual(['Ask about insurance'])
      expect(changesText(c)).toBe('Added 1 item, removed 1, renamed 1, reworded 1')
    })

    it('counts one step moved as one move, not as its neighbours too', () => {
      const edited = [leaf(original[0], [leaf(hand, [leaf(greet, [leaf(ask)])])])]
      const c = describeChanges(original, edited)
      expect(c.moved).toEqual(['Hand over to a person'])
      expect(c.total).toBe(1)
    })
  })
})

describe('the request for an edited pattern', () => {
  const pattern = {
    id: 'fp_1',
    agentId: 'agt_1',
    agentName: 'OPD appointments',
    steps: ['Book an appointment', 'Greet the caller', 'Hand over to a person'],
    occurrences: 3,
    windowSize: 5,
    callIds: ['c1', 'c2', 'c3'],
    firstSeenAt: '',
    lastSeenAt: '',
    summary: '',
  } satisfies DetectedFlowPattern

  const edited: FlowNode[] = [
    {
      id: 'i',
      kind: 'intent',
      label: 'Book an appointment',
      sourceCallIds: [],
      children: [
        { id: 's1', kind: 'step', label: 'Greet the caller', say: 'Namaste, how can I help?', sourceCallIds: [], children: [] },
        { id: 's2', kind: 'step', label: 'Check insurance', say: '', sourceCallIds: [], children: [] },
        { id: 'b', kind: 'branch', label: 'No slot suits', condition: 'the caller can’t make either', sourceCallIds: [], children: [{ id: 's3', kind: 'step', label: 'Offer the next day', say: '', sourceCallIds: [], children: [] }] },
      ],
    },
  ]

  it('carries the hospital’s version, their note and what was detected', () => {
    const text = editedFlowRequestDetail(pattern, { flow: edited, note: 'Callers on insurance plans only.' })
    expect(text).toContain('We changed it')
    expect(text).toContain('Intent: Book an appointment')
    expect(text).toContain('1. Step: Greet the caller')
    expect(text).toContain('The agent says: “Namaste, how can I help?”')
    expect(text).toContain('2. Step: Check insurance')
    expect(text).toContain('- Branch: No slot suits (when the caller can’t make either)')
    expect(text).toContain('    1. Step: Offer the next day')
    expect(text).toContain('Offer the next day')
    expect(text).toContain('Our note: Callers on insurance plans only.')
    expect(text).toContain('As detected: Book an appointment > Greet the caller > Hand over to a person')
    expect(text).toMatch(/Calls: c1, c2, c3$/)
    expect(text).not.toBe(flowRequestDetail(pattern))
  })

  it('stays inside the 2,000-character limit, giving up the call list before their version', () => {
    const many = { ...pattern, callIds: Array.from({ length: 400 }, (_, i) => `call_20000_${i}`) }
    const text = editedFlowRequestDetail(many, { flow: edited, note: 'x'.repeat(300) })
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text).toContain('Intent: Book an appointment')
    expect(text).toContain('Our note: xxx')
    expect(text).toMatch(/and \d+ more$/)
  })

  it('cuts only as a last resort', () => {
    const long: FlowNode[] = [{ ...edited[0], children: Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, kind: 'step' as const, label: `Step number ${i} of a very long flow`, say: 'Something long that the agent says to the caller here.', sourceCallIds: [], children: [] })) }]
    const text = editedFlowRequestDetail(pattern, { flow: long })
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text.endsWith('…')).toBe(true)
  })
})
