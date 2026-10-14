import { useEffect, useId, useState } from 'react'

/** A row of radio "chips" to filter a list, each with its count. */
export function SegFilter<K extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string
  /** `count` shows how many each option would show, when that helps. */
  options: { value: K; label: string; count?: number }[]
  value: K
  onChange(next: K): void
}) {
  const name = useId()
  return (
    <fieldset className="seg">
      <legend className="field__label">{legend}</legend>
      <div className="seg__opts">
        {options.map((o) => (
          <label key={o.value} className="seg__opt">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>
              {o.label}
              {o.count !== undefined && <span className="seg__n"> {o.count}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** `summary` (e.g. "4 of 12 calls shown"), once typing pauses: for a
 * polite live region, so each keystroke doesn't announce. */
export function useSettled(summary: string, ready: boolean, ms = 600): string {
  const [said, setSaid] = useState('')
  useEffect(() => {
    if (!ready) return
    const t = window.setTimeout(() => setSaid(summary), ms)
    return () => window.clearTimeout(t)
  }, [summary, ready, ms])
  return said
}
