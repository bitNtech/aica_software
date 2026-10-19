import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { createMockAuthClient, DEMO_PASSWORD } from '../auth/mockClient'
import type { AuthClient, Invite } from '../auth/types'
import { ConsoleProvider } from '../console/ConsoleProvider'
import { createDemoConsoleClient } from '../console/demoClient'
import { createDemoOpsClient } from '../ops/demoOpsClient'
import { OpsDataProvider } from '../ops/OpsDataProvider'
import { signIn } from './renderApp'

const INVITE: Invite = {
  email: 'viewer@example.com',
  orgName: 'Arogya Hospital',
  role: 'supervisor',
  invitedBy: 'Dr. Lakshmi',
  expiresAt: new Date(Date.now() + 5 * 864e5).toISOString(),
  hasAccount: true,
}

/** The mock backend, but this invitation is for someone with an account. */
async function setup(signedInAs?: string) {
  const base = createMockAuthClient({ latency: 0 })
  if (signedInAs) await base.signIn({ email: signedInAs, password: DEMO_PASSWORD, remember: false })
  const joinInvite = vi.fn(async () => {
    const s = await base.restore()
    if (!s) throw new Error('not signed in')
    return s
  })
  const client: AuthClient = { ...base, getInvite: async () => INVITE, joinInvite }
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/invite/tok123']}>
      <AuthProvider client={client}>
        <ConsoleProvider client={createDemoConsoleClient({ latency: 0 })}>
          <OpsDataProvider client={createDemoOpsClient({ latency: 0 })}>
            <App />
          </OpsDataProvider>
        </ConsoleProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
  return { user, joinInvite }
}

describe('/invite/:token for someone who already has an account', () => {
  it('sends them to sign in, brings them back, and joins', async () => {
    const { user, joinInvite } = await setup()
    expect(await screen.findByText(/viewer@example.com already has an AICA account/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/create a password/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /sign in to accept/i }))
    // The address is filled in for them.
    expect(await screen.findByLabelText(/work email/i)).toHaveValue('viewer@example.com')
    await signIn(user, 'viewer@example.com', DEMO_PASSWORD)
    const join = await screen.findByRole('button', { name: /join arogya hospital/i })
    expect(screen.getByText(/you're signed in as viewer@example.com/i)).toBeInTheDocument()
    await user.click(join)
    await waitFor(() => expect(joinInvite).toHaveBeenCalledWith('tok123'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /join arogya hospital/i })).not.toBeInTheDocument())
  })

  it('says so when they are signed in as someone else, and lets them sign out', async () => {
    const { user, joinInvite } = await setup('owner@example.com')
    expect(await screen.findByText(/this invitation is for viewer@example.com, and you're signed in as owner@example.com/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /join arogya hospital/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^sign out$/i }))
    expect(await screen.findByRole('link', { name: /sign in to accept/i })).toBeInTheDocument()
    expect(joinInvite).not.toHaveBeenCalled()
  })

  it('goes straight to joining when already signed in with the address', async () => {
    const { user, joinInvite } = await setup('viewer@example.com')
    await user.click(await screen.findByRole('button', { name: /join arogya hospital/i }))
    await waitFor(() => expect(joinInvite).toHaveBeenCalledTimes(1))
  })
})
