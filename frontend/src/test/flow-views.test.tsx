import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DetectedFlowChart } from '../components/console/DetectedFlowChart'
import { createDemoConsoleClient } from '../console/demoClient'
import type { DetectedFlowPattern, FlowNode } from '../console/types'
import { renderApp, signIn } from './renderApp'

const focus = (el: Element) => act(() => (el as HTMLElement | SVGElement).focus())
const tree = () => screen.getByRole('tree', { name: /conversation flow diagram/i })
const outline = () => screen.getByRole('list', { name: /conversation flow/i })
const treeitem = (name: RegExp | string) => within(tree()).getByRole('treeitem', { name })
const view = (name: string) => screen.getByRole('radio', { name })

const AGENT = '/o/arogya-demo/agents/agt_appointments'
const OPS_AGENT = '/ops/orgs/arogya-demo/agents/agt_appointments'

async function openFlowTab(email: string, path: string) {
  const v = renderApp(path)
  await signIn(v.user, email)
  await screen.findByRole('list', { name: /conversation flow/i })
  return v
}

describe('the agent’s Flow tab: outline, diagram, side by side', () => {
  it('starts as the outline, and switches to the diagram and back, remembering the choice', async () => {
    const { user, unmount } = await openFlowTab('admin@example.com', `${AGENT}/flow`)
    expect(view('Outline')).toBeChecked()
    expect(screen.queryByRole('tree')).not.toBeInTheDocument()

    await user.click(view('Diagram'))
    expect(tree()).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /conversation flow/i })).not.toBeInTheDocument()
    expect(treeitem(/^Intent: Book an appointment/)).toBeInTheDocument()
    expect(treeitem(/^Step: Offer two slots/)).toBeInTheDocument()
    // The branch, with its condition on the arrow.
    expect(treeitem(/^Branch: No slot suits the caller, when The caller can’t make either slot/)).toBeInTheDocument()
    expect(localStorage.getItem('aica.flow.view')).toBe('diagram')
    // The outline stays one click away, and says so.
    expect(tree()).toHaveAccessibleDescription(/outline view lists the same flow/i)

    await user.click(view('Outline'))
    expect(outline()).toBeInTheDocument()
    await user.click(view('Diagram'))
    unmount()

    // A fresh visit opens on the diagram.
    renderApp(`${AGENT}/flow`)
    expect(await screen.findByRole('tree', { name: /conversation flow diagram/i })).toBeInTheDocument()
    expect(view('Diagram')).toBeChecked()
  })

  it('keeps the diagram read-only for a hospital, with no edit buttons on any node', async () => {
    const { user } = await openFlowTab('admin@example.com', `${AGENT}/flow`)
    await user.click(view('Diagram'))
    focus(treeitem(/^Step: Offer two slots/))
    await user.keyboard('{ArrowDown}')
    expect(screen.queryByRole('group', { name: /^edit /i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add an intent|add a step|delete|edit details/i })).not.toBeInTheDocument()
    // But they can still read: what a step says, and its folded count.
    await user.click(treeitem(/^Step: Offer two slots/))
    expect(await screen.findByRole('region', { name: /about offer two slots/i })).toHaveTextContent(/dr\. \{doctor\}/i)
  })

  it('side by side: a node picked in the diagram focuses its outline row, and an outline row selects its node', async () => {
    const { user } = await openFlowTab('admin@example.com', `${AGENT}/flow`)
    await user.click(view('Side by side'))
    expect(outline()).toBeInTheDocument()
    expect(tree()).toBeInTheDocument()

    await user.click(treeitem(/^Step: Offer two slots/))
    const label = within(outline()).getByText('Offer two slots', { selector: '.flow__label' })
    expect(label).toHaveFocus()
    expect(treeitem(/^Step: Offer two slots/)).toHaveAttribute('aria-selected', 'true')
    expect(label.closest('.flow__row')).toHaveClass('is-selected')

    // And back: an outline row selects the node in the diagram.
    const other = within(outline()).getByText('Confirm the booking', { selector: '.flow__label' })
    await user.click(other)
    expect(treeitem(/^Step: Confirm the booking/)).toHaveAttribute('aria-selected', 'true')
    expect(treeitem(/^Step: Offer two slots/)).toHaveAttribute('aria-selected', 'false')
  })

  it('shares folding between the diagram and the outline', async () => {
    const { user } = await openFlowTab('admin@example.com', `${AGENT}/flow`)
    await user.click(view('Side by side'))
    focus(treeitem(/^Intent: Reschedule an appointment/))
    await user.keyboard('-')
    expect(within(outline()).getByRole('button', { name: /steps in reschedule an appointment/i })).toHaveAttribute('aria-expanded', 'false')
    // And the other way: "Collapse all" in the outline folds the diagram.
    await user.click(screen.getByRole('button', { name: /^collapse all$/i }))
    expect(within(tree()).queryByRole('treeitem', { name: /^Step:/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^expand all$/i }))
    expect(within(tree()).getAllByRole('treeitem', { name: /^Step:/ }).length).toBeGreaterThan(3)
  })

  it('lets the master admin edit from the diagram with the outline’s own handlers', async () => {
    const { user } = await openFlowTab('master@example.com', `${OPS_AGENT}/flow`)
    await user.click(view('Diagram'))

    // Rename: the same form as the outline's, below the diagram.
    focus(treeitem(/^Intent: Book an appointment/))
    await user.click(await screen.findByRole('button', { name: /edit details of book an appointment/i }))
    const name = screen.getByLabelText(/^name/i)
    expect(name).toHaveFocus()
    await user.clear(name)
    await user.type(name, 'Book an OPD visit{Enter}')
    expect(treeitem(/^Intent: Book an OPD visit/)).toBeInTheDocument()
    await waitFor(() => expect(treeitem(/^Intent: Book an OPD visit/)).toHaveFocus())

    // Add a step under it: the form opens, and an empty one cancelled disappears again.
    await user.click(await screen.findByRole('button', { name: /add a step under book an opd visit/i }))
    expect(screen.getByLabelText(/^name/i)).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('treeitem', { name: /Unnamed/ })).not.toBeInTheDocument()
    focus(treeitem(/^Intent: Book an OPD visit/))
    await user.click(await screen.findByRole('button', { name: /add a step under book an opd visit/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Ask about insurance{Enter}')
    expect(treeitem(/^Step: Ask about insurance/)).toBeInTheDocument()

    // Move it earlier among its siblings: it was last.
    focus(treeitem(/^Step: Ask about insurance/))
    await user.click(await screen.findByRole('button', { name: /move ask about insurance earlier/i }))
    await user.click(view('Outline'))
    const labels = () => [...within(outline()).getByText('Book an OPD visit', { selector: '.flow__label' }).closest('li')!.querySelectorAll(':scope > .flow__kids > li > .flow__row .flow__label')].map((l) => l.textContent)
    expect(labels().at(-2)).toBe('Ask about insurance')
    await user.click(view('Diagram'))

    // Delete a step: gone at once, with undo; an intent with steps asks first.
    focus(treeitem(/^Step: Ask about insurance/))
    await user.click(await screen.findByRole('button', { name: /delete ask about insurance/i }))
    expect(screen.queryByRole('treeitem', { name: /Ask about insurance/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^undo$/i }))
    expect(treeitem(/^Step: Ask about insurance/)).toBeInTheDocument()

    focus(treeitem(/^Intent: Cancel an appointment/))
    await user.click(await screen.findByRole('button', { name: /delete cancel an appointment/i }))
    const dialog = screen.getByRole('dialog', { name: /delete “cancel an appointment”/i })
    await user.click(within(dialog).getByRole('button', { name: /delete intent/i }))
    expect(screen.queryByRole('treeitem', { name: /Cancel an appointment/ })).not.toBeInTheDocument()
  })
})

