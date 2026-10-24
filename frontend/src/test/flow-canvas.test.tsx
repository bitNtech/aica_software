import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FlowCanvas, type FlowCanvasProps } from '../components/console/flow/FlowCanvas'
import type { FlowNode } from '../console/types'

let n = 0
const node = (kind: FlowNode['kind'], label: string, children: FlowNode[] = [], extra: Partial<FlowNode> = {}): FlowNode => ({
  id: `c${++n}`,
  kind,
  label,
  say: kind === 'step' ? `Say ${label}` : undefined,
  condition: kind === 'branch' ? 'The caller can’t make either slot' : undefined,
  sourceCallIds: [],
  children,
  ...extra,
})

function sample() {
  const ask = node('step', 'Ask for the doctor')
  const offer = node('step', 'Offer two slots')
  const alt = node('step', 'Offer the next day')
  const branch = node('branch', 'No slot suits', [alt])
  const confirm = node('step', 'Confirm the booking')
  const book = node('intent', 'Book an appointment', [ask, offer, branch, confirm])
  const find = node('step', 'Find the booking')
  const resched = node('intent', 'Reschedule an appointment', [find])
  return { flow: [book, resched], book, resched, ask, offer, alt, branch, confirm, find }
}

/** Focus as a user would, so React's updates are inside act. */
const focus = (el: Element) => act(() => (el as SVGElement).focus())
const items = () => screen.getAllByRole('treeitem')
const item = (name: RegExp | string) => screen.getByRole('treeitem', { name })
const zoom = () => screen.getByText(/^\d+%$/).textContent

function show(props: Partial<FlowCanvasProps> = {}) {
  const s = sample()
  const user = userEvent.setup()
  const view = render(<FlowCanvas nodes={s.flow} {...props} />)
  return { ...s, user, ...view }
}

