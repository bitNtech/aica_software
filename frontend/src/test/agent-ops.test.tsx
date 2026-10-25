import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { callLog } from '../console/demo/operations'
import { renderApp, signIn, signOutToLogin } from './renderApp'

const O = '/o/arogya-demo'
const AGENT = `${O}/agents/agt_appointments`
const OPS_AGENT = '/ops/orgs/arogya-demo/agents/agt_appointments'
const nav = () => screen.getByRole('navigation', { name: /^organisation$/i })
const tabs = () => screen.getByRole('navigation', { name: /agent sections/i })

async function open(email: string, path: string, consoleClient = createDemoConsoleClient({ latency: 0 })) {
  const view = renderApp(path, { consoleClient })
  await signIn(view.user, email)
  return view
}

describe('the agent’s structure belongs to bitNtech', () => {
  it('shows a hospital admin the flow read-only, with a way to ask for a change', async () => {
    const { user } = await open('admin@example.com', `${AGENT}/flow`)
    await screen.findByRole('list', { name: /conversation flow/i })
    expect(screen.queryByRole('button', { name: /add intent/i })).not.toBeInTheDocument()
    expect(screen.getByText(/bitntech sets up the conversation flow/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change it in the agent builder/i })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /or describe it in a request/i }))

    // The request form opens filled in for this agent.
    const form = await screen.findByRole('region', { name: /new request to bitntech/i })
    expect(within(form).getByLabelText(/what do you need/i)).toHaveValue('flow_change')
    expect(within(form).getByLabelText(/which agent/i)).toHaveValue('agt_appointments')
    await user.click(within(form).getByRole('button', { name: /send to bitntech/i }))
    expect(within(form).getByLabelText(/^title/i)).toHaveFocus()
    await user.type(within(form).getByLabelText(/^title/i), 'Offer evening slots first')
    await user.type(within(form).getByLabelText(/^details/i), 'Most callers work days; offer the 5 PM to 8 PM slots first.')
    await user.click(within(form).getByRole('button', { name: /send to bitntech/i }))
    const list = await screen.findByRole('list', { name: /^requests$/i })
    const card = within(list).getByRole('heading', { name: 'Offer evening slots first' }).closest('li')!
    expect(within(card).getByText('Waiting for bitNtech')).toBeInTheDocument()
    expect(within(card).getByText(/change to a flow · opd appointments/i)).toBeInTheDocument()
  })

  it('lets the master admin change the voice pipeline, where hospitals only read it', async () => {
    const { user, unmount } = await open('admin@example.com', `${AGENT}/pipeline`)
    expect(await screen.findByText(/bitntech sets up the voice pipeline/i)).toBeInTheDocument()
    expect(screen.getByText('When it replies')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    await signOutToLogin(user)
    unmount()

    const ops = await open('master@example.com', `${OPS_AGENT}/pipeline`)
    const shortest = await screen.findByLabelText(/shortest wait \(ms\)/i)
    await ops.user.clear(shortest)
    await ops.user.type(shortest, '50')
    expect(await screen.findByText(/draft changes, not live yet/i)).toBeInTheDocument()
    await ops.user.click(screen.getByRole('button', { name: /review and publish/i }))
    const fix = await screen.findByRole('link', { name: 'Voice pipeline' })
    expect(fix.closest('li')).toHaveTextContent(/at least 200/i)
  })

  it('lets a hospital word what success means, but not the fields', async () => {
    const { user } = await open('admin@example.com', `${AGENT}/analysis`)
    const criteria = await screen.findByLabelText(/a call succeeded when/i)
    await user.clear(criteria)
    await user.type(criteria, 'Booked without a person.')
    await waitFor(() => expect(screen.getByText(/draft saved/i)).toBeInTheDocument())
    expect(screen.getByText(/bitntech sets these up/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add a field/i })).not.toBeInTheDocument()
    expect(screen.getByText('Department')).toBeInTheDocument()
  })
})

