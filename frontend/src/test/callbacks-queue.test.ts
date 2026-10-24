import { describe, expect, it } from 'vitest'
import type { Callback, CallSummary, Member, OrgSettings } from '../console/types'
import {
  assigneeGone,
  buildQueue,
  callsFromNumber,
  describeChange,
  dueText,
  howLong,
  initials,
  nextCallback,
  NO_FILTER,
  otherOpenFor,
  outsideHours,
  rangBack,
  summarize,
  type QueueFilter,
} from '../pages/console/operate/callbacks/queue'

/**
 * The rules behind Callbacks: groups by urgency, filters and sorts, which
 * callback comes next, duplicates, who has rung back and what is outside
 * hours. Times are fixed local times, so nothing depends on the clock.
 */
const NOW = new Date(2026, 9, 24, 12, 0).getTime() // 12:00 local, a Saturday
const at = (hours: number) => new Date(NOW + hours * 36e5).toISOString()
const ME = 'u_me'

function cb(id: string, over: Partial<Callback> = {}): Callback {
  return {
    id,
    callerName: 'Caller ' + id,
    callerPhone: '+91 98402 33415',
    reason: 'Wants a call back.',
    requestedAt: at(-3),
    dueBy: at(1),
    assignedTo: null,
    status: 'open',
    attempts: 0,
    notes: [],
    callId: null,
    ...over,
  }
}
/** Distinct numbers by default, so duplicates only appear when a test asks. */
let n = 0
const own = (id: string, over: Partial<Callback> = {}) => cb(id, { callerPhone: `+91 90000 ${String(10000 + n++)}`, ...over })

const queue = (list: Callback[], filter: Partial<QueueFilter> = {}, sort: 'urgency' | 'newest' | 'oldest' = 'urgency') => buildQueue(list, { ...NO_FILTER, ...filter }, sort, NOW, ME)
const ids = (items: { callback: Callback }[]) => items.map((i) => i.callback.id)

describe('Callbacks: groups by urgency', () => {
  it('puts overdue first, then within the hour, later today, another day, then done and couldn’t reach', () => {
    const items = queue([
      own('later', { dueBy: at(30) }),
      own('closed', { status: 'done', dueBy: at(-5) }),
      own('today', { dueBy: at(4) }),
      own('hour', { dueBy: at(0.5) }),
      own('overdue', { dueBy: at(-2) }),
      own('unreachable', { status: 'unreachable', attempts: 3, dueBy: at(-9) }),
    ])
    expect(items.map((i) => `${i.callback.id}:${i.group}`)).toEqual(['overdue:overdue', 'hour:hour', 'today:today', 'later:later', 'closed:closed', 'unreachable:closed'])
  })

  it('orders each group by soonest due, the most overdue first', () => {
    const items = queue([own('a', { dueBy: at(-1) }), own('b', { dueBy: at(-6) }), own('c', { dueBy: at(-3) })])
    expect(ids(items)).toEqual(['b', 'c', 'a'])
  })

  it('counts a callback due in exactly an hour as within the hour, and one a minute later as later today', () => {
    const items = queue([own('edge', { dueBy: at(1) }), own('past', { dueBy: new Date(NOW + 36e5 + 6e4).toISOString() })])
    expect(items.map((i) => i.group)).toEqual(['hour', 'today'])
  })

  it('keeps the closed ones last, the most recently touched first', () => {
    const items = queue([
      own('old', { status: 'done', requestedAt: at(-50) }),
      own('noted', { status: 'done', requestedAt: at(-40), notes: [{ id: 'n', by: 'Meena S', at: at(-1), text: 'Spoke.' }] }),
      own('open', { dueBy: at(2) }),
    ])
    expect(ids(items)).toEqual(['open', 'noted', 'old'])
  })

  it('sorts by when it was asked into one flat group when not sorting by urgency', () => {
    const list = [own('mid', { requestedAt: at(-5), dueBy: at(-1) }), own('new', { requestedAt: at(-1), dueBy: at(30) }), own('first', { requestedAt: at(-9), dueBy: at(3) })]
    expect(ids(queue(list, {}, 'newest'))).toEqual(['new', 'mid', 'first'])
    expect(ids(queue(list, {}, 'oldest'))).toEqual(['first', 'mid', 'new'])
    expect(new Set(queue(list, {}, 'newest').map((i) => i.group))).toEqual(new Set(['all']))
  })

  it('says how late or how soon in words', () => {
    const [late, soon, tomorrow] = queue([own('late', { dueBy: at(-2.5) }), own('soon', { dueBy: at(0.4) }), own('tom', { dueBy: at(30) })])
    expect(dueText(late, NOW)).toBe('Overdue by 2 h 30 min')
    expect(dueText(soon, NOW)).toBe('Due in 24 min')
    expect(dueText(tomorrow, NOW)).toMatch(/^Due .* tomorrow$/)
    expect(howLong(20_000)).toBe('under a minute')
    expect(howLong(26 * 36e5)).toBe('1 day')
  })

  it('summarises open and overdue', () => {
    const s = summarize(queue([own('a', { dueBy: at(-1) }), own('b', { dueBy: at(2) }), own('c', { status: 'done' })]))
    expect(s).toEqual({ open: 2, overdue: 1 })
  })
})