describe('FlowCanvas drawing', () => {
  it('draws every node as a named tree item, with its kind in words and a different shape', () => {
    const s = show()
    expect(screen.getByRole('tree', { name: /conversation flow diagram/i })).toBeInTheDocument()
    expect(items()).toHaveLength(8)
    const book = item(/^Intent: Book an appointment/)
    const step = item(/^Step: Ask for the doctor/)
    const branch = item(/^Branch: No slot suits, when The caller can’t make either slot/)
    // The caption is drawn on the node, not just spoken.
    expect(book).toHaveTextContent('INTENT')
    expect(step).toHaveTextContent('STEP')
    expect(branch).toHaveTextContent('BRANCH')
    expect([book, step, branch].map((el) => el.getAttribute('data-kind'))).toEqual(['intent', 'step', 'branch'])
    // Three outlines: round-ended, rectangular, notched (straight cuts, no arcs).
    const shape = (el: Element) => el.querySelector('.flowc__body')!.getAttribute('d')!
    expect(shape(branch)).not.toMatch(/A/)
    expect(shape(step)).toMatch(/A/)
    expect(new Set([shape(book), shape(step), shape(branch)]).size).toBe(3)
    // Tree structure for screen readers.
    expect(book).toHaveAttribute('aria-level', '1')
    expect(step).toHaveAttribute('aria-level', '2')
    expect(branch).toHaveAttribute('aria-posinset', '3')
    expect(branch).toHaveAttribute('aria-setsize', '4')
    expect(book).toHaveAttribute('aria-expanded', 'true')
    expect(step).not.toHaveAttribute('aria-expanded')
    // What a step says is its description.
    expect(step).toHaveAccessibleDescription(/the agent says: say ask for the doctor/i)
    expect(s.container.querySelectorAll('.flowc__node')).toHaveLength(8)
  })

  it('writes a branch’s condition on its edge, from the step before it', () => {
    const { container, offer, branch } = show()
    const labels = [...container.querySelectorAll('.flowc__label')].map((l) => l.textContent)
    expect(labels).toEqual([expect.stringContaining('The caller')])
    const edge = container.querySelector(`[data-edge="${offer.id}>${branch.id}"]`)!
    expect(edge).toHaveClass('flowc__edge--branch')
    expect(edge.querySelector('.flowc__label')).toHaveTextContent(/The caller can’t\s*make either slot/)
    // Branch arrows are dashed, so they differ from the main path by more than where they go.
    expect(edge.querySelector('path')).toBeInTheDocument()
  })

  it('has one node in the tab order, and says when there is nothing to draw', () => {
    show()
    expect(items().filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(items()[0]).toHaveAttribute('tabindex', '0')
    const { unmount } = render(<FlowCanvas nodes={[]} emptyText="Nothing here." />)
    expect(screen.getByText('Nothing here.')).toBeInTheDocument()
    unmount()
  })

  it('shows marks as an icon and words, and counts as a badge', () => {
    const { flow, ask } = sample()
    render(<FlowCanvas nodes={flow} marks={{ [ask.id]: { tone: 'warn', text: 'Low confidence, 58%' } }} counts={{ [ask.id]: 12 }} />)
    const el = item(/^Step: Ask for the doctor/)
    expect(el).toHaveTextContent('Low confidence, 58%')
    expect(el.querySelector('.flowc__mark-icon')).toBeInTheDocument()
    expect(el.querySelector('.flowc__count')).toHaveTextContent('12')
    expect(el).toHaveAccessibleName(/12 calls.*low confidence, 58%/i)
  })
})

describe('FlowCanvas keyboard', () => {
  it('moves along the arrows: next, back, and between alternatives', async () => {
    const { user } = show()
    // The tree has one tab stop, the first node; Down is the first step, then the next, and so on.
    focus(items()[0])
    expect(item(/^Intent: Book/)).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(item(/^Step: Ask for the doctor/)).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(item(/^Step: Offer two slots/)).toHaveFocus()
    // Down from "Offer two slots" is the main path, the confirmation; Right is the branch beside it.
    await user.keyboard('{ArrowDown}')
    expect(item(/^Step: Confirm the booking/)).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(item(/^Branch: No slot suits/)).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(item(/^Step: Confirm the booking/)).toHaveFocus()
    // Up is the step before; into the branch and back.
    await user.keyboard('{ArrowUp}')
    expect(item(/^Step: Offer two slots/)).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowRight}{ArrowDown}')
    expect(item(/^Step: Offer the next day/)).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(item(/^Branch: No slot suits/)).toHaveFocus()
    // Home and End.
    await user.keyboard('{End}')
    expect(item(/^Step: Find the booking/)).toHaveFocus()
    await user.keyboard('{Home}')
    expect(item(/^Intent: Book/)).toHaveFocus()
    // Left and right at the top level move between intents.
    await user.keyboard('{ArrowRight}')
    expect(item(/^Intent: Reschedule/)).toHaveFocus()
  })

  it('swaps the axes in a left to right diagram', async () => {
    const { user } = show()
    await user.click(screen.getByRole('button', { name: /left to right/i }))
    focus(items()[0])
    await user.keyboard('{ArrowRight}')
    expect(item(/^Step: Ask for the doctor/)).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(item(/^Step: Offer two slots/)).toHaveFocus()
    // The next step is on along the row; the alternative beside that is above or below now.
    await user.keyboard('{ArrowRight}{ArrowDown}')
    expect(item(/^Branch: No slot suits/)).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(item(/^Step: Offer two slots/)).toHaveFocus()
  })

  it('selects with Enter and on click', async () => {
    const onSelect = vi.fn()
    const { user } = show({ onSelect })
    focus(items()[0])
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenLastCalledWith(sampleIdOf('Ask for the doctor'))
    await user.click(item(/^Step: Offer two slots/))
    expect(onSelect).toHaveBeenLastCalledWith(sampleIdOf('Offer two slots'))
  })

  it('marks the selected node', () => {
    const { flow, offer } = sample()
    render(<FlowCanvas nodes={flow} selectedId={offer.id} />)
    expect(item(/^Step: Offer two slots/)).toHaveAttribute('aria-selected', 'true')
    expect(item(/^Step: Ask for the doctor/)).toHaveAttribute('aria-selected', 'false')
  })
})

