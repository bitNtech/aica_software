import { describe, expect, it } from 'vitest'
import type { Permission, PlatformRole, Role } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import { callLog, callRecord, report } from '../console/demo/operations'

const ORG = 'arogya-demo'

/** A demo client as the server would see this person. */
const as = (id: string, name: string, role: Role | null, extra: { permissions?: Permission[]; platformRole?: PlatformRole } = {}) => {
  const c = createDemoConsoleClient({ latency: 0, persist: false })
  c.setViewer?.({ id, name, roles: role ? { [ORG]: role } : {}, permissions: extra.permissions ? { [ORG]: extra.permissions } : undefined, platformRole: extra.platformRole ?? null })
  return c
}
const admin = () => as('u_admin', 'Karthik R', 'admin')
const meena = (permissions?: Permission[]) => as('u_frontdesk', 'Meena S', 'front_desk', { permissions })
const master = () => as('u_master', 'Vikram S', null, { platformRole: 'master_admin' })

describe('who builds agents', () => {
  it('lets only bitNtech’s master admin create, publish new and delete agents', async () => {
    const a = admin()
    await expect(a.createDraft(ORG, 'Arogya')).rejects.toThrow(/only bitntech can create agents/i)
    await expect(a.deleteAgent(ORG, 'agt_reports')).rejects.toThrow(/only bitntech/i)
    await expect(a.saveTool(ORG, { id: '', name: 'x', kind: 'http', description: '', acts: false, params: [], enabled: true })).rejects.toThrow(/only bitntech/i)

    const m = master()
    const draft = await m.createDraft(ORG, 'Arogya Demo Hospital')
    expect(draft.pipeline.turnDetection).toBe('semantic')
    await m.deleteAgent(ORG, 'agt_reports')
    expect((await m.listAgents(ORG)).some((x) => x.id === 'agt_reports')).toBe(false)
    // Logged as bitNtech's, in the organisation's activity.
    const log = (await m.listActivity(ORG, {})).entries[0]
    expect(log).toMatchObject({ actorKind: 'bitntech', actor: 'Vikram S (bitNtech)' })
  })

  it('lets a hospital change everyday settings, but not the structure', async () => {
    const a = admin()
    const d = await a.getAgent(ORG, 'agt_appointments')
    const greeted = await a.saveAgent(ORG, 'agt_appointments', { ...d.working, behaviour: { ...d.working.behaviour, greeting: 'Vanakkam!' }, analysis: { ...d.working.analysis, successCriteria: 'Booked.' } })
    expect(greeted.working.behaviour.greeting).toBe('Vanakkam!')
    await expect(a.saveAgent(ORG, 'agt_appointments', { ...greeted.working, flow: [] })).rejects.toThrow(/set up by bitntech/i)
    await expect(a.saveAgent(ORG, 'agt_appointments', { ...greeted.working, pipeline: { ...greeted.working.pipeline, temperature: 0.9 } })).rejects.toThrow(/set up by bitntech/i)
    await expect(a.saveAgent(ORG, 'agt_appointments', { ...greeted.working, analysis: { ...greeted.working.analysis, fields: [] } })).rejects.toThrow(/set up by bitntech/i)
    // bitNtech can.
    const m = master()
    const changed = await m.saveAgent(ORG, 'agt_appointments', { ...(await m.getAgent(ORG, 'agt_appointments')).working, flow: [] })
    expect(changed.working.flow).toEqual([])
  })
})

describe('requests to bitNtech', () => {
  it('files, discusses, and closes a request, logging each step', async () => {
    const a = admin()
    await expect(a.createChangeRequest(ORG, { kind: 'flow_change', agentId: null, title: 'Cancel by SMS', detail: 'Let callers cancel by replying to the SMS.', urgency: 'normal' })).rejects.toThrow(/choose the agent/i)
    const r = await a.createChangeRequest(ORG, { kind: 'flow_change', agentId: 'agt_appointments', title: 'Cancel by SMS', detail: 'Let callers cancel by replying to the SMS.', urgency: 'soon' })
    expect(r).toMatchObject({ status: 'open', agentName: 'OPD appointments', createdBy: 'Karthik R' })
    await expect(master().createChangeRequest(ORG, { kind: 'other', agentId: null, title: 'Hello there', detail: 'From bitNtech itself.', urgency: 'normal' })).rejects.toThrow(/come from the organisation/i)

    // The same store, as bitNtech: one demo client stands in for the server.
    a.setViewer?.({ id: 'u_master', name: 'Vikram S', roles: {}, platformRole: 'master_admin' })
    await expect(a.updateChangeRequest(ORG, r.id, { status: 'declined' })).rejects.toThrow(/say why/i)
    const done = await a.updateChangeRequest(ORG, r.id, { status: 'done', reply: 'Added and published.' })
    expect(done.status).toBe('done')
    expect(done.replies.at(-1)).toMatchObject({ byKind: 'bitntech', text: 'Added and published.' })

    a.setViewer?.({ id: 'u_admin', name: 'Karthik R', roles: { [ORG]: 'admin' } })
    await expect(a.updateChangeRequest(ORG, r.id, { status: 'open' })).rejects.toThrow(/master admin/i)
    await expect(a.withdrawChangeRequest(ORG, r.id)).rejects.toThrow(/only open requests/i)
    const texts = (await a.listActivity(ORG, { area: 'agents' })).entries.map((e) => e.text)
    expect(texts).toContain('bitNtech finished the request “Cancel by SMS”')
    expect(texts).toContain('Asked bitNtech for a flow change: “Cancel by SMS”')
  })

  it('turns “ask for another number” into a request', async () => {
    const a = admin()
    await a.requestNumber(ORG, 'A line for the lab')
    expect((await a.listChangeRequests(ORG))[0]).toMatchObject({ kind: 'number', detail: 'A line for the lab', status: 'open' })
  })
})

