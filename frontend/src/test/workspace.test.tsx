import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable, type Column } from '../components/console/DataTable'
import { ShortcutsProvider, useShortcuts } from '../components/console/KeyboardHelp'
import { SplitView } from '../components/console/SplitView'
import { ToastProvider, useToast } from '../components/console/Toast'
import { WaitTimer } from '../components/console/WaitTimer'

/** jsdom has no matchMedia: answer every query with `matches`. */
function mockMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}
afterEach(() => {
  // @ts-expect-error: put jsdom back as it was, without matchMedia.
  delete window.matchMedia
  vi.useRealTimers()
})

describe('SplitView', () => {
  function Demo({ storageKey = 'test.split' }: { storageKey?: string }) {
    const [open, setOpen] = useState(false)
    return (
      <SplitView
        storageKey={storageKey}
        listLabel="Callers"
        detailLabel="Caller details"
        detailOpen={open}
        onCloseDetail={() => setOpen(false)}
        list={
          <button type="button" onClick={() => setOpen(true)}>
            Open Ramesh Iyer
          </button>
        }
        detail={<p>Chest pain, passed to casualty.</p>}
      />
    )
  }

  it('resizes the list from the keyboard and remembers the width', async () => {
    const user = userEvent.setup()
    render(<Demo />)
    const bar = screen.getByRole('separator', { name: /resize the list/i })
    expect(bar).toHaveAttribute('aria-valuenow', '380')
    expect(bar).toHaveAttribute('aria-valuemin', '280')
    expect(bar).toHaveAttribute('aria-valuemax', '640')
    bar.focus()
    await user.keyboard('{ArrowRight}')
    expect(bar).toHaveAttribute('aria-valuenow', '396')
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect(bar).toHaveAttribute('aria-valuenow', '332')
    await user.keyboard('{Home}')
    expect(bar).toHaveAttribute('aria-valuenow', '280')
    await user.keyboard('{End}')
    expect(bar).toHaveAttribute('aria-valuenow', '640')
    expect(localStorage.getItem('test.split')).toBe('640')
  })

  it('starts from the remembered width', () => {
    localStorage.setItem('test.split', '450')
    render(<Demo />)
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '450')
  })

  it('shows the detail beside the list on a wide screen', async () => {
    const user = userEvent.setup()
    render(<Demo />)
    await user.click(screen.getByRole('button', { name: /open ramesh/i }))
    expect(within(screen.getByRole('region', { name: /caller details/i })).getByText(/chest pain/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the detail in a drawer when narrow: Escape closes it and focus returns', async () => {
    mockMedia(false)
    const user = userEvent.setup()
    render(<Demo />)
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    const opener = screen.getByRole('button', { name: /open ramesh/i })
    opener.focus()
    await user.click(opener)
    const drawer = await screen.findByRole('dialog', { name: /caller details/i })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(drawer).toHaveFocus()
    expect(within(drawer).getByText(/chest pain/i)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps Tab inside the drawer', async () => {
    mockMedia(false)
    const user = userEvent.setup()
    render(<Demo />)
    await user.click(screen.getByRole('button', { name: /open ramesh/i }))
    const drawer = await screen.findByRole('dialog')
    const close = within(drawer).getByRole('button', { name: /close/i })
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()
  })
})

describe('DataTable', () => {
  interface Row {
    id: string
    caller: string
    seconds: number
  }
  const ROWS: Row[] = [
    { id: 'a', caller: 'Meera Nair', seconds: 120 },
    { id: 'b', caller: 'Arun Prakash', seconds: 45 },
    { id: 'c', caller: 'Divya Menon', seconds: 300 },
  ]
  const COLUMNS: Column<Row>[] = [
    { key: 'caller', header: 'Caller', cell: (r) => r.caller, sortValue: (r) => r.caller },
    { key: 'dur', header: 'Duration', align: 'end', cell: (r) => `${r.seconds} s`, sortValue: (r) => r.seconds },
    { key: 'note', header: 'Note', cell: () => '' },
  ]
  const order = () => within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row').map((r) => within(r).getAllByRole('cell')[0].textContent)

  it('sorts from the header and says which way with aria-sort', async () => {
    const user = userEvent.setup()
    render(<DataTable caption="Calls" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />)
    const header = screen.getByRole('columnheader', { name: /caller/i })
    expect(header).toHaveAttribute('aria-sort', 'none')
    // Columns that can't sort don't claim to.
    expect(screen.getByRole('columnheader', { name: /note/i })).not.toHaveAttribute('aria-sort')

    await user.click(within(header).getByRole('button', { name: /caller/i }))
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(order()).toEqual(['Arun Prakash', 'Divya Menon', 'Meera Nair'])

    await user.click(within(header).getByRole('button', { name: /caller/i }))
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(order()).toEqual(['Meera Nair', 'Divya Menon', 'Arun Prakash'])

    // A third press goes back to the order given.
    await user.click(within(header).getByRole('button', { name: /caller/i }))
    expect(header).toHaveAttribute('aria-sort', 'none')
    expect(order()).toEqual(['Meera Nair', 'Arun Prakash', 'Divya Menon'])
  })

  it('sorts numbers as numbers', async () => {
    const user = userEvent.setup()
    render(<DataTable caption="Calls" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />)
    await user.click(screen.getByRole('button', { name: /duration/i }))
    expect(order()).toEqual(['Arun Prakash', 'Meera Nair', 'Divya Menon'])
  })

  it('moves with the arrow keys and opens a row with Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    function Demo() {
      const [key, setKey] = useState<string | null>(null)
      return (
        <DataTable
          caption="Calls"
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(r) => r.id}
          selectedKey={key}
          onSelect={(r) => {
            onSelect(r)
            setKey(r.id)
          }}
        />
      )
    }
    render(<Demo />)
    const rows = within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row')
    // One tab stop: the first row.
    expect(rows[0]).toHaveAttribute('tabindex', '0')
    expect(rows[1]).toHaveAttribute('tabindex', '-1')
    rows[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(rows[1]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(ROWS[1])
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    expect(rows[0]).toHaveAttribute('aria-selected', 'false')
    await user.keyboard('k')
    expect(rows[0]).toHaveFocus()
  })

  it('selects rows with checkboxes and select-all', async () => {
    const user = userEvent.setup()
    function Demo() {
      const [keys, setKeys] = useState<ReadonlySet<string>>(new Set())
      return <DataTable caption="Calls" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowLabel={(r) => r.caller} checked={{ keys, onChange: setKeys }} />
    }
    render(<Demo />)
    await user.click(screen.getByRole('checkbox', { name: 'Select Arun Prakash' }))
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    const all = screen.getByRole('checkbox', { name: /select all rows/i }) as HTMLInputElement
    expect(all.indeterminate).toBe(true)
    await user.click(all)
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument()
  })

  it('says so when there are no rows, and shows skeleton rows while loading', () => {
    const { rerender } = render(<DataTable caption="Calls" columns={COLUMNS} rows={[]} rowKey={(r: Row) => r.id} empty="No calls match these filters." />)
    expect(screen.getByText('No calls match these filters.')).toBeInTheDocument()
    rerender(<DataTable caption="Calls" columns={COLUMNS} rows={[]} rowKey={(r: Row) => r.id} loading empty="No calls match these filters." />)
    expect(screen.queryByText('No calls match these filters.')).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Calls' })).toHaveAttribute('aria-busy', 'true')
  })
})

describe('WaitTimer', () => {
  it('counts up and changes its words as the wait passes the thresholds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T10:00:00'))
    render(<WaitTimer since={new Date('2026-10-23T10:00:00')} warn={60} alert={120} />)
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.getByText('0:00')).toBeInTheDocument()
    expect(screen.getByText(/^waiting under a minute$/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(61_000)
    })
    expect(screen.getByText('Getting long')).toBeInTheDocument()
    expect(screen.getByText('1:01')).toBeInTheDocument()
    expect(screen.getByText(/^waiting 1 minute, getting long$/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Too long')).toBeInTheDocument()
    expect(screen.getByText(/^waiting 2 minutes, too long$/)).toBeInTheDocument()
  })

  it('keeps the ticking figures out of the accessibility tree', () => {
    render(<WaitTimer since={Date.now() - 5000} />)
    expect(screen.getByText('0:05').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('runs one timer for every timer on the page', () => {
    vi.useFakeTimers()
    const before = vi.getTimerCount()
    const { unmount } = render(
      <>
        <WaitTimer since={Date.now()} />
        <WaitTimer since={Date.now() - 90_000} />
        <WaitTimer since={Date.now() - 400_000} />
      </>,
    )
    expect(vi.getTimerCount() - before).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(before)
  })
})

describe('Toast', () => {
  function Demo({ onUndo, timeoutMs }: { onUndo?: () => void; timeoutMs?: number }) {
    const toast = useToast()
    return (
      <>
        <button type="button" onClick={() => toast.show({ message: 'Callback closed', timeoutMs, action: onUndo ? { label: 'Undo', onClick: onUndo } : undefined })}>
          Close it
        </button>
        <button type="button" onClick={() => toast.show({ message: 'Server unreachable', tone: 'danger' })}>
          Fail
        </button>
      </>
    )
  }
  const wrap = (ui: React.ReactNode) => render(<ToastProvider>{ui}</ToastProvider>)

  it('runs the Undo action once and then goes', async () => {
    const user = userEvent.setup()
    const undo = vi.fn()
    wrap(<Demo onUndo={undo} />)
    await user.click(screen.getByRole('button', { name: 'Close it' }))
    expect(screen.getByText('Callback closed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Callback closed')).not.toBeInTheDocument()
  })

  it('goes by itself after its time, but waits while the pointer is on it', () => {
    vi.useFakeTimers()
    wrap(<Demo timeoutMs={1000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close it' }))
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByText('Callback closed')).toBeInTheDocument()
    const card = screen.getByText('Callback closed').closest('.toast')!
    fireEvent.pointerEnter(card)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('Callback closed')).toBeInTheDocument()
    fireEvent.pointerLeave(card)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.queryByText('Callback closed')).not.toBeInTheDocument()
  })

  it('puts danger in the assertive region and the rest in the polite one', async () => {
    const user = userEvent.setup()
    wrap(<Demo />)
    await user.click(screen.getByRole('button', { name: 'Close it' }))
    await user.click(screen.getByRole('button', { name: 'Fail' }))
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Callback closed')
    expect(document.querySelector('[aria-live="assertive"]')).toHaveTextContent('Server unreachable')
    expect(document.querySelector('[aria-live="polite"]')).not.toHaveTextContent('Server unreachable')
  })

  it('dismisses the newest with Escape, and any with its own button', async () => {
    const user = userEvent.setup()
    wrap(<Demo />)
    await user.click(screen.getByRole('button', { name: 'Close it' }))
    await user.click(screen.getByRole('button', { name: 'Fail' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Server unreachable')).not.toBeInTheDocument()
    expect(screen.getByText('Callback closed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dismiss notification/i }))
    expect(screen.queryByText('Callback closed')).not.toBeInTheDocument()
  })
})

describe('useShortcuts and the ? help', () => {
  function Page({ run }: { run: () => void }) {
    useShortcuts({ n: { description: 'New callback', run }, '/': { description: 'Search the queue', run: () => {} } })
    return <input aria-label="Search" />
  }
  const wrap = (run = vi.fn()) => {
    render(
      <ShortcutsProvider>
        <Page run={run} />
      </ShortcutsProvider>,
    )
    return run
  }

  it('runs a shortcut, but not while typing in a field', async () => {
    const user = userEvent.setup()
    const run = wrap()
    await user.keyboard('n')
    expect(run).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('textbox', { name: 'Search' }))
    await user.keyboard('nnn')
    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('nnn')
  })

  it('leaves keys alone when Ctrl, Alt or Meta is held', async () => {
    const user = userEvent.setup()
    const run = wrap()
    await user.keyboard('{Control>}n{/Control}')
    await user.keyboard('{Alt>}n{/Alt}')
    await user.keyboard('{Meta>}n{/Meta}')
    expect(run).not.toHaveBeenCalled()
  })

  it('opens a help list of the page\'s shortcuts with ?', async () => {
    const user = userEvent.setup()
    wrap()
    await user.keyboard('?')
    const help = await screen.findByRole('dialog', { name: /keyboard shortcuts/i })
    expect(within(help).getByText('New callback')).toBeInTheDocument()
    expect(within(help).getByText('Search the queue')).toBeInTheDocument()
    expect(within(help).getByText('Show this list')).toBeInTheDocument()
  })

  it('does not open the help while typing a question mark in a field', async () => {
    const user = userEvent.setup()
    wrap()
    await user.click(screen.getByRole('textbox', { name: 'Search' }))
    await user.keyboard('why?')
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('why?')
    expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).not.toBeInTheDocument()
  })
})