// Ids are made as nodes are built; find one by label in the last render.
function sampleIdOf(label: string): string {
  const el = screen.getAllByRole('treeitem').find((e) => e.getAttribute('aria-label')?.includes(label))
  return el!.getAttribute('data-flow-node')!
}

describe('FlowCanvas folding', () => {
  it('folds a branch with - and Space, hides what is inside, and unfolds with +', async () => {
    const { user } = show()
    expect(items()).toHaveLength(8)
    focus(item(/^Intent: Book/))
    await user.keyboard('-')
    expect(items()).toHaveLength(3)
    expect(item(/^Intent: Book an appointment, 5 hidden inside/)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /Ask for the doctor/ })).not.toBeInTheDocument()
    // The stub says how many are inside.
    expect(document.querySelector('[data-toggle]')).toHaveTextContent('+5')
    await user.keyboard('+')
    expect(items()).toHaveLength(8)
    await user.keyboard(' ')
    expect(items()).toHaveLength(3)
    await user.keyboard(' ')
    expect(items()).toHaveLength(8)
    // Steps with nothing inside can't fold.
    focus(item(/^Step: Ask for the doctor/))
    await user.keyboard('-')
    expect(items()).toHaveLength(8)
  })

  it('folds from the mouse button on the node, and with fold all / unfold all', async () => {
    const { user, container } = show()
    await user.click(container.querySelector('[data-toggle]')!)
    expect(items()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: /unfold everything/i }))
    expect(items()).toHaveLength(8)
    await user.click(screen.getByRole('button', { name: /fold every intent/i }))
    expect(items()).toHaveLength(2)
  })

  it('lets a parent own the folding', async () => {
    const s = sample()
    const seen: Set<string>[] = []
    function Owner() {
      const [c, setC] = useState<ReadonlySet<string>>(new Set([s.book.id]))
      return <FlowCanvas nodes={s.flow} collapsed={c} onCollapsedChange={(next) => (seen.push(next), setC(next))} />
    }
    const user = userEvent.setup()
    render(<Owner />)
    expect(items()).toHaveLength(3)
    focus(item(/^Intent: Book/))
    await user.keyboard('+')
    expect(items()).toHaveLength(8)
    expect(seen.at(-1)!.has(s.book.id)).toBe(false)
  })
})

describe('FlowCanvas find', () => {
  it('highlights matches, and Enter cycles through them, centring each', async () => {
    const { user } = show()
    const box = screen.getByRole('searchbox', { name: /find a step/i })
    await user.type(box, 'offer')
    // "Offer two slots" and "Offer the next day".
    await waitFor(() => expect(document.querySelectorAll('[data-match]')).toHaveLength(2))
    expect(screen.getByText(/2 matches, 1 shown/i)).toBeInTheDocument()
    expect(item(/Offer two slots/)).toHaveAttribute('data-match', 'current')
    expect(item(/Offer the next day/)).toHaveAttribute('data-match', 'match')
    await user.keyboard('{Enter}')
    expect(item(/Offer the next day/)).toHaveAttribute('data-match', 'current')
    expect(item(/Offer two slots/)).toHaveAttribute('data-match', 'match')
    expect(screen.getByText(/2 matches, 2 shown/i)).toBeInTheDocument()
    // It wraps, and Shift+Enter goes back.
    await user.keyboard('{Enter}')
    expect(item(/Offer two slots/)).toHaveAttribute('data-match', 'current')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(item(/Offer the next day/)).toHaveAttribute('data-match', 'current')
    // It looks in what the agent says and in conditions too.
    await user.clear(box)
    await user.type(box, 'either slot')
    await waitFor(() => expect(item(/^Branch: No slot suits/)).toHaveAttribute('data-match', 'current'))
    // Nothing.
    await user.clear(box)
    await user.type(box, 'zzz')
    expect(screen.getByText('No match')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-match]')).toHaveLength(0)
  })

  it('unfolds a fold that hides a match', async () => {
    const s = sample()
    const user = userEvent.setup()
    render(<FlowCanvas nodes={s.flow} collapsed={undefined} />)
    focus(item(/^Intent: Book/))
    await user.keyboard('-')
    expect(items()).toHaveLength(3)
    await user.type(screen.getByRole('searchbox', { name: /find a step/i }), 'next day')
    await waitFor(() => expect(item(/Offer the next day/)).toHaveAttribute('data-match', 'current'))
    expect(items()).toHaveLength(8)
  })

  it('Escape clears the search', async () => {
    const { user } = show()
    const box = screen.getByRole('searchbox', { name: /find a step/i })
    await user.type(box, 'offer{Escape}')
    expect(box).toHaveValue('')
    expect(document.querySelectorAll('[data-match]')).toHaveLength(0)
  })
})

