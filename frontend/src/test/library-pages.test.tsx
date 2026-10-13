import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'
const nav = () => screen.getByRole('navigation', { name: /organisation/i })

async function open(email: string, path: string) {
  const view = renderApp(path)
  await signIn(view.user, email)
  return view
}

describe('Build pages in the sidebar', () => {
  const BUILD = ['Agents', 'Call uploads', 'Knowledge', 'Tools and integrations', 'Phone numbers']
  it.each([
    ['admin@example.com', BUILD],
    ['supervisor@example.com', BUILD],
    ['viewer@example.com', ['Agents', 'Knowledge']],
    ['frontdesk@example.com', []],
  ])('%s sees the build pages they can open', async (email, pages) => {
    await open(email, O)
    await screen.findByRole('heading', { level: 1 })
    for (const p of BUILD) {
      const link = within(nav()).queryByRole('link', { name: p })
      if (pages.includes(p)) expect(link, `sees ${p}`).toBeInTheDocument()
      else expect(link, `doesn't see ${p}`).not.toBeInTheDocument()
    }
  })
})

describe('Call uploads', () => {
  it('adds recordings, shows who uses each call, and removes one after confirming', async () => {
    const { user } = await open('admin@example.com', `${O}/uploads`)
    const list = await screen.findByRole('list', { name: /^calls$/i })
    expect(within(list).getAllByText(/used by opd appointments/i).length).toBeGreaterThan(0)

    const audio = new File(['x'.repeat(2000)], 'monday-reception.mp3', { type: 'audio/mpeg' })
    fireEvent.drop(document.querySelector('.file-drop')!, { dataTransfer: { files: [audio] } })
    expect(await within(list).findByRole('heading', { name: 'monday-reception.mp3' })).toBeInTheDocument()
    expect(screen.getByText(/1 recording added, now being processed/i)).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: /remove monday-reception\.mp3/i }))
    await user.click(within(screen.getByRole('dialog', { name: /remove monday-reception/i })).getByRole('button', { name: /^remove$/i }))
    await waitFor(() => expect(within(list).queryByRole('heading', { name: 'monday-reception.mp3' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText(/search calls/i)).toHaveFocus())
  })

  it('is read-only for supervisors', async () => {
    await open('supervisor@example.com', `${O}/uploads`)
    await screen.findByRole('list', { name: /^calls$/i })
    expect(screen.queryByRole('heading', { name: /add recordings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^remove /i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /read transcript/i }).length).toBeGreaterThan(0)
  })
})

