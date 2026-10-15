import { useId, type ReactNode } from 'react'

interface Props {
  label: ReactNode
  hint?: ReactNode
  checked: boolean
  onChange(next: boolean): void
  disabled?: boolean
  /** Can't be changed here, with the reason shown, e.g. "Always on". It stays
   * focusable (aria-disabled), so keyboard users still hear it. */
  locked?: string
  /** An id for the label, for a group named after this setting. */
  labelId?: string
}

/** An on/off setting that applies at once: a button with role="switch",
 * so Space and Enter toggle it and screen readers say "on" or "off". */
export function Switch({ label, hint, checked, onChange, disabled, locked, labelId }: Props) {
  const id = useId()
  return (
    <div className="switch">
      <button
        type="button"
        role="switch"
        id={id}
        className="switch__control"
        aria-checked={checked}
        aria-describedby={[hint && `${id}-hint`, locked && `${id}-lock`].filter(Boolean).join(' ') || undefined}
        aria-disabled={locked ? true : undefined}
        disabled={disabled}
        onClick={() => !locked && onChange(!checked)}
      >
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
      </button>
      <div className="switch__text">
        {/* The hint is outside the label: read once, as the description. */}
        <span className="switch__head">
          <label className="switch__label" htmlFor={id} id={labelId}>
            {label}
          </label>
          {/* Read as part of the description, not the name. */}
          {locked && (
            <span className="flag" id={`${id}-lock`}>
              {locked}
            </span>
          )}
        </span>
        {hint && (
          <span className="switch__hint" id={`${id}-hint`}>
            {hint}
          </span>
        )}
      </div>
    </div>
  )
}