describe('FlowCanvas path and exit', () => {
  it('draws a call’s path heavier, marks it, numbers it and dims the rest', () => {
    const { flow, book, ask, offer, confirm, resched } = sample()
    const { container } = render(<FlowCanvas nodes={flow} highlightPath={[book.id, ask.id, offer.id, confirm.id]} />)
    for (const [i, id] of [book.id, ask.id, offer.id, confirm.id].entries()) {
      const el = container.querySelector(`[data-flow-node="${id}"]`)!
      expect(el).toHaveAttribute('data-on-path', 'true')
      expect(el).toHaveAttribute('aria-current', 'true')
      expect(el.querySelector('.flowc__ordinal')).toHaveTextContent(String(i + 1))
      expect(el).toHaveAccessibleName(new RegExp(`number ${i + 1} on the call’s path`))
    }
    const off = container.querySelector(`[data-flow-node="${resched.id}"]`)!
    expect(off).not.toHaveAttribute('data-on-path')
    expect(off).not.toHaveAttribute('aria-current')
    expect(off).toHaveClass('is-dim')
    // Arrows between consecutive path nodes are the heavy ones; others recede.
    const hot = container.querySelectorAll('.flowc__edge.is-on-path')
    expect(hot).toHaveLength(3)
    expect(container.querySelectorAll('.flowc__edge.is-dim').length).toBeGreaterThan(0)
    // Heavy arrows get the bigger arrowhead.
    expect(hot[0].querySelector('path')!.getAttribute('marker-end')).toMatch(/-arrow-path\)/)
  })

  it('flags where the call left, in words and with a barrier', () => {
    const { flow, book, ask, offer } = sample()
    const { container } = render(<FlowCanvas nodes={flow} highlightPath={[book.id, ask.id, offer.id]} exitAt={offer.id} />)
    const el = container.querySelector(`[data-flow-node="${offer.id}"]`)!
    expect(el).toHaveTextContent('Call left here')
    expect(el).toHaveAccessibleName(/the call left here/i)
    expect(el.querySelector('.flowc__barrier')).toBeInTheDocument()
    expect(el).toHaveClass('is-exit')
  })

  it('dims all but the nodes it is told to keep', () => {
    const { flow, ask } = sample()
    const { container } = render(<FlowCanvas nodes={flow} dimExcept={[ask.id]} />)
    expect(container.querySelector(`[data-flow-node="${ask.id}"]`)).not.toHaveClass('is-dim')
    expect(container.querySelectorAll('.flowc__node.is-dim')).toHaveLength(7)
    // No path, so no path attributes.
    expect(container.querySelector('[data-on-path]')).toBeNull()
  })
})

