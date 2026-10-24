import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import './Workspace.css'

export interface Column<T> {
  key: string
  header: string
  cell(row: T): ReactNode
  /** Makes the column sortable by this value (numbers, or strings compared naturally). */
  sortValue?(row: T): string | number | null
  align?: 'start' | 'end' | 'center'
  /** Any CSS width, e.g. "9rem". The rest share what is left. */
  width?: string
}

type Dir = 'ascending' | 'descending'
export type Density = 'comfortable' | 'compact'

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey(row: T): string
  /** Names the table for screen readers (it is not drawn). */
  caption: string
  /** Opening a row: Enter on it, or a click. */
  onSelect?(row: T): void
  /** The row currently open, by key: marked with aria-selected. */
  selectedKey?: string | null
  /** Checkbox column with select-all. */
  checked?: { keys: ReadonlySet<string>; onChange(keys: Set<string>): void }
  /** The checkbox's name, e.g. the caller: "Select Meena S". */
  rowLabel?(row: T): string
  defaultSort?: { key: string; dir: Dir }
  loading?: boolean
  /** What to show when there are no rows (and not loading). */
  empty?: ReactNode
  /** The scroll area's height; the header stays put inside it. */
  maxHeight?: string
  /** localStorage key remembering the density. */
  densityKey?: string
  defaultDensity?: Density
  /** The row count and density toggle above the table. On by default. */
  bar?: boolean
}

const SKELETON_ROWS = 6

function readDensity(key: string | undefined, fallback: Density): Density {
  if (!key) return fallback
  try {
    const v = localStorage.getItem(key)
    return v === 'compact' || v === 'comfortable' ? v : fallback
  } catch {
    return fallback
  }
}

function compare(a: string | number | null, b: string | number | null): number {
  // Blanks go last either way round: handled by the caller.
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true, sensitivity: 'base' })
}

