import { describe, expect, it } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { createDemoOpsClient } from '../ops/demoOpsClient'

const as = (role: 'master_admin' | 'staff' | null) => {
  const c = createDemoOpsClient({ latency: 0 })
  c.setViewer?.({ id: 'u_x', name: role === 'staff' ? 'Divya K' : 'Vikram S', platformRole: role })
  return c
}
const owner = () => {
  const c = createDemoConsoleClient({ latency: 0, persist: false })
  c.setViewer?.({ id: 'u_owner', name: 'Lakshmi K', roles: { 'arogya-demo': 'owner' } })
  return c
}

describe('Ops changes reach the organisation console', () => {
  it('hides a template from builder step 1, and offers a new one only once shown', async () => {
    const ops = as('master_admin')
    await ops.setTemplatePublished('hospital', 'billing', false)
    const types = await owner().listAgentTypes()
    expect(types.find((t) => t.id === 'hospital')!.subTypes.map((s) => s.id)).not.toContain('billing')
    const t = await ops.saveTemplate({ typeId: 'clinic', label: 'Eye tests', description: 'Books eye tests and spectacle fittings.', covers: ['Eye test', 'Spectacles'] })
    expect(t.published).toBe(false)
    expect((await owner().listAgentTypes()).find((x) => x.id === 'clinic')!.subTypes.some((s) => s.id === t.id)).toBe(false)
    await ops.setTemplatePublished('clinic', t.id, true)
    expect((await owner().listAgentTypes()).find((x) => x.id === 'clinic')!.subTypes.some((s) => s.id === t.id)).toBe(true)
  })

  it('takes a switched-off voice out of the builder, and plan changes into billing', async () => {
    const ops = as('master_admin')
    const s = await ops.getPlatformSettings()
    await ops.updatePlatformSettings({ models: s.models, voices: { selvi: false }, plans: s.plans.map((p) => (p.id === 'growth' ? { ...p, minutes: 5000 } : p)) })
    expect((await owner().listVoices()).map((v) => v.id)).not.toContain('selvi')
    const b = await owner().getBilling('arogya-demo')
    expect(b.plans.find((p) => p.id === 'growth')!.minutes).toBe(5000)
  })

  it('refuses settings that would break builders', async () => {
    const ops = as('master_admin')
    const s = await ops.getPlatformSettings()
    await expect(ops.updatePlatformSettings({ models: s.models, voices: { kavya: false }, plans: s.plans })).rejects.toThrow(/kavya/i)
    await expect(ops.updatePlatformSettings({ models: s.models, voices: { kavya: true, arun: false, selvi: false }, plans: s.plans })).resolves.toBeTruthy()
    await expect(ops.updatePlatformSettings({ models: { ...s.models, language: 'nope' }, voices: {}, plans: s.plans })).rejects.toThrow(/choose a model/i)
  })
})

describe('who may do what in Ops', () => {
  it('lets staff read but not change', async () => {
    const staff = as('staff')
    await expect(staff.getOrgDetail('arogya-demo')).resolves.toBeTruthy()
    await expect(staff.retryJob('arogya-demo', 'job_silent')).rejects.toThrow(/only the master admin/i)
    await expect(staff.setTemplatePublished('hospital', 'billing', false)).rejects.toThrow(/only the master admin/i)
    await expect(staff.getPlatformSettings()).rejects.toThrow(/only the master admin/i)
    await expect(as(null).getUsage(7)).rejects.toThrow(/bitntech staff/i)
  })

  it('adds up usage, and retries only failed jobs', async () => {
    const ops = as('master_admin')
    const u = await ops.getUsage(30)
    expect(u.days).toHaveLength(30)
    expect(u.totals.minutes).toBe(u.orgs.reduce((s, o) => s + o.minutes, 0))
    for (const o of u.orgs) expect(o.minutesByDay.reduce((s, n) => s + n, 0)).toBe(o.minutes)
    await expect(ops.retryJob('arogya-demo', 'kb_doctors')).rejects.toThrow(/only a failed job/i)
    expect((await ops.retryJob('arogya-demo', 'job_silent')).status).toBe('queued')
  })
})
