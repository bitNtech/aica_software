import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import type { ConsoleClient } from '../console/types'
import { renderApp, signIn } from './renderApp'

type User = ReturnType<typeof renderApp>['user']
const next = () => screen.getByRole('button', { name: /^next/i })
const tree = () => screen.getByRole('list', { name: /conversation flow/i })
const summary = async () => (await screen.findByText(/to fix before going on/i)).closest('.alert') as HTMLElement

const rail = () => screen.getByRole('navigation', { name: /builder steps/i })

/** Signs in as an admin and walks the builder to the flow step (step 4).
 * `tweak` can change the demo client first, e.g. to make a call fail. */
async function toFlow(tweak?: (c: ConsoleClient) => void) {
  const client = createDemoConsoleClient({ latency: 0 })
  tweak?.(client)
  const view = renderApp('/o/arogya-demo/agents', { consoleClient: client })
  const { user } = view
  await signIn(user, 'admin@example.com')
  await user.click(await screen.findByRole('link', { name: /new agent/i }))
  await user.click(await screen.findByRole('checkbox', { name: /choose all ready calls/i }))
  await user.click(screen.getByRole('checkbox', { name: /callers agreed/i }))
  await user.click(next())
  await user.click(await screen.findByRole('radio', { name: /^hospital$/i }))
  await user.click(screen.getByRole('radio', { name: /appointments/i }))
  await user.click(next())
  await screen.findByRole('radio', { name: /kavya/i })
  await user.click(next())
  await screen.findByRole('list', { name: /conversation flow/i })
  return { ...view, consoleClient: client }
}

async function toReview(user: User) {
  for (const heading of [/details to collect/i, /anywhere in a call/i, /what it knows and can do/i]) {
    await user.click(next())
    await screen.findByRole('heading', { level: 1, name: heading })
  }
  await screen.findByRole('checkbox', { name: /transfer to a person/i })
  await user.click(next())
  await screen.findByRole('heading', { level: 1, name: /review and confirm/i })
  await screen.findByText(/ready to publish|fix these before publishing/i)
}

