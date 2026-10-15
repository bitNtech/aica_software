import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, signIn } from './renderApp'

describe('My account', () => {
  it('is reached from the console, and changes the name everywhere', async () => {
    const { user } = renderApp('/o/arogya-demo')
    await signIn(user, 'frontdesk@example.com')
    await user.click(await screen.findByRole('link', { name: /meena s: your account/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /your account/i })).toBeInTheDocument()
    const name = screen.getByLabelText(/your name/i)
    await user.clear(name)
    await user.type(name, 'Meena Sundaram')
    await user.click(screen.getByRole('button', { name: /save name/i }))
    expect(await screen.findByText('Name saved.')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /back to arogya demo hospital/i }))
    expect(await screen.findByRole('link', { name: /meena sundaram: your account/i })).toBeInTheDocument()
  })

  it('shows only the emails for the person’s roles, and saves a change', async () => {
    const { user } = renderApp('/account')
    await signIn(user, 'frontdesk@example.com')
    const box = await screen.findByRole('checkbox', { name: /a callback is given to you/i })
    expect(screen.queryByRole('checkbox', { name: /invoices/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /signs up/i })).toBeNull()
    await user.click(box)
    expect(await screen.findByText(/you won’t get this email/i)).toBeInTheDocument()
    expect(box).not.toBeChecked()
  })

  it('signs out other browsers, and emails a password link', async () => {
    const { user } = renderApp('/ops')
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /vikram s: your account/i }))
    const list = (await screen.findByRole('heading', { name: /where you’re signed in/i })).closest('section')!
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3))
    await user.click(within(list).getByRole('button', { name: /sign out everywhere else/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /sign out everywhere else/i }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))
    expect(within(list).getByText(/signed in only here/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /email me a link/i }))
    expect(await screen.findByText(/sent to master@example.com/i)).toBeInTheDocument()
    expect(screen.getByText(/master admin at bitntech/i)).toBeInTheDocument()
  })

  it('changes nothing while a master admin acts as someone', async () => {
    const { user } = renderApp('/ops')
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('button', { name: /act as the owner of nila eye clinic/i }))
    await user.type(screen.getByLabelText(/why act as the owner/i), 'Checking their billing page.')
    await user.click(screen.getByRole('button', { name: /^act as owner$/i }))
    // Karthik belongs to two organisations: they choose one first.
    await user.click(await screen.findByRole('button', { name: /nila eye clinic/i }))
    await user.click(await screen.findByRole('link', { name: /karthik r: your account/i }))
    expect(await screen.findByText(/you're acting as karthik r/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/your name/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /email me a link/i })).toBeNull()
  })
})
