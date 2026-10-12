import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, signIn } from './renderApp'

async function suspendNila(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: /suspend nila eye clinic/i }))
  await user.type(screen.getByLabelText(/why suspend/i), 'Invoice for October is 30 days overdue.')
  await user.click(screen.getByRole('button', { name: /suspend organisation/i }))
  await screen.findByText(/is suspended/i)
}

describe('/ops/audit', () => {
  it('starts empty', async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /audit log/i }))
    expect(await screen.findByText(/nothing recorded yet/i)).toBeInTheDocument()
  })

  it('shows who did what, why, newest first', async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await suspendNila(user)
    await user.click(await screen.findByRole('button', { name: /restore nila eye clinic/i }))
    await screen.findByText(/is active again/i)
    await user.click(screen.getByRole('link', { name: /audit log/i }))

    const table = await screen.findByRole('table', { name: /audit log/i })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent(/restored an organisation/i)
    expect(rows[1]).toHaveTextContent(/suspended an organisation/i)
    expect(rows[1]).toHaveTextContent('master@example.com')
    expect(rows[1]).toHaveTextContent(/30 days overdue/i)
    expect(screen.getByText(/that's everything/i)).toBeInTheDocument()
  })

  it('filters by action', async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await suspendNila(user)
    await user.click(await screen.findByRole('button', { name: /restore nila eye clinic/i }))
    await screen.findByText(/is active again/i)
    await user.click(screen.getByRole('link', { name: /audit log/i }))
    await screen.findByRole('table')

    await user.selectOptions(screen.getByLabelText(/filter by/i), 'action')
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText(/^action$/i), 'org_suspended')
    await user.click(screen.getByRole('button', { name: /apply/i }))
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).queryByText(/restored/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear filter/i }))
    expect(await screen.findByText(/restored an organisation/i)).toBeInTheDocument()
  })
})