describe('the bot desk', () => {
  it('sends a line to staff, which takes its agent off live calls, and back', async () => {
    const m = meena()
    const before = await m.getDesk(ORG)
    expect(before.lines.find((l) => l.numberId === 'num_1210')).toMatchObject({ mode: 'agent', agentName: 'OPD appointments' })
    const after = await m.setLineMode(ORG, 'num_1210', { mode: 'staff', until: new Date(Date.now() + 36e5).toISOString(), reason: 'Desk is free' })
    expect(after.lines.find((l) => l.numberId === 'num_1210')).toMatchObject({ mode: 'staff', staffBy: 'Meena S', staffReason: 'Desk is free', liveCalls: 0 })
    expect((await m.listLiveCalls(ORG)).some((c) => c.agentId === 'agt_appointments')).toBe(false)
    await expect(m.setLineMode(ORG, 'num_1230', { mode: 'staff' })).rejects.toThrow(/no agent answers/i)
    const back = await m.setLineMode(ORG, 'num_1210', { mode: 'agent' })
    expect(back.lines.find((l) => l.numberId === 'num_1210')?.mode).toBe('agent')
  })

  it('follows each person’s permissions, not just their role', async () => {
    // A front desk member without the bot switch, but with notices.
    const suresh = meena(['desk.notices', 'calls.take'])
    await expect(suresh.setLineMode(ORG, 'num_1210', { mode: 'staff' })).rejects.toThrow(/permission to switch lines/i)
    const d = await suresh.saveNotice(ORG, { text: 'Free eye camp in the OPD lobby today.', agentId: null, from: new Date().toISOString(), until: new Date(Date.now() + 36e5).toISOString() })
    expect(d.notices.some((n) => n.text.startsWith('Free eye camp'))).toBe(true)
    // Viewers only look.
    await expect(as('u_viewer', 'Arun V', 'viewer').getDesk(ORG)).rejects.toThrow(/permission to open the bot desk/i)
  })

  it('checks notices, doctor changes and flags as a server would', async () => {
    const m = meena()
    const now = new Date().toISOString()
    await expect(m.saveNotice(ORG, { text: 'Hi', agentId: null, from: now, until: now })).rejects.toThrow(/5 to 300/i)
    await expect(m.saveNotice(ORG, { text: 'Long notice here', agentId: null, from: now, until: new Date(Date.now() + 40 * 864e5).toISOString() })).rejects.toThrow(/31 days/i)
    await expect(m.saveDoctorChange(ORG, { doctor: 'Dr. K. Arvind', department: 'Orthopaedics', date: '2020-01-01', kind: 'away', detail: '' })).rejects.toThrow(/today or a later day/i)
    const today = (await m.getDesk(ORG)).doctorChanges[0].date
    await expect(m.saveDoctorChange(ORG, { doctor: 'Dr. V. Senthil', department: 'ENT', date: today, kind: 'away', detail: '' })).rejects.toThrow(/already has a change/i)
    await expect(m.saveDoctorChange(ORG, { doctor: 'Dr. P. Lakshmi', department: 'Paediatrics', date: today, kind: 'late', detail: '' })).rejects.toThrow(/from when/i)

    const f = await m.flagAnswer(ORG, { callId: null, agentName: 'Main reception', text: 'Said parking is paid.', correction: 'Parking is free.' })
    await expect(m.resolveFlag(ORG, f.id, { status: 'fixed', note: 'x' })).rejects.toThrow(/permission to resolve/i)
    const a = admin()
    a.setViewer?.({ id: 'u_admin', name: 'Karthik R', roles: { [ORG]: 'admin' } })
    // A new client is a new store: flag again there.
    const f2 = await a.flagAnswer(ORG, { callId: null, agentName: null, text: 'Said parking is paid.', correction: '' })
    await expect(a.resolveFlag(ORG, f2.id, { status: 'fixed', note: '' })).rejects.toThrow(/say what you changed/i)
    const desk = await a.resolveFlag(ORG, f2.id, { status: 'fixed', note: 'Added parking to the FAQ.' })
    expect(desk.flags.find((x) => x.id === f2.id)).toMatchObject({ status: 'fixed', resolution: { by: 'Karthik R' } })
  })
})

