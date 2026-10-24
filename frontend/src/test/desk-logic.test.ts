import { describe, expect, it } from 'vitest'
import type { ActivityEntry, Appointment, AnswerFlag, DeskLine, DoctorChange, Notice, TranscriptTurn } from '../console/types'
import {
  affectedAppointments,
  agentIdFor,
  boardSummary,
  calendarDays,
  calendarRange,
  calendarRows,
  cellSpeech,
  changeAt,
  checkNotice,
  deskEntries,
  endFor,
  endOfDay,
  endsSoon,
  excerptFor,
  faqDraft,
  filterFlags,
  flagAgents,
  flagCounts,
  fromLocalInput,
  groupNotices,
  hasPlaceholder,
  isDeskEntry,
  lineState,
  noticePreview,
  noticeState,
  NOTICE_TEMPLATES,
  NO_FLAG_FILTER,
  remaining,
  similarity,
  similarNotice,
  toGiveBack,
  toLocalInput,
  todayFigures,
  toSend,
  until,
  untilFor,
  when,
} from '../pages/console/operate/desk/logic'

// 12:00 local on Saturday 24 October 2026.
const NOW = new Date(2026, 9, 24, 12, 0).getTime()
const at = (min: number) => new Date(NOW + min * 6e4).toISOString()

const line = (over: Partial<DeskLine> = {}): DeskLine => ({
  numberId: 'num_1',
  number: '+91 00000 01200',
  label: 'Main reception',
  agentId: 'agt_1',
  agentName: 'Main reception',
  agentStatus: 'live',
  mode: 'agent',
  staffUntil: null,
  staffReason: null,
  staffBy: null,
  liveCalls: 0,
  ...over,
})

const notice = (over: Partial<Notice> = {}): Notice => ({ id: 'n1', text: 'The lift in Block B is under repair today.', agentId: null, from: at(-30), until: at(120), createdBy: 'Meena S', createdAt: at(-30), ...over })

const change = (over: Partial<DoctorChange> = {}): DoctorChange => ({ id: 'c1', doctor: 'Dr. K. Arvind', department: 'Orthopaedics', date: '2026-10-25', kind: 'away', detail: '', createdBy: 'Meena S', createdAt: at(-60), ...over })

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1',
  patientName: 'A Patient',
  phone: '+91 90000 00000',
  department: 'Orthopaedics',
  doctor: 'Dr. K. Arvind',
  date: '2026-10-25',
  time: '10:00',
  status: 'booked',
  bookedBy: 'agent',
  agentName: null,
  callId: null,
  createdAt: at(-600),
  ...over,
})

const flag = (over: Partial<AnswerFlag> = {}): AnswerFlag => ({ id: 'f1', callId: null, agentName: 'Main reception', text: 'Told a caller the pharmacy closes at 8 PM.', correction: 'It is open 24 hours.', by: 'Suresh B', at: at(-60), status: 'open', ...over })

describe('time in words', () => {
  it('says how long is left, rounding up to the minute', () => {
    expect(remaining(at(0.5), NOW)).toBe('1 min')
    expect(remaining(at(40), NOW)).toBe('40 min')
    expect(remaining(at(60), NOW)).toBe('1 h')
    expect(remaining(at(130), NOW)).toBe('2 h 10 min')
    expect(remaining(at(27 * 60), NOW)).toBe('1 day 3 h')
    expect(remaining(at(48 * 60), NOW)).toBe('2 days')
    expect(remaining(at(-5), NOW)).toBe('now')
  })

  it('names the day for today and tomorrow, and the date after that', () => {
    expect(when(at(90), NOW)).toMatch(/^today, 1:30/i)
    expect(when(at(24 * 60 + 30), NOW)).toMatch(/^tomorrow, 12:30/i)
    expect(when(at(5 * 24 * 60), NOW)).toMatch(/^29 Oct, /)
    expect(until(at(90), NOW)).toMatch(/^until 1:30/i)
    expect(until(at(24 * 60), NOW)).toMatch(/^until tomorrow, /)
    expect(until(at(5 * 24 * 60), NOW)).toBe('until 29 Oct')
  })

  it('ends the day at 11:59 pm, and moves a time in and out of a datetime-local field', () => {
    const eod = new Date(endOfDay(0, NOW))
    expect([eod.getDate(), eod.getHours(), eod.getMinutes()]).toEqual([24, 23, 59])
    expect(new Date(endOfDay(1, NOW)).getDate()).toBe(25)
    expect(toLocalInput(new Date(2026, 9, 24, 9, 5).toISOString())).toBe('2026-10-24T09:05')
    expect(new Date(fromLocalInput('2026-10-24T09:05')!).getHours()).toBe(9)
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('tomorrow')).toBeNull()
  })
})