/**
 * A table to work in: sortable columns (the header is a button; aria-sort
 * says which way), a header that stays in view, rows you move through with
 * the arrow keys (also j and k; Home and End) and open with Enter or a click,
 * optional checkboxes with select-all, and a comfortable/compact density.
 * It shows skeleton rows while loading and your own `empty` content with no
 * rows. Wide tables scroll sideways inside their own box, never the page.
 *
 * Keyboard model: the rows are one tab stop (a roving tabindex): Tab enters
 * the table at the active row, arrows move between rows, Tab leaves.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  onSelect,
  selectedKey,
  checked,
  rowLabel,
  defaultSort,
  loading,
  empty,
  maxHeight = '70dvh',
  densityKey,
  defaultDensity = 'comfortable',
  bar = true,
}: Props<T>) {
  const id = useId()
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(defaultSort ?? null)
  const [density, setDensity] = useState<Density>(() => readDensity(densityKey, defaultDensity))
  const [active, setActive] = useState(0)
  const rowEls = useRef<(HTMLTableRowElement | null)[]>([])
  const allBox = useRef<HTMLInputElement>(null)

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined
    if (!sort || !col?.sortValue) return rows
    const value = col.sortValue
    const sign = sort.dir === 'ascending' ? 1 : -1
    return rows
      .map((row, i) => ({ row, i, v: value(row) }))
      .sort((a, b) => {
        const blankA = a.v === null || a.v === ''
        const blankB = b.v === null || b.v === ''
        if (blankA || blankB) return blankA === blankB ? a.i - b.i : blankA ? 1 : -1
        return sign * compare(a.v, b.v) || a.i - b.i
      })
      .map((x) => x.row)
  }, [rows, columns, sort])

  // Keep the active row inside the rows there are.
  const activeRow = Math.min(active, Math.max(0, sorted.length - 1))

  const keys = sorted.map(rowKey)
  const checkedCount = checked ? keys.filter((k) => checked.keys.has(k)).length : 0
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = checkedCount > 0 && checkedCount < keys.length
  })

  function cycle(col: Column<T>) {
    setSort((s) => (s?.key !== col.key ? { key: col.key, dir: 'ascending' } : s.dir === 'ascending' ? { key: col.key, dir: 'descending' } : null))
  }

  function changeDensity(d: Density) {
    setDensity(d)
    if (!densityKey) return
    try {
      localStorage.setItem(densityKey, d)
    } catch {
      // Not remembered; still applies now.
    }
  }

  function toggleAll() {
    if (!checked) return
    const next = new Set(checked.keys)
    if (checkedCount === keys.length) keys.forEach((k) => next.delete(k))
    else keys.forEach((k) => next.add(k))
    checked.onChange(next)
  }
  function toggleOne(key: string) {
    if (!checked) return
    const next = new Set(checked.keys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    checked.onChange(next)
  }

  function move(to: number) {
    const i = Math.max(0, Math.min(sorted.length - 1, to))
    setActive(i)
    rowEls.current[i]?.focus()
  }

  function onRowKey(e: KeyboardEvent<HTMLTableRowElement>, row: T, i: number) {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const inside = e.target !== e.currentTarget
    const tag = (e.target as HTMLElement).tagName
    // Typing in a field, or pressing a button or link inside a row, is theirs.
    if (inside && (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox'))) return
    if (e.key === 'ArrowDown' || (e.key === 'j' && !inside)) {
      e.preventDefault()
      move(i + 1)
    } else if (e.key === 'ArrowUp' || (e.key === 'k' && !inside)) {
      e.preventDefault()
      move(i - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      move(sorted.length - 1)
    } else if (e.key === 'Enter' && !inside) {
      e.preventDefault()
      onSelect?.(row)
    } else if (e.key === ' ' && !inside && checked) {
      e.preventDefault()
      toggleOne(rowKey(row))
    }
  }

  function onRowClick(e: MouseEvent<HTMLTableRowElement>, row: T, i: number) {
    setActive(i)
    // Controls inside a row do their own thing.
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label')) return
    onSelect?.(row)
  }

  const colCount = columns.length + (checked ? 1 : 0)
  const showEmpty = !loading && sorted.length === 0

  return (
    <div className={`dt dt--${density}`}>
      {bar && (
        <div className="dt__bar">
          <p className="dt__count num" role="status">
            {loading ? 'Loading…' : `${sorted.length.toLocaleString('en-IN')} ${sorted.length === 1 ? 'row' : 'rows'}`}
            {checked && checkedCount > 0 && ` · ${checkedCount} selected`}
          </p>
          <div className="dt__density" role="group" aria-label="Row spacing">
            {(['comfortable', 'compact'] as const).map((d) => (
              <button key={d} type="button" className="dt__density-btn" aria-pressed={density === d} onClick={() => changeDensity(d)}>
                {d === 'comfortable' ? 'Roomy' : 'Compact'}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* The scroll box is focusable so a keyboard user can scroll it sideways. */}
      <div className="dt__scroll" style={{ maxHeight }} tabIndex={0} role="region" aria-label={`${caption}, scrollable`}>
        <table className="dt__table" aria-busy={loading || undefined} aria-describedby={onSelect ? `${id}-hint` : undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {checked && (
                <th scope="col" className="dt__check">
                  <input ref={allBox} type="checkbox" aria-label="Select all rows" checked={keys.length > 0 && checkedCount === keys.length} disabled={keys.length === 0} onChange={toggleAll} />
                </th>
              )}
              {columns.map((c) => {
                const dir = sort?.key === c.key ? sort.dir : undefined
                return (
                  <th key={c.key} scope="col" aria-sort={c.sortValue ? (dir ?? 'none') : undefined} className={`dt__th dt__th--${c.align ?? 'start'}`} style={c.width ? { width: c.width } : undefined}>
                    {c.sortValue ? (
                      <button type="button" className="dt__sort" onClick={() => cycle(c)}>
                        <span>{c.header}</span>
                        <svg className="dt__arrow" viewBox="0 0 10 14" width="9" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m2 5.5 3-3 3 3" className={dir === 'ascending' ? 'is-on' : ''} />
                          <path d="m2 8.5 3 3 3-3" className={dir === 'descending' ? 'is-on' : ''} />
                        </svg>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: SKELETON_ROWS }, (_, r) => (
                <tr key={`s${r}`} className="dt__row dt__row--skeleton" aria-hidden="true">
                  {Array.from({ length: colCount }, (_, c) => (
                    <td key={c}>
                      <span className="skeleton skeleton--line" style={{ width: c === 0 ? '70%' : '55%' }} />
                    </td>
                  ))}
                </tr>
              ))}
            {showEmpty && (
              <tr className="dt__empty">
                <td colSpan={colCount}>{empty ?? 'Nothing to show.'}</td>
              </tr>
            )}
            {!loading &&
              sorted.map((row, i) => {
                const key = keys[i]
                const selected = selectedKey === key
                const isChecked = checked?.keys.has(key)
                return (
                  <tr
                    key={key}
                    ref={(el) => {
                      rowEls.current[i] = el
                    }}
                    className={`dt__row${selected ? ' is-selected' : ''}${onSelect ? ' is-clickable' : ''}`}
                    tabIndex={i === activeRow ? 0 : -1}
                    aria-selected={onSelect ? selected : undefined}
                    onKeyDown={(e) => onRowKey(e, row, i)}
                    onClick={(e) => onRowClick(e, row, i)}
                    onFocus={() => setActive(i)}
                  >
                    {checked && (
                      <td className="dt__check">
                        <input type="checkbox" aria-label={rowLabel ? `Select ${rowLabel(row)}` : 'Select row'} checked={!!isChecked} onChange={() => toggleOne(key)} />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={`dt__td dt__td--${c.align ?? 'start'}${c.align === 'end' ? ' num' : ''}`}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
      {onSelect && (
        <p id={`${id}-hint`} className="sr-only">
          Use the up and down arrow keys to move between rows and Enter to open one.
        </p>
      )}
    </div>
  )
}
