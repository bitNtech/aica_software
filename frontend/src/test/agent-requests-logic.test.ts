import { describe, expect, it } from 'vitest'
import type { Permission } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'

const ORG = 'arogya-demo'

function as(id: string, name: string, role: 'admin' | 'front_desk' | null, extra: { permissions?: Permission[]; platformRole?: 'master_admin' } = {}) {
  const c = createDemoConsoleClient({ latency: 0, persist: false })
  c.setViewer?.({ id, name, roles: role ? { [ORG]: role } : {}, permissions: extra.permissions ? { [ORG]: extra.permissions } : undefined, platformRole: extra.platformRole ?? null })
  return c
}
/** Two people on one set of data: the hospital's admin and bitNtech's master admin. */
function pair() {
  const c = createDemoConsoleClient({ latency: 0, persist: false })
  const asAdmin = () => c.setViewer?.({ id: 'u_admin', name: 'Karthik R', roles: { [ORG]: 'admin' }, platformRole: null })
  const asMaster = () => c.setViewer?.({ id: 'u_master', name: 'Vikram S', roles: {}, platformRole: 'master_admin' })
  return { c, asAdmin, asMaster }
}

describe('reading calls into flows', () => {
  it('groups related calls into one flow, keeps unrelated ones apart, and suggests the job’s own', async () => {
    const a = as('u_admin', 'Karthik R', 'admin')
    const d = await a.createDraft(ORG, 'Arogya')
    const calls = (await a.listCalls(ORG)).filter((x) => x.status === 'ready')
    await a.saveDraft(ORG, { ...d, sourceCallIds: calls.map((x) => x.id), consent: true, typeId: 'hospital', subTypeId: 'reports' })
    const x = await a.extractFlow(ORG, d.id)
    const groups = x.flowGroups!
    // Booking and directions belong together; reports and bills are each their own.
    expect(groups.map((g) => g.title)).toEqual(['Lab reports', 'Appointments and visits', 'Bills and insurance'])
    expect(groups[0].matchesJob).toBe(true)
    expect(groups.find((g) => g.title === 'Appointments and visits')!.topics.sort()).toEqual(['Booking an appointment', 'Timings and directions'])
    // Every call is in exactly one group.
    expect(groups.flatMap((g) => g.callIds).sort()).toEqual(calls.map((c) => c.id).sort())
    // The new agent takes the suggested group's flow, which branches.
    expect(x.flowGroupId).toBe(groups[0].id)
    expect(x.flow).toEqual(groups[0].flow)
    const report = x.flow[0]
    const lookup = report.children[0].children[0]
    expect(lookup.label).toBe('Look up the report')
    expect(lookup.children.map((n) => n.kind)).toEqual(['branch', 'branch', 'step'])
  })

  it('makes one flow when every call is about related things', async () => {
    const a = as('u_admin', 'Karthik R', 'admin')
    const d = await a.createDraft(ORG, 'Arogya')
    const calls = (await a.listCalls(ORG)).filter((x) => x.topic === 'Booking an appointment' || x.topic === 'Timings and directions')
    await a.saveDraft(ORG, { ...d, sourceCallIds: calls.map((x) => x.id), consent: true, typeId: 'hospital', subTypeId: 'appointments' })
    const x = await a.extractFlow(ORG, d.id)
    expect(x.flowGroups!.map((g) => g.title)).toEqual(['Appointments and visits'])
  })
})

describe('the organisation’s own drafts, sent as requests', () => {
  it('sends a new agent to bitNtech, locks it, unlocks it on withdrawal, and is done when bitNtech publishes it', async () => {
    const { c, asAdmin, asMaster } = pair()
    asAdmin()
    let d = await c.createDraft(ORG, 'Arogya')
    const calls = (await c.listCalls(ORG)).filter((x) => x.topic === 'Report status')
    d = await c.saveDraft(ORG, { ...d, sourceCallIds: calls.map((x) => x.id), consent: true, typeId: 'hospital', subTypeId: 'reports', name: 'Lab line' })
    d = await c.extractFlow(ORG, d.id)
    // Not sent yet: in Agents as theirs to carry on with.
    expect((await c.listAgents(ORG)).find((x) => x.id === d.id)?.request).toEqual({ state: 'drafting', by: 'Karthik R', requestId: null })

    const r = await c.submitDraft!(ORG, d.id, { title: 'New agent: Lab line', note: 'About 40 calls a week.', urgency: 'soon' })
    expect(r).toMatchObject({ kind: 'new_agent', draftId: d.id, status: 'open', urgency: 'soon', agentId: null })
    expect(r.detail).toContain('About 40 calls a week.')
    expect(r.detail).toContain('Intent: Check if a report is ready')
    expect(r.detail).toMatch(/- Branch: Report is ready \(when All tests are reported\)/)
    // Locked while bitNtech has it.
    await expect(c.saveDraft(ORG, { ...d, name: 'Changed' })).rejects.toThrow(/withdraw the request/i)
    await expect(c.submitDraft!(ORG, d.id, { title: 'Again please', note: '', urgency: 'normal' })).rejects.toThrow(/withdraw/i)
    // The organisation can't publish it.
    await expect(c.publishDraft(ORG, d.id, null)).rejects.toThrow(/only bitntech/i)

    await c.withdrawChangeRequest(ORG, r.id)
    const open = await c.saveDraft(ORG, { ...(await c.getDraft(ORG, d.id)), name: 'Lab reports line' })
    expect(open.submittedAt).toBeNull()
    const again = await c.submitDraft!(ORG, d.id, { title: 'New agent: Lab reports line', note: '', urgency: 'normal' })

    // bitNtech can still work on it, then publishes it for them.
    asMaster()
    const seen = await c.getDraft(ORG, d.id)
    expect(seen.requestedBy).toEqual({ id: 'u_admin', name: 'Karthik R' })
    await c.saveDraft(ORG, { ...seen, behaviour: { ...seen.behaviour, persona: 'Selvi' } })
    const agent = await c.publishDraft(ORG, d.id, null)
    expect(agent).toMatchObject({ name: 'Lab reports line', status: 'paused', version: 1 })
    const done = (await c.listChangeRequests(ORG)).find((x) => x.id === again.id)!
    expect(done.status).toBe('done')
    expect(done.replies.at(-1)).toMatchObject({ byKind: 'bitntech', text: expect.stringMatching(/built and published as lab reports line/i) })
  })

  it('needs permission to ask, and keeps bitNtech’s own drafts from the organisation', async () => {
    const { c, asAdmin, asMaster } = pair()
    asMaster()
    const theirs = await c.createDraft(ORG, 'Arogya')
    expect(theirs.requestedBy).toBeNull()
    asAdmin()
    await expect(c.getDraft(ORG, theirs.id)).rejects.toThrow(/bitntech is building/i)
    await expect(c.saveDraft(ORG, theirs)).rejects.toThrow(/bitntech is building/i)
    const desk = as('u_frontdesk', 'Meena S', 'front_desk')
    await expect(desk.createDraft(ORG, 'Arogya')).rejects.toThrow(/permission/i)
    await expect(desk.startAgentChange!(ORG, 'agt_appointments')).rejects.toThrow(/permission/i)
  })
})