describe('lines', () => {
  const lines = [
    line(),
    line({ numberId: 'n2', label: 'OPD', mode: 'staff', staffUntil: at(30) }),
    line({ numberId: 'n3', label: 'Lab', agentStatus: 'paused' }),
    line({ numberId: 'n4', label: 'Spare', agentId: null, agentName: null, agentStatus: null }),
  ]

  it('tells what each line is doing, and counts them', () => {
    expect(lines.map(lineState)).toEqual(['answering', 'staff', 'paused', 'none'])
    expect(boardSummary(lines)).toEqual({ answering: 1, staff: 1, paused: 1, none: 1 })
  })

  it('sends only lines an agent is answering, and gives back only those with staff', () => {
    expect(toSend(lines).map((l) => l.label)).toEqual(['Main reception'])
    expect(toGiveBack(lines).map((l) => l.label)).toEqual(['OPD'])
  })

  it('works out when a hand-over ends', () => {
    expect(untilFor('open', NOW)).toEqual({ until: null })
    expect(untilFor('1', NOW)).toEqual({ until: at(60) })
    expect(untilFor('2', NOW)).toEqual({ until: at(120) })
    expect(untilFor('day', NOW)).toEqual({ until: endOfDay(0, NOW) })
    const four = untilFor('at', NOW, '16:30')
    expect(four).toHaveProperty('until')
    expect(new Date((four as { until: string }).until).getHours()).toBe(16)
    expect(untilFor('at', NOW, '')).toEqual({ error: 'Choose a time today.' })
    expect(untilFor('at', NOW, '11:00')).toEqual({ error: 'Choose a time later than now.' })
  })

  it('works out today’s calls and the share handed over, and says nothing for a day with no calls', () => {
    const totals = (calls: number, handedOver: number) => ({ totals: { calls, byAgent: 0, handedOver, dropped: 0, avgDurationSec: 0 } })
    expect(todayFigures(totals(20, 5))).toEqual({ calls: 20, handedOver: 5, rate: 25 })
    expect(todayFigures(totals(0, 0))).toEqual({ calls: 0, handedOver: 0, rate: null })
    expect(todayFigures(null)).toBeNull()
  })
})

