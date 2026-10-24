import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { accessFor } from '../console/access'
import { ConsoleProvider } from '../console/ConsoleProvider'
import { createDemoConsoleClient } from '../console/demoClient'
import type { ConsoleClient } from '../console/types'
import BotDeskPage from '../pages/console/operate/BotDeskPage'

/**
 * The Bot desk shows each person only what their permissions allow: lines
 * only for those who switch them, notices and doctors only for those who
 * post them, and each extra (today's figures, appointments, activity, FAQ,
 * requests, calls) only when they may open it, with no error and no empty
 * block where something is left out. Rendered on its own with permissions
 * set per person, as an owner can.
 */
const scope = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../console/useOrg', () => ({ useOrg: () => scope.current }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedIn', user: (scope.current as { user: unknown }).user }) }))

const SLUG = 'arogya-demo'

/** The demo, with calls to the sources a permission guards counted. */
function spied() {
  const demo = createDemoConsoleClient({ latency: 0, persist: false })
  const calls = { report: 0, appointments: 0, activity: 0 }
  const client = {
    ...demo,
    getReport: (...a: Parameters<ConsoleClient['getReport']>) => (calls.report++, demo.getReport(...a)),
    listAppointments: (...a: Parameters<ConsoleClient['listAppointments']>) => (calls.appointments++, demo.listAppointments(...a)),
    listActivity: (...a: Parameters<ConsoleClient['listActivity']>) => (calls.activity++, demo.listActivity(...a)),
  } as ConsoleClient
  return { client, calls }
}

async function renderWith(role: 'front_desk' | 'supervisor' | 'admin', permissions: string[], client: ConsoleClient = spied().client) {
  const org = { orgSlug: SLUG, orgName: 'Arogya Demo Hospital', role, permissions: permissions as never }
  scope.current = {
    user: { id: 'u_x', name: 'Someone', email: 'someone@example.com', memberships: [org] },
    org,
    access: accessFor({ role, permissions: permissions as never }),
    base: `/o/${SLUG}`,
  }
  render(
    <MemoryRouter>
      <ConsoleProvider client={client}>
        <BotDeskPage />
      </ConsoleProvider>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { level: 2, name: 'Lines' })
}

const lines = () => screen.getByRole('list', { name: 'Phone lines' })
const flags = () => screen.getByRole('heading', { level: 2, name: 'Flagged answers' }).closest('section')!
const notices = () => screen.getByRole('heading', { level: 2, name: 'Notices' }).closest('section')!
const calendar = () => screen.getByRole('table', { name: /doctors by day/i })

describe('Bot desk: someone who can only post notices', () => {
  it('sees the lines without any control, and is told why', async () => {
    await renderWith('front_desk', ['desk.notices'])
    expect(within(lines()).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: /every line/i })).toBeNull()
    expect(screen.getByText(/switching one to staff needs the “switch lines to staff” permission/i)).toBeInTheDocument()
    expect(within(lines()).getByText('Main reception is answering')).toBeInTheDocument()
  })

  it('posts notices and changes doctors', async () => {
    await renderWith('front_desk', ['desk.notices'])
    expect(within(notices()).getByRole('button', { name: /post a notice/i })).toBeInTheDocument()
    expect(within(notices()).getAllByRole('button', { name: /end the notice early/i })).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: /mark a doctor away or late/i })).toBeInTheDocument()
    expect(within(calendar()).getAllByRole('button').length).toBeGreaterThan(0)
  })
})

