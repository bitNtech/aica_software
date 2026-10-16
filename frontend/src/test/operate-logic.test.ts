import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { callLog, callRecord, report } from '../console/demo/operations'

const ORG = 'arogya-demo'
const ctx = { orgSlug: ORG, paused: new Set<string>(), pauses: {} }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(1_700_000_000_000))
})
afterEach(() => vi.useRealTimers())

const client = (who: { id: string; name: string; role: 'admin' | 'front_desk' | 'viewer' | 'supervisor' }) => {
  const c = createDemoConsoleClient({ latency: 0, persist: false })
  c.setViewer?.({ id: who.id, name: who.name, roles: { [ORG]: who.role } })
  return c
}
const admin = { id: 'u_admin', name: 'Karthik R', role: 'admin' as const }
const meena = { id: 'u_frontdesk', name: 'Meena S', role: 'front_desk' as const }

describe('the sample call log', () => {
  it('is the same every time, and its full records agree with it', () => {
    const a = callLog(ctx, 7)
    const b = callLog(ctx, 7)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(100)
    const handed = a.find((c) => c.outcome === 'handed_over')!
    const rec = callRecord(handed)
    expect(rec.handledBy).toBe(handed.handledBy)
    expect(rec.path.at(-1)).toBe('Hand over to a person')
    expect(callRecord(handed)).toEqual(rec)
  })

  it('adds up in reports', () => {
    const r = report(ctx, 7)
    expect(r.totals.calls).toBe(r.totals.byAgent + r.totals.handedOver + r.totals.dropped)
    expect(r.byDay.reduce((s, d) => s + d.resolved + d.handedOver + d.dropped, 0)).toBe(r.totals.calls)
    expect(r.byHour.reduce((s, n) => s + n, 0)).toBe(r.totals.calls)
    expect(r.byDay).toHaveLength(7)
  })

  it('has no calls for an agent while it was paused, and keeps the ones before', () => {
    const from = Date.now() - 2 * 864e5
    const to = Date.now() - 864e5
    const log = callLog({ orgSlug: ORG, paused: new Set(), pauses: { agt_reports: [{ from, to }] } }, 7)
    const lab = log.filter((c) => c.agentId === 'agt_reports').map((c) => Date.parse(c.startedAt))
    expect(lab.some((t) => t >= from && t < to)).toBe(false)
    expect(lab.some((t) => t < from)).toBe(true)
    expect(lab.some((t) => t >= to)).toBe(true)
    // Pausing doesn't rewrite what happened before it.
    const before = callLog(ctx, 7).filter((c) => Date.parse(c.startedAt) < from)
    expect(log.filter((c) => Date.parse(c.startedAt) < from)).toEqual(before)
  })

  it('turns the day over at midnight in India, not in UTC', () => {
    // 03:43 IST on 15 Nov 2023 is still 14 Nov in UTC.
    const istDate = (iso: string) => new Date(Date.parse(iso) + 5.5 * 36e5).toISOString().slice(0, 10)
    expect(callLog(ctx, 1).every((c) => istDate(c.startedAt) === '2023-11-15')).toBe(true)
    const two = new Set(callLog(ctx, 2).map((c) => istDate(c.startedAt)))
    expect(two.has('2023-11-14')).toBe(true)
    expect([...two].every((d) => d === '2023-11-14' || d === '2023-11-15')).toBe(true)
  })
})

