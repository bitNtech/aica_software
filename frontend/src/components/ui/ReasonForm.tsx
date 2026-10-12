import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from './Button'

interface Props {
  label: string
  hint: string
  confirmLabel: string
  busyLabel: string
  busy?: boolean
  /** Shown when the reason is too short. */
  tooShort?: string
  onConfirm(reason: string): void
  onCancel(): void
}

/** An inline "why?" box for actions that need a reason on record —
 * declining a sign-up or suspending an organisation (shown to the client word
 * for word), and the master admin's people actions (kept in the audit log). */
export function ReasonForm({
  label,
  hint,
  confirmLabel,
  busyLabel,
  busy,
  tooShort = 'Write at least a short sentence — the client will read this.',
  onConfirm,
  onCancel,
}: Props) {
  const id = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 10) {
      setError(tooShort)
      ref.current?.focus()
      return
    }
    onConfirm(reason.trim())
  }

  return (
    <form
      className="reason"
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onCancel()
      }}
    >
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        className="field__input reason__input"
        rows={3}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value)
          if (error) setError(null)
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-err` : ''}`}
      />
      {error && (
        <p className="field__error" id={`${id}-err`}>
          {error}
        </p>
      )}
      <p className="field__hint" id={`${id}-hint`}>
        {hint}
      </p>
      <div className="reason__actions">
        <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel={busyLabel}>
          {confirmLabel}
        </Button>
        <Button variant="line" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