describe('FlowCanvas editing', () => {
  it('offers edit buttons on the focused node and calls back with what was asked', async () => {
    const onAddChild = vi.fn()
    const onRename = vi.fn()
    const onMove = vi.fn()
    const onDelete = vi.fn()
    const { user, book, offer } = show({ editable: true, onAddChild, onRename, onMove, onDelete })
    // Nothing until a node has focus.
    expect(screen.queryByRole('group', { name: /^edit /i })).not.toBeInTheDocument()
    focus(item(/^Intent: Book/))
    const bar = await screen.findByRole('group', { name: 'Edit Book an appointment' })
    await user.click(within(bar).getByRole('button', { name: /add a step under book an appointment/i }))
    expect(onAddChild).toHaveBeenLastCalledWith(book.id, 'step')
    focus(item(/^Intent: Book/))
    await user.click(within(await screen.findByRole('group', { name: /^edit book/i })).getByRole('button', { name: /add a branch under/i }))
    expect(onAddChild).toHaveBeenLastCalledWith(book.id, 'branch')
    await user.click(screen.getByRole('button', { name: /add an intent/i }))
    expect(onAddChild).toHaveBeenLastCalledWith(null, 'intent')

    // A step: no add buttons, but move, edit and delete.
    focus(item(/^Step: Offer two slots/))
    const stepBar = await screen.findByRole('group', { name: 'Edit Offer two slots' })
    expect(within(stepBar).queryByRole('button', { name: /add a/i })).not.toBeInTheDocument()
    await user.click(within(stepBar).getByRole('button', { name: /edit details of offer two slots/i }))
    expect(onRename).toHaveBeenCalledWith(offer.id)
    focus(item(/^Step: Offer two slots/))
    await user.click(within(await screen.findByRole('group', { name: 'Edit Offer two slots' })).getByRole('button', { name: /move offer two slots later/i }))
    expect(onMove).toHaveBeenCalledWith(offer.id, 1)
    focus(item(/^Step: Offer two slots/))
    await user.click(within(await screen.findByRole('group', { name: 'Edit Offer two slots' })).getByRole('button', { name: /move offer two slots earlier/i }))
    expect(onMove).toHaveBeenCalledWith(offer.id, -1)
    focus(item(/^Step: Offer two slots/))
    await user.click(within(await screen.findByRole('group', { name: 'Edit Offer two slots' })).getByRole('button', { name: /delete offer two slots/i }))
    expect(onDelete).toHaveBeenCalledWith(offer.id)
  })

  it('stops the first and last from moving past the ends', async () => {
    show({ editable: true })
    focus(item(/^Step: Ask for the doctor/))
    const bar = await screen.findByRole('group', { name: 'Edit Ask for the doctor' })
    expect(within(bar).getByRole('button', { name: /earlier/i })).toBeDisabled()
    expect(within(bar).getByRole('button', { name: /later/i })).toBeEnabled()
  })

  it('has F2 and Delete as keys, only when editable', async () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const { user, ask, unmount } = show({ editable: true, onRename, onDelete })
    focus(item(/^Step: Ask for the doctor/))
    await user.keyboard('{F2}{Delete}')
    expect(onRename).toHaveBeenCalledWith(ask.id)
    expect(onDelete).toHaveBeenCalledWith(ask.id)
    unmount()
    const quiet = vi.fn()
    const again = show({ onRename: quiet, onDelete: quiet })
    focus(item(/^Step: Ask for the doctor/))
    await again.user.keyboard('{F2}{Delete}')
    expect(quiet).not.toHaveBeenCalled()
  })

  it('shows no edit buttons when read-only, whatever is focused', async () => {
    const { user } = show({ onAddChild: vi.fn(), onDelete: vi.fn() })
    focus(item(/^Intent: Book/))
    await user.keyboard('{ArrowDown}')
    expect(screen.queryByRole('group', { name: /^edit /i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add a|add an|delete|edit details|move .* (earlier|later)/i })).not.toBeInTheDocument()
  })
})