describe('notices', () => {
  it('splits what is showing from what is scheduled and what has run out, soonest first', () => {
    const list = [
      notice({ id: 'late', until: at(300) }),
      notice({ id: 'soon', until: at(20) }),
      notice({ id: 'later2', from: at(300), until: at(400) }),
      notice({ id: 'later1', from: at(120), until: at(500) }),
      notice({ id: 'gone', from: at(-120), until: at(-1) }),
    ]
    const g = groupNotices(list, NOW)
    expect(g.showing.map((n) => n.id)).toEqual(['soon', 'late'])
    expect(g.scheduled.map((n) => n.id)).toEqual(['later1', 'later2'])
    expect(g.ended.map((n) => n.id)).toEqual(['gone'])
  })

  it('counts one that starts within the clock’s half minute as showing, and warns in the last quarter hour', () => {
    expect(noticeState(notice({ from: at(0.4) }), NOW)).toBe('showing')
    expect(noticeState(notice({ from: at(5) }), NOW)).toBe('scheduled')
    expect(endsSoon(notice({ until: at(10) }), NOW)).toBe(true)
    expect(endsSoon(notice({ until: at(40) }), NOW)).toBe(false)
    expect(endsSoon(notice({ until: at(-1) }), NOW)).toBe(false)
  })

  it('has ready-made notices with parts to fill in', () => {
    expect(NOTICE_TEMPLATES.map((t) => t.label)).toEqual(['Doctor on leave', 'Lift or parking', 'Holiday hours', 'Camp or event', 'Counter moved'])
    for (const t of NOTICE_TEMPLATES) expect(hasPlaceholder(t.text)).toBe(true)
    expect(hasPlaceholder('The lift is out of order today.')).toBe(false)
  })

  it('works out when it ends from the choice made, counted from the start', () => {
    expect(endFor('2h', NOW)).toBe(at(120))
    expect(new Date(endFor('today', NOW)!).getHours()).toBe(23)
    expect(new Date(endFor('tomorrow', NOW)!).getDate()).toBe(25)
    expect(new Date(endFor('week', NOW)!).getDate()).toBe(31)
    expect(endFor('keep', NOW, { keep: at(77) })).toBe(at(77))
    expect(endFor('custom', NOW, { custom: '2026-10-24T18:00' })).toBe(new Date(2026, 9, 24, 18, 0).toISOString())
    expect(endFor('custom', NOW, { custom: '' })).toBeNull()
  })

  it('checks a notice before it is sent', () => {
    const ok = { text: 'The lift is out of order today.', from: at(0), until: at(60) }
    expect(checkNotice(ok, NOW)).toEqual({})
    expect(checkNotice({ ...ok, text: 'Hi' }, NOW).text).toMatch(/sentence or two/)
    expect(checkNotice({ ...ok, text: 'Dr. [name] is on leave today.' }, NOW).text).toMatch(/square brackets/)
    expect(checkNotice({ ...ok, from: null }, NOW).when).toMatch(/starts/)
    expect(checkNotice({ ...ok, until: null }, NOW).when).toMatch(/ends/)
    expect(checkNotice({ ...ok, until: at(-5) }, NOW).when).toMatch(/later than now/)
    expect(checkNotice({ ...ok, from: at(90), until: at(60) }, NOW).when).toMatch(/after it starts/)
    expect(checkNotice({ ...ok, until: at(32 * 24 * 60) }, NOW).when).toMatch(/31 days/)
  })

  it('previews the notice as the agent would say it: the same words, tidied, with when', () => {
    const p = noticePreview('  The lift  is under repair ', 'Main reception', at(0), at(120), NOW)
    expect(p.intro).toBe('Main reception will tell callers')
    expect(p.says).toBe('The lift is under repair.')
    expect(p.timing).toMatch(/^from now, until today, 2:00/i)
    expect(noticePreview('Camp today.', null, at(180), at(300), NOW)).toMatchObject({ intro: 'Every agent will tell callers' })
    expect(noticePreview('Camp today.', null, at(180), at(300), NOW).timing).toMatch(/^from today, 3:00/i)
  })

  describe('duplicates', () => {
    const showing = [notice({ id: 'lift', text: 'The lift in Block B is under repair today. Use the ramp near the pharmacy.' })]
    const mine = { agentId: null, from: at(0), until: at(60) }

    it('measures how much of the shorter text is in the other', () => {
      expect(similarity('The lift is out of order', 'The lift is out of order')).toBe(1)
      expect(similarity('Free eye camp in the lobby', 'Pharmacy counter moved downstairs')).toBe(0)
      expect(similarity('', 'anything here')).toBe(0)
    })

    it('finds a notice saying much the same to the same agents at the same time', () => {
      expect(similarNotice('Lift in Block B is under repair, please use the ramp near the pharmacy', showing, mine, NOW)?.id).toBe('lift')
      expect(similarNotice('The pharmacy counter has moved to the ground floor', showing, mine, NOW)).toBeNull()
    })

    it('ignores another agent’s notice, one at another time, an ended one, and the one being changed', () => {
      const text = 'The lift in Block B is under repair today'
      expect(similarNotice(text, [notice({ id: 'x', text, agentId: 'agt_2' })], { ...mine, agentId: 'agt_1' }, NOW)).toBeNull()
      expect(similarNotice(text, [notice({ id: 'x', text, agentId: 'agt_1' })], { ...mine, agentId: 'agt_1' }, NOW)?.id).toBe('x')
      expect(similarNotice(text, [notice({ id: 'x', text, from: at(200), until: at(300) })], mine, NOW)).toBeNull()
      expect(similarNotice(text, [notice({ id: 'x', text, from: at(-100), until: at(-10) })], mine, NOW)).toBeNull()
      expect(similarNotice(text, [notice({ id: 'x', text })], { ...mine, ignoreId: 'x' }, NOW)).toBeNull()
    })

    it('leaves very short notices alone', () => {
      expect(similarNotice('Lift off', [notice({ text: 'Lift off' })], mine, NOW)).toBeNull()
    })
  })
})

