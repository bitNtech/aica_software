import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'

interface Props {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel: string
  busyLabel?: string
  busy?: boolean
  /** Red confirm button for actions that can't be undone. */
  danger?: boolean
  /** Shown inside the dialog, e.g. when the action failed. */
  error?: string | null
  onConfirm(): void
  onCancel(): void
}

/**
 * A confirmation over the page: a native <dialog> opened with showModal(),
 * so the browser traps focus, makes the page inert, closes on Escape and
 * returns focus to the button that opened it.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, busyLabel, busy, danger, error, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      // Start on Cancel: the safe choice when Enter is pressed by habit.
      cancel.current?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={children ? `${id}-body` : undefined}
      onCancel={(e) => {
        // Escape: let React decide, and never close while working.
        e.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <h2 id={`${id}-title`} className="dialog__title">
        {title}
      </h2>
      {children && (
        <div id={`${id}-body`} className="dialog__body">
          {children}
        </div>
      )}
      {error && (
        <p className="field__error dialog__error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog__actions">
        <Button variant={danger ? 'danger' : 'plum'} size="sm" busy={busy} busyLabel={busyLabel} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={cancel} variant="line" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </dialog>
  )
}
