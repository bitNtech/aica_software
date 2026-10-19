import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
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
  /** The dismiss button, when "Cancel" would clash, e.g. "Keep it" beside "Cancel appointment". */
  cancelLabel?: string
  /** Where focus starts instead of Cancel, e.g. a field to fill in first. */
  initialFocus?: RefObject<HTMLElement | null>
}

/**
 * A confirmation over the page: a native <dialog> opened with showModal(),
 * so the browser traps focus, makes the page inert, closes on Escape and
 * returns focus to the button that opened it.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, busyLabel, busy, danger, error, onConfirm, onCancel, initialFocus, cancelLabel = 'Cancel' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      // Start on Cancel: the safe choice when Enter is pressed by habit.
      ;(initialFocus?.current ?? cancel.current)?.focus()
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
      // Some browsers close anyway on a second Escape: keep state in step.
      onClose={() => {
        if (open) onCancel()
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
          {cancelLabel}
        </Button>
      </div>
    </dialog>
  )
}

interface ModalProps {
  open: boolean
  title: string
  onClose(): void
  children: ReactNode
  /** Wider, for content like transcripts. */
  wide?: boolean
  /** Docked to the right half of the screen instead of centred, e.g. for a diagram with its own pan/zoom. */
  side?: 'right'
}

/** A dialog to read or work in (not a yes/no question): a native modal
 * <dialog> with a Close button. Escape closes it; focus goes back to the
 * button that opened it. */
export function Modal({ open, title, onClose, children, wide, side }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      close.current?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}${side === 'right' ? ' dialog--right' : ''}`}
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={() => {
        if (open) onClose()
      }}
    >
      <div className="dialog__head">
        <h2 id={`${id}-title`} className="dialog__title">
          {title}
        </h2>
        <button ref={close} type="button" className="dialog__close" onClick={onClose}>
          Close
        </button>
      </div>
      {open && <div className="dialog__body">{children}</div>}
    </dialog>
  )
}
