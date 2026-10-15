import { describe, expect, it } from 'vitest'
import type { Role } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'

const ORG = 'arogya-demo'
const as = (id: string, name: string, role: Role) => {
  const c = createDemoConsoleClient({ latency: 0, persist: false })
  c.setViewer?.({ id, name, roles: { [ORG]: role } })
  return c
}
const owner = () => as('u_owner', 'Lakshmi K', 'owner')
const admin = () => as('u_admin', 'Karthik R', 'admin')

describe('team rules the server keeps', () => {
  it('stops anyone changing or removing themselves', async () => {
    const c = owner()
    await expect(c.changeRole(ORG, 'u_owner', 'admin')).rejects.toThrow(/your own role/i)
    await expect(c.removeMember(ORG, 'u_owner')).rejects.toThrow(/remove yourself/i)
  })

  it('keeps owners to owners', async () => {
    const c = admin()
    await expect(c.changeRole(ORG, 'u_owner', 'admin')).rejects.toThrow(/only an owner/i)
    await expect(c.changeRole(ORG, 'u_viewer', 'owner')).rejects.toThrow(/only an owner/i)
    await expect(c.removeMember(ORG, 'u_owner')).rejects.toThrow(/only an owner/i)
    await expect(c.inviteMember(ORG, { email: 'boss@example.com', role: 'owner' })).rejects.toThrow(/only an owner/i)
  })

  it('always leaves an owner', async () => {
    // An owner the sample team doesn't list (as a master admin acting would be).
    const c = as('u_someone', 'Someone', 'owner')
    await expect(c.removeMember(ORG, 'u_owner')).rejects.toThrow(/at least one owner/i)
    await expect(c.changeRole(ORG, 'u_owner', 'admin')).rejects.toThrow(/at least one owner/i)
    await c.changeRole(ORG, 'u_admin', 'owner')
    expect((await c.changeRole(ORG, 'u_owner', 'admin')).role).toBe('admin')
  })

  it('refuses duplicate invitations and other roles', async () => {
    const c = admin()
    await expect(c.inviteMember(ORG, { email: 'NEWSTAFF@example.com', role: 'viewer' })).rejects.toThrow(/already invited/i)
    await expect(c.inviteMember(ORG, { email: 'viewer@example.com', role: 'viewer' })).rejects.toThrow(/already in the team/i)
    await expect(as('u_supervisor', 'Priya N', 'supervisor').listMembers(ORG)).resolves.toBeTruthy()
    await expect(as('u_supervisor', 'Priya N', 'supervisor').inviteMember(ORG, { email: 'x@example.com', role: 'viewer' })).rejects.toThrow(/role can’t/i)
  })

  it('gives a removed person’s callbacks back to nobody, and logs it', async () => {
    const c = admin()
    const before = (await c.listCallbacks(ORG)).filter((x) => x.status === 'open' && x.assignedTo?.id === 'u_frontdesk2')
    expect(before.length).toBeGreaterThan(0)
    await c.removeMember(ORG, 'u_frontdesk2')
    const after = await c.listCallbacks(ORG)
    for (const b of before) expect(after.find((x) => x.id === b.id)?.assignedTo).toBeNull()
    const log = await c.listActivity(ORG, { area: 'team' })
    expect(log.entries[0]).toMatchObject({ actor: 'Karthik R', actorId: 'u_admin', text: 'Removed Suresh B (Front desk)' })
  })
})

describe('activity, settings and billing', () => {
  it('pages the log and hides billing from admins', async () => {
    const a = admin()
    const first = await a.listActivity(ORG, {})
    expect(first.entries.every((e) => e.area !== 'billing')).toBe(true)
    const all = [...first.entries]
    let next = first.nextBefore
    while (next) {
      const p = await a.listActivity(ORG, { before: next })
      all.push(...p.entries)
      next = p.nextBefore
    }
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length)
    expect((await owner().listActivity(ORG, { area: 'billing' })).entries.length).toBeGreaterThan(0)
  })

  it('checks settings before changing anything', async () => {
    const c = admin()
    const s = await c.getOrgSettings(ORG)
    await expect(c.updateOrgSettings(ORG, { ...s, name: 'New name', languages: [] })).rejects.toThrow(/at least one language/i)
    await expect(c.updateOrgSettings(ORG, { ...s, closed: [{ date: '2026-02-30', label: 'Nope' }] })).rejects.toThrow(/real date/i)
    expect((await c.getOrgSettings(ORG)).name).toBe(s.name)
    const saved = await c.updateOrgSettings(ORG, { ...s, closed: s.closed.slice(1) })
    expect(saved.updatedBy).toBe('Karthik R')
    expect((await c.listActivity(ORG, { area: 'settings' })).entries[0].text).toMatch(/removed the closed day/i)
  })

  it('upgrades now, downgrades at renewal, and only for owners', async () => {
    await expect(admin().getBilling(ORG)).rejects.toThrow(/role can’t/i)
    const c = owner()
    const up = await c.changePlan(ORG, 'scale')
    expect(up).toMatchObject({ plan: 'scale', pendingPlan: null })
    const down = await c.changePlan(ORG, 'growth')
    expect(down).toMatchObject({ plan: 'scale', pendingPlan: 'growth' })
    expect((await c.changePlan(ORG, null)).pendingPlan).toBeNull()
    await expect(c.updateBillingDetails(ORG, { legalName: 'Arogya', email: 'a@example.com', gstin: '12345' })).rejects.toThrow(/15 characters/i)
  })
})
