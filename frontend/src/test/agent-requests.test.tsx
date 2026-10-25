import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { renderApp, signIn } from './renderApp'

const next = () => screen.getByRole('button', { name: /^next/i })
/** Demo data set up before signing in, kept when the app signs in (which
 * would otherwise start the demo afresh). */
const kept = () => ({ ...createDemoConsoleClient({ latency: 0, persist: false }), reset: () => {} })

describe('Agents: each agent as callers meet it', () => {
  it('shows the chosen agent’s voice, greeting and what it handles, and opens it in the agent builder to upload calls', async () => {
    const { user } = renderApp('/o/arogya-demo/agents')
    await signIn(user, 'admin@example.com')
    const list = await screen.findByRole('list', { name: /^agents$/i })
    // The first agent is shown to start with.
    const panel = document.getElementById('agent-profile')!
    expect(within(panel).getByRole('heading', { level: 2, name: 'Main reception' })).toBeInTheDocument()
    expect(within(panel).getByText(/how it answers/i)).toBeInTheDocument()
    expect(within(panel).getByText(/speaks as/i)).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: 'Show OPD appointments' }))
    expect(within(list).getByRole('button', { name: 'Show OPD appointments' })).toHaveAttribute('aria-pressed', 'true')
    const heading = within(document.getElementById('agent-profile')!).getByRole('heading', { level: 2, name: 'OPD appointments' })
    await waitFor(() => expect(heading).toHaveFocus())
    const handles = within(document.getElementById('agent-profile')!).getByRole('list', { name: /what opd appointments handles/i })
    expect(within(handles).getByText('Book an appointment')).toBeInTheDocument()

    await user.click(within(document.getElementById('agent-profile')!).getByRole('button', { name: /^agent builder$/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /learn from past calls/i })).toBeInTheDocument()
    expect(screen.getAllByText(/changes to opd appointments/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: /^upload calls$/i })).toBeInTheDocument()
    expect(screen.getByText(/teach opd appointments from calls/i)).toBeInTheDocument()
    // No calls is fine for changes: on to the flow, which is the agent's own.
    await user.click(next())
    await screen.findByRole('heading', { level: 1, name: /what will this agent do/i })
  })
})

