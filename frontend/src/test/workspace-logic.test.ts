import { describe, expect, it } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { checkGuardrails, specProblems } from '../pages/console/agent/checks'
import { diffSpecs } from '../pages/console/agent/diff'

const names = { knowledge: (id: string) => id, tool: (id: string) => id, voice: (id: string) => id }
const ORG = 'arogya-demo'

describe('diffSpecs', () => {
  it('says nothing changed for the same setup', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    const d = await c.getAgent(ORG, 'agt_appointments')
    expect(diffSpecs(d.working, structuredClone(d.working), names)).toEqual([])
  })

  it('describes intents, steps, details and settings in words', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    const { working: before } = await c.getAgent(ORG, 'agt_appointments')
    const after = structuredClone(before)
    after.flow[0].label = 'Book an OPD visit'
    after.flow[0].children[0].say = 'Which doctor?'
    after.flow = after.flow.filter((n) => !/timings/i.test(n.label))
    after.attributes = after.attributes.filter((a) => a.label !== 'Visit type')
    after.guardrails.maxCallMinutes = 15
    after.context.toolIds = after.context.toolIds.filter((t) => t !== 'tool_sms')
    const areas = Object.fromEntries(diffSpecs(before, after, names).map((a) => [a.area, a.changes]))
    expect(areas['Conversation flow']).toEqual(
      expect.arrayContaining(['Removed intents: “Ask about timings and directions”.', 'Renamed the intent “Book an appointment” to “Book an OPD visit”.', 'Edited 1 step or branch.']),
    )
    // Steps that went with the removed intent aren't counted again.
    expect(areas['Conversation flow'].some((x) => /removed \d+ step/i.test(x))).toBe(false)
    expect(areas['Details to collect']).toEqual(['Removed details: “Visit type”.'])
    expect(areas['Tools']).toEqual(['Removed tools: “tool_sms”.'])
    expect(areas['Handoff and guardrails']).toEqual(['Longest call: 15 minutes (was 10).'])
  })
})

describe('diffSpecs: the easy-to-miss changes', () => {
  it('notices language following, step and detail order, and pronunciations', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    const { working: before } = await c.getAgent(ORG, 'agt_appointments')
    const after = structuredClone(before)
    after.behaviour.followCaller = !before.behaviour.followCaller
    after.flow[0].children.reverse()
    after.attributes.reverse()
    after.speech.pronunciations[0].sayAs = 'Raama'
    const all = diffSpecs(before, after, names).flatMap((a) => a.changes)
    expect(all).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/follows the caller’s language/i),
        'Changed the order of steps in “Book an appointment”.',
        'Changed the order they’re asked in.',
        'Says “Dr. Ramachandran” as “Raama” (was “Doctor Raa-ma-chan-dran”).',
      ]),
    )
    expect(all.some((x) => /added pronunciations|removed pronunciations/i.test(x))).toBe(false)
  })

  it('counts a merge as moved steps, not removed ones', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    const { working: before } = await c.getAgent(ORG, 'agt_appointments')
    const after = structuredClone(before)
    const [, resched, cancel] = after.flow
    resched.children.push(...cancel.children)
    after.flow = after.flow.filter((n) => n !== cancel)
    after.flow[0].children.splice(0, 2)
    const flow = diffSpecs(before, after, names).find((a) => a.area === 'Conversation flow')!.changes
    expect(flow).toContain('Removed intents: “Cancel an appointment”.')
    expect(flow).toContain('Removed 2 steps.')
  })

  it('lists what changed in a detail', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    const { working: before } = await c.getAgent(ORG, 'agt_appointments')
    const after = structuredClone(before)
    after.attributes[0] = { ...after.attributes[0], required: false, confirm: false }
    const details = diffSpecs(before, after, names).find((a) => a.area === 'Details to collect')!.changes
    expect(details).toEqual(['“Patient name”: now optional, no longer read back.'])
  })
})

describe('workspace checks', () => {
  it('finds problems by tab', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    const { working } = await c.getAgent(ORG, 'agt_appointments')
    const voices = await c.listVoices()
    const tools = await c.listTools(ORG)
    expect(specProblems(working, voices, tools)).toEqual({})
    working.guardrails.transferTo = ' '
    working.behaviour.greeting = ''
    working.attributes[0].label = ''
    const p = specProblems(working, voices, tools)
    expect(Object.keys(p).sort()).toEqual(['behaviour', 'flow', 'rules'])
    expect(Object.keys(p.flow!)[0]).toMatch(/^attr:/)
    expect(checkGuardrails({ ...working.guardrails, recordingNotice: true, recordingNoticeText: '' }).recordingNoticeText).toBeTruthy()
  })
})

describe('demo client: agent workspace', () => {
  it('publishes only real changes, and keeps a version history', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    const d = await c.getAgent(ORG, 'agt_reports')
    await expect(c.publishAgent(ORG, 'agt_reports', '')).rejects.toThrow(/no unpublished changes/i)
    const saved = await c.saveAgent(ORG, 'agt_reports', { ...d.working, redact: false })
    expect(saved.agent.hasChanges).toBe(true)
    expect((await c.listAgents(ORG)).find((a) => a.id === 'agt_reports')?.hasChanges).toBe(true)
    const out = await c.publishAgent(ORG, 'agt_reports', 'Show details')
    expect(out.agent.version).toBe(4)
    expect(out.versions[0]).toMatchObject({ version: 4, note: 'Show details' })
    expect(out.agent.hasChanges).toBe(false)
  })

  it('moves numbers between agents only when free', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    await expect(c.updateAgent(ORG, 'agt_reports', { numberId: 'num_1200' })).rejects.toThrow(/already has an agent/i)
    const moved = await c.updateAgent(ORG, 'agt_reports', { numberId: 'num_1230' })
    expect(moved.agent.phoneNumber).toBe('+91 00000 01230')
    const nums = await c.listNumbers(ORG)
    expect(nums.find((n) => n.id === 'num_1220')?.agentId).toBeNull()
    const none = await c.updateAgent(ORG, 'agt_reports', { numberId: null })
    expect(none.agent.status).toBe('paused')
    await expect(c.updateAgent(ORG, 'agt_reports', { status: 'live' })).rejects.toThrow(/phone number/i)
  })

  it('deletes an agent and frees its number', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    await c.deleteAgent(ORG, 'agt_reception')
    expect((await c.listAgents(ORG)).some((a) => a.id === 'agt_reception')).toBe(false)
    expect((await c.listNumbers(ORG)).find((n) => n.id === 'num_1200')?.agentId).toBeNull()
    await expect(c.getAgent(ORG, 'agt_reception')).rejects.toThrow(/doesn't exist/i)
  })
})
