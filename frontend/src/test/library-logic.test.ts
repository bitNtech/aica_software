import { describe, expect, it } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { search } from '../console/demo/passages'
import { seedKnowledge } from '../console/demo/library'

const ORG = 'arogya-demo'
const client = (processingMs = 9000) => createDemoConsoleClient({ latency: 0, persist: false, processingMs })

describe('knowledge search (demo stand-in)', () => {
  it('matches on meaningful words, not filler', () => {
    const hits = search(seedKnowledge(), 'Is the cardiologist in on Wednesday?')
    expect(hits[0].text).toMatch(/ramachandran, cardiology/i)
    expect(hits.some((p) => /complete blood count/i.test(p.text))).toBe(false)
    expect(search(seedKnowledge(), 'the and for')).toEqual([])
  })
})

describe('demo client: library rules', () => {
  it('reads new knowledge, then lets it be found', async () => {
    const c = client(0)
    const k = await c.addKnowledge(ORG, { kind: 'faq', name: 'Lab FAQ', description: '', faq: [{ q: 'When do reports come?', a: 'Most by the same evening.' }], expiresAt: null })
    expect(k.status).toBe('ready')
    const hits = await c.searchKnowledge(ORG, [k.id], 'When will my reports come?')
    expect(hits[0].sourceName).toBe('Lab FAQ')
    await expect(c.addKnowledge(ORG, { kind: 'web', name: 'Site', description: '', url: 'http://x', refreshEvery: 'never', expiresAt: null })).rejects.toThrow(/https/i)
  })

  it('changes nothing when a knowledge edit is refused', async () => {
    const c = client()
    await expect(c.updateKnowledge(ORG, 'kb_faq', { name: 'Renamed FAQ', faq: [] })).rejects.toThrow(/at least one question/i)
    expect((await c.listKnowledge(ORG)).find((k) => k.id === 'kb_faq')?.name).toBe('Visiting hours and directions')
  })

  it('counts every version, and drafts, as using knowledge', async () => {
    const c = client()
    const k = (await c.listKnowledge(ORG)).find((x) => x.id === 'kb_doctors')!
    expect(k.usedBy).toEqual(['Main reception', 'OPD appointments'])
    await expect(c.deleteKnowledge(ORG, 'kb_doctors')).rejects.toThrow(/take it out/i)
  })

  it('refuses to delete built-in tools or a stale tool', async () => {
    const c = client()
    await expect(c.deleteTool(ORG, 'tool_transfer')).rejects.toThrow(/switched off, not deleted/i)
    const slots = (await c.listTools(ORG)).find((t) => t.id === 'tool_slots')!
    await expect(c.saveTool(ORG, { ...slots, id: 'tool_gone' })).rejects.toThrow(/doesn't exist/i)
    await expect(c.saveTool(ORG, { ...slots, description: 'short' })).rejects.toThrow(/say what it does/i)
  })

  it('removes a call from drafts that chose it', async () => {
    const c = client()
    const draft = (await c.listAgents(ORG)).find((a) => a.setupStep)!
    const before = await c.getDraft(ORG, draft.id)
    await c.deleteCall(ORG, before.sourceCallIds[0])
    expect((await c.getDraft(ORG, draft.id)).sourceCallIds).not.toContain(before.sourceCallIds[0])
  })

  it('checks tools against their secrets', async () => {
    const c = client()
    const book = (await c.listTools(ORG)).find((t) => t.id === 'tool_book')!
    await expect(c.saveTool(ORG, { ...book, credentialName: 'NOPE_KEY' })).rejects.toThrow(/no secret called NOPE_KEY/)
    await expect(c.deleteCredential(ORG, 'LIS_TOKEN')).rejects.toThrow(/uses LIS_TOKEN/)
    const saved = await c.saveTool(ORG, { ...book, description: 'Books a slot.' })
    expect(saved.lastTestedAt).toBeNull()
    expect((await c.testTool(ORG, 'tool_book', {})).summary).toMatch(/fill in patient_name/i)
  })

  it('moves numbers between agents, and checks out-of-hours handovers', async () => {
    const c = client()
    await expect(c.updateNumber(ORG, 'num_1230', { afterHours: 'transfer', transferTo: '' })).rejects.toThrow(/after hours/i)
    await c.updateNumber(ORG, 'num_1230', { agentId: 'agt_reports' })
    const nums = await c.listNumbers(ORG)
    expect(nums.find((n) => n.id === 'num_1230')?.agentId).toBe('agt_reports')
    expect(nums.find((n) => n.id === 'num_1220')?.agentId).toBeNull()
    const agents = await c.listAgents(ORG)
    expect(agents.find((a) => a.id === 'agt_reports')?.phoneNumber).toBe('+91 00000 01230')
    // Taking the reception agent's number leaves it paused, with none.
    await c.updateNumber(ORG, 'num_1200', { agentId: null })
    expect((await c.listAgents(ORG)).find((a) => a.id === 'agt_reception')).toMatchObject({ phoneNumber: null, status: 'paused' })
  })
})