describe('Knowledge', () => {
  it('finds what an agent would answer from', async () => {
    const { user } = await open('viewer@example.com', `${O}/knowledge`)
    await user.type(await screen.findByLabelText(/a question a caller might ask/i), 'Is the cardiologist in on Wednesday?')
    await user.click(screen.getByRole('button', { name: /look it up/i }))
    const first = (await screen.findAllByText(/ramachandran, cardiology/i))[0]
    expect(first).toBeInTheDocument()
    // Viewers look; they don't add.
    expect(screen.queryByRole('button', { name: /add knowledge/i })).not.toBeInTheDocument()
  })

  it('adds an FAQ, and won’t delete a source an agent uses', async () => {
    const { user } = await open('admin@example.com', `${O}/knowledge`)
    await user.click(await screen.findByRole('button', { name: /add knowledge/i }))
    const add = screen.getByRole('dialog', { name: /add knowledge/i })
    await user.click(within(add).getByRole('radio', { name: /faq/i }))
    await user.click(within(add).getByRole('button', { name: /^add knowledge$/i }))
    await waitFor(() => expect(within(add).getByLabelText(/^name/i)).toHaveFocus())
    await user.type(within(add).getByLabelText(/^name/i), 'Lab FAQ')
    await user.type(within(add).getByLabelText(/^question 1/i), 'When do reports come?')
    await user.type(within(add).getByLabelText(/^answer 1/i), 'Most by the same evening.')
    await user.click(within(add).getByRole('button', { name: /^add knowledge$/i }))
    const list = await screen.findByRole('list', { name: /knowledge sources/i })
    const row = (await within(list).findByRole('button', { name: 'Lab FAQ' })).closest('li')!
    expect(within(row).getByText(/being read/i)).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: 'Doctor schedule, October 2026' }))
    const detail = screen.getByRole('dialog', { name: 'Doctor schedule, October 2026' })
    expect(await within(detail).findByText(/ramachandran, cardiology/i)).toBeInTheDocument()
    // In use: delete isn't offered, and it says why.
    expect(within(detail).queryByRole('button', { name: /delete source/i })).not.toBeInTheDocument()
    expect(within(detail).getByText(/can’t be deleted while main reception, opd appointments use it/i)).toBeInTheDocument()
  })

  it('edits a source in its dialog, keeping what’s typed while the list refreshes', async () => {
    const { user } = await open('admin@example.com', `${O}/knowledge`)
    const list = await screen.findByRole('list', { name: /knowledge sources/i })
    await user.click(within(list).getByRole('button', { name: 'Visiting hours and directions' }))
    const detail = screen.getByRole('dialog', { name: 'Visiting hours and directions' })
    // The FAQ's own questions are there to edit.
    expect(within(detail).getByLabelText(/^question 1/i)).toHaveValue('What are the OPD timings?')
    const name = within(detail).getByLabelText(/^name/i)
    await user.clear(name)
    await user.click(within(detail).getByRole('button', { name: /save changes/i }))
    expect(name).toHaveFocus()
    expect(name).toHaveAccessibleDescription(/at least 3 characters/i)
    await user.type(name, 'Visiting hours, parking and directions')
    await user.click(within(detail).getByRole('button', { name: /save changes/i }))
    expect(await within(detail).findByText(/visiting hours, parking and directions saved/i)).toBeInTheDocument()
    // Saving an FAQ reads it again; the list refreshes behind, and the form keeps its text.
    await user.type(within(detail).getByLabelText(/^answer 6/i), ' Ask at the front desk.')
    await new Promise((r) => setTimeout(r, 2300))
    expect(within(detail).getByLabelText(/^answer 6/i)).toHaveValue('Yes, open 24 hours, on the ground floor. Ask at the front desk.')
  })

  it('deletes a source nobody uses', async () => {
    const { user } = await open('admin@example.com', `${O}/knowledge`)
    const list = await screen.findByRole('list', { name: /knowledge sources/i })
    await user.click(within(list).getByRole('button', { name: 'Insurance partners' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Insurance partners' })).getByRole('button', { name: /delete source/i }))
    await user.click(within(screen.getByRole('dialog', { name: /delete insurance partners/i })).getByRole('button', { name: /delete source/i }))
    await waitFor(() => expect(within(list).queryByRole('button', { name: 'Insurance partners' })).not.toBeInTheDocument())
  })
})

describe('Tools and integrations', () => {
  it('connects a system after checking it, and tests one', async () => {
    const { user } = await open('admin@example.com', `${O}/integrations`)
    await user.click(await screen.findByRole('button', { name: /connect a system/i }))
    const form = screen.getByRole('dialog', { name: /connect a system/i })
    await user.click(within(form).getByRole('button', { name: /^add tool$/i }))
    await waitFor(() => expect(within(form).getByLabelText(/^name/i)).toHaveFocus())
    expect(within(form).getByText(/say what it does in a sentence/i)).toBeInTheDocument()
    await user.type(within(form).getByLabelText(/^name/i), 'Check bed availability')
    await user.type(within(form).getByLabelText(/^what it does/i), 'Says how many beds are free in a ward.')
    await user.clear(within(form).getByLabelText(/^address/i))
    await user.type(within(form).getByLabelText(/^address/i), 'https://his.example.com/api/beds')
    await user.click(within(form).getByRole('button', { name: /add an input/i }))
    await user.type(within(form).getByRole('group', { name: /input 1/i }).querySelector('input')!, 'Ward Name')
    await user.click(within(form).getByRole('button', { name: /^add tool$/i }))
    expect(within(form).getByText(/lower-case letters, digits and underscores/i)).toBeInTheDocument()
    const name = within(within(form).getByRole('group', { name: /input 1/i })).getByLabelText(/^name/i)
    await user.clear(name)
    await user.type(name, 'ward')
    await user.click(within(form).getByRole('button', { name: /^add tool$/i }))
    expect(await screen.findByRole('heading', { name: /check bed availability/i })).toBeInTheDocument()
    expect(screen.getByText(/check bed availability added\. test it/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^test find free slots$/i }))
    const test = screen.getByRole('dialog', { name: /test find free slots/i })
    // Missing details are flagged on the fields, not reported as a failed test.
    await user.click(within(test).getByRole('button', { name: /run test/i }))
    const dept = within(test).getByLabelText(/^opd department/i)
    await waitFor(() => expect(dept).toHaveFocus())
    expect(dept).toHaveAccessibleDescription(/fill this in/i)
    expect(within(test).queryByText(/it didn’t work/i)).not.toBeInTheDocument()
    await user.type(dept, 'Cardiology')
    await user.type(within(test).getByLabelText(/^the day to check/i), '2026-10-20')
    await user.click(within(test).getByRole('button', { name: /run test/i }))
    expect(await within(test).findByText(/it worked in \d\.\d seconds/i)).toBeInTheDocument()
  })

  it('keeps secrets write-only, and won’t delete one a tool sends', async () => {
    const { user } = await open('admin@example.com', `${O}/integrations`)
    const secretForm = await screen.findByRole('form', { name: /add or replace a key/i })
    await user.type(within(secretForm).getByLabelText(/^name/i), 'bad name')
    await user.click(within(secretForm).getByRole('button', { name: /save key/i }))
    expect(within(secretForm).getByLabelText(/^name/i)).toHaveFocus()
    await user.clear(within(secretForm).getByLabelText(/^name/i))
    await user.type(within(secretForm).getByLabelText(/^name/i), 'SMS_GATEWAY_KEY')
    await user.type(within(secretForm).getByLabelText(/^value/i), 's3cret-value')
    await user.click(within(secretForm).getByRole('button', { name: /save key/i }))
    expect(await screen.findByRole('heading', { name: 'SMS_GATEWAY_KEY' })).toBeInTheDocument()
    expect(within(secretForm).getByLabelText(/^value/i)).toHaveValue('')
    expect(screen.queryByText('s3cret-value')).not.toBeInTheDocument()
    // Nowhere in this tab's saved demo data either.
    expect(JSON.stringify(window.sessionStorage)).not.toContain('s3cret-value')

    // Replacing says so.
    await user.click(screen.getByRole('button', { name: /replace the value of his_api_key/i }))
    expect(within(secretForm).getByLabelText(/new value for his_api_key/i)).toHaveFocus()
    expect(within(secretForm).getByRole('button', { name: /replace key/i })).toBeInTheDocument()
    // Sent by tools: delete isn't offered.
    expect(screen.queryByRole('button', { name: /delete his_api_key/i })).not.toBeInTheDocument()
  })

  it('asks before switching off a tool agents use, and not otherwise', async () => {
    const { user } = await open('admin@example.com', `${O}/integrations`)
    const transfer = await screen.findByRole('switch', { name: /transfer to a person/i })
    await user.click(transfer)
    const dialog = screen.getByRole('dialog', { name: /switch off transfer to a person/i })
    expect(within(dialog).getByText(/callers won’t be able to reach your team/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
    expect(transfer).toHaveAttribute('aria-checked', 'true')

    const whatsapp = screen.getByRole('switch', { name: /send a whatsapp message/i })
    await user.click(whatsapp)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(whatsapp).toHaveAttribute('aria-checked', 'true')
    expect(await screen.findByText(/send a whatsapp message switched on/i)).toBeInTheDocument()
  })

  it('shows supervisors the tools without changing them', async () => {
    await open('supervisor@example.com', `${O}/integrations`)
    expect(await screen.findByRole('heading', { name: /send a whatsapp message off/i })).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /connect a system|^test |^change /i })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /secret/i })).not.toBeInTheDocument()
  })
})