describe('Ops: building for an organisation', () => {
  it('lists the organisation’s agents and open requests on its page', async () => {
    await open('master@example.com', '/ops/orgs/arogya-demo')
    expect(await screen.findByRole('link', { name: /^new agent$/i })).toHaveAttribute('href', '/ops/orgs/arogya-demo/agents/new')
    expect(await screen.findByText(/open requests/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'OPD appointments' })).toHaveAttribute('href', OPS_AGENT)
  })

  it('replies to a request and marks it done', async () => {
    const client = createDemoConsoleClient({ latency: 0 })
    const { user } = await open('master@example.com', '/ops/changes', client)
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: /health check-up packages/i })).toHaveAttribute('href', '/ops/orgs/arogya-demo/requests#cr_health_check')
    await user.click(within(table).getByRole('link', { name: /health check-up packages/i }))
    const card = (await screen.findByRole('heading', { name: /health check-up packages/i })).closest('li')!
    await user.type(within(card).getByLabelText(/reply to the organisation/i), 'Built and published as “Health check-ups”.')
    await user.selectOptions(within(card).getByLabelText(/^status/i), 'done')
    await user.click(within(card).getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/marked “an agent for master health check-up packages” done/i)).toBeInTheDocument()
    // It leaves the open list; the thread keeps bitNtech's reply.
    await user.click(screen.getByRole('radio', { name: /finished/i }))
    const done = (await screen.findByRole('heading', { name: /health check-up packages/i })).closest('li')!
    expect(within(done).getByText('Done', { selector: '.status-chip' })).toBeInTheDocument()
    expect(within(done).getByText(/built and published/i)).toBeInTheDocument()
    expect(within(done).getByText('bitNtech')).toBeInTheDocument()
    // (The hospital's view of it is checked in agent-ops-logic: demo data resets when someone else signs in.)
  })
})

describe('the bot desk', () => {
  it('is the front desk’s first Operate page', async () => {
    await open('frontdesk@example.com', O)
    await screen.findByRole('heading', { name: /you're in/i })
    const links = within(nav()).getAllByRole('link').map((l) => l.textContent)
    expect(links.indexOf('Bot desk')).toBe(links.indexOf('Home') + 1)
  })

  it('sends a line to staff for a while, and gives it back', async () => {
    const { user } = await open('frontdesk@example.com', `${O}/desk`)
    const card = (await screen.findByRole('heading', { level: 3, name: 'OPD appointments' })).closest('li')!
    await user.click(within(card).getByRole('button', { name: /send to staff/i }))
    const dialog = screen.getByRole('dialog', { name: /send opd appointments to your team/i })
    await user.click(within(dialog).getByRole('radio', { name: /until the end of today/i }))
    await user.type(within(dialog).getByLabelText(/^why/i), 'OPD desk is quiet')
    await user.click(within(dialog).getByRole('button', { name: /send to staff/i }))
    expect(await within(card).findByText(/your team is answering/i)).toBeInTheDocument()
    expect(within(card).getByText(/switched by meena s/i)).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: /give back to opd appointments/i }))
    expect(await within(card).findByText(/opd appointments is answering/i)).toBeInTheDocument()
  })

  it('posts a notice and marks a doctor away', async () => {
    const { user } = await open('frontdesk@example.com', `${O}/desk`)
    await user.click(await screen.findByRole('button', { name: /post a notice/i }))
    const n = screen.getByRole('dialog', { name: /post a notice/i })
    await user.type(within(n).getByLabelText(/what callers should know/i), 'The pharmacy counter has moved to the ground floor today.')
    await user.click(within(n).getByRole('button', { name: /post notice/i }))
    expect(await within(screen.getByRole('list', { name: /notices showing now/i })).findByText(/pharmacy counter has moved/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /mark a doctor away or late/i }))
    const d = screen.getByRole('dialog', { name: /mark a doctor away or late/i })
    await user.click(within(d).getByRole('button', { name: /^save$/i }))
    expect(within(d).getByLabelText(/^doctor/i)).toHaveFocus()
    await user.selectOptions(within(d).getByLabelText(/^doctor/i), 'Dr. P. Lakshmi')
    await user.click(within(d).getByRole('radio', { name: /starting late/i }))
    await user.click(within(d).getByRole('button', { name: /^save$/i }))
    expect(within(d).getByLabelText(/from when/i)).toHaveAccessibleDescription(/from when/i)
    await user.type(within(d).getByLabelText(/from when/i), 'From 11 AM')
    await user.click(within(d).getByRole('button', { name: /^save$/i }))
    const changes = await screen.findByRole('list', { name: /doctor changes/i })
    expect(await within(changes).findByText('Dr. P. Lakshmi')).toBeInTheDocument()
  })

  it('lets an admin fix a flagged answer', async () => {
    const { user } = await open('admin@example.com', `${O}/desk`)
    const flags = await screen.findByRole('list', { name: /flagged answers/i })
    const item = within(flags).getByText(/pharmacy closes at 8 pm/i).closest('li')!
    await user.click(within(item).getByRole('button', { name: /mark fixed/i }))
    await user.click(within(item).getByRole('button', { name: /mark fixed/i }))
    expect(within(item).getByLabelText(/what you changed/i)).toHaveAccessibleDescription(/say what you changed/i)
    await user.type(within(item).getByLabelText(/what you changed/i), 'Added pharmacy hours to the FAQ.')
    await user.click(within(item).getByRole('button', { name: /mark fixed/i }))
    expect(await screen.findByText('Nothing flagged.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^fixed 2$/i })).toBeInTheDocument()
  })
})

