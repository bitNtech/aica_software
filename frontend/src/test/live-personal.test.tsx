import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { accessFor } from '../console/access'
import { ConsoleProvider } from '../console/ConsoleProvider'
import { createDemoConsoleClient } from '../console/demoClient'
import LiveCallsPage from '../pages/console/operate/LiveCallsPage'

/**
 * Callers' names and details on Live calls are for people who may see them
 * (`calls.personal`). Rendered on its own, with a front desk member whose
 * permissions leave that out, as an owner can set per person.
 */
const scope = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../console/useOrg', () => ({ useOrg: () => scope.current }))
// ConsoleProvider tells the client who is asking, from the signed-in user.
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedIn', user: (scope.current as { user: unknown }).user }) }))

const SLUG = 'arogya-demo'

/** The queue's rows, across its groups. */
const rows = () => screen.getAllByRole('listbox').flatMap((l) => within(l).getAllByRole('option'))

function renderWith(permissions: string[]) {
  const role = 'front_desk' as const
  const org = { orgSlug: SLUG, orgName: 'Arogya Demo Hospital', role, permissions: permissions as never }
  scope.current = {
    user: { id: 'u_frontdesk', name: 'Meena S', email: 'frontdesk@example.com', memberships: [org] },
    org,
    access: accessFor({ role, permissions: permissions as never }),
    base: `/o/${SLUG}`,
  }
  const client = createDemoConsoleClient({ latency: 0, persist: false })
  return render(
    <MemoryRouter>
      <ConsoleProvider client={client}>
        <LiveCallsPage />
      </ConsoleProvider>
    </MemoryRouter>,
  )
}

describe('personal details on Live calls', () => {
  it('hides names and collected details from someone without calls.personal, and says so', async () => {
    const user = userEvent.setup()
    renderWith(['calls.take', 'desk.notices'])
    await screen.findAllByRole('listbox')
    const options = rows()
    // Rows show the masked number, not the name.
    expect(options[1]).toHaveTextContent('+91 ••••• 50442')
    expect(screen.queryByText(/selvi murugan/i)).toBeNull()
    expect(screen.queryByText(/venkatesan/i)).toBeNull()
    await user.click(options[1])
    const detail = within(screen.getByRole('region', { name: /call details/i }))
    // Their own wording, in place of the value; what isn't personal still shows.
    expect((await detail.findAllByText(/hidden — you can’t see personal details/i)).length).toBeGreaterThan(0)
    expect(detail.getByText('Patient name')).toBeInTheDocument()
    expect(detail.getByText('Cardiology')).toBeInTheDocument()
    expect(screen.queryByText(/selvi murugan/i)).toBeNull()
  })

  it('hides names inside the transcript too', async () => {
    const user = userEvent.setup()
    renderWith(['calls.take'])
    await screen.findAllByRole('listbox')
    const options = rows()
    await user.click(options[2])
    const detail = within(screen.getByRole('region', { name: /call details/i }))
    expect(await detail.findByText(/personal details are hidden/i)).toBeInTheDocument()
    const log = detail.getByRole('log', { name: /live transcript/i })
    expect(within(log).getByText(/\[name\], policy \[policy\]/i)).toBeInTheDocument()
    expect(screen.queryByText(/ramasamy/i)).toBeNull()
    expect(screen.queryByText('SH-88213-02')).toBeNull()
  })

  it('shows them to someone who has calls.personal', async () => {
    const user = userEvent.setup()
    renderWith(['calls.take', 'calls.personal'])
    await screen.findAllByRole('listbox')
    const options = rows()
    expect(options[1]).toHaveTextContent(/selvi murugan/i)
    await user.click(options[2])
    const detail = within(screen.getByRole('region', { name: /call details/i }))
    expect(await detail.findByText('SH-88213-02')).toBeInTheDocument()
    expect(detail.queryByText(/hidden — you can’t see personal details/i)).toBeNull()
  })
})