describe('changes to a published agent in the builder', () => {
  it('starts from the agent’s setup, reads new calls without touching its flow, and is sent as a flow change', async () => {
    const { c, asAdmin, asMaster } = pair()
    asAdmin()
    const before = await c.getAgent(ORG, 'agt_appointments')
    const d = await c.startAgentChange!(ORG, 'agt_appointments')
    expect(d).toMatchObject({ baseAgentId: 'agt_appointments', baseVersion: before.agent.version, name: 'OPD appointments', reached: 'review' })
    expect(d.flow).toEqual(before.working.flow)
    expect(d.guardrails).toEqual(before.working.guardrails)
    // One set of changes at a time: asking again opens the same one.
    expect((await c.startAgentChange!(ORG, 'agt_appointments')).id).toBe(d.id)
    // It shows on the agent, not as an agent of its own.
    const listed = await c.listAgents(ORG)
    expect(listed.some((x) => x.id === d.id)).toBe(false)
    expect(listed.find((x) => x.id === 'agt_appointments')!.change).toMatchObject({ draftId: d.id, state: 'drafting', by: 'Karthik R' })
    expect((await c.getAgent(ORG, 'agt_appointments')).agent.change?.draftId).toBe(d.id)
    // The agent shows as it comes across on a call.
    expect(listed.find((x) => x.id === 'agt_appointments')).toMatchObject({ persona: expect.any(String), greeting: expect.any(String), intents: expect.arrayContaining(['Book an appointment']) })

    const billing = (await c.listCalls(ORG)).filter((x) => x.topic === 'Bill and insurance')
    await c.saveDraft(ORG, { ...d, sourceCallIds: billing.map((x) => x.id), consent: true })
    const read = await c.extractFlow(ORG, d.id)
    expect(read.flow).toEqual(before.working.flow)
    expect(read.flowGroups!.map((g) => g.title)).toEqual(['Bills and insurance'])

    // Add what the calls found, and send it.
    const added = await c.saveDraft(ORG, { ...read, flow: [...read.flow, ...read.flowGroups![0].flow] })
    const r = await c.submitDraft!(ORG, added.id, { title: 'Changes to OPD appointments', note: '', urgency: 'normal', changes: ['Conversation flow: Added intents: “Ask about an insurance claim”.'] })
    expect(r).toMatchObject({ kind: 'flow_change', agentId: 'agt_appointments', agentName: 'OPD appointments', draftId: d.id })
    expect(r.detail).toContain('What changed:\n- Conversation flow: Added intents')

    // bitNtech publishes it as the agent's next version.
    asMaster()
    const out = await c.publishDraft(ORG, d.id, null)
    expect(out.version).toBe((before.agent.version ?? 0) + 1)
    const after = await c.getAgent(ORG, 'agt_appointments')
    expect(after.versions[0].spec.flow.map((n) => n.label)).toContain('Ask about an insurance claim')
    expect(after.agent.change).toBeUndefined()
    expect((await c.listChangeRequests(ORG)).find((x) => x.id === r.id)!.status).toBe('done')
  })

  it('lets the organisation change an agent by hand, without calls', async () => {
    const a = as('u_admin', 'Karthik R', 'admin')
    const d = await a.startAgentChange!(ORG, 'agt_reports')
    expect(d.sourceCallIds).toEqual([])
    const r = await a.submitDraft!(ORG, d.id, { title: 'Greet in Tamil first', note: '', urgency: 'normal' })
    expect(r.kind).toBe('flow_change')
  })
})
