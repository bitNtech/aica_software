import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface Tab<K extends string> {
  key: K
  label: ReactNode
}

interface Props<K extends string> {
  label: string
  tabs: Tab<K>[]
  value: K
  onChange(key: K): void
  /** The panel for the selected tab. */
  children: ReactNode
}

/** In-page tabs (WAI-ARIA tabs pattern): one tab stop, arrow keys move
 * between tabs and select them, Home/End jump to the ends. For tabs that
 * are separate pages, use links with aria-current instead. */
export function Tabs<K extends string>({ label, tabs, value, onChange, children }: Props<K>) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKey(e: KeyboardEvent, i: number) {
    const last = tabs.length - 1
    const next = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
    if (next === null) return
    e.preventDefault()
    onChange(tabs[next].key)
    refs.current[next]?.focus()
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list">
        {tabs.map((t, i) => {
          const selected = t.key === value
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              className="tabs__tab"
              onClick={() => onChange(t.key)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${value}`} className="tabs__panel" tabIndex={0}>
        {children}
      </div>
    </div>
  )
}