describe('Callbacks: duplicates', () => {
  const same = '+91 98402 33415'
  const list = [cb('a', { callerPhone: same }), cb('b', { callerPhone: '9840233415', dueBy: at(2) }), cb('c', { callerPhone: '+91 98402 33415', status: 'done' }), own('d')]

  it('marks open callbacks that share a number, however it is written', () => {
    const items = queue(list)
    expect(items.find((i) => i.callback.id === 'a')!.duplicates.map((c) => c.id)).toEqual(['b'])
    expect(items.find((i) => i.callback.id === 'b')!.duplicates.map((c) => c.id)).toEqual(['a'])
    expect(items.find((i) => i.callback.id === 'd')!.duplicates).toEqual([])
  })

  it('counts only open ones: a done callback is neither marked nor counted', () => {
    const items = queue(list)
    expect(items.find((i) => i.callback.id === 'c')!.duplicates).toEqual([])
    expect(otherOpenFor(list[0], list).map((c) => c.id)).toEqual(['b'])
    expect(otherOpenFor(list[2], list)).toEqual([])
  })
})

describe('Callbacks: filters', () => {
  const list = [
    cb('a', { callerName: 'Anand Kumar', callerPhone: '+91 98945 30017', reason: 'Insurance for the health check-up', assignedTo: { id: ME, name: 'Me' }, attempts: 1 }),
    cb('b', { callerName: null, callerPhone: '+91 90031 77452', reason: 'Missed call from the OPD line', assignedTo: { id: 'u_2', name: 'Suresh B' } }),
    cb('c', { callerName: 'Revathi M', callerPhone: '+91 94440 61208', reason: 'Move a review to the evening', status: 'done' }),
    cb('d', { callerName: 'Joseph', callerPhone: '+91 99620 18834', reason: 'Final bill', status: 'unreachable', attempts: 3 }),
  ]
  const only = (f: Partial<QueueFilter>) => ids(queue(list, f)).sort()

  it('searches names, digits of the number and words of the reason', () => {
    expect(only({ text: 'anand' })).toEqual(['a'])
    expect(only({ text: 'evening' })).toEqual(['c'])
    expect(only({ text: '90031' })).toEqual(['b'])
    expect(only({ text: '+91 94440' })).toEqual(['c'])
    expect(only({ text: 'zzz' })).toEqual([])
  })

  it('filters by who has it: me, nobody, or one person', () => {
    expect(only({ assignee: 'me' })).toEqual(['a'])
    expect(only({ assignee: 'nobody' })).toEqual(['c', 'd'])
    expect(only({ assignee: 'u_2' })).toEqual(['b'])
  })

  it('filters by tries and by status', () => {
    expect(only({ tries: 'untried' })).toEqual(['b', 'c'])
    expect(only({ tries: 'tried' })).toEqual(['a', 'd'])
    expect(only({ status: 'open' })).toEqual(['a', 'b'])
    expect(only({ status: 'done' })).toEqual(['c'])
    expect(only({ status: 'unreachable' })).toEqual(['d'])
  })

  it('combines filters', () => {
    expect(only({ assignee: 'me', tries: 'untried' })).toEqual([])
    expect(only({ status: 'open', tries: 'tried' })).toEqual(['a'])
  })
})

describe('Callbacks: the next callback', () => {
  const list = [
    own('mine-late', { dueBy: at(-2), assignedTo: { id: ME, name: 'Me' } }),
    own('free', { dueBy: at(-1) }),
    own('theirs', { dueBy: at(-3), assignedTo: { id: 'u_2', name: 'Suresh B' } }),
    own('mine-later', { dueBy: at(3), assignedTo: { id: ME, name: 'Me' } }),
    own('done', { dueBy: at(-9), status: 'done' }),
  ]

  it('is the most urgent open one that is mine or not given to anyone, skipping others’ and closed ones', () => {
    expect(nextCallback(list, null, ME)?.id).toBe('mine-late')
  })

  it('goes on down the list from the current one, and round to the top at the end', () => {
    expect(nextCallback(list, 'mine-late', ME)?.id).toBe('free')
    expect(nextCallback(list, 'free', ME)?.id).toBe('mine-later')
    expect(nextCallback(list, 'mine-later', ME)?.id).toBe('mine-late')
  })

  it('starts at the top when the current one has just been closed', () => {
    expect(nextCallback(list, 'done', ME)?.id).toBe('mine-late')
  })

  it('is nothing when the current one is the only one left, or none is left', () => {
    expect(nextCallback([list[0]], 'mine-late', ME)).toBeNull()
    expect(nextCallback([list[2], list[4]], null, ME)).toBeNull()
  })
})

