import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AuthError } from '../auth/types'
import type { ConsoleClient } from '../console/types'
import { describe, expect, it } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { renderApp, signIn, signOutToLogin } from './renderApp'

/** Signs in as an admin and opens a new agent at step 0. */
async function startBuilder(opts: { processingMs?: number } = {}) {
  const view = renderApp('/ops/orgs/arogya-demo/agents', { consoleClient: createDemoConsoleClient({ latency: 0, ...opts }) })
  await signIn(view.user, 'master@example.com')
  await view.user.click(await screen.findByRole('link', { name: /new agent/i }))
  await screen.findByRole('heading', { level: 1, name: /learn from past calls/i })
  await screen.findByRole('checkbox', { name: /choose all ready calls/i })
  return view
}

const next = () => screen.getByRole('button', { name: /^next/i })
/** The error summary: not a live region, it takes focus instead. */
const summary = async () => (await screen.findByText(/to fix before going on/i)).closest('.alert') as HTMLElement

async function passCalls(user: ReturnType<typeof renderApp>['user']) {
  await user.click(screen.getByRole('checkbox', { name: /choose all/i }))
  await user.click(screen.getByRole('checkbox', { name: /callers agreed/i }))
  await user.click(next())
  await screen.findByRole('heading', { level: 1, name: /what will this agent do/i })
}

async function passType(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('radio', { name: /^hospital$/i }))
  await user.click(screen.getByRole('radio', { name: /appointments/i }))
  await user.click(next())
  await screen.findByRole('heading', { level: 1, name: /how it speaks/i })
}

describe('builder step 0: source calls', () => {
  it('needs enough ready calls and consent, and says so', async () => {
    const { user } = await startBuilder()
    expect(screen.getByRole('main').querySelector('header')).toHaveTextContent(/step 1 of 8/i)
    await user.click(next())
    const box = await summary()
    expect(box).toHaveTextContent(/2 things to fix/i)
    expect(box).toHaveTextContent(/at least 3 ready calls/i)
    expect(box).toHaveTextContent(/callers agreed/i)
    expect(box).toHaveFocus()
    // The consent error is tied to its checkbox.
    expect(screen.getByRole('checkbox', { name: /callers agreed/i })).toHaveAccessibleDescription(/confirm the callers agreed/i)
    // Errors update as they're fixed.
    await user.click(screen.getByRole('checkbox', { name: /callers agreed/i }))
    expect(await summary()).toHaveTextContent(/one thing to fix/i)
    const all = screen.getByRole('checkbox', { name: /choose all/i })
    await user.click(screen.getAllByRole('checkbox')[1])
    expect((all as HTMLInputElement).indeterminate).toBe(true)
    await user.click(all)
    expect(screen.queryByText(/to fix before going on/i)).not.toBeInTheDocument()
    expect(screen.getByText(/12 of 12 ready calls chosen/i)).toBeInTheDocument()
  })

  it('adds recordings, turns away non-audio, and waits for processing', async () => {
    const { user } = await startBuilder({ processingMs: 60_000 })
    const audio = new File([new Uint8Array(2048)], 'reception-monday.mp3', { type: 'audio/mpeg' })
    const notes = new File(['x'], 'notes.txt', { type: 'text/plain' })
    // Dropped files skip the picker's own filter, so the page must check them.
    fireEvent.drop(document.querySelector('.file-drop')!, { dataTransfer: { files: [audio, notes] } })
    expect(await screen.findByText(/notes\.txt: not an audio file/i)).toBeInTheDocument()
    expect(await screen.findByText(/1 recording added and chosen/i)).toBeInTheDocument()
    const row = (await screen.findByText('reception-monday.mp3')).closest('li')!
    expect(within(row).getByText(/^(queued|transcribing)$/i)).toBeInTheDocument()
    expect(within(row).getByRole('checkbox')).toBeChecked()
    expect(screen.getByText(/1 still processing/i)).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /choose all/i }))
    await user.click(screen.getByRole('checkbox', { name: /callers agreed/i }))
    await user.click(next())
    expect(await summary()).toHaveTextContent(/wait for 1 chosen call to finish processing/i)
  })

  it('shows transcripts with personal details hidden, or shown when allowed', async () => {
    const { user } = await startBuilder()
    const first = screen.getAllByRole('button', { name: /read transcript/i })[0]
    await user.click(first)
    const dialog = await screen.findByRole('dialog', { name: /transcript/i })
    expect(await within(dialog).findByText(/personal details are hidden/i)).toBeInTheDocument()
    await waitFor(() => expect(dialog).toHaveTextContent(/\[name\]|\[patient id\]|\[policy\]|OPD timings/i))
    await user.click(within(dialog).getByRole('button', { name: /close/i }))

    await user.click(screen.getByRole('switch', { name: /hide personal details/i }))
    await user.click(screen.getAllByRole('button', { name: /read transcript/i })[0])
    const again = await screen.findByRole('dialog', { name: /transcript/i })
    await waitFor(() => expect(again).not.toHaveTextContent(/\[name\]/))
    expect(within(again).queryByText(/personal details are hidden/i)).not.toBeInTheDocument()
  })
})

