import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createDemoOpsClient } from '../ops/demoOpsClient'
import { renderApp, signIn } from './renderApp'

async function open(email: string, path: string) {
  const view = renderApp(path)
  await signIn(view.user, email)
  return view
}
const h1 = (name: RegExp) => screen.findByRole('heading', { level: 1, name }, { timeout: 4000 })

describe('Ops pages for every organisation', () => {
  it('lists, searches and filters organisations', async () => {
    const { user } = await open('master@example.com', '/ops/orgs')
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: 'Arogya Demo Hospital' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/search organisations/i), 'madurai')
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2)
    expect(within(screen.getByRole('table')).getByText(/nila eye/i)).toBeInTheDocument()
  })

  it('opens an organisation with links to everything bitNtech manages there', async () => {
    await open('master@example.com', '/ops/orgs/arogya-demo')
    const manage = await screen.findByRole('navigation', { name: /manage arogya/i })
    for (const l of ['Agents', 'Calls', 'Team', 'Settings', 'Billing']) expect(within(manage).getByRole('link', { name: l })).toBeInTheDocument()
  })

  it('shows callers to the master admin, and hides them from staff', async () => {
    await open('master@example.com', '/ops/calls')
    const table = await screen.findByRole('table', undefined, { timeout: 4000 })
    expect(within(table).queryAllByText('Hidden')).toHaveLength(0)
    expect(within(table).getAllByRole('link').length).toBeGreaterThan(0)
  })

  it('keeps staff away from callers’ details and the call pages', async () => {
    await open('ops@example.com', '/ops/calls')
    const table = await screen.findByRole('table', undefined, { timeout: 4000 })
    expect(within(table).getAllByText('Hidden').length).toBeGreaterThan(0)
    expect(within(table).queryAllByRole('link')).toHaveLength(0)
    expect(within(screen.getByRole('navigation', { name: /^ops$/i })).queryByRole('link', { name: /billing/i })).toBeNull()
  })

  it('sends staff from an organisation’s call pages back to the organisation', async () => {
    await open('ops@example.com', '/ops/orgs/arogya-demo/calls')
    expect(await h1(/arogya demo hospital/i)).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: /manage arogya/i })).queryByRole('link', { name: 'Calls' })).toBeNull()
  })

  it('shows live calls, handoffs and callbacks, and appointments', async () => {
    const { user } = await open('master@example.com', '/ops/calls/live')
    expect(await h1(/live calls/i)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /waiting for a person/i })).toBeInTheDocument()
    // Each page draws its own sidebar: find it afresh after moving.
    const nav = () => screen.getByRole('navigation', { name: /^ops$/i })
    await user.click(within(nav()).getByRole('link', { name: /handoffs and callbacks/i }))
    expect(await screen.findByRole('heading', { level: 2, name: /^callbacks$/i }, { timeout: 4000 })).toBeInTheDocument()
    await user.click(within(nav()).getByRole('link', { name: /appointments/i }))
    expect(await h1(/appointments/i)).toBeInTheDocument()
    expect(await screen.findByText(/needs a check/i, { selector: 'dt' })).toBeInTheDocument()
  })

  it('lists every organisation’s tools and phone lines', async () => {
    const { user } = await open('master@example.com', '/ops/integrations')
    expect(await screen.findByRole('region', { name: /^tools$/i }, { timeout: 4000 })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /phone lines/i }))
    expect(await screen.findByRole('region', { name: /phone lines/i })).toBeInTheDocument()
  })

  it('shows billing to the master admin only', async () => {
    await open('master@example.com', '/ops/billing')
    expect(await screen.findByRole('heading', { level: 2, name: /subscriptions/i }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /invoices/i })).toBeInTheDocument()
  })

  it('sends staff away from billing and security', async () => {
    await open('ops@example.com', '/ops/security')
    expect(await screen.findByRole('heading', { level: 1, name: /every client/i })).toBeInTheDocument()
  })
})

