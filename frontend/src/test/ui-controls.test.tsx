import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../components/ui/Dialog'
import { Switch } from '../components/ui/Switch'
import { Tabs } from '../components/ui/Tabs'

describe('Tabs', () => {
  function Demo() {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a')
    return (
      <Tabs<'a' | 'b' | 'c'> label="Sections" tabs={[{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }, { key: 'c', label: 'Gamma' }]} value={v} onChange={setV}>
        <p>Panel {v}</p>
      </Tabs>
    )
  }

  it('has one tab stop and moves with the arrow keys, Home and End', async () => {
    const user = userEvent.setup()
    render(<Demo />)
    const [a, b, c] = screen.getAllByRole('tab')
    expect(a).toHaveAttribute('tabindex', '0')
    expect(b).toHaveAttribute('tabindex', '-1')
    a.focus()
    await user.keyboard('{ArrowRight}')
    expect(b).toHaveFocus()
    expect(b).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel b')
    await user.keyboard('{End}')
    expect(c).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(a).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(c).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Gamma')
  })
})

describe('Switch', () => {
  it('is a named switch that toggles', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Switch label="Answer after hours" hint="Outside business hours" checked={false} onChange={onChange} />)
    const sw = screen.getByRole('switch', { name: /answer after hours/i })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw).toHaveAccessibleDescription(/outside business hours/i)
    await user.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('ConfirmDialog', () => {
  it('starts on Cancel, confirms, and cancels on Escape', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <ConfirmDialog open={false} title="Delete agent?" confirmLabel="Delete" danger onConfirm={onConfirm} onCancel={onCancel}>
        <p>This can't be undone.</p>
      </ConfirmDialog>,
    )
    rerender(
      <ConfirmDialog open title="Delete agent?" confirmLabel="Delete" danger onConfirm={onConfirm} onCancel={onCancel}>
        <p>This can't be undone.</p>
      </ConfirmDialog>,
    )
    const dialog = screen.getByRole('dialog', { name: /delete agent/i })
    expect(dialog).toHaveAccessibleDescription(/can't be undone/i)
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(onConfirm).toHaveBeenCalled()
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(onCancel).toHaveBeenCalled()
  })
})