describe('Bot desk: someone who can only switch lines', () => {
  it('switches lines, but notices and doctors are read-only with no buttons, and say why', async () => {
    await renderWith('front_desk', ['desk.bot'])
    expect(within(lines()).getByRole('button', { name: /send to staff for main reception/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send every line to staff' })).toBeInTheDocument()

    // The notice is there to read, with nothing to press.
    expect(within(notices()).getByText(/lift in block b is under repair/i)).toBeInTheDocument()
    expect(within(notices()).queryByRole('button')).toBeNull()
    expect(within(notices()).getByText(/needs the “post notices” permission/i)).toBeInTheDocument()

    // Doctors: the table reads (changes in words), the list has no Change or Remove.
    expect(within(calendar()).queryByRole('button')).toBeNull()
    expect(within(calendar()).getAllByText(/away/i).length).toBeGreaterThan(0)
    const changes = screen.getByRole('list', { name: 'Doctor changes' })
    expect(within(changes).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: /mark a doctor away or late/i })).toBeNull()
  })
})

describe('Bot desk: what is left out without the permission, and without an error', () => {
  it('reads no reports, appointments or activity, and shows no figures, counts or activity block', async () => {
    const { client, calls } = spied()
    await renderWith('front_desk', ['desk.bot', 'desk.notices'], client)
    // Give the slower reads a moment: none were asked for.
    await new Promise((r) => setTimeout(r, 100))
    expect(calls).toEqual({ report: 0, appointments: 0, activity: 0 })
    expect(screen.queryByText('Calls today')).toBeNull()
    expect(screen.queryByText(/booked$/)).toBeNull()
    expect(screen.queryByText(/appointments? affected/i)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Desk activity' })).toBeNull()
    expect(screen.queryByText(/couldn.t/i)).toBeNull()
  })

  it('reads them for someone who may see reports, appointments and the activity log', async () => {
    const { client, calls } = spied()
    await renderWith('supervisor', ['desk.bot', 'desk.notices', 'reports.view', 'calls.viewAll', 'activity.view'], client)
    await waitFor(() => expect(within(lines()).getAllByText('Calls today').length).toBeGreaterThan(0))
    // One report per agent that answers a line.
    expect(calls.report).toBe(3)
    await waitFor(() => expect(calls.appointments).toBeGreaterThan(0))
    expect(screen.getByRole('heading', { level: 2, name: 'Desk activity' })).toBeInTheDocument()
    expect(calls.activity).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'See all activity' })).toHaveAttribute('href', `/o/${SLUG}/activity`)
  })

  it('keeps going when today’s figures or the appointments can’t be read', async () => {
    const demo = createDemoConsoleClient({ latency: 0, persist: false })
    const client = {
      ...demo,
      getReport: async () => {
        throw new Error('Reports are down.')
      },
      listAppointments: async () => {
        throw new Error('Appointments are down.')
      },
    } as ConsoleClient
    await renderWith('supervisor', ['desk.bot', 'desk.notices', 'reports.view', 'calls.viewAll'], client)
    await new Promise((r) => setTimeout(r, 100))
    // The lines still show, without figures; the doctors still show, with a quiet note.
    expect(within(lines()).getByText('Main reception is answering')).toBeInTheDocument()
    expect(screen.queryByText('Calls today')).toBeNull()
    expect(await screen.findAllByText(/couldn’t check the appointments just now/i)).not.toHaveLength(0)
    expect(screen.queryByText(/reports are down/i)).toBeNull()
  })
})

describe('Bot desk: flags by permission', () => {
  const FLAG = /pharmacy closes at 8 pm/i

  it('offers Add to FAQ, Ask bitNtech and fixing to someone who manages knowledge and may ask', async () => {
    await renderWith('admin', ['desk.notices', 'library.knowledge', 'requests.create', 'agents.view'])
    const item = within(flags()).getByText(FLAG).closest('li')!
    expect(within(item).getByRole('link', { name: 'Add to FAQ' })).toBeInTheDocument()
    expect(within(item).getByRole('link', { name: 'Ask bitNtech' })).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: /mark fixed/i })).toBeInTheDocument()
  })

  it('offers only Ask bitNtech to someone who can read Knowledge but not change it, and no fixing', async () => {
    await renderWith('admin', ['desk.notices', 'agents.view', 'requests.create'])
    const item = within(flags()).getByText(FLAG).closest('li')!
    expect(within(item).queryByRole('link', { name: 'Add to FAQ' })).toBeNull()
    expect(within(item).getByRole('link', { name: 'Ask bitNtech' })).toHaveAttribute('href', `/o/${SLUG}/requests?new=flow_change&agent=agt_reception`)
    expect(within(item).queryByRole('button', { name: /mark fixed|dismiss/i })).toBeNull()
  })

  it('offers neither to someone who can do neither', async () => {
    await renderWith('front_desk', ['desk.bot'])
    const item = within(flags()).getByText(FLAG).closest('li')!
    expect(within(item).queryByRole('link')).toBeNull()
    expect(within(item).queryByRole('button')).toBeNull()
    // Anyone can still flag one, and the filters work.
    expect(within(flags()).getByRole('button', { name: /flag a wrong answer/i })).toBeInTheDocument()
    expect(within(flags()).getByRole('searchbox', { name: /search flagged answers/i })).toBeInTheDocument()
  })
})