describe('FlowCanvas view', () => {
  it('leaves the plain wheel alone and zooms only with Ctrl or ⌘', () => {
    const { container } = show()
    const scroller = container.querySelector('.flowc__scroll')!
    const before = zoom()
    const plain = new WheelEvent('wheel', { deltaY: -120, cancelable: true, bubbles: true })
    scroller.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
    expect(zoom()).toBe(before)

    const ctrl = new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, cancelable: true, bubbles: true })
    fireEvent(scroller, ctrl)
    expect(ctrl.defaultPrevented).toBe(true)
    expect(Number.parseInt(zoom()!)).toBeGreaterThan(Number.parseInt(before!))
    const meta = new WheelEvent('wheel', { deltaY: 120, metaKey: true, cancelable: true, bubbles: true })
    fireEvent(scroller, meta)
    expect(meta.defaultPrevented).toBe(true)
    expect(zoom()).toBe(before)
  })

  it('zooms and fits from buttons and keys, within limits', async () => {
    const { user } = show()
    expect(zoom()).toBe('100%')
    await user.click(screen.getByRole('button', { name: /zoom in/i }))
    expect(zoom()).toBe('120%')
    await user.click(screen.getByRole('button', { name: /zoom out/i }))
    await user.click(screen.getByRole('button', { name: /zoom out/i }))
    expect(zoom()).toBe('83%')
    for (let i = 0; i < 12; i++) await user.click(screen.getByRole('button', { name: /zoom out/i }))
    expect(zoom()).toBe('25%')
    await user.click(screen.getByRole('button', { name: /fit to screen/i }))
    expect(zoom()).toMatch(/%$/)
    focus(items()[0])
    await user.keyboard('z')
    const a = Number.parseInt(zoom()!)
    await user.keyboard('Z')
    expect(Number.parseInt(zoom()!)).toBeLessThan(a)
  })

  it('remembers the direction', async () => {
    const { user, unmount } = show()
    const tb = screen.getByRole('button', { name: /top to bottom/i })
    expect(tb).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /left to right/i }))
    expect(screen.getByRole('button', { name: /left to right/i })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('aica.flow.direction')).toBe('LR')
    unmount()
    const { container } = show()
    expect(container.querySelector('.flowc')).toHaveAttribute('data-direction', 'LR')
    expect(screen.getByRole('button', { name: /left to right/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('still works when storage throws', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { user } = show()
    await user.click(screen.getByRole('button', { name: /left to right/i }))
    expect(screen.getByRole('button', { name: /left to right/i })).toHaveAttribute('aria-pressed', 'true')
    get.mockRestore()
    set.mockRestore()
  })

  it('has an overview that can be turned off, and remembers it', async () => {
    const { user, unmount } = show()
    expect(screen.getByTestId('flow-minimap')).toBeInTheDocument()
    // Decorative: its content is in the diagram.
    expect(screen.getByTestId('flow-minimap')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('flow-minimap').querySelectorAll('rect.flowc__mini-node')).toHaveLength(8)
    await user.click(screen.getByRole('button', { name: /overview/i }))
    expect(screen.queryByTestId('flow-minimap')).not.toBeInTheDocument()
    unmount()
    show()
    expect(screen.queryByTestId('flow-minimap')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /overview/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('goes full screen as an overlay where the browser won’t, and Escape comes back', async () => {
    const { user, container } = show()
    const root = container.querySelector('.flowc')!
    await user.click(screen.getByRole('button', { name: /^full screen$/i }))
    await waitFor(() => expect(root).toHaveClass('is-overlay'))
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(root).not.toHaveClass('is-overlay'))
    expect(document.body.style.overflow).toBe('')
    // Focus goes back to the button that opened it.
    expect(screen.getByRole('button', { name: /^full screen$/i })).toHaveFocus()
  })

  it('uses the Fullscreen API when there is one', async () => {
    const request = vi.fn(function (this: HTMLElement) {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: this })
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    const exit = vi.fn(() => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
    try {
      const { user, container } = show()
      await user.click(screen.getByRole('button', { name: /^full screen$/i }))
      expect(request).toHaveBeenCalled()
      const root = container.querySelector('.flowc')!
      await waitFor(() => expect(root).toHaveClass('is-full'))
      expect(root).not.toHaveClass('is-overlay')
      await user.click(screen.getByRole('button', { name: /exit full screen/i }))
      expect(exit).toHaveBeenCalled()
      await waitFor(() => expect(root).not.toHaveClass('is-full'))
    } finally {
      delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen
      delete (document as { exitFullscreen?: unknown }).exitFullscreen
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    }
  })

  it('describes how to use it, for screen readers, and lists the keys', () => {
    show({ description: 'The Outline view lists the same flow as text.' })
    expect(screen.getByRole('tree')).toHaveAccessibleDescription(/outline view lists the same flow.*arrow keys/i)
    expect(screen.getByText(/keyboard and mouse/i)).toBeInTheDocument()
  })
})
