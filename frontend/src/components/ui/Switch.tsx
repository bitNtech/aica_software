import { useId, type ReactNode } from 'react'

interface Props {
  label: ReactNode
  hint?: ReactNode
  checked: boolean
  onChange(next: boolean): void
  disabled?: boolean
}

/** An on/off setting that applies at once: a button with role="switch",
 * so Space and Enter toggle it and screen readers say "on" or "off". */
export function Switch({ label, hint, checked, onChange, disabled }: Props) {
  const id = useId()
  return (
    <div className="switch">
      <button
        type="button"
        role="switch"
        id={id}
        className="switch__control"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
      </button>
      <label className="switch__label" htmlFor={id}>
        {label}
        {hint && (
          <span className="switch__hint" id={`${id}-hint`}>
            {hint}
          </span>
        )}
      </label>
    </div>
  )
}
