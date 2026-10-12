import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import App from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { createMockAuthClient, DEMO_PASSWORD } from '../auth/mockClient'
import { ConsoleProvider } from '../console/ConsoleProvider'
import { createDemoConsoleClient } from '../console/demoClient'
import type { ConsoleClient } from '../console/types'

export function renderApp(
  path = '/login',
  { idleMs, consoleClient = createDemoConsoleClient({ latency: 0 }) }: { idleMs?: number; consoleClient?: ConsoleClient } = {},
) {
  const client = createMockAuthClient({ latency: 0 })
  const user = userEvent.setup()
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={client} idleMs={idleMs}>
        <ConsoleProvider client={consoleClient}>
          <App />
        </ConsoleProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
  return { ...view, user, client }
}

type User = ReturnType<typeof userEvent.setup>

/** Fills /login and submits. The page must already be on /login. */
export async function signIn(user: User, email: string, password = DEMO_PASSWORD) {
  const field = await screen.findByLabelText(/work email/i)
  await user.clear(field)
  await user.type(field, email)
  await user.type(screen.getByLabelText(/^password/i), password)
  await user.click(screen.getByRole('button', { name: /^sign in/i }))
}

/** Signs out from an Ops page or a client page, then returns to /login. */
export async function signOutToLogin(user: User) {
  await user.click(await screen.findByRole('button', { name: /^sign out$/i }))
  await user.click(await screen.findByRole('link', { name: /sign in again/i }))
}
