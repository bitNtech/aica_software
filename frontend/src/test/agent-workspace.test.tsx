import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import { renderApp, signIn } from './renderApp'

const AGENT = '/o/arogya-demo/agents/agt_appointments'
const tabs = () => screen.getByRole('navigation', { name: /agent sections/i })
const tabNames = () => within(tabs()).getAllByRole('link').map((l) => l.textContent)

async function open(email: string, path = AGENT) {
  const view = renderApp(path)
  await signIn(view.user, email)
  await screen.findByRole('navigation', { name: /agent sections/i })
  return view
}

describe('agent workspace: who sees what', () => {
  it('is opened from the Agents list, on the Flow tab', async () => {
    const { user } = renderApp('/o/arogya-demo/agents')
    await signIn(user, 'admin@example.com')
    await user.click(await screen.findByRole('link', { name: 'OPD appointments' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'OPD appointments' })).toBeInTheDocument()
    expect(within(tabs()).getByRole('link', { name: 'Flow' })).toHaveAttribute('aria-current', 'page')
    expect(tabNames()).toEqual(['Flow', 'Behaviour and voice', 'Voice pipeline', 'Knowledge', 'Tools', 'Handoff and guardrails', 'After each call', 'Test', 'Versions', 'Settings'])
    expect(screen.getByText(/answering \+91 00000 01210/i)).toBeInTheDocument()
  })

  it('is read-only for viewers, without tools, test or settings', async () => {
    await open('viewer@example.com', `${AGENT}/settings`)
    expect(tabNames()).toEqual(['Flow', 'Behaviour and voice', 'Knowledge', 'Handoff and guardrails', 'After each call', 'Versions'])
    // Settings isn't theirs: they land on Flow.
    expect(within(tabs()).getByRole('link', { name: 'Flow' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('list', { name: /conversation flow/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit /i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add intent/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument()
  })

  it('lets supervisors test, but not publish or change settings', async () => {
    const { user } = await open('supervisor@example.com', `${AGENT}/test`)
    expect(tabNames()).toContain('Test')
    expect(tabNames()).not.toContain('Settings')
    await user.type(screen.getByLabelText(/say something as the caller/i), 'I want to book an appointment{Enter}')
    expect(within(screen.getByRole('list', { name: /test conversation/i })).getByText(/which doctor or department/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start a test call/i })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('agent workspace: changes and versions', () => {
  it('saves edits as unpublished changes, then publishes them as the next version', async () => {
    const { user } = await open('admin@example.com', `${AGENT}/behaviour`)
    const greeting = screen.getByLabelText(/^greeting/i)
    await user.clear(greeting)
    await user.type(greeting, 'Vanakkam, OPD desk.')
    expect(await screen.findByText(/draft changes, not live yet/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/draft saved/i)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /review and publish/i }))
    const dialog = screen.getByRole('dialog', { name: /publish version 13/i })
    expect(within(dialog).getByText(/new greeting: “vanakkam, opd desk\.”/i)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/note for your team/i), 'Shorter greeting')
    await user.click(within(dialog).getByRole('button', { name: /^publish$/i }))
    expect(await screen.findByText(/version 13 is live on \+91 00000 01210/i, { selector: '.alert *' })).toBeInTheDocument()
    expect(screen.queryByText(/draft changes, not live yet/i)).not.toBeInTheDocument()

    await user.click(within(tabs()).getByRole('link', { name: 'Versions' }))
    const history = screen.getByRole('list', { name: /published versions/i })
    const first = within(history).getAllByRole('listitem')[0]
    expect(within(first).getByText('Version 13')).toBeInTheDocument()
    expect(within(first).getByText('Shorter greeting')).toBeInTheDocument()
    expect(within(first).getByText('Live')).toBeInTheDocument()
  })

  it('deletes draft changes after confirming', async () => {
    const { user } = await open('admin@example.com', `${AGENT}/behaviour`)
    await user.type(screen.getByLabelText(/^spoken name/i), 'a')
    await user.click(await screen.findByRole('button', { name: /delete draft changes/i }))
    await user.click(within(screen.getByRole('dialog', { name: /delete the draft changes/i })).getByRole('button', { name: /delete draft changes/i }))
    expect(await screen.findByText(/draft changes deleted/i, { selector: '.alert *' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^spoken name/i)).toHaveValue('Kavya')
  })

  it('won’t publish with problems, and says which tab they’re on', async () => {
    const { user } = await open('admin@example.com', `${AGENT}/rules`)
    await user.clear(screen.getByLabelText(/put callers through to/i))
    await user.click(await screen.findByRole('button', { name: /review and publish/i }))
    const alert = (await screen.findByText(/fix these before publishing/i)).closest('.alert') as HTMLElement
    await waitFor(() => expect(alert).toHaveFocus())
    expect(within(alert).getByRole('link', { name: /handoff and guardrails/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(tabs()).getByRole('link', { name: /^handoff and guardrails, 1 to fix$/i })).toBeInTheDocument()
    expect(screen.getByText(/say where handovers go/i, { selector: '.field__error' })).toBeInTheDocument()
  })

  it('compares versions and goes back to an earlier one', async () => {
    const { user } = await open('admin@example.com', `${AGENT}/versions`)
    await user.click(screen.getByRole('button', { name: /compare version 10 with the live version/i }))
    expect(screen.getByRole('heading', { name: /from version 10 to version 12/i })).toBeInTheDocument()
    expect(screen.getByText(/added intents: “cancel an appointment”/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /make version 10 live again/i }))
    await user.click(within(screen.getByRole('dialog', { name: /make version 10 live again/i })).getByRole('button', { name: /^make it live$/i }))
    expect(await screen.findByText(/version 10’s setup is live again, as version 13/i, { selector: '.alert *' })).toBeInTheDocument()
    const first = within(screen.getByRole('list', { name: /published versions/i })).getAllByRole('listitem')[0]
    expect(within(first).getByText(/went back to version 10/i)).toBeInTheDocument()
  })
})

describe('agent workspace: settings', () => {
  it('renames, pauses after confirming, and turns on again', async () => {
    const { user } = await open('admin@example.com', `${AGENT}/settings`)
    const name = screen.getByLabelText(/^agent name/i)
    await user.clear(name)
    await user.type(name, 'OPD bookings')
    await user.click(screen.getByRole('button', { name: /save name/i }))
    expect(await screen.findByRole('heading', { level: 1, name: 'OPD bookings' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /pause agent/i }))
    await user.click(within(screen.getByRole('dialog', { name: /pause opd bookings/i })).getByRole('button', { name: /^pause$/i }))
    expect(await screen.findByText('Paused', { selector: '.status-chip' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /turn on/i }))
    expect(await screen.findByText('Live', { selector: '.status-chip' })).toBeInTheDocument()
  })

  it('pauses an agent left without a number, and can’t turn it on', async () => {
    const { user } = await open('admin@example.com', `${AGENT}/settings`)
    await user.selectOptions(screen.getByLabelText(/^answers/i), '')
    await user.click(screen.getByRole('button', { name: /save number/i }))
    // It's live: taking its number away asks first.
    await user.click(within(screen.getByRole('dialog', { name: /take \+91 00000 01210 away/i })).getByRole('button', { name: /remove number/i }))
    expect(await screen.findByText(/has no number now, so it’s paused/i, { selector: '.alert *' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /turn on/i })).toHaveAttribute('aria-disabled', 'true')
  })

  it('offers delete to nobody in the hospital', async () => {
    await open('admin@example.com', `${AGENT}/settings`)
    await screen.findByRole('heading', { name: /answering calls/i })
    expect(screen.queryByRole('button', { name: /delete agent/i })).not.toBeInTheDocument()
  })

  it('lets bitNtech delete, only when the name is typed', async () => {
    const { user } = await open('master@example.com', `/ops/orgs/arogya-demo/agents/agt_appointments/settings`)
    await user.click(screen.getByRole('button', { name: /delete agent/i }))
    const dialog = screen.getByRole('dialog', { name: /delete opd appointments/i })
    // Focus starts in the name field; a wrong name is flagged on it.
    const field = within(dialog).getByLabelText(/type “opd appointments”/i)
    expect(field).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: /delete agent/i }))
    expect(field).toHaveAccessibleDescription(/exactly, to confirm/i)
    expect(field).toHaveFocus()
    // Enter in the field confirms.
    await user.type(field, 'OPD appointments{Enter}')
    expect(await screen.findByText(/opd appointments is deleted/i)).toBeInTheDocument()
    expect(within(await screen.findByRole('list', { name: /agents/i })).queryByRole('link', { name: 'OPD appointments' })).not.toBeInTheDocument()
  })
})

describe('agent workspace: edge cases', () => {
  it('says so for an agent that doesn’t exist', async () => {
    const { user } = renderApp('/o/arogya-demo/agents/agt_missing/flow')
    await signIn(user, 'admin@example.com')
    expect(await screen.findByText(/couldn't open this agent/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to agents/i })).toBeInTheDocument()
  })

  it('doesn’t show viewers the calls behind the flow', async () => {
    await open('viewer@example.com', `${AGENT}/flow`)
    await screen.findByRole('list', { name: /conversation flow/i })
    expect(screen.queryByRole('button', { name: /seen in \d+ calls/i })).not.toBeInTheDocument()
  })

  it('compares with the live version once the draft changes are gone', async () => {
    const { user } = await open('admin@example.com', `${AGENT}/behaviour`)
    await user.type(screen.getByLabelText(/^spoken name/i), 'a')
    await user.click(within(tabs()).getByRole('link', { name: 'Versions' }))
    expect(screen.getByLabelText(/^to/i)).toHaveDisplayValue(/draft changes/i)
    await user.click(screen.getByRole('button', { name: /delete draft changes/i }))
    await user.click(within(screen.getByRole('dialog', { name: /delete the draft changes/i })).getByRole('button', { name: /delete draft changes/i }))
    await screen.findByText(/draft changes deleted/i, { selector: '.alert *' })
    expect(screen.getByLabelText(/^to/i)).toHaveDisplayValue(/version 12 \(live\)/i)
    expect(screen.getByRole('heading', { name: /to version 12$/i })).toBeInTheDocument()
  })

  it('keeps saving edits after a delete fails', async () => {
    const client = createDemoConsoleClient({ latency: 0 })
    client.deleteAgent = async () => {
      throw new AuthError('network', 'offline')
    }
    const { user } = renderApp(`/ops/orgs/arogya-demo/agents/agt_appointments/settings`, { consoleClient: client })
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('button', { name: /delete agent/i }))
    const dialog = screen.getByRole('dialog', { name: /delete opd appointments/i })
    await user.type(within(dialog).getByLabelText(/type “opd appointments”/i), 'OPD appointments{Enter}')
    expect(await within(dialog).findByText('offline')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
    await user.click(within(tabs()).getByRole('link', { name: 'Behaviour and voice' }))
    await user.type(screen.getByLabelText(/^spoken name/i), 'a')
    await waitFor(() => expect(screen.getByText(/draft saved/i)).toBeInTheDocument())
    expect((await client.getAgent('arogya-demo', 'agt_appointments')).working.behaviour.persona).toBe('Kavyaa')
  })
})
