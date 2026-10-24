import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'

async function open(email: string, path: string) {
  const view = renderApp(path)
  await signIn(view.user, email)
  return view
}

const row = (list: HTMLElement, name: RegExp) => within(list).getByRole('heading', { name }).closest('li')!

describe('Team', () => {
  it('lets an owner invite, change roles and remove, but not change themselves', async () => {
    const { user } = await open('owner@example.com', `${O}/team`)
    const members = await screen.findByRole('list', { name: /^members/i })
    expect(within(row(members, /lakshmi k/i)).queryByRole('button')).toBeNull()
    expect(within(row(members, /lakshmi k/i)).getByText(/this is you/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /invite someone/i }))
    const invite = screen.getByRole('dialog', { name: /invite someone/i })
    expect(within(invite).getByRole('radio', { name: /^owner/i })).toBeInTheDocument()
    await user.click(within(invite).getByRole('button', { name: /send invitation/i }))
    expect(within(invite).getByText(/enter an email address/i)).toBeInTheDocument()
    await user.type(within(invite).getByLabelText(/their email/i), 'nurse@example.com')
    await user.click(within(invite).getByRole('radio', { name: /^supervisor/i }))
    await user.click(within(invite).getByRole('button', { name: /send invitation/i }))
    const invites = await screen.findByRole('list', { name: /^invitations/i })
    expect(within(invites).getByText('nurse@example.com')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /change suresh b’s role/i }))
    const dialog = screen.getByRole('dialog', { name: /change suresh b’s role/i })
    await user.click(within(dialog).getByRole('radio', { name: /^supervisor/i }))
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(within(row(members, /suresh b/i)).getByText('Supervisor')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /remove arun v/i }))
    await user.click(within(screen.getByRole('dialog', { name: /remove arun v/i })).getByRole('button', { name: /^remove$/i }))
    await waitFor(() => expect(within(members).queryByRole('heading', { name: /arun v/i })).toBeNull())
    expect(screen.getByRole('heading', { name: /^members/i })).toHaveFocus()
  })

  it('keeps admins away from owners', async () => {
    const { user } = await open('admin@example.com', `${O}/team`)
    const members = await screen.findByRole('list', { name: /^members/i })
    expect(within(row(members, /lakshmi k/i)).getByText(/only an owner can change an owner/i)).toBeInTheDocument()
    expect(within(row(members, /lakshmi k/i)).queryByRole('button')).toBeNull()
    await user.click(screen.getByRole('button', { name: /invite someone/i }))
    expect(within(screen.getByRole('dialog', { name: /invite someone/i })).queryByRole('radio', { name: /^owner/i })).toBeNull()
  })

  it('isn’t open to supervisors or the front desk', async () => {
    await open('supervisor@example.com', `${O}/team`)
    expect(await screen.findByText(/team isn't part of the supervisor role/i)).toBeInTheDocument()
  })
})

describe('Audit log (was Organisation activity)', () => {
  it('shows what changed, filters it, and hides billing from admins', async () => {
    const { user } = await open('admin@example.com', `${O}/activity`)
    expect(await screen.findByText(/signed in as karthik r for 30 minutes/i)).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^billing$/i })).toBeNull()
    expect(screen.queryByText(/changed the plan/i)).toBeNull()
    await user.click(screen.getByRole('radio', { name: /^team$/i }))
    await waitFor(() => expect(screen.queryByText(/published opd appointments/i)).toBeNull())
    expect(screen.getByText(/invited newstaff@example.com as supervisor/i)).toBeInTheDocument()
  })

  it('records changes made on the Team page', async () => {
    const { user } = await open('owner@example.com', `${O}/team`)
    await user.click(await screen.findByRole('button', { name: /remove arun v/i }))
    await user.click(within(screen.getByRole('dialog', { name: /remove arun v/i })).getByRole('button', { name: /^remove$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(within(screen.getByRole('navigation', { name: /organisation/i })).getByRole('link', { name: /^audit log$/i }))
    expect(await screen.findByText(/removed arun v \(viewer\)/i)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^billing$/i })).toBeInTheDocument()
  })
})

describe('Organisation settings', () => {
  it('checks hours, adds a closed day and saves', async () => {
    const { user } = await open('admin@example.com', `${O}/settings`)
    const save = await screen.findByRole('button', { name: /save changes/i })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    const opens = screen.getByLabelText('Monday opens')
    await user.clear(opens)
    await user.type(opens, '21:00')
    await user.click(save)
    expect(await screen.findByText(/monday: opening time must be before closing time/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Monday opens')).toHaveFocus())
    await user.click(screen.getByRole('button', { name: /undo changes/i }))

    await user.type(screen.getByLabelText(/^date/i), '2026-11-14')
    await user.type(screen.getByLabelText(/what it is/i), 'Hospital day{Enter}')
    expect(screen.getByText('Hospital day')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByText(/last changed by karthik r just now/i)).toBeInTheDocument()
  })
})

describe('Billing', () => {
  it('is for owners: upgrade now, and a smaller plan is refused when it can’t fit', async () => {
    const { user } = await open('owner@example.com', `${O}/billing`)
    expect(await screen.findByText(/call minutes this month/i)).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /move to starter/i }))
    const down = screen.getByRole('dialog', { name: /move to starter/i })
    await user.click(within(down).getByRole('button', { name: /^move on/i }))
    expect(await within(down).findByText(/starter allows 1 agent/i)).toBeInTheDocument()
    await user.click(within(down).getByRole('button', { name: /^cancel$/i }))

    await user.click(screen.getByRole('button', { name: /upgrade to scale/i }))
    await user.click(within(screen.getByRole('dialog', { name: /upgrade to scale/i })).getByRole('button', { name: /upgrade now/i }))
    await waitFor(() => expect(within(screen.getByRole('heading', { name: /^scale/i })).getByText(/your plan/i)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('heading', { name: /^scale/i })).toHaveFocus())
    expect(screen.getByRole('button', { name: /change payment method/i })).toHaveAttribute('aria-disabled', 'true')
  })

  it('isn’t in an admin’s console', async () => {
    await open('admin@example.com', `${O}/billing`)
    expect(await screen.findByText(/billing and plan isn't part of the admin role/i)).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: /organisation/i })).queryByRole('link', { name: /billing/i })).toBeNull()
  })
})
