import { describe, expect, it } from 'vitest'
import type { Appointment, Callback, Desk, Handoff } from '../console/types'
import { appointmentsToCheck, changesOn, isOverdue, myCallbacks, noticesNow, waitingCallers } from '../pages/console/home/shift'

const NOW = Date.parse('2023-11-14T10:00:00Z')
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

const handoff = (id: string, waitedMin: number, over: Partial<Handoff> = {}): Handoff => ({
  id, callId: `c_${id}`, agentName: 'Reception', line: 'Main', callerPhone: '+91 ••••• 00000', reason: 'Wants a person', summary: '', details: [], language: 'english',
  waitingSince: iso(-waitedMin), status: 'waiting', takenBy: null, takenAt: null, emergency: false, ...over,
})
const callback = (id: string, dueMin: number, over: Partial<Callback> = {}): Callback => ({
  id, callerName: id, callerPhone: '+91 90000 00000', reason: 'r', requestedAt: iso(-600), dueBy: iso(dueMin), assignedTo: null, status: 'open', attempts: 0, notes: [], callId: null, ...over,
})

describe('waitingCallers', () => {
  it('puts emergencies first, then the longest wait, and leaves out anyone no longer waiting', () => {
    const list = waitingCallers([handoff('short', 1), handoff('long', 9), handoff('sos', 2, { emergency: true }), handoff('taken', 20, { status: 'taken' }), handoff('missed', 30, { status: 'missed' })])
    expect(list.map((h) => h.id)).toEqual(['sos', 'long', 'short'])
  })
})

describe('myCallbacks', () => {
  it('keeps open callbacks that are mine or nobody’s, overdue first and then soonest due', () => {
    const list = myCallbacks(
      [
        callback('later', 180, { assignedTo: { id: 'me', name: 'Me' } }),
        callback('theirs', -30, { assignedTo: { id: 'other', name: 'Other' } }),
        callback('late', -120),
        callback('soon', 30),
        callback('done', -10, { status: 'done' }),
        callback('gaveup', -10, { status: 'unreachable' }),
      ],
      'me',
    )
    expect(list.map((c) => c.id)).toEqual(['late', 'soon', 'later'])
  })
  it('knows what is overdue', () => {
    expect(isOverdue(callback('a', -1), NOW)).toBe(true)
    expect(isOverdue(callback('b', 1), NOW)).toBe(false)
  })
})

describe('appointmentsToCheck', () => {
  it('keeps only the ones needing a check, earliest first', () => {
    const appt = (id: string, time: string, status: Appointment['status'], checkReason?: string): Appointment => ({
      id, patientName: id, phone: '', department: 'OPD', doctor: 'Dr A', date: '2023-11-14', time, status, checkReason, bookedBy: 'agent', agentName: null, callId: null, createdAt: iso(-60),
    })
    expect(appointmentsToCheck([appt('b', '15:00', 'pending', 'Unsure of the date.'), appt('x', '09:00', 'confirmed', 'Cleared once confirmed.'), appt('y', '09:10', 'pending'), appt('a', '09:30', 'pending', 'Name unclear.')]).map((a) => a.id)).toEqual(['a', 'b'])
  })
})

describe('desk', () => {
  const desk: Desk = {
    lines: [],
    notices: [
      { id: 'n_old', text: 'Ended', agentId: null, from: iso(-600), until: iso(-60), createdBy: 'x', createdAt: iso(-700) },
      { id: 'n_now', text: 'Lift is out', agentId: null, from: iso(-60), until: iso(120), createdBy: 'x', createdAt: iso(-100) },
      { id: 'n_next', text: 'Tomorrow', agentId: null, from: iso(600), until: iso(900), createdBy: 'x', createdAt: iso(-100) },
    ],
    doctorChanges: [
      { id: 'd1', doctor: 'Dr A', department: 'ENT', date: '2023-11-14', kind: 'away', detail: 'On leave', createdBy: 'x', createdAt: iso(-100) },
      { id: 'd2', doctor: 'Dr B', department: 'ENT', date: '2023-11-15', kind: 'late', detail: 'From 11', createdBy: 'x', createdAt: iso(-100) },
    ],
    flags: [],
    doctors: [],
  }
  it('lists the notices in force now, and today’s doctor changes', () => {
    expect(noticesNow(desk, NOW).map((n) => n.id)).toEqual(['n_now'])
    expect(changesOn(desk, '2023-11-14').map((d) => d.id)).toEqual(['d1'])
  })
})