describe('demo client: who sees and does what', () => {
  it('shows the front desk only calls they handled, and refuses others', async () => {
    const c = client(meena)
    const page = await c.listCallLog(ORG, { days: 30, limit: 500 })
    expect(page.calls.every((x) => x.handledBy === 'Meena S')).toBe(true)
    const other = callLog(ctx, 30).find((x) => x.handledBy && x.handledBy !== 'Meena S')!
    await expect(c.getCallRecord(ORG, other.id)).rejects.toThrow(/calls you handled/i)
  })

  it('keeps callbacks to the front desk’s own, and their assignments to themselves', async () => {
    const c = client(meena)
    const mine = await c.listCallbacks(ORG)
    expect(mine.every((x) => !x.assignedTo || x.assignedTo.id === 'u_frontdesk')).toBe(true)
    await expect(c.updateCallback(ORG, 'cb_3', { assignedTo: 'u_frontdesk2' })).rejects.toThrow(/for yourself/i)
    const taken = await c.updateCallback(ORG, 'cb_3', { assignedTo: 'u_frontdesk' })
    expect(taken.assignedTo?.name).toBe('Meena S')
  })

  it('won’t give a callback to a viewer, and moves it on after three missed tries', async () => {
    const c = client(admin)
    await expect(c.updateCallback(ORG, 'cb_3', { assignedTo: 'u_viewer' })).rejects.toThrow(/viewer/i)
    let cb = await c.updateCallback(ORG, 'cb_3', { attempt: 'no_answer' })
    cb = await c.updateCallback(ORG, 'cb_3', { attempt: 'no_answer', note: 'Voicemail full.' })
    expect(cb.status).toBe('open')
    cb = await c.updateCallback(ORG, 'cb_3', { attempt: 'no_answer' })
    expect(cb).toMatchObject({ status: 'unreachable', attempts: 3 })
    expect(cb.notes[0]).toMatchObject({ by: 'Karthik R', text: 'Voicemail full.' })
  })

  it('lets one person take a waiting caller', async () => {
    const a = createDemoConsoleClient({ latency: 0, persist: false })
    a.setViewer?.({ id: meena.id, name: meena.name, roles: { [ORG]: 'front_desk' } })
    const h = await a.takeHandoff(ORG, 'ho_1')
    expect(h).toMatchObject({ status: 'taken', takenBy: 'Meena S' })
    a.setViewer?.({ id: 'u_frontdesk2', name: 'Suresh B', roles: { [ORG]: 'front_desk' } })
    await expect(a.takeHandoff(ORG, 'ho_1')).rejects.toThrow(/meena s has already taken/i)
    await expect(a.handoffToCallback(ORG, 'ho_1')).rejects.toThrow(/already taken/i)
  })

  it('enforces the rules a server would', async () => {
    const desk = client(meena)
    // Suresh's callback: not Meena's to unassign or change.
    await expect(desk.updateCallback(ORG, 'cb_2', { assignedTo: null })).rejects.toThrow(/suresh b’s/i)
    await expect(desk.updateCallback(ORG, 'cb_2', { attempt: 'no_answer' })).rejects.toThrow(/suresh b’s/i)
    // Notes only on real calls they handled.
    await expect(desk.addCallNote(ORG, 'call_1_999', 'Hi')).rejects.toThrow(/doesn't exist/i)
    const viewer = client({ id: 'u_viewer', name: 'Arun V', role: 'viewer' })
    await expect(viewer.updateAppointment(ORG, 'apt_3', { status: 'confirmed' })).rejects.toThrow(/permission to/i)
    await expect(viewer.listLiveCalls(ORG)).rejects.toThrow(/permission to/i)
    const a = client(admin)
    await expect(a.updateAppointment(ORG, 'apt_3', { date: '2026-02-31' })).rejects.toThrow(/real date/i)
    await a.handoffToCallback(ORG, 'ho_2')
    await expect(a.handoffToCallback(ORG, 'ho_2')).rejects.toThrow(/already has a callback/i)
  })

  it('records who published and noted things', async () => {
    const c = client(admin)
    const call = callLog(ctx, 2)[0]
    const note = await c.addCallNote(ORG, call.id, 'Called back to confirm.')
    expect(note.by).toBe('Karthik R')
    const viewer = client({ id: 'u_viewer', name: 'Arun V', role: 'viewer' })
    await expect(viewer.addCallNote(ORG, call.id, 'Hi')).rejects.toThrow(/viewers can read notes/i)
  })
})