const next = () => screen.getByRole('button', { name: /^next/i })

/** Signs in as the master admin and walks the builder to the flow step. */
async function toBuilderFlow() {
  const client = createDemoConsoleClient({ latency: 0 })
  const v = renderApp('/ops/orgs/arogya-demo/agents', { consoleClient: client })
  await signIn(v.user, 'master@example.com')
  await v.user.click(await screen.findByRole('link', { name: /new agent/i }))
  await v.user.click(await screen.findByRole('checkbox', { name: /choose all ready calls/i }))
  await v.user.click(screen.getByRole('checkbox', { name: /callers agreed/i }))
  await v.user.click(next())
  await v.user.click(await screen.findByRole('radio', { name: /^hospital$/i }))
  await v.user.click(screen.getByRole('radio', { name: /appointments/i }))
  await v.user.click(next())
  await screen.findByRole('radio', { name: /kavya/i })
  await v.user.click(next())
  await screen.findByRole('list', { name: /conversation flow/i })
  return v
}

describe('builder flow step: diagram', () => {
  it('marks the nodes AICA wasn’t sure about with an icon and words, and can dim the rest', async () => {
    const { user } = await toBuilderFlow()
    await user.click(view('Diagram'))
    const low = treeitem(/^Intent: Ask about timings and directions/)
    expect(low).toHaveTextContent(/low confidence, 58%/i)
    expect(low.querySelector('.flowc__mark-icon')).toBeInTheDocument()
    expect(low).toHaveAccessibleName(/low confidence, 58%/i)
    // High confidence nodes carry no mark, but say so when asked.
    const high = treeitem(/^Intent: Book an appointment/)
    expect(high.querySelector('.flowc__mark')).toBeNull()
    expect(high).toHaveAccessibleDescription(/confidence 94%/i)

    await user.click(screen.getByRole('switch', { name: /only what needs a look/i }))
    expect(low).not.toHaveClass('is-dim')
    expect(high).toHaveClass('is-dim')
  })

  it('edits the flow from the diagram and from side by side, the same as the outline', async () => {
    const { user } = await toBuilderFlow()
    await user.click(view('Side by side'))
    // A rename from the diagram opens the outline's own form, in the outline.
    focus(treeitem(/^Intent: Book an appointment/))
    await user.click(await screen.findByRole('button', { name: /edit details of book an appointment/i }))
    const name = screen.getByLabelText(/^name/i)
    await user.clear(name)
    await user.type(name, 'Book a visit{Enter}')
    expect(within(outline()).getByText('Book a visit', { selector: '.flow__label' })).toBeInTheDocument()
    expect(treeitem(/^Intent: Book a visit/)).toBeInTheDocument()

    // And an add from the outline shows up in the diagram.
    await user.click(screen.getByRole('button', { name: /add step to cancel an appointment/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Say goodbye{Enter}')
    expect(treeitem(/^Step: Say goodbye/)).toBeInTheDocument()

    // The diagram's Add an intent button adds one too.
    await user.click(screen.getByRole('button', { name: /add an intent/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Ask about parking{Enter}')
    expect(treeitem(/^Intent: Ask about parking/)).toBeInTheDocument()
    // It has no steps yet, which the diagram says in words once the step is checked.
    expect(within(outline()).getByText('Ask about parking', { selector: '.flow__label' })).toBeInTheDocument()
  })
})

const pattern: DetectedFlowPattern = {
  id: 'fp1',
  agentId: 'agt_appointments',
  agentName: 'OPD appointments',
  steps: ['Greet the caller', 'Ask about parking', 'Offer two slots', 'Say goodbye'],
  occurrences: 4,
  windowSize: 5,
  callIds: ['c1', 'c2', 'c3', 'c4'],
  firstSeenAt: '2026-10-01T00:00:00Z',
  lastSeenAt: '2026-10-02T00:00:00Z',
  summary: '4 of the last 5 calls asked about parking.',
}

describe('DetectedFlowChart', () => {
  it('keeps its summary, count and request button, and draws the steps as a chain', async () => {
    const onRequestFlow = vi.fn()
    const user = userEvent.setup()
    render(<DetectedFlowChart pattern={pattern} onRequestFlow={onRequestFlow} />)
    expect(screen.getByText(pattern.summary)).toBeInTheDocument()
    expect(screen.getByText(/seen in 4 of the last 5 calls/i)).toBeInTheDocument()
    const diagram = screen.getByRole('tree', { name: /detected flow diagram/i })
    const items = within(diagram).getAllByRole('treeitem')
    expect(items).toHaveLength(4)
    // Numbered in order, and linked one to the next.
    expect(items.map((el) => el.querySelector('.flowc__ordinal')?.textContent)).toEqual(['1', '2', '3', '4'])
    expect(diagram.querySelectorAll('.flowc__edge')).toHaveLength(3)
    // Zoom, fit and reset-like controls are there.
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fit to screen/i })).toBeInTheDocument()
    // The steps are also a plain list.
    await user.click(screen.getByText(/the steps as a list/i))
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(pattern.steps)

    await user.click(screen.getByRole('button', { name: /ask bitntech to build this flow/i }))
    expect(onRequestFlow).toHaveBeenCalledTimes(1)
  })

  it('shows busy while sending', () => {
    render(<DetectedFlowChart pattern={pattern} onRequestFlow={() => undefined} busy />)
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled()
  })

  it('shows counts per step and where calls left, when it is told', () => {
    render(<DetectedFlowChart pattern={pattern} onRequestFlow={() => undefined} stepCounts={[4, 4, 3, 1]} exitIndex={2} />)
    const items = within(screen.getByRole('tree')).getAllByRole('treeitem')
    expect(items.map((el) => el.querySelector('.flowc__count')?.textContent)).toEqual(['4', '4', '3', '1'])
    expect(items[2]).toHaveTextContent('Call left here')
    expect(items[2]).toHaveAttribute('aria-label', expect.stringContaining('the call left here'))
  })

  it('marks which steps are in the designed flow when it has the flow', () => {
    const designed: FlowNode[] = [
      { id: 'a', kind: 'intent', label: 'Book', sourceCallIds: [], children: [{ id: 'b', kind: 'step', label: 'Offer two slots', sourceCallIds: [], children: [] }] },
      { id: 'g', kind: 'intent', label: 'Other', sourceCallIds: [], children: [{ id: 'h', kind: 'step', label: 'Say goodbye', sourceCallIds: [], children: [] }] },
    ]
    render(<DetectedFlowChart pattern={pattern} onRequestFlow={() => undefined} designed={designed} />)
    const items = within(screen.getByRole('tree')).getAllByRole('treeitem')
    expect(items[0]).toHaveTextContent('Not in the designed flow')
    expect(items[1]).toHaveTextContent('Not in the designed flow')
    expect(items[2]).toHaveTextContent('In the designed flow')
    expect(items[3]).toHaveTextContent('Under another intent')
  })

  it('says so when there are no steps', () => {
    render(<DetectedFlowChart pattern={{ ...pattern, steps: [] }} onRequestFlow={() => undefined} />)
    expect(screen.getByText(/no steps were recorded/i)).toBeInTheDocument()
  })
})
