import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import type { ConsoleClient } from '../console/types'
import { renderApp, signIn } from './renderApp'

const nav = () => screen.getByRole('navigation', { name: /organisation/i })
const sidebar = () => screen.getByRole('complementary', { name: /organisation and account/i })
const pageHeader = () => screen.getByRole('main').querySelector('header') as HTMLElement

/** Signs in on one app, then opens `path` in a fresh one: the same browser
 * session, a typed URL. */
async function openAs(email: string, path: string) {
  const first = renderApp('/login')
  await signIn(first.user, email)
  await screen.findByRole('main')
  first.unmount()
  return renderApp(path)
}

describe('console frame', () => {
  it('shows each role only the pages it may open, and labels demo data', async () => {
    const { user } = renderApp('/o/arogya-demo')
    await signIn(user, 'supervisor@example.com')
    await screen.findByRole('heading', { name: /you're in/i })
    expect(within(nav()).getByRole('link', { name: /home/i })).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: /agents/i })).toBeInTheDocument()
    expect(within(pageHeader()).getByText('Demo data')).toBeInTheDocument()
    expect(within(pageHeader()).getByText(/not your organisation's real setup/i)).toBeInTheDocument()
    expect(within(sidebar()).getByText('Supervisor')).toBeInTheDocument()
  })

  it('sends a role that cannot open a page to Home, saying why', async () => {
    await openAs('frontdesk@example.com', '/o/arogya-demo/agents')
    expect(await screen.findByRole('heading', { name: /you're in/i })).toBeInTheDocument()
    expect(screen.getByText(/agents isn't part of the front desk role here/i)).toBeInTheDocument()
    expect(within(nav()).queryByRole('link', { name: /agents/i })).not.toBeInTheDocument()
    // Their pages are the Operate ones.
    expect(within(nav()).getByRole('link', { name: /live calls/i })).toBeInTheDocument()
  })

  it('offers the organisation switcher only to people in several organisations', async () => {
    const { user } = renderApp('/o/arogya-demo')
    await signIn(user, 'admin@example.com')
    await screen.findByRole('heading', { name: /you're in/i })
    expect(screen.getByRole('link', { name: /switch organisation/i })).toHaveAttribute('href', '/choose')
  })

  it('refuses an organisation the person is not in', async () => {
    await openAs('frontdesk@example.com', '/o/marutham-demo/agents')
    expect(await screen.findByRole('heading', { name: /not on your team/i })).toBeInTheDocument()
  })

  it('refuses bitNtech staff, who belong to no organisation', async () => {
    await openAs('ops@example.com', '/o/arogya-demo')
    expect(await screen.findByRole('heading', { name: /not on your team/i })).toBeInTheDocument()
  })

  it('sends members of a suspended organisation to the paused page', async () => {
    await openAs('suspended@example.com', '/o/marutham-demo/agents')
    expect(await screen.findByRole('heading', { name: /access is paused/i })).toBeInTheDocument()
  })

  it('applies the acted-as user’s role while a master admin acts as them', async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /^people$/i }))
    await user.click(await screen.findByRole('button', { name: /act as meena s/i }))
    await user.type(screen.getByLabelText(/why act as meena s/i), 'Checking the front desk view.')
    await user.click(screen.getByRole('button', { name: /^act as meena s$/i }))
    await screen.findByRole('heading', { name: /you're in/i })
    expect(screen.getByRole('region', { name: /acting as another user/i })).toBeInTheDocument()
    expect(within(nav()).queryByRole('link', { name: /agents/i })).not.toBeInTheDocument()
  })

  it('opens and closes the narrow-screen menu, making the page inert meanwhile', async () => {
    const { user } = renderApp('/o/arogya-demo')
    await signIn(user, 'admin@example.com')
    await screen.findByRole('heading', { name: /you're in/i })
    const menu = screen.getByRole('button', { name: /menu/i })
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    await user.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('console-main')).toHaveAttribute('inert')
    // Escape works with focus still on the button.
    await user.keyboard('{Escape}')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(menu).toHaveFocus()
    expect(document.getElementById('console-main')).not.toHaveAttribute('inert')
  })

  it('moves focus to the new page’s heading after navigating', async () => {
    const { user } = renderApp('/o/arogya-demo')
    await signIn(user, 'admin@example.com')
    await screen.findByRole('heading', { name: /you're in/i })
    await user.click(within(nav()).getByRole('link', { name: /agents/i }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /^agents$/i })).toHaveFocus())
  })
})

describe('/o/:slug/agents', () => {
  it('lists agents live first, with what matters about each', async () => {
    const { user } = renderApp('/o/arogya-demo/agents')
    await signIn(user, 'admin@example.com')
    const list = await screen.findByRole('list', { name: /agents/i })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((r) => within(r).getByText(/^(Live|Draft|Paused)$/).textContent)).toEqual(['Live', 'Live', 'Draft', 'Paused'])
    const billing = rows[2]
    expect(within(billing).getByRole('heading', { name: 'Billing and insurance' })).toBeInTheDocument()
    expect(within(billing).getByText('Not assigned')).toBeInTheDocument()
    expect(within(billing).getByText('Never')).toBeInTheDocument()
    expect(within(nav()).getByRole('link', { name: /agents/i })).toHaveAttribute('aria-current', 'page')
  })

  it('lets admins ask bitNtech for a new agent in the builder, but not publish one', async () => {
    const { user } = renderApp('/o/arogya-demo/agents')
    await signIn(user, 'admin@example.com')
    expect(await screen.findByRole('link', { name: /ask for a new agent/i })).toHaveAttribute('href', '/o/arogya-demo/agents/new')
    expect(screen.queryByRole('link', { name: /^new agent$/i })).not.toBeInTheDocument()
    // The half-built sample agent is bitNtech's work in progress.
    const list = await screen.findByRole('list', { name: /agents/i })
    expect(within(list).getByText(/being set up by bitntech/i)).toBeInTheDocument()
    expect(within(list).queryByRole('link', { name: /continue setup/i })).not.toBeInTheDocument()
  })

  it('lets the master admin build an agent for the organisation from Ops', async () => {
    const { user } = renderApp('/ops/orgs/arogya-demo/agents')
    await signIn(user, 'master@example.com')
    expect(await screen.findByRole('link', { name: /^new agent$/i })).toHaveAttribute('href', '/ops/orgs/arogya-demo/agents/new')
    expect(screen.getByRole('navigation', { name: /^organisation$/i })).toHaveTextContent(/arogya demo hospital/i)
    expect(await screen.findByRole('link', { name: /continue setup of billing and insurance/i })).toBeInTheDocument()
  })

  it('lets bitNtech staff look at an organisation’s agents, not build them', async () => {
    const { user } = renderApp('/ops/orgs/arogya-demo/agents')
    await signIn(user, 'ops@example.com')
    await screen.findByRole('list', { name: /agents/i })
    expect(screen.queryByRole('link', { name: /new agent/i })).not.toBeInTheDocument()
  })

  it('is read-only for supervisors and viewers', async () => {
    for (const email of ['supervisor@example.com', 'viewer@example.com']) {
      const view = renderApp('/o/arogya-demo/agents')
      await signIn(view.user, email)
      await within(view.container).findByRole('list', { name: /agents/i })
      expect(within(view.container).queryByRole('link', { name: /new agent/i })).not.toBeInTheDocument()
      expect(within(view.container).queryByRole('link', { name: /ask for a new agent/i })).not.toBeInTheDocument()
      view.unmount()
      localStorage.clear()
      sessionStorage.clear()
    }
  })

  it('searches and filters, and clears both from the no-results state', async () => {
    const { user } = renderApp('/o/arogya-demo/agents')
    await signIn(user, 'admin@example.com')
    await screen.findByRole('list', { name: /agents/i })

    await user.click(screen.getByRole('radio', { name: /paused/i }))
    expect(within(screen.getByRole('list', { name: /agents/i })).getAllByRole('listitem')).toHaveLength(1)
    expect(await screen.findByText(/1 of 4 agents shown/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/search agents/i), 'appointments')
    expect(screen.getByText(/no agents match “appointments” with status paused/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear search and filter/i }))
    expect(within(screen.getByRole('list', { name: /agents/i })).getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByLabelText(/search agents/i)).toHaveValue('')
    expect(screen.getByLabelText(/search agents/i)).toHaveFocus()
    expect(screen.getByRole('radio', { name: /all/i })).toBeChecked()

    // Numbers match whatever the spacing.
    await user.type(screen.getByLabelText(/search agents/i), '0000001210')
    const list = screen.getByRole('list', { name: /agents/i })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('OPD appointments')).toBeInTheDocument()
  })

  it('shows the first-run state when there are no agents', async () => {
    const { user } = renderApp('/o/nila-eye-demo/agents')
    await signIn(user, 'admin@example.com')
    expect(await screen.findByRole('heading', { name: /no agents yet/i })).toBeInTheDocument()
    expect(screen.getByText(/set it up in the agent builder from recordings of your past calls/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ask bitntech for your first agent/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/search agents/i)).not.toBeInTheDocument()
  })

  it('tells read-only roles who sets agents up', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    const empty: ConsoleClient = { ...demo, listAgents: async () => [] }
    const { user } = renderApp('/o/arogya-demo/agents', { consoleClient: empty })
    await signIn(user, 'viewer@example.com')
    expect(await screen.findByText(/when bitntech sets up an agent for you/i)).toBeInTheDocument()
  })

  it('explains a failed load and shows the retry happening', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    let fail = true
    let release: () => void = () => {}
    const flaky: ConsoleClient = {
      ...demo,
      async listAgents(slug) {
        if (fail) {
          fail = false
          throw new AuthError('network', "We couldn't reach AICA. Check your connection and try again.")
        }
        await new Promise<void>((r) => (release = r))
        return demo.listAgents(slug)
      },
    }
    const { user } = renderApp('/o/arogya-demo/agents', { consoleClient: flaky })
    await signIn(user, 'admin@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load agents/i)
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByText(/loading agents/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => release())
    expect(await screen.findByRole('list', { name: /agents/i })).toBeInTheDocument()
  })
})
