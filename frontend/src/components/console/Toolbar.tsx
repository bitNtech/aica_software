import type { ReactNode } from 'react'
import './Workspace.css'

export interface FilterChip {
  id: string
  /** What is applied, e.g. "Agent: Appointments". */
  label: string
  onRemove(): void
}

/**
 * The row above a list or table: a search box, filters and a view switch
 * (each a slot you fill with existing fields and controls), an optional
 * summary ("12 of 40 calls") and, underneath, one chip per applied filter.
 * Chips are buttons that remove their filter; "Clear all" removes every one.
 * Sticks to the top of the page while the list scrolls under it.
 *
 * Not role="toolbar": that promises arrow-key roving between its controls,
 * and this is a plain group, so every control is its own tab stop.
 */
export function Toolbar({
  label = 'Filters',
  search,
  filters,
  views,
  summary,
  chips = [],
  onClearAll,
  sticky = true,
}: {
  /** Names the group for screen readers. */
  label?: string
  search?: ReactNode
  filters?: ReactNode
  /** E.g. a list/table switch or the density toggle. */
  views?: ReactNode
  /** Said politely to a screen reader whenever it changes. */
  summary?: ReactNode
  chips?: FilterChip[]
  onClearAll?(): void
  sticky?: boolean
}) {
  return (
    <div className={`toolbar${sticky ? ' toolbar--sticky' : ''}`} role="group" aria-label={label}>
      <div className="toolbar__row">
        {search && <div className="toolbar__search">{search}</div>}
        {filters && <div className="toolbar__filters">{filters}</div>}
        {summary && (
          <p className="toolbar__summary num" role="status">
            {summary}
          </p>
        )}
        {views && <div className="toolbar__views">{views}</div>}
      </div>
      {chips.length > 0 && (
        <ul className="toolbar__chips" aria-label="Applied filters">
          {chips.map((chip) => (
            <li key={chip.id}>
              <button type="button" className="chip" onClick={chip.onRemove} aria-label={`Remove filter: ${chip.label}`}>
                <span>{chip.label}</span>
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="m3 3 6 6M9 3 3 9" />
                </svg>
              </button>
            </li>
          ))}
          {onClearAll && (
            <li>
              <button type="button" className="toolbar__clear" onClick={onClearAll}>
                Clear all<span className="sr-only"> filters</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
