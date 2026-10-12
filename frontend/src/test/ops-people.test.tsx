import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, signIn, signOutToLogin } from './renderApp'

const REASON = 'Covering the support rota this month.'

async function openPeople(user: ReturnType<typeof renderApp>['user']) {
  await signIn(user, 'master@example.com')
  await user.click(await screen.findByRole('link', { name: /^people$/i }))
  await screen.findByRole('heading', { name: /^clients$/i })
}

const section = (name: RegExp) => screen.getByRole('heading', { name }).closest('section') as HTMLElement

describe('/ops/people', () => {
  it('is for master admins only', async () => {
    const { user } = renderApp()
    await signIn(user, 'ops@example.com')
    await screen.findByRole('heading', { name: /every client/i })
    expect(screen.queryByRole('link', { name: /^people$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /audit log/i })).not.toBeInTheDocument()
  })

  it('lists bitNtech and client accounts, and never offers actions on yourself', async () => {
    const { user } = renderApp()
    await openPeople(user)
    const bitntech = section(/^bitntech$/i)
    expect(within(bitntech).getByText('Vikram S')).toBeInTheDocument()
    expect(within(bitntech).getByText('Divya K')).toBeInTheDocument()
    expect(within(bitntech).getByText('You')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /vikram s/i })).not.toBeInTheDocument()
    const clients = section(/^clients$/i)
    expect(within(clients).getByText(/arogya demo hospital \(admin\), nila eye clinic \(demo\) \(owner\)/i)).toBeInTheDocument()
    // Client accounts in an organisation can't be given a bitNtech role.
    expect(screen.queryByRole('button', { name: /change role for meena s/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /act as meena s/i })).toBeInTheDocument()
    // bitNtech accounts can't be acted as.
    expect(screen.queryByRole('button', { name: /act as divya k/i })).not.toBeInTheDocument()
  })

  it('finds people by name, email or organisation', async () => {
    const { user } = renderApp()
    await openPeople(user)
    await user.type(screen.getByLabelText(/find a person/i), 'marutham')
    expect(screen.getByText('Ravi P')).toBeInTheDocument()
    expect(screen.queryByText('Meena S')).not.toBeInTheDocument()
    expect(screen.getByText(/no bitntech accounts match/i)).toBeInTheDocument()
  })

  it('changes a role with a reason and warns before making a master admin', async () => {
    const { user } = renderApp()
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: /change role for divya k/i }))
    await user.click(screen.getByRole('radio', { name: /master admin/i }))
    expect(screen.getByText(/every master admin is emailed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^change role$/i }))
    expect(screen.getByText(/write at least a short sentence/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^why\?/i), REASON)
    await user.click(screen.getByRole('button', { name: /^change role$/i }))
    expect(await screen.findByText(/divya k is now master admin/i)).toBeInTheDocument()
  })

  it('disables an account, which then cannot sign in, and enables it again', async () => {
    const { user } = renderApp()
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: /disable meena s/i }))
    await user.type(screen.getByLabelText(/why disable meena s/i), 'Left the hospital in September.')
    await user.click(screen.getByRole('button', { name: /disable account/i }))
    expect(await screen.findByText(/meena s is disabled/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /enable meena s/i })).toBeInTheDocument()
    await signOutToLogin(user)

    await signIn(user, 'frontdesk@example.com')
    expect(await screen.findByText(/this account is locked/i)).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/^password/i))
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /^people$/i }))
    await user.click(await screen.findByRole('button', { name: /enable meena s/i }))
    expect(await screen.findByText(/meena s can sign in again/i)).toBeInTheDocument()
  })

  it('invites someone to bitNtech as a master admin', async () => {
    const { user } = renderApp()
    await openPeople(user)
    await user.click(screen.getByRole('button', { name: /send invitation/i }))
    expect(screen.getByLabelText(/^email/i)).toHaveFocus()
    await user.type(screen.getByLabelText(/^email/i), 'ops@example.com')
    await user.click(screen.getByRole('button', { name: /send invitation/i }))
    expect(await screen.findByText(/already has an aica account/i)).toBeInTheDocument()
    await user.clear(screen.getByLabelText(/^email/i))
    await user.type(screen.getByLabelText(/^email/i), 'cto@example.com')
    await user.selectOptions(screen.getByLabelText(/^role/i), 'master_admin')
    await user.click(screen.getByRole('button', { name: /send invitation/i }))
    expect(await screen.findByText(/invitation sent to cto@example.com as master admin/i)).toBeInTheDocument()
  })
})