describe('builder steps 1 and 2', () => {
  it('chooses a type and job, suggesting a name', async () => {
    const { user } = await startBuilder()
    await passCalls(user)
    await screen.findByRole('radio', { name: /^hospital$/i })
    await user.click(next())
    expect(await summary()).toHaveTextContent(/choose the kind of business/i)
    await user.click(await screen.findByRole('radio', { name: /^hospital$/i }))
    await user.click(screen.getByRole('radio', { name: /report status/i }))
    expect(screen.getByLabelText(/agent name/i)).toHaveValue('Report status')
    expect(screen.getByText(/AICA will look for these/i)).toBeInTheDocument()
    expect(screen.getByText('Is my report ready?')).toBeInTheDocument()
    // A name the person typed isn't overwritten.
    await user.clear(screen.getByLabelText(/agent name/i))
    await user.type(screen.getByLabelText(/agent name/i), 'Lab line')
    await user.click(screen.getByRole('radio', { name: /appointments/i }))
    expect(screen.getByLabelText(/agent name/i)).toHaveValue('Lab line')
  })

  it('checks behaviour: languages, a voice that speaks them, and rules', async () => {
    const { user } = await startBuilder()
    await passCalls(user)
    await passType(user)
    expect(screen.getByLabelText(/spoken name/i)).toHaveValue('Kavya')
    expect((screen.getByLabelText(/^greeting/i) as HTMLTextAreaElement).value).toMatch(/Arogya Demo Hospital/)

    await user.click(await screen.findByRole('radio', { name: /meera/i }))
    await user.click(next())
    expect(await summary()).toHaveTextContent(/doesn't speak tamil/i)
    await user.click(screen.getByRole('checkbox', { name: /^tamil$/i }))
    expect(screen.queryByText(/to fix before going on/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/greets callers in/i)).toHaveValue('english')

    await user.type(screen.getByLabelText(/add a rule/i), 'Never quote a price that isn’t in the price list.{Enter}')
    expect(screen.getByText('Never quote a price that isn’t in the price list.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /remove rule: never give medical advice/i }))
    expect(screen.queryByText(/never give medical advice/i)).not.toBeInTheDocument()
    expect(screen.getByText(/rule removed\. 3 rules left/i)).toBeInTheDocument()

    await user.click(next())
    expect(await screen.findByRole('heading', { level: 1, name: /conversation flow/i })).toBeInTheDocument()
  })
})

describe('builder drafts', () => {
  it('saves and exits, then continues from the Agents list', async () => {
    const { user } = await startBuilder()
    await passCalls(user)
    await passType(user)
    await user.click(screen.getByRole('button', { name: /save and exit/i }))
    const list = await screen.findByRole('list', { name: /agents/i })
    const row = within(list).getByRole('heading', { name: 'Appointments' }).closest('li')!
    expect(row).toHaveTextContent(/setup: step 3 of 8, behaviour/i)
    await user.click(within(row).getByRole('link', { name: /continue setup/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /how it speaks/i })).toBeInTheDocument()
    // Earlier steps are links; later ones aren't reachable yet.
    const steps = screen.getByRole('navigation', { name: /builder steps/i })
    expect(within(steps).getByRole('link', { name: /source calls/i })).toBeInTheDocument()
    expect(within(steps).queryByRole('link', { name: /attributes/i })).not.toBeInTheDocument()
  })

  it('discards a draft after confirming', async () => {
    const { user } = await startBuilder()
    await user.click(screen.getByRole('button', { name: /discard this draft/i }))
    const dialog = screen.getByRole('dialog', { name: /discard this draft/i })
    await user.click(within(dialog).getByRole('button', { name: /discard draft/i }))
    const list = await screen.findByRole('list', { name: /agents/i })
    expect(within(list).queryByText('Untitled agent')).not.toBeInTheDocument()
  })

  it('keeps supervisors out of the builder', async () => {
    const first = renderApp('/login')
    await signIn(first.user, 'supervisor@example.com')
    await screen.findByRole('main')
    first.unmount()
    renderApp('/o/arogya-demo/agents/new')
    expect(await screen.findByText(/the agent builder isn't part of the supervisor role/i)).toBeInTheDocument()
  })
})

describe('builder robustness', () => {
  it('sends a link to a step not reached yet to the furthest step reached', async () => {
    const { user } = await startBuilder()
    await passCalls(user)
    // Jump ahead by URL: the app goes back to Type, the furthest reached.
    const draftPath = (screen.getByRole('navigation', { name: /builder steps/i }).querySelector('a') as HTMLAnchorElement).getAttribute('href')!
    const second = renderApp(draftPath.replace(/calls$/, 'review'))
    expect(await within(second.container).findByRole('heading', { level: 1, name: /what will this agent do/i })).toBeInTheDocument()
  })

  it('doesn’t carry a failed Next’s errors to the step you go back to', async () => {
    const { user } = await startBuilder()
    await passCalls(user)
    await user.click(next())
    expect(await summary()).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /^back$/i }))
    await screen.findByRole('heading', { level: 1, name: /learn from past calls/i })
    expect(screen.queryByText(/to fix before going on/i)).not.toBeInTheDocument()
  })

  it('keeps the draft through a reload', async () => {
    const { user, unmount } = await startBuilder()
    await passCalls(user)
    const path = (screen.getByRole('navigation', { name: /builder steps/i }).querySelector('a') as HTMLAnchorElement).getAttribute('href')!
    unmount()
    renderApp(path.replace(/calls$/, 'type'))
    expect(await screen.findByRole('heading', { level: 1, name: /what will this agent do/i })).toBeInTheDocument()
  })

  it('stays where you went if you leave before the draft exists', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    let release: () => void = () => {}
    const slow: ConsoleClient = {
      ...demo,
      async createDraft(o, n) {
        await new Promise<void>((r) => (release = r))
        return demo.createDraft(o, n)
      },
    }
    const { user } = renderApp('/ops/orgs/arogya-demo/agents', { consoleClient: slow })
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /new agent/i }))
    expect(await screen.findByText(/starting a new agent/i)).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /^overview$/i }))
    await screen.findByRole('heading', { level: 1, name: /every client/i })
    await act(async () => release())
    expect(screen.getByRole('heading', { level: 1, name: /every client/i })).toBeInTheDocument()
  })

  it('says when a save fails, and recovers with Retry', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    let fail = true
    const flaky: ConsoleClient = {
      ...demo,
      async saveDraft(o, d) {
        if (fail) throw new AuthError('network', 'Offline')
        return demo.saveDraft(o, d)
      },
    }
    const { user } = renderApp('/ops/orgs/arogya-demo/agents', { consoleClient: flaky })
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /new agent/i }))
    await user.click(await screen.findByRole('checkbox', { name: /callers agreed/i }))
    expect(await screen.findByText(/couldn’t save your changes/i, {}, { timeout: 3000 })).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText(/your changes are saved now/i)).toBeInTheDocument()
    expect(screen.getByText(/draft saved/i)).toBeInTheDocument()
  })

  it('forgets demo drafts when someone signs out', async () => {
    const { user } = await startBuilder()
    await passCalls(user)
    await user.click(screen.getByRole('button', { name: /save and exit/i }))
    await screen.findByRole('list', { name: /agents/i })
    await signOutToLogin(user)
    await signIn(user, 'master@example.com')
    await user.click((await screen.findAllByRole('link', { name: /arogya demo hospital/i }))[0])
    await user.click(await screen.findByRole('link', { name: /build and change agents/i }))
    const list = await screen.findByRole('list', { name: /agents/i })
    // Only the sample draft is left; the one started here is gone.
    expect(within(list).getAllByText(/setup: step/i)).toHaveLength(1)
    expect(within(list).queryByRole('heading', { name: /untitled agent/i })).not.toBeInTheDocument()
  })
})
