import { useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  /** Sits beside the label, e.g. a "Forgot password?" link. */
  aside?: ReactNode
  hint?: ReactNode
  error?: string | null
  /** Sits inside the input on the right, e.g. a show/hide toggle. */
  trailing?: ReactNode
  /** Fixed text inside the input on the left, e.g. "+91". */
  leading?: string
  /** Extra content under the input, e.g. a strength meter. */
  below?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export function TextField({ label, aside, hint, error, trailing, leading, below, className, ref, ...input }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [errId, hintId, input['aria-describedby']].filter(Boolean).join(' ') || undefined

  return (
    <div
      className={['field', error && 'field--error', trailing && 'field--trailing', leading && 'field--leading', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="field__top">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        {aside}
      </div>
      <div className="field__control">
        {leading && (
          <span className="field__lead" aria-hidden="true">
            {leading}
          </span>
        )}
        <input
          {...input}
          ref={ref}
          id={id}
          className="field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        {trailing}
      </div>
      {error && (
        <p className="field__error" id={errId}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path d="M8 4.5v4.2M8 11.2v.3" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      )}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {below}
    </div>
  )
}

interface PasswordProps extends Omit<FieldProps, 'type' | 'trailing'> {
  /** Warn when Caps Lock is on. Off for the confirm field to avoid repeats. */
  capsWarning?: boolean
}

export function PasswordField({ capsWarning = true, onKeyUp, onKeyDown, onBlur, hint, ...props }: PasswordProps) {
  const [shown, setShown] = useState(false)
  const [caps, setCaps] = useState(false)
  const toggleId = useId()

  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => {
    if (capsWarning && typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock'))
  }

  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      onKeyDown={(e) => {
        readCaps(e)
        onKeyDown?.(e)
      }}
      onKeyUp={(e) => {
        readCaps(e)
        onKeyUp?.(e)
      }}
      onBlur={(e) => {
        setCaps(false)
        onBlur?.(e)
      }}
      hint={
        caps ? (
          <span className="field__caps" role="status">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M8 2 2.5 8H5v3h6V8h2.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M5 13.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Caps Lock is on
          </span>
        ) : (
          hint
        )
      }
      trailing={
        <button
          type="button"
          id={toggleId}
          className="field__toggle"
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      }
    />
  )
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label: ReactNode
  hint?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export function Checkbox({ label, hint, className, ...input }: CheckboxProps) {
  const id = useId()
  return (
    <div className={['check', className].filter(Boolean).join(' ')}>
      <input {...input} type="checkbox" id={id} className="check__box" aria-describedby={hint ? `${id}-hint` : undefined} />
      <label htmlFor={id} className="check__label">
        {label}
        {hint && (
          <span className="check__hint" id={`${id}-hint`}>
            {hint}
          </span>
        )}
      </label>
    </div>
  )
}
