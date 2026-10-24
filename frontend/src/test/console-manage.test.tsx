import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'

async function open(email: string, path: string) {
  const view = renderApp(path)
  await signIn(view.user, email)
  return view
}
const h1 = (name: RegExp) => screen.findByRole('heading', { level: 1, name }, { timeout: 4000 })
const nav = () => screen.getByRole('navigation', { name: /^organisation$/i })

describe('Organisation pages for owners and admins', () => {
  it('lists the new pages for an owner, and fewer for an admin', async () => {
    await open('owner@example.com', O)
    await h1(/you're in/i)
    for (const l of [/^analytics and reports$/i, /^owners$/i, /^audit log$/i, /^notifications$/i, /^billing and plan$/i, /^usage and limits$/i]) expect(within(nav()).getByRole('link', { name: l })).toBeInTheDocument()
  })

  it('lets an owner make someone an owner, after typing the name, then change them back', async () => {
    const { user } = await open('owner@example.com', `${O}/owners`)
    expect(await screen.findByText(/to step down, ask someone you make an owner/i)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/^who/i), 'u_admin')
    const make = screen.getByRole('button', { name: /^make owner$/i })
    expect(make).toBeDisabled()
    await user.type(screen.getByLabelText(/type arogya demo hospital to confirm/i), 'Arogya Demo Hospital')
    await user.click(make)
    expect(await screen.findByRole('heading', { level: 2, name: /^2 owners$/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /change karthik r to admin/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^change to admin$/i }))
    expect(await screen.findByRole('heading', { level: 2, name: /^1 owner$/i })).toBeInTheDocument()
  })

  it('shows admins who the owners are, without changing them', async () => {
    await open('admin@example.com', `${O}/owners`)
    expect(await screen.findByRole('heading', { level: 2, name: /^1 owner$/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /make someone an owner/i })).toBeNull()
    expect(within(nav()).queryByRole('link', { name: /usage and limits/i })).toBeNull()
  })

  it('shows usage against the plan with a forecast', async () => {
    await open('owner@example.com', `${O}/usage`)
    expect(await screen.findByText('Call minutes', undefined, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText('Live agents')).toBeInTheDocument()
    expect(screen.getByText(/at this rate, about/i)).toBeInTheDocument()
    expect(screen.getByText(/when minutes reach 80% of the plan/i)).toBeInTheDocument()
  })

  it('saves who gets alerts, and refuses an alert nobody gets', async () => {
    const { user } = await open('owner@example.com', `${O}/notifications`)
    const card = (await screen.findByRole('region', { name: /^team$/i }, { timeout: 4000 }))
    for (const box of within(card).getAllByRole('checkbox')) if ((box as HTMLInputElement).checked) await user.click(box)
    await user.click(screen.getByRole('button', { name: /save notifications/i }))
    expect(await screen.findByText(/choose who gets it, or turn it off/i)).toBeInTheDocument()
    await user.click(within(card).getByRole('switch'))
    await user.click(screen.getByRole('button', { name: /save notifications/i }))
    expect(await screen.findByText(/^saved\./i)).toBeInTheDocument()
  })

  it('offers the audit log for download, with a period', async () => {
    await open('owner@example.com', `${O}/audit`)
    expect(await h1(/audit log/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^when/i)).toHaveValue('30')
  })

  it('sends the old reports address to analytics', async () => {
    await open('owner@example.com', `${O}/reports`)
    expect(await h1(/analytics and reports/i)).toBeInTheDocument()
  })

  it('keeps a one-organisation person’s account inside the console', async () => {
    await open('frontdesk@example.com', '/account')
    expect(await screen.findByRole('heading', { level: 2, name: /your role in arogya demo hospital/i }, { timeout: 4000 })).toBeInTheDocument()
    expect(within(nav()).queryByRole('link', { name: /^owners$/i })).toBeNull()
  })

  it('keeps front desk out of owners, usage and notifications', async () => {
    await open('frontdesk@example.com', `${O}/notifications`)
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: /notifications/i })).toBeNull())
    expect(await screen.findByText(/isn't part of the front desk role here/i)).toBeInTheDocument()
  })
})

describe('the demo alert settings', () => {
  it('validates thresholds and quiet hours, and is for managers only', async () => {
    const c = createDemoConsoleClient({ latency: 0, persist: false })
    c.setViewer?.({ id: 'u_owner', name: 'Lakshmi K', roles: { 'arogya-demo': 'owner' } })
    const s = await c.getAlertSettings('arogya-demo')
    const bad = s.rules.map((r) => (r.key === 'usage_threshold' ? { ...r, threshold: 150 } : r))
    await expect(c.updateAlertSettings('arogya-demo', { rules: bad, quietHours: s.quietHours })).rejects.toThrow(/1 to 100/)
    await expect(c.updateAlertSettings('arogya-demo', { rules: s.rules, quietHours: { enabled: true, from: '25:00', to: '07:00' } })).rejects.toThrow(/quiet hours/i)
    const saved = await c.updateAlertSettings('arogya-demo', { rules: s.rules, quietHours: { enabled: true, from: '22:00', to: '06:30' } })
    expect(saved.updatedBy).toBe('Lakshmi K')
    c.setViewer?.({ id: 'u_frontdesk', name: 'Meena S', roles: { 'arogya-demo': 'front_desk' } })
    await expect(c.getAlertSettings('arogya-demo')).rejects.toThrow(/permission/i)
  })
})