describe('builder step 3: conversation flow', () => {
  it('reads the calls into intents with confidence and sources', async () => {
    const { user } = await toFlow()
    const book = within(tree()).getByText('Book an appointment', { selector: '.flow__label' }).closest('li')!
    expect(within(book).getByText(/high confidence, 94%/i)).toBeInTheDocument()
    expect(within(book).getByText('Offer two slots')).toBeInTheDocument()
    expect(screen.getByText(/1 needs a look/i)).toBeInTheDocument()
    // Intents are headings, for jumping between them.
    expect(within(tree()).getAllByRole('heading', { level: 3 })).toHaveLength(4)

    await user.click(within(book).getAllByRole('button', { name: /seen in \d+ calls: book an appointment/i })[0])
    const dialog = screen.getByRole('dialog', { name: /where “book an appointment” came from/i })
    expect(within(dialog).getAllByText(/reception call/i).length).toBeGreaterThan(0)
    await user.click(within(dialog).getByRole('button', { name: /close/i }))

    await user.click(screen.getByRole('switch', { name: /only what needs a look/i }))
    expect(within(tree()).getAllByRole('heading', { level: 3 })).toHaveLength(1)
    expect(within(tree()).getByText('Ask about timings and directions', { selector: '.flow__label' })).toBeInTheDocument()
  })

  it('edits, adds, cancels, moves, merges and deletes', async () => {
    const { user } = await toFlow()
    // Rename an intent; focus returns to it.
    await user.click(screen.getByRole('button', { name: /^edit book an appointment$/i }))
    const name = screen.getByLabelText(/^name/i)
    expect(name).toHaveFocus()
    await user.clear(name)
    await user.type(name, 'Book an OPD visit{Enter}')
    expect(within(tree()).getByText('Book an OPD visit', { selector: '.flow__label' })).toHaveFocus()

    // A new step cancelled while empty disappears again.
    await user.click(screen.getByRole('button', { name: /add step to cancel an appointment/i }))
    expect(screen.getByLabelText(/^name/i)).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(within(tree()).queryByText('Unnamed')).not.toBeInTheDocument()

    // Move down.
    const tops = () => [...tree().children].map((li) => li.querySelector('.flow__label')?.textContent)
    expect(tops()[0]).toBe('Book an OPD visit')
    await user.click(screen.getByRole('button', { name: /move book an opd visit down/i }))
    expect(tops()[1]).toBe('Book an OPD visit')

    // Merge Cancel into Reschedule.
    await user.click(screen.getByRole('button', { name: /^edit cancel an appointment$/i }))
    await user.selectOptions(screen.getByLabelText(/merge into another intent/i), 'Reschedule an appointment')
    await user.click(screen.getByRole('button', { name: /^merge$/i }))
    await user.click(within(screen.getByRole('dialog', { name: /merge these intents/i })).getByRole('button', { name: /^merge$/i }))
    expect(within(tree()).queryByText('Cancel an appointment', { selector: '.flow__label' })).not.toBeInTheDocument()
    const resched = within(tree()).getByText('Reschedule an appointment', { selector: '.flow__label' }).closest('li')!
    expect(within(resched).getByText('Confirm the cancellation', { selector: '.flow__label' })).toBeInTheDocument()

    // Delete an intent with steps, after confirming.
    await user.click(screen.getByRole('button', { name: /^edit ask about timings and directions$/i }))
    await user.click(screen.getByRole('button', { name: /delete intent/i }))
    await user.click(within(screen.getByRole('dialog', { name: /delete “ask about timings/i })).getByRole('button', { name: /delete intent/i }))
    expect(within(tree()).queryByText('Ask about timings and directions', { selector: '.flow__label' })).not.toBeInTheDocument()
  })

  it('won’t go on with an intent that has no steps', async () => {
    const { user } = await toFlow()
    await user.click(screen.getByRole('button', { name: /add intent/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Ask about parking{Enter}')
    await user.click(next())
    expect(await summary()).toHaveTextContent(/“ask about parking” has no steps/i)
    const row = within(tree()).getByText('Ask about parking', { selector: '.flow__label' }).closest('li')!
    expect(within(row).getByText(/has no steps/i)).toBeInTheDocument()
  })
})

describe('builder steps 4 to 6', () => {
  it('checks details, global flows and knowledge', async () => {
    const { user } = await toFlow()
    await user.click(next())
    await screen.findByRole('heading', { level: 1, name: /details to collect/i })
    const list = screen.getByRole('list', { name: /details to collect/i })
    expect(within(list).getByText('Patient name', { selector: '.attrs__name' })).toBeInTheDocument()
    expect(within(list).getAllByText('Personal data').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /^edit visit type$/i }))
    const options = screen.getByLabelText(/^options/i)
    await user.clear(options)
    await user.type(options, 'Only one')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(screen.getByText(/at least two options/i)).toBeInTheDocument()
    await user.type(options, '{Enter}Another')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await user.click(next())
    await screen.findByRole('heading', { level: 1, name: /anywhere in a call/i })
    // Locked on, but still focusable and explained.
    const emergency = screen.getByRole('switch', { name: /emergency/i })
    expect(emergency).toHaveAttribute('aria-disabled', 'true')
    expect(emergency).toHaveAccessibleDescription(/always on/i)
    await user.click(emergency)
    expect(emergency).toHaveAttribute('aria-checked', 'true')
    // Each flow's fields are grouped under its name.
    expect(within(screen.getByRole('group', { name: /^emergency$/i })).getByLabelText(/^when/i)).toBeInTheDocument()

    await user.click(next())
    await screen.findByRole('checkbox', { name: /transfer to a person/i })
    for (const box of within(screen.getByRole('group', { name: /knowledge it answers from/i })).getAllByRole('checkbox', { checked: true })) await user.click(box)
    await user.click(screen.getByRole('checkbox', { name: /transfer to a person/i }))
    await user.click(next())
    const box = await summary()
    expect(box).toHaveTextContent(/at least one knowledge source/i)
    expect(box).toHaveTextContent(/transfer to a person” is needed/i)
  })
})

describe('builder step 7: review and publish', () => {
  it('tests the agent in a simulated chat', async () => {
    const { user } = await toFlow()
    await toReview(user)
    expect(screen.getByText(/ready to publish/i)).toBeInTheDocument()
    expect(screen.getByText(/1 intent has low confidence/i)).toBeInTheDocument()
    // {date}, {slot 1} and the like are filled in during the call: not flagged.
    expect(screen.queryByText(/isn’t a detail|aren’t details/i)).not.toBeInTheDocument()

    const chat = screen.getByRole('list', { name: /test conversation/i })
    expect(within(chat).getByText(/vanakkam/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/say something as the caller/i), 'I want to book an appointment{Enter}')
    expect(within(chat).getByText(/which doctor or department/i)).toBeInTheDocument()
    expect(within(chat).getByText(/flow: book an appointment › ask for the doctor/i)).toBeInTheDocument()
    expect(within(chat).getByText(/tool: book an appointment \(asks the caller first\)/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /i have chest pain/i }))
    expect(within(chat).getByText(/global flow: emergency/i)).toBeInTheDocument()
  })

  it('publishes to a free number and shows it live', async () => {
    const { user } = await toFlow()
    await toReview(user)
    expect(screen.getByRole('combobox', { name: /^phone number/i })).toHaveDisplayValue(/01230/)
    await user.click(screen.getByRole('button', { name: /publish agent/i }))
    await user.click(within(screen.getByRole('dialog', { name: /publish appointments/i })).getByRole('button', { name: /^publish$/i }))
    expect(await screen.findByText(/appointments is live on \+91 00000 01230/i)).toBeInTheDocument()
    const row = within(await screen.findByRole('list', { name: /agents/i })).getByRole('heading', { name: 'Appointments' }).closest('li')!
    expect(within(row).getByText('Live')).toBeInTheDocument()
    expect(within(row).queryByText(/setup: step/i)).not.toBeInTheDocument()
  })

  it('publishes paused, without a number', async () => {
    const { user } = await toFlow()
    await toReview(user)
    await user.click(screen.getByRole('radio', { name: /publish paused/i }))
    await user.click(screen.getByRole('button', { name: /publish agent/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^publish$/i }))
    expect(await screen.findByText(/published and paused/i)).toBeInTheDocument()
  })

  it('catches problems made after jumping back, and links to them', async () => {
    const { user } = await toFlow()
    await toReview(user)
    await user.click(within(rail()).getByRole('link', { name: /^type$/i }))
    await user.clear(await screen.findByLabelText(/agent name/i))
    await user.click(within(rail()).getByRole('link', { name: /review/i }))
    const fix = await screen.findByText(/fix these before publishing/i)
    const alert = fix.closest('.alert') as HTMLElement
    expect(within(alert).getByRole('link', { name: /^type$/i })).toBeInTheDocument()
    const publish = screen.getByRole('button', { name: /publish agent/i })
    expect(publish).toHaveAttribute('aria-disabled', 'true')
    expect(publish).toHaveAccessibleDescription(/fix the step listed at the top/i)
    await user.click(publish)
    expect(screen.queryByRole('dialog', { name: /publish/i })).not.toBeInTheDocument()
  })

  it('shows a failed publish once, in the dialog, and can try again', async () => {
    let failed = false
    const { user } = await toFlow((c) => {
      const real = c.publishDraft.bind(c)
      c.publishDraft = async (o, id, numberId) => {
        if (!failed) {
          failed = true
          throw new AuthError('invalid_input', '+91 00000 01230 already has an agent. Choose a free number.')
        }
        return real(o, id, numberId)
      }
    })
    await toReview(user)
    await user.click(screen.getByRole('button', { name: /publish agent/i }))
    const dialog = screen.getByRole('dialog', { name: /publish appointments/i })
    await user.click(within(dialog).getByRole('button', { name: /^publish$/i }))
    // Shown once, in the dialog, not behind it too.
    expect(await within(dialog).findByText(/already has an agent/i)).toBeInTheDocument()
    expect(screen.getAllByText(/already has an agent/i)).toHaveLength(1)
    await user.click(within(dialog).getByRole('button', { name: /^publish$/i }))
    expect(await screen.findByText(/appointments is live/i)).toBeInTheDocument()
  })

  it('doesn’t publish when the last changes can’t be saved', async () => {
    const { user, consoleClient: client } = await toFlow()
    await toReview(user)
    // Saving fails from here on, with a change waiting to be saved.
    client.saveDraft = async () => {
      throw new AuthError('network', 'offline')
    }
    await user.click(within(rail()).getByRole('link', { name: /^type$/i }))
    await user.type(await screen.findByLabelText(/agent name/i), ' desk')
    await user.click(within(rail()).getByRole('link', { name: /review/i }))
    await screen.findByText(/ready to publish/i)
    await user.click(screen.getByRole('button', { name: /publish agent/i }))
    const dialog = screen.getByRole('dialog', { name: /publish appointments desk/i })
    await user.click(within(dialog).getByRole('button', { name: /^publish$/i }))
    expect(await within(dialog).findByText(/couldn’t save your last changes, so nothing was published/i)).toBeInTheDocument()
  })
})