describe('team permissions', () => {
  it('stores changes trimmed to the role, and the defaults as no change', async () => {
    const a = admin()
    const m = await a.setPermissions(ORG, 'u_frontdesk', ['calls.take', 'reports.view', 'team.manage'])
    expect(m.permissions).toEqual(['calls.take', 'reports.view'])
    const reset = await a.setPermissions(ORG, 'u_frontdesk', ['desk.bot', 'desk.notices', 'calls.take', 'appointments.manage', 'calls.personal'])
    expect(reset.permissions).toBeNull()
    await expect(a.setPermissions(ORG, 'u_admin', null)).rejects.toThrow(/your own permissions/i)
    await expect(a.setPermissions(ORG, 'u_owner', [])).rejects.toThrow(/only an owner/i)
    // A new role starts from its defaults.
    await a.setPermissions(ORG, 'u_frontdesk2', ['calls.take'])
    expect((await a.changeRole(ORG, 'u_frontdesk2', 'supervisor')).permissions).toBeNull()
  })

  it('frees callbacks for someone who can no longer take calls', async () => {
    const a = admin()
    await a.setPermissions(ORG, 'u_frontdesk', ['desk.notices'])
    const cbs = await a.listCallbacks(ORG)
    expect(cbs.filter((c) => c.status === 'open').some((c) => c.assignedTo?.id === 'u_frontdesk')).toBe(false)
  })
})

describe('live call guidance', () => {
  it('passes notes to the agent and hands calls to colleagues', async () => {
    const m = meena()
    const live = await m.listLiveCalls(ORG)
    if (!live.length) return // Between sample calls: nothing to guide.
    const call = live[0]
    const guided = await m.whisperToAgent(ORG, call.id, 'Offer Saturday 10 AM.')
    expect(guided.whispers.at(-1)).toMatchObject({ by: 'Meena S', text: 'Offer Saturday 10 AM.' })
    await expect(m.transferCall(ORG, call.id, 'u_viewer', true)).rejects.toThrow(/viewer/i)
    const handed = await m.transferCall(ORG, call.id, 'u_frontdesk2', true)
    expect(handed).toMatchObject({ takenBy: 'Suresh B', transferredTo: { name: 'Suresh B', warm: true } })
    await expect(m.whisperToAgent(ORG, call.id, 'Too late')).rejects.toThrow(/no longer on it/i)
  })
})

describe('test scenarios', () => {
  it('runs the seeded scenarios against the setup, and fails a broken one', async () => {
    const a = admin()
    const ran = await a.runScenarios(ORG, 'agt_appointments')
    expect(ran.length).toBeGreaterThan(0)
    expect(ran.every((s) => s.lastRun?.passed)).toBe(true)
    const bad = await a.saveScenario(ORG, 'agt_appointments', { name: 'Says something it never says', callerSays: ['I want to book an appointment'], expect: { intent: 'Cancel an appointment', mustSay: ['xyzzy'], handover: true } })
    expect(bad.lastRun).toBeNull()
    const again = await a.runScenarios(ORG, 'agt_appointments')
    const run = again.find((s) => s.id === bad.id)!.lastRun!
    expect(run.passed).toBe(false)
    expect(run.problems).toEqual(expect.arrayContaining([expect.stringMatching(/didn’t reach “cancel an appointment”/i), 'Never said “xyzzy”.', 'Didn’t hand over to a person.']))
    await expect(as('u_viewer', 'Arun V', 'viewer').runScenarios(ORG, 'agt_appointments')).rejects.toThrow(/permission to run/i)
  })
})

describe('call quality', () => {
  it('gives each call analysis and timings that agree with its outcome, and reports add up', () => {
    const ctx = { orgSlug: ORG, paused: new Set<string>(), pauses: {} }
    const calls = callLog(ctx, 7)
    const booked = callRecord(calls.find((c) => c.outcome === 'booked')!)
    expect(booked.analysis.success).toBe(true)
    expect(booked.analysis.fields.map((f) => f.label)).toEqual(['Department', 'First visit'])
    expect(booked.metrics.replyP95Ms).toBeGreaterThan(booked.metrics.replyP50Ms)
    expect(booked.metrics.replyP50Ms).toBe(booked.metrics.speechMs + booked.metrics.languageMs + booked.metrics.voiceMs)
    expect(booked.transcript.filter((t) => t.speaker === 'agent').every((t) => typeof t.latencyMs === 'number')).toBe(true)
    expect(callRecord(calls.find((c) => c.outcome === 'dropped')!).analysis.success).toBe(false)

    const r = report(ctx, 7)
    const q = r.quality
    expect(q.sentiment.positive + q.sentiment.neutral + q.sentiment.negative).toBe(r.totals.calls)
    expect(q.success).toBeLessThanOrEqual(r.totals.calls)
    expect(r.agents.reduce((s, a) => s + a.calls, 0)).toBe(r.totals.calls)
  })
})
