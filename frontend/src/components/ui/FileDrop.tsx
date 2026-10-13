import { useId, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** What to choose, e.g. "Choose recordings". */
  label: string
  hint?: ReactNode
  /** The input's accept attribute. */
  accept: string
  multiple?: boolean
  disabled?: boolean
  /** A file is needed, or the one chosen won't do: marks the input, so
   * focusing it reads the error (pass the error's id). */
  invalid?: boolean
  errorId?: string
  onFiles(files: File[]): void
}

/**
 * A file picker that also takes files dropped onto it. The real control is
 * a native file input behind a visible label, so it works with the keyboard
 * and screen readers; dropping is an extra for mouse users.
 */
export function FileDrop({ label, hint, accept, multiple, disabled, invalid, errorId, onFiles }: Props) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <div
      className={['file-drop', over && 'is-over', disabled && 'is-disabled', invalid && 'is-invalid'].filter(Boolean).join(' ')}
      onDragOver={(e) => {
        // Always handled, so a drop never makes the browser open the file.
        e.preventDefault()
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
        if (!disabled) setOver(true)
      }}
      onDragLeave={(e) => {
        // Moving over the button or text inside isn't leaving.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled && e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <svg className="file-drop__icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
      </svg>
      <input
        ref={input}
        id={id}
        type="file"
        className="sr-only file-drop__input"
        accept={accept}
        multiple={multiple}
        // Not disabled while busy: it may hold focus, which would drop to
        // <body>. Busy pickers ignore new files instead (onFiles).
        aria-disabled={disabled || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={[invalid && errorId, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          // Reset, so choosing the same file again still fires a change.
          e.target.value = ''
          if (files.length && !disabled) onFiles(files)
        }}
      />
      <label htmlFor={id} className="btn btn--line btn--sm file-drop__button">
        <span>{label}</span>
      </label>
      <p className="file-drop__or">or drop files here</p>
      {hint && (
        <p className="file-drop__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  )
}