describe('the doctor calendar', () => {
  const doctors = [
    { doctor: 'Dr. V. Senthil', department: 'ENT' },
    { doctor: 'Dr. K. Arvind', department: 'Orthopaedics' },
  ]
  const days = calendarDays('2026-10-24')

  it('covers the next fortnight from today', () => {
    expect(days).toHaveLength(14)
    expect([days[0], days[13]]).toEqual(['2026-10-24', '2026-11-06'])
    expect(calendarRange('2026-10-24')).toEqual({ from: '2026-10-24', to: '2026-11-06' })
  })

  it('has a row per library doctor by name, and one for a doctor in a change who is not in the library', () => {
    const rows = calendarRows(doctors, [change({ doctor: 'Dr. Gone', department: 'ENT', date: '2026-10-26' })], days)
    expect(rows.map((r) => [r.doctor, r.inLibrary])).toEqual([
      ['Dr. Gone', false],
      ['Dr. K. Arvind', true],
      ['Dr. V. Senthil', true],
    ])
    // A change outside the fortnight doesn't add a row.
    expect(calendarRows(doctors, [change({ doctor: 'Dr. Far', date: '2026-12-01' })], days)).toHaveLength(2)
  })

  it('finds a doctor’s change on a day, however the name is written', () => {
    const c = change()
    expect(changeAt('dr k arvind', '2026-10-25', [c])).toBe(c)
    expect(changeAt('Dr. K. Arvind', '2026-10-26', [c])).toBeNull()
  })

  describe('appointments affected', () => {
    const day = [
      appt({ id: 'early', time: '09:00' }),
      appt({ id: 'late', time: '12:30' }),
      appt({ id: 'cancelled', status: 'cancelled' }),
      appt({ id: 'other-day', date: '2026-10-26' }),
      appt({ id: 'other-doctor', doctor: 'Dr. V. Senthil' }),
    ]
    it('is every booked appointment that day when away, not cancelled ones', () => {
      expect(affectedAppointments(change({ kind: 'away' }), day).map((a) => a.id)).toEqual(['early', 'late'])
    })
    it('is those before the time a late doctor arrives, or all when the words give no time', () => {
      expect(affectedAppointments(change({ kind: 'late', detail: 'Seeing patients from 11 AM' }), day).map((a) => a.id)).toEqual(['early'])
      expect(affectedAppointments(change({ kind: 'late', detail: 'After surgery' }), day).map((a) => a.id)).toEqual(['early', 'late'])
    })
    it('is every booked appointment when moved to another room (they need telling where)', () => {
      expect(affectedAppointments(change({ kind: 'moved', detail: 'OPD room 4' }), day)).toHaveLength(2)
    })
  })

  it('says a cell in words for a screen reader, with the appointments and the action', () => {
    expect(cellSpeech('Dr. K. Arvind', '2026-10-25', '2026-10-24', change({ kind: 'late', detail: 'From 11 AM' }), 3, true)).toBe('Dr. K. Arvind, Sun 25 Oct: Starting late, From 11 AM, 3 appointments affected. Change it.')
    expect(cellSpeech('Dr. K. Arvind', '2026-10-24', '2026-10-24', null, null, true)).toBe('Dr. K. Arvind, today, Sat 24 Oct: no change. Add a change.')
    expect(cellSpeech('Dr. K. Arvind', '2026-10-25', '2026-10-24', change(), 1, false)).toBe('Dr. K. Arvind, Sun 25 Oct: Away all day, 1 appointment affected.')
  })
})

