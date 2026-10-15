import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, signIn } from './renderApp'

async function open(email: string, path: string) {
  const view = renderApp(path)
  await signIn(view.user, email)
  return view
}

describe('Organisation detail', () => {
  it('opens from the Overview and lets the master admin retry a failed job', async () => {
    const { user } = await open('master@example.com', '/ops')
    await user.click(await screen.findByRole('link', { name: /^arogya demo hospital$/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /arogya demo hospital/i })).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByText(/2 failed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /try again: insurance partners \(web page\)/i }))
    expect(await screen.findByText(/1 failed/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /insurance partners \(web page\)/i })).toHaveFocus()
  })

  it('is read-only for bitNtech staff', async () => {
    const { user } = await open('ops@example.com', '/ops/orgs/arogya-demo')
    expect(await screen.findByText(/only the master admin suspends/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /suspend/i })).toBeNull()
    await user.click(screen.getByRole('link', { name: /all usage/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /usage/i })).toBeInTheDocument()
  })
})

describe('Template library', () => {
  it('adds a template hidden, then offers it', async () => {
    const { user } = await open('master@example.com', '/ops/templates')
    await user.click(await screen.findByRole('button', { name: /new template/i }))
    const dialog = screen.getByRole('dialog', { name: /new template/i })
    await user.type(within(dialog).getByLabelText(/^name/i), 'Health checks')
    await user.type(within(dialog).getByLabelText(/what it does/i), 'Books master health check packages.')
    await user.type(within(dialog).getByLabelText(/what callers ask about/i), 'Packages')
    await user.click(within(dialog).getByRole('button', { name: /add template/i }))
    expect(await within(dialog).findByText(/at least two things/i)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/what callers ask about/i), '{Enter}Fasting')
    await user.click(within(dialog).getByRole('button', { name: /add template/i }))
    const row = (await screen.findByRole('heading', { name: /health checks/i })).closest('li')!
    expect(within(row).getByText('Hidden')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: /offer health checks/i }))
    expect(await within(row).findByText('Offered')).toBeInTheDocument()
  })

  it('is read-only for staff', async () => {
    await open('ops@example.com', '/ops/templates')
    expect(await screen.findByRole('heading', { name: /^hospital$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new template/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^change /i })).toBeNull()
  })
})

describe('Usage, status and platform', () => {
  it('shows usage by organisation and switches period', async () => {
    const { user } = await open('ops@example.com', '/ops/usage')
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: /arogya demo hospital/i })).toBeInTheDocument()
    expect(within(table).queryByText(/kaveri/i)).toBeNull()
    await user.click(screen.getByRole('radio', { name: /last 7 days/i }))
    expect(await screen.findByRole('heading', { name: /^last 7 days$/i })).toBeInTheDocument()
  })

  it('shows each service’s health', async () => {
    await open('ops@example.com', '/ops/status')
    const list = await screen.findByRole('list', { name: /services/i })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText(/everything is working|having problems/i)).toBeInTheDocument()
  })

  it('keeps platform settings to the master admin', async () => {
    await open('ops@example.com', '/ops/platform')
    expect(await screen.findByText(/only the master admin can see and change platform settings/i)).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: /ops/i })).queryByRole('link', { name: /platform/i })).toBeNull()
  })

  it('checks plans and saves voices', async () => {
    const { user } = await open('master@example.com', '/ops/platform')
    const growth = await screen.findByRole('group', { name: /^growth$/i })
    const price = within(growth).getByLabelText(/price a month/i)
    await user.clear(price)
    await user.type(price, '999')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByText(/growth must cost more/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /undo changes/i }))
    await user.click(screen.getByRole('checkbox', { name: /offer selvi/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(screen.getByText(/last changed by vikram s just now/i)).toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: /offer kavya/i })).toBeDisabled()
  })
})