describe('builder step 3: reading and focus', () => {
  it('offers to write the flow by hand when reading fails', async () => {
    const view = renderApp('/o/arogya-demo/agents', {
      consoleClient: (() => {
        const c = createDemoConsoleClient({ latency: 0 })
        c.extractFlow = async () => {
          throw new AuthError('network', 'AICA couldn’t reach the server.')
        }
        return c
      })(),
    })
    const { user } = view
    await signIn(user, 'admin@example.com')
    await user.click(await screen.findByRole('link', { name: /new agent/i }))
    await user.click(await screen.findByRole('checkbox', { name: /choose all ready calls/i }))
    await user.click(screen.getByRole('checkbox', { name: /callers agreed/i }))
    await user.click(next())
    await user.click(await screen.findByRole('radio', { name: /^hospital$/i }))
    await user.click(screen.getByRole('radio', { name: /appointments/i }))
    await user.click(next())
    await screen.findByRole('radio', { name: /kavya/i })
    await user.click(next())
    await screen.findByText(/couldn't read your calls/i)
    await user.click(screen.getByRole('button', { name: /write the flow yourself/i }))
    await user.click(screen.getByRole('button', { name: /add intent/i }))
    expect(screen.getByLabelText(/^name/i)).toHaveFocus()
  })

  it('reads again on request, keeping focus and announcing the result', async () => {
    const { user } = await toFlow()
    const again = screen.getByRole('button', { name: /read the calls again/i })
    await user.click(again)
    await user.click(within(screen.getByRole('dialog', { name: /read the calls again/i })).getByRole('button', { name: /read again/i }))
    await waitFor(() => expect(screen.getByText(/flow updated: 4 intents/i)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/4 intents,/i)).toHaveFocus())
  })

  it('sends focus to the next intent after a delete, and can undo it', async () => {
    const { user } = await toFlow()
    await user.click(screen.getByRole('button', { name: /^edit book an appointment$/i }))
    await user.click(screen.getByRole('button', { name: /delete intent/i }))
    await user.click(within(screen.getByRole('dialog', { name: /delete “book an appointment/i })).getByRole('button', { name: /delete intent/i }))
    expect(within(tree()).getByText('Reschedule an appointment', { selector: '.flow__label' })).toHaveFocus()
    expect(screen.getByText(/deleted the intent\./i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^undo$/i }))
    expect(within(tree()).getByText('Book an appointment', { selector: '.flow__label' })).toHaveFocus()
  })

  it('keeps focus on the move button while it can still move', async () => {
    const { user } = await toFlow()
    const down = screen.getByRole('button', { name: /move book an appointment down/i })
    await user.click(down)
    expect(screen.getByRole('button', { name: /move book an appointment down/i })).toHaveFocus()
  })

  it('warns when the calls or the job changed after reading', async () => {
    const { user } = await toFlow()
    await user.click(within(rail()).getByRole('link', { name: /^type$/i }))
    await user.click(await screen.findByRole('radio', { name: /report status/i }))
    await user.click(within(rail()).getByRole('link', { name: /conversation flow/i }))
    expect(await screen.findByText(/your calls or the agent’s job changed/i)).toBeInTheDocument()
    // Coming back doesn't read the calls again by itself.
    expect(within(tree()).getByText('Book an appointment', { selector: '.flow__label' })).toBeInTheDocument()
  })
})