describe('flagged answers', () => {
  const flags = [
    flag({ id: 'old', at: at(-600), text: 'Quoted the old fee.' }),
    flag({ id: 'new', at: at(-10), text: 'Said parking is paid.', agentName: 'OPD appointments', by: 'Meena S' }),
    flag({ id: 'anon', at: at(-30), text: 'Gave the wrong room.', agentName: null }),
    flag({ id: 'fixed1', status: 'fixed', resolution: { by: 'Karthik R', at: at(-100), note: 'Updated the price list.' } }),
    flag({ id: 'fixed2', status: 'fixed', resolution: { by: 'Karthik R', at: at(-20), note: 'Added parking.' } }),
    flag({ id: 'dismissed', status: 'dismissed', resolution: { by: 'Karthik R', at: at(-50), note: '' } }),
  ]

  it('counts open, fixed and dismissed', () => {
    expect(flagCounts(flags)).toEqual({ open: 3, fixed: 2, dismissed: 1 })
  })

  it('shows open flags oldest first, and dealt-with ones newest first', () => {
    expect(filterFlags(flags, 'open', NO_FLAG_FILTER).map((f) => f.id)).toEqual(['old', 'anon', 'new'])
    expect(filterFlags(flags, 'fixed', NO_FLAG_FILTER).map((f) => f.id)).toEqual(['fixed2', 'fixed1'])
    expect(filterFlags(flags, 'dismissed', NO_FLAG_FILTER).map((f) => f.id)).toEqual(['dismissed'])
  })

  it('searches what was said, the correction, who flagged it and the note, and filters by agent', () => {
    expect(filterFlags(flags, 'open', { text: 'PARKING', agent: '' }).map((f) => f.id)).toEqual(['new'])
    expect(filterFlags(flags, 'open', { text: 'meena', agent: '' }).map((f) => f.id)).toEqual(['new'])
    expect(filterFlags(flags, 'fixed', { text: 'price list', agent: '' }).map((f) => f.id)).toEqual(['fixed1'])
    expect(filterFlags(flags, 'open', { text: '', agent: 'OPD appointments' }).map((f) => f.id)).toEqual(['new'])
    expect(filterFlags(flags, 'open', { text: '', agent: '__none' }).map((f) => f.id)).toEqual(['anon'])
    expect(filterFlags(flags, 'open', { text: 'nothing like this', agent: '' })).toEqual([])
  })

  it('lists the agents to filter by once each, with "No agent named" only when a flag has none', () => {
    const opts = flagAgents(flags, [line({ agentName: 'Lab report status' }), line({ numberId: 'n2', agentName: 'Main reception' })])
    expect(opts.map((o) => o.label)).toEqual(['Every agent', 'Lab report status', 'Main reception', 'OPD appointments', 'No agent named'])
    expect(flagAgents([flag()], []).map((o) => o.label)).toEqual(['Every agent', 'Main reception'])
  })

  it('finds a flag’s agent among the lines, for a request about it', () => {
    expect(agentIdFor(flag({ agentName: 'Main reception' }), [line()])).toBe('agt_1')
    expect(agentIdFor(flag({ agentName: 'Someone else' }), [line()])).toBeNull()
    expect(agentIdFor(flag({ agentName: null }), [line()])).toBeNull()
  })

  describe('the call excerpt', () => {
    const turns: TranscriptTurn[] = [
      { speaker: 'agent', at: 0, text: 'Welcome to Arogya Hospital. How can I help?' },
      { speaker: 'caller', at: 4, text: 'When does the pharmacy close on Sundays?' },
      { speaker: 'agent', at: 8, text: 'The pharmacy closes at 8 PM on Sundays.' },
      { speaker: 'caller', at: 12, text: 'Thanks. And the lab?' },
      { speaker: 'agent', at: 15, text: 'The lab is open until 9 PM.' },
    ]
    it('picks the reply the flag is about, with the caller’s question before it and the next turn after', () => {
      const e = excerptFor(turns, 'Told a caller the pharmacy closes at 8 PM on Sundays.')
      expect(e.matched).toBe(true)
      expect(e.question).toBe('When does the pharmacy close on Sundays?')
      expect(e.turns.map((t) => t.at)).toEqual([4, 8, 12])
    })
    it('says so and shows the start of the call when nothing matches', () => {
      const e = excerptFor(turns, 'Zxqv wrongly quoted blorp.')
      expect(e.matched).toBe(false)
      expect(e.turns).toHaveLength(3)
      expect(e.question).toBe('When does the pharmacy close on Sundays?')
    })
    it('copes with a call with no turns', () => {
      expect(excerptFor([], 'anything at all')).toEqual({ turns: [], question: null, matched: false })
    })
  })

  it('drafts an FAQ from the caller’s question when known, else from what was flagged', () => {
    expect(faqDraft(flag(), 'When does the pharmacy close?')).toBe('Question: When does the pharmacy close?\nAnswer: It is open 24 hours.')
    expect(faqDraft(flag(), null)).toBe('Question: Told a caller the pharmacy closes at 8 PM.\nAnswer: It is open 24 hours.')
    expect(faqDraft(flag({ correction: '' }), null)).toBe('Question: Told a caller the pharmacy closes at 8 PM.')
  })
})

describe('desk activity', () => {
  const e = (area: ActivityEntry['area'], text: string): ActivityEntry => ({ id: text, at: at(0), actor: 'Meena S', actorKind: 'member', area, text })

  it('keeps the entries the desk wrote: lines, notices, doctor changes and flags', () => {
    for (const text of [
      'Sent Main reception (+91 00000 01200) to staff',
      'Gave OPD (+91 00000 01210) back to the agent',
      'Posted a notice: “The lift is out”',
      'Changed a notice: “The lift is out”',
      'Took down a notice',
      'Marked Dr. K. Arvind late on 2026-10-25',
      'Removed Dr. K. Arvind’s change on 2026-10-25',
      'Fixed a flagged answer',
      'Dismissed a flagged answer',
      'Reopened a flagged answer',
    ])
      expect(isDeskEntry(e('agents', text)), text).toBe(true)
  })

  it('leaves out the rest of the agents’ activity, and the same words in another area', () => {
    expect(isDeskEntry(e('agents', 'Published OPD appointments, version 4'))).toBe(false)
    expect(isDeskEntry(e('agents', 'Changed the recording notice wording'))).toBe(false)
    expect(isDeskEntry(e('team', 'Posted a notice'))).toBe(false)
    expect(deskEntries([e('agents', 'Took down a notice'), e('agents', 'Paused Lab report status'), e('settings', 'Took down a notice')])).toHaveLength(1)
  })
})