describe('Callbacks: caller history and ringing back', () => {
  const call = (id: string, hoursAgo: number, phone = '+91 ••••• 33415'): CallSummary => ({
    id,
    agentId: 'agt',
    agentName: 'Main reception',
    line: '+91 00000 01200',
    callerPhone: phone,
    callerName: null,
    startedAt: at(-hoursAgo),
    durationSec: 90,
    language: 'english',
    intent: 'Ask about prices',
    outcome: 'resolved',
    handledBy: null,
  })
  const c = cb('a', { callerPhone: '+91 98402 33415', requestedAt: at(-3), callId: 'src' })

  it('matches past calls on the last five digits only', () => {
    const found = callsFromNumber(c, [call('x', 5), call('y', 6, '+91 ••••• 99999'), call('z', 50, '+91 ••••• 33415')])
    expect(found.map((x) => x.id)).toEqual(['x', 'z'])
  })

  it('finds the first call from the number after the callback was asked for', () => {
    const r = rangBack(c, [call('later', 1), call('earlier', 2), call('before', 4)])
    expect(r?.id).toBe('earlier')
  })

  it('does not count the call it came from, calls before it, other numbers or closed callbacks', () => {
    expect(rangBack(c, [call('src', 1)])).toBeNull()
    expect(rangBack(c, [call('before', 4)])).toBeNull()
    expect(rangBack(c, [call('other', 1, '+91 ••••• 11111')])).toBeNull()
    expect(rangBack({ ...c, status: 'done' }, [call('later', 1)])).toBeNull()
  })
})

describe('Callbacks: who has it', () => {
  const member = (id: string, over: Partial<Member> = {}): Member => ({ id, name: id, email: `${id}@x.in`, role: 'front_desk', permissions: null, lastActiveAt: null, status: 'active', ...over })
  const given = cb('a', { assignedTo: { id: 'u_2', name: 'Suresh B' } })

  it('flags an open callback given to someone who is not on the team, disabled, or a viewer', () => {
    expect(assigneeGone(given, [member('u_1')])).toBe(true)
    expect(assigneeGone(given, [member('u_2', { status: 'disabled' })])).toBe(true)
    expect(assigneeGone(given, [member('u_2', { role: 'viewer' })])).toBe(true)
    expect(assigneeGone(given, [member('u_2')])).toBe(false)
    expect(assigneeGone(cb('b'), [])).toBe(false)
    expect(assigneeGone({ ...given, status: 'done' }, [])).toBe(false)
  })

  it('describes what changed while someone looked', () => {
    const after = { ...given, assignedTo: { id: ME, name: 'Me' }, attempts: 2, notes: [{ id: 'n', by: 'x', at: at(0), text: 'hi' }] }
    expect(describeChange(given, after, ME)).toEqual(['It is yours now.', 'It has been tried 2 times now.', '1 new note.'])
    expect(describeChange(given, { ...given, status: 'done', assignedTo: null }, ME)).toEqual(['It is not given to anyone now.', 'It was marked done.'])
    expect(describeChange(given, given, ME)).toEqual([])
  })

  it('makes initials for an avatar', () => {
    expect(initials('Meena S')).toBe('MS')
    expect(initials('Karthik')).toBe('K')
    expect(initials('')).toBe('?')
  })
})

describe('Callbacks: due outside opening hours', () => {
  const day = (open: boolean, from = '09:00', to = '18:00') => ({ open, from, to })
  const settings = {
    name: 'H',
    city: 'C',
    languages: ['english'],
    hours: [day(true), day(true), day(true), day(true), day(true), day(true, '09:00', '13:00'), day(false)],
    closed: [{ date: '2026-11-08', label: 'Diwali' }],
    updatedAt: '',
    updatedBy: '',
  } as OrgSettings
  /** An IST moment, as the ISO instant it is. */
  const ist = (iso: string) => new Date(`${iso}+05:30`).toISOString()

  it('is fine inside the hours', () => {
    expect(outsideHours(ist('2026-10-26T10:30:00'), settings)).toBeNull() // Monday
  })
  it('says before opening and after closing', () => {
    expect(outsideHours(ist('2026-10-26T08:15:00'), settings)).toMatch(/before the organisation opens at 9:00 am/)
    expect(outsideHours(ist('2026-10-26T18:00:00'), settings)).toMatch(/after the organisation closes at 6:00 pm/)
    expect(outsideHours(ist('2026-10-24T14:00:00'), settings)).toMatch(/closes at 1:00 pm/) // Saturday
  })
  it('says a closed weekday or a closed date', () => {
    expect(outsideHours(ist('2026-10-25T10:00:00'), settings)).toMatch(/closed on Sundays/)
    expect(outsideHours(ist('2026-11-08T10:00:00'), settings)).toMatch(/closed that day \(Diwali\)/)
  })
})
