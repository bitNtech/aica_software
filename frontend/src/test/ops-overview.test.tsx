import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createDemoOpsClient } from '../ops/demoOpsClient'
import type { OverviewDays } from '../ops/types'
import { renderApp, signIn } from './renderApp'

const as = (role: 'master_admin' | 'staff' | null) => {
  const c = createDemoOpsClient({ latency: 0 })
  c.setViewer?.({ id: 'u_x', name: role === 'staff' ? 'Divya K' : 'Vikram S', platformRole: role })
  return c
}

describe('the overview figures (demo client)', () => {
  it.each([1, 7, 30] as OverviewDays[])('adds up for %s day(s)', async (days) => {
    const o = await as('master_admin').getOverview(days)
    expect(o.buckets).toHaveLength(o.succeeded.length)
    expect(o.failed).toHaveLength(o.buckets.length)
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    expect(sum(o.succeeded) + sum(o.failed)).toBe(o.totals.calls)
    expect(sum(Object.values(o.outcomes))).toBe(o.totals.calls)
    expect(sum(o.orgs.map((x) => x.calls))).toBe(o.totals.calls)
    expect(o.outcomes.dropped + o.outcomes.failed).toBe(sum(o.failed))
    if (days !== 1) expect(o.buckets).toHaveLength(days)
  })

  it('matches the usage page for the same period', async () => {
    const ops = as('master_admin')
    const [o, u] = await Promise.all([ops.getOverview(30), ops.getUsage(30)])
    expect(o.totals.calls).toBe(u.totals.calls)
  })

  it('flags the agent whose calls keep failing, and the organisation behind it', async () => {
    const o = await as('master_admin').getOverview(7)
    const bad = o.agents.find((a) => a.health === 'errors')
    expect(bad?.name).toBe('OPD appointments')
    expect(o.attention.some((a) => a.slug === bad!.orgSlug && a.tone === 'danger')).toBe(true)
    expect(o.agents.some((a) => a.status === 'draft')).toBe(true)
  })

  it('shows admin actions to the master admin only', async () => {
    expect((await as('master_admin').getOverview(7)).activity.some((a) => a.kind === 'admin')).toBe(true)
    expect((await as('staff').getOverview(7)).activity.some((a) => a.kind === 'admin')).toBe(false)
  })

  it('is for bitNtech staff only', async () => {
    await expect(as(null).getOverview(7)).rejects.toThrow(/bitntech staff/i)
    await expect(as(null).getLiveOps()).rejects.toThrow(/bitntech staff/i)
  })

  it('reports live operations with every service, telephony included', async () => {
    const l = await as('staff').getLiveOps()
    expect(l.services.map((s) => s.id).sort()).toEqual(['language', 'speech', 'telephony', 'voice'])
    expect(l.handoffs.length).toBeGreaterThan(0)
    // Emergencies first, and each one raises a critical alert.
    expect(l.handoffs[0].emergency).toBe(true)
    expect(l.alerts[0].severity).toBe('critical')
  })
})

describe('the overview page', () => {
  it('shows every section, and keeps the master admin’s organisation actions', async () => {
    const view = renderApp('/ops')
    await signIn(view.user, 'master@example.com')
    expect(await screen.findByRole('heading', { level: 1, name: /every client/i })).toBeInTheDocument()
    for (const h of ['Needs you', 'Live operations', 'Analytics', 'Organisations', 'Agents', 'Recent activity', 'Platform health'])
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()

    const figures = within(view.container.querySelector<HTMLElement>('dl.kpis')!)
    // Once the figures have arrived, not their placeholders.
    expect(await figures.findByText(/answering calls now/i)).toBeInTheDocument()
    expect(await figures.findByText(/oldest waiting/i)).toBeInTheDocument()
    expect(figures.getByText('Calls today')).toBeInTheDocument()

    expect(await screen.findByRole('button', { name: /suspend nila eye clinic/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /restore marutham hospital/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /review the sign-up from kaveri scans/i })).toHaveAttribute('href', '/ops/requests')
    expect(await screen.findByRole('radio', { name: /admin actions/i })).toBeInTheDocument()
  })

  it('changes the period, and leaves admin actions out for staff', async () => {
    const view = renderApp('/ops')
    await signIn(view.user, 'ops@example.com')
    await screen.findByRole('heading', { level: 2, name: 'Analytics' })
    await view.user.click(screen.getByRole('radio', { name: /^today$/i }))
    expect(await screen.findAllByText(/^today$/i)).not.toHaveLength(0)
    expect(await screen.findByRole('radio', { name: /sign-ups/i })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /admin actions/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /suspend/i })).toBeNull()
  })
})