describe('Phone numbers', () => {
  it('moves an agent to another number, saying what that does first', async () => {
    const { user } = await open('admin@example.com', `${O}/numbers`)
    await user.click(await screen.findByRole('button', { name: /change \+91 00000 01230/i }))
    const dialog = screen.getByRole('dialog', { name: /change \+91 00000 01230/i })
    await user.selectOptions(within(dialog).getByLabelText(/answered by/i), 'agt_reports')
    expect(within(dialog).getByText(/lab report status stops answering \+91 00000 01220/i, { selector: '.alert *' })).toBeInTheDocument()
    expect(within(dialog).getByText(/lab report status is paused: turn it on/i, { selector: '.alert *' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const row = (n: string) => screen.getByText(n).closest('li')!
    await waitFor(() => expect(within(row('+91 00000 01230')).getByText(/lab report status/i)).toBeInTheDocument())
    expect(within(row('+91 00000 01220')).getByText('No agent')).toBeInTheDocument()
  })

  it('asks bitNtech for another number', async () => {
    const { user } = await open('admin@example.com', `${O}/numbers`)
    await user.click(await screen.findByRole('button', { name: /ask for another number/i }))
    const dialog = screen.getByRole('dialog', { name: /ask for another number/i })
    await user.type(within(dialog).getByLabelText(/what it’s for/i), 'A line for the lab')
    await user.click(within(dialog).getByRole('button', { name: /send request/i }))
    expect(await screen.findByText(/request sent/i)).toBeInTheDocument()
  })
})