describe('asking for a new agent in the agent builder', () => {
  it('reads unrelated calls into separate flows to choose from, then sends the agent to bitNtech', async () => {
    const client = createDemoConsoleClient({ latency: 0, persist: false })
    const { user } = renderApp('/o/arogya-demo/agents', { consoleClient: client })
    await signIn(user, 'admin@example.com')
    await user.click(await screen.findByRole('link', { name: /ask for a new agent/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /learn from past calls/i })).toBeInTheDocument()
    await user.click(await screen.findByRole('checkbox', { name: /choose all ready calls/i }))
    await user.click(screen.getByRole('checkbox', { name: /callers agreed/i }))
    await user.click(next())
    await user.click(await screen.findByRole('radio', { name: /^hospital$/i }))
    await user.click(screen.getByRole('radio', { name: /appointments/i }))
    await user.click(next())
    await screen.findByRole('radio', { name: /kavya/i })
    await user.click(next())

    // Three unrelated things in the calls: three flows, the job's own in use.
    const found = await screen.findByRole('region', { name: /what aica found in your calls/i })
    expect(within(found).getByText(/about 3 unrelated things/i)).toBeInTheDocument()
    const card = (title: string) => within(found).getByRole('listitem', { name: title })
    expect(within(card('Appointments and visits')).getByText('In use')).toBeInTheDocument()
    await user.click(within(card('Lab reports')).getByRole('button', { name: /use the flow for lab reports/i }))
    const tree = screen.getByRole('list', { name: /conversation flow/i })
    expect(within(tree).getByRole('heading', { level: 3, name: /check if a report is ready/i })).toBeInTheDocument()
    expect(within(tree).queryByRole('heading', { level: 3, name: /book an appointment/i })).not.toBeInTheDocument()
    // The tree forks: several ways on after looking the report up.
    expect(within(tree).getByRole('list', { name: /3 ways on after look up the report/i })).toBeInTheDocument()

    // Edited, then switching asks first.
    await user.click(within(tree).getByRole('button', { name: /add a branch after look up the report/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Report was lost')
    await user.type(screen.getByLabelText(/when this applies/i), 'The lab has no record of the sample{Enter}')
    await user.click(within(card('Bills and insurance')).getByRole('button', { name: /use the flow for bills and insurance/i }))
    const ask = screen.getByRole('dialog', { name: /use the flow for bills and insurance/i })
    await user.click(within(ask).getByRole('button', { name: /cancel/i }))
    expect(within(tree).getByText('Report was lost', { selector: '.flow__label' })).toBeInTheDocument()
    // A branch needs a step of its own.
    await user.click(within(tree).getByRole('button', { name: /add a step after report was lost/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Apologise and hand over')
    await user.type(screen.getByLabelText(/what the agent says/i), 'I’m sorry about that. Let me put you through to the lab.')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    for (const heading of [/details to collect/i, /anywhere in a call/i, /what it knows and can do/i, /review and confirm/i]) {
      await user.click(next())
      await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 5000 })
    }
    // Handing over and limits are set in the builder too.
    expect(screen.queryByText(/ready to publish/i)).not.toBeInTheDocument()
    expect(await screen.findByText(/ready to send to bitntech/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /publish agent/i })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText(/^title/i))
    await user.type(screen.getByLabelText(/^title/i), 'New agent: lab reports')
    await user.click(screen.getByRole('button', { name: /^send to bitntech/i }))

    expect(await screen.findByText(/sent to bitntech: “new agent: lab reports”/i)).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: /^agents$/i })
    expect(within(list).getByText(/asked for by karthik r: bitntech is building it/i)).toBeInTheDocument()
    const request = (await client.listChangeRequests('arogya-demo'))[0]
    expect(request).toMatchObject({ kind: 'new_agent', title: 'New agent: lab reports' })
    expect(request.detail).toContain('Report was lost')
    // A long walk through every step: slow when the whole suite runs at once.
  }, 45000)

  it('shows a sent draft to look at only, until the request is withdrawn', async () => {
    const client = kept()
    client.setViewer?.({ id: 'u_admin', name: 'Karthik R', roles: { 'arogya-demo': 'admin' }, platformRole: null })
    const d = await client.startAgentChange!('arogya-demo', 'agt_reports')
    await client.submitDraft!('arogya-demo', d.id, { title: 'Changes to Lab report status', note: '', urgency: 'normal' })
    const { user } = renderApp(`/o/arogya-demo/agents/drafts/${d.id}/behaviour`, { consoleClient: client })
    await signIn(user, 'admin@example.com')
    expect((await screen.findAllByText(/^sent to bitntech/i)).length).toBeGreaterThan(0)
    expect(screen.getByRole('group', { name: /sent to bitntech, look only/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument()
    // Next only looks at the next step.
    await user.click(next())
    expect(await screen.findByRole('heading', { level: 1, name: /conversation flow/i })).toBeInTheDocument()
  })
})

describe('bitNtech building what the organisation sent', () => {
  it('links the request to the builder, where the master admin publishes it', async () => {
    const client = kept()
    client.setViewer?.({ id: 'u_admin', name: 'Karthik R', roles: { 'arogya-demo': 'admin' }, platformRole: null })
    const d = await client.startAgentChange!('arogya-demo', 'agt_reports')
    const r = await client.submitDraft!('arogya-demo', d.id, { title: 'Changes to Lab report status', note: 'Please add SMS links.', urgency: 'soon' })
    const { user } = renderApp(`/ops/orgs/arogya-demo/requests#${r.id}`, { consoleClient: client })
    await signIn(user, 'master@example.com')
    const card = (await screen.findByRole('heading', { name: 'Changes to Lab report status' })).closest('li')!
    expect(within(card).getByText('Made in the agent builder', { selector: '.req__tag' })).toBeInTheDocument()
    expect(within(card).getByText('Please add SMS links.')).toBeInTheDocument()
    await user.click(within(card).getByRole('link', { name: /build and publish the changes in the builder/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /review and confirm/i })).toBeInTheDocument()
    expect(screen.getByText(/asked for by karthik r/i)).toBeInTheDocument()
    await screen.findByRole('heading', { name: /what changes/i })
    await user.click(await screen.findByRole('button', { name: /publish the changes/i }))
    await user.click(within(screen.getByRole('dialog', { name: /publish the changes to lab report status/i })).getByRole('button', { name: /^publish$/i }))
    expect(await screen.findByText(/lab report status: version \d+ is published\. the request is marked done/i)).toBeInTheDocument()
    expect((await client.listChangeRequests('arogya-demo')).find((x) => x.id === r.id)!.status).toBe('done')
  })
})