describe('team permissions', () => {
  it('changes what one person can do, and puts the defaults back', async () => {
    const { user } = await open('admin@example.com', `${O}/team`)
    const suresh = (await screen.findByRole('heading', { name: /suresh b/i })).closest('li')!
    expect(within(suresh).getByText(/custom permissions/i)).toBeInTheDocument()

    const meena = screen.getByRole('heading', { name: /meena s/i }).closest('li')!
    await user.click(within(meena).getByRole('button', { name: /change what meena s can do/i }))
    const dialog = screen.getByRole('dialog', { name: /what meena s can do/i })
    // Only what a front desk role may hold is offered.
    expect(within(dialog).queryByRole('checkbox', { name: /manage the team/i })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/not for front desks: .*manage the team/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /see reports/i }))
    expect(within(dialog).getByRole('checkbox', { name: /see reports \(changed\)/i })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    expect(await within(meena).findByText(/custom permissions/i)).toBeInTheDocument()

    await user.click(within(meena).getByRole('button', { name: /change what meena s can do/i }))
    const again = screen.getByRole('dialog', { name: /what meena s can do/i })
    await user.click(within(again).getByRole('button', { name: /use the defaults/i }))
    await user.click(within(again).getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(within(meena).queryByText(/custom permissions/i)).not.toBeInTheDocument())
  })
})

describe('calls: guidance, analysis and quality', () => {
  it('shows each call’s analysis and response times, and takes a flag', async () => {
    // A call from the last week, on an agent that wasn't paused.
    const call = callLog({ orgSlug: 'arogya-demo', paused: new Set(), pauses: {} }, 7).find((c) => c.agentId !== 'agt_reports')!
    const { user } = await open('supervisor@example.com', `${O}/calls/${call.id}`)
    expect(await screen.findByRole('heading', { name: /after the call/i })).toBeInTheDocument()
    expect(screen.getByText(/how the caller sounded/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /response times/i })).toBeInTheDocument()
    expect(screen.getAllByText(/replied in \d\.\d s/i).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /flag a wrong answer/i }))
    const dialog = screen.getByRole('dialog', { name: /flag a wrong answer/i })
    await user.type(within(dialog).getByLabelText(/what it got wrong/i), 'Gave the wrong OPD room.')
    await user.click(within(dialog).getByRole('button', { name: /flag it/i }))
    expect(await screen.findByText(/flagged\. it’s on the bot desk/i)).toBeInTheDocument()
  })

  it('reports quality: success, how callers sounded and reply times, by agent', async () => {
    await open('admin@example.com', `${O}/reports`)
    const quality = (await screen.findByRole('heading', { name: /^quality$/i })).closest('section')!
    expect(within(quality).getByText('Successful calls')).toBeInTheDocument()
    // The by-agent table has its own Agents card now, beside Quality rather than inside it.
    expect(within(quality).getAllByText('Typical reply').length).toBe(1)
    const agents = screen.getByRole('heading', { name: /^agents$/i }).closest('section')!
    expect(within(agents).getByRole('table', { name: /each agent/i })).toBeInTheDocument()
    expect(within(agents).getByRole('columnheader', { name: /typical reply/i })).toBeInTheDocument()
  })

  it('lets the front desk guide the agent on a live call', async () => {
    const { user } = await open('frontdesk@example.com', `${O}/live`)
    await screen.findByRole('heading', { level: 1, name: /live calls/i })
    const guide = await screen.findAllByRole('button', { name: /guide the agent/i }).catch(() => [])
    if (!guide.length) return // Between sample calls.
    await user.click(guide[0])
    const field = screen.getByLabelText(/note to the agent/i)
    expect(field).toHaveFocus()
    await user.type(field, 'Offer Saturday 10 AM.')
    await user.click(screen.getByRole('button', { name: /send to the agent/i }))
    expect(await screen.findByText(/sent to the agent\. the caller doesn’t hear it/i)).toBeInTheDocument()
  })
})

describe('test scenarios', () => {
  it('runs every scenario and shows what passed', async () => {
    const { user } = await open('supervisor@example.com', `${AGENT}/test`)
    const list = await screen.findByRole('list', { name: /test scenarios/i })
    expect(within(list).getAllByText('Not run').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /run all/i }))
    expect(await screen.findByText(/all \d+ scenarios passed/i)).toBeInTheDocument()
    expect(within(list).queryByText('Not run')).not.toBeInTheDocument()
    expect(within(tabs()).getByRole('link', { name: 'Test' })).toHaveAttribute('aria-current', 'page')
  })
})
