import { useId, type Ref } from 'react'

interface Option<T extends string> {
  value: T
  label: string
  hint?: string
  lang?: string
}

interface Props<T extends string> {
  legend: string
  hint?: string
  error?: string | null
  options: Option<T>[]
  /** radio: one value; checkbox: any number. */
  type: 'radio' | 'checkbox'
  value: T[]
  onChange(next: T[]): void
  onBlur?(): void
  /** Ref to the first option, so a failed submit can focus the group. */
  firstRef?: Ref<HTMLInputElement>
  columns?: 2 | 3 | 4
}

/** A labelled group of tappable option tiles over native radios/checkboxes,
 * so arrow keys, Space and screen readers behave as usual. */
export function ChoiceGroup<T extends string>({
  legend,
  hint,
  error,
  options,
  type,
  value,
  onChange,
  onBlur,
  firstRef,
  columns = 2,
}: Props<T>) {
  const id = useId()
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined

  const toggle = (v: T, checked: boolean) => {
    if (type === 'radio') onChange([v])
    else onChange(checked ? [...value, v] : value.filter((x) => x !== v))
  }

  return (
    <fieldset
      className={['choice', error && 'choice--error'].filter(Boolean).join(' ')}
      aria-describedby={describedBy}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.()
      }}
    >
      <legend className="field__label">{legend}</legend>
      <div className="choice__grid" data-cols={columns}>
        {options.map((o, i) => (
          <label key={o.value} className="choice__opt">
            <input
              ref={i === 0 ? firstRef : undefined}
              type={type}
              name={id}
              value={o.value}
              checked={value.includes(o.value)}
              aria-invalid={error ? true : undefined}
              onChange={(e) => toggle(o.value, e.target.checked)}
            />
            <span className="choice__mark" aria-hidden="true" />
            <span className="choice__text">
              <span className="choice__label" lang={o.lang}>
                {o.label}
              </span>
              {o.hint && <span className="choice__hint">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p className="field__error" id={`${id}-err`}>
          {error}
        </p>
      )}
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </fieldset>
  )
}