describe('Platform pages', () => {
  it('refuses a bad address range, then saves the security policies', async () => {
    const { user } = await open('master@example.com', '/ops/security')
    const ranges = await screen.findByLabelText(/address ranges/i)
    await user.type(ranges, 'not-a-range')
    await user.click(screen.getByRole('button', { name: /save policies/i }))
    expect(await screen.findByText(/isn’t an address range/i)).toBeInTheDocument()
    await user.clear(ranges)
    await user.type(ranges, '203.0.113.0/24')
    await user.click(screen.getByRole('button', { name: /save policies/i }))
    expect(await screen.findByText(/^saved\./i)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 2, name: /access review/i })).toBeInTheDocument()
  })

  it('lets the master admin declare and resolve an incident', async () => {
    const { user } = await open('master@example.com', '/ops/incidents')
    await user.click(await screen.findByRole('button', { name: /declare an incident/i }))
    await user.type(screen.getByLabelText(/^title/i), 'Booking tool timing out')
    await user.type(screen.getByLabelText(/what’s happening/i), 'Appointments agents can’t book; callers are offered a callback.')
    await user.click(screen.getByRole('button', { name: /^declare incident$/i }))
    const card = (await screen.findByRole('heading', { name: 'Booking tool timing out' })).closest('li')!
    await user.click(within(card).getByRole('button', { name: /post an update/i }))
    await user.selectOptions(within(card).getByLabelText(/^now/i), 'resolved')
    await user.type(within(card).getByLabelText(/what changed/i), 'The booking system is back.')
    await user.click(within(card).getByRole('button', { name: /^post update$/i }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Booking tool timing out' })).toBeNull())
    await user.click(screen.getByRole('radio', { name: /resolved/i }))
    expect(await screen.findByRole('heading', { name: 'Booking tool timing out' })).toBeInTheDocument()
  })

  it('lets staff read incidents, not declare them', async () => {
    await open('ops@example.com', '/ops/incidents')
    expect(await h1(/incidents/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /declare an incident/i })).toBeNull()
  })

  it('lists agent versions and platform releases', async () => {
    await open('master@example.com', '/ops/deployments')
    const table = await screen.findByRole('table', undefined, { timeout: 4000 })
    expect(within(table).getAllByRole('link', { name: /v\d+$/ }).length).toBeGreaterThan(0)
    expect(within(table).getByText(/web app, october release 3/i)).toBeInTheDocument()
  })

  it('shows analytics with a download', async () => {
    await open('master@example.com', '/ops/analytics')
    expect(await h1(/analytics/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /download csv/i })).toBeEnabled())
  })

  it('sends the old change requests address to support requests', async () => {
    await open('master@example.com', '/ops/changes')
    expect(await h1(/support requests/i)).toBeInTheDocument()
  })

  it('keeps a bitNtech account inside Ops', async () => {
    const { user } = await open('master@example.com', '/ops')
    await user.click(await screen.findByRole('link', { name: /vikram s: your account/i }))
    expect(await screen.findByRole('heading', { level: 2, name: /your access/i })).toBeInTheDocument()
    expect(screen.getByText(/two-step sign-in is required/i)).toBeInTheDocument()
  })
})

describe('the demo Ops client', () => {
  it('validates incidents and policies, and keeps staff read-only', async () => {
    const staff = createDemoOpsClient({ latency: 0 })
    staff.setViewer?.({ id: 'u', name: 'Divya K', platformRole: 'staff' })
    await expect(staff.createIncident({ title: 'Something broke', service: 'app', severity: 'minor', text: 'Something broke badly.' })).rejects.toThrow(/master admin/i)
    const p = await staff.getSecurityPolicy()
    const { updatedAt: _a, updatedBy: _b, ...input } = p
    await expect(staff.updateSecurityPolicy(input)).rejects.toThrow(/master admin/i)
    const master = createDemoOpsClient({ latency: 0 })
    master.setViewer?.({ id: 'm', name: 'Vikram S', platformRole: 'master_admin' })
    await expect(master.updateSecurityPolicy({ ...input, passwordMinLength: 4 })).rejects.toThrow(/8 to 64/)
    await expect(master.createIncident({ title: 'x', service: 'app', severity: 'minor', text: 'short' })).rejects.toThrow(/title/i)
    expect((await master.listDeployments()).some((d) => d.component === 'agent' && d.status === 'live')).toBe(true)
  })
})
