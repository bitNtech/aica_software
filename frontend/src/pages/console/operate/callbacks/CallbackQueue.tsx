import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useShortcuts } from '../../../../components/console/KeyboardHelp'
import { Skeleton } from '../../../../components/console/Skeleton'
import { StatusPill } from '../../../../components/console/StatusPill'
import { GROUP_ORDER, nameOf, triesText, type Group, type QueueItem, type Sort } from './queue'
import { Avatar, DueLabel, STATUS } from './parts'

interface Props {
  /** What passes the filters, in queue order. */
  items: QueueItem[]
  /** Every callback loaded, before filters: tells "nothing here" from "filtered out". */
  total: number
  sort: Sort
  selectedId: string | null
  onSelect(id: string): void
  /** The person may give callbacks to others, so rows have tick boxes. */
  manage: boolean
  ticked: ReadonlySet<string>
  onTick(id: string, on: boolean): void
  now: number
  loading: boolean
  /** The status filter is set to done or couldn't reach: show that group open. */
  openClosed: boolean
  onClearFilters(): void
  /** Above the groups: the bulk bar, when something is ticked. */
  header?: ReactNode
}

const TITLE: Record<Exclude<Group, 'all'>, string> = {
  overdue: 'Overdue',
  hour: 'Due within the hour',
  today: 'Later today',
  later: 'Another day',
  closed: 'Done or couldn’t reach',
}
const flatTitle = (sort: Sort) => (sort === 'newest' ? 'To call, newest first' : 'To call, oldest first')

/**
 * The queue: open callbacks in groups by how urgent they are (overdue,
 * within the hour, later today, another day), then, folded, the ones that
 * are done or couldn't be reached. Each row is one button that opens the
 * callback beside the list (in a drawer on a phone); on a row of its own
 * beside it is a tick box for people who may give callbacks to others.
 * Tab enters at one row; ↑ ↓ (or j and k from anywhere) move between rows,
 * Home and End jump, Enter opens the row, and x ticks it. Moving between
 * rows does not open them, so a phone's drawer doesn't pop up while someone
 * scans the list.
 */
export function CallbackQueue({ items, total, sort, selectedId, onSelect, manage, ticked, onTick, now, loading, openClosed, onClearFilters, header }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const uid = useId()
  const [tabId, setTabId] = useState<string | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)

  const closed = items.filter((i) => i.group === 'closed')
  const live = items.filter((i) => i.group !== 'closed')
  const selectedClosed = closed.some((i) => i.callback.id === selectedId)
  // An open one that is picked stays visible, whatever the disclosure says.
  const showClosed = closedOpen || openClosed || selectedClosed
  const visible = [...live, ...(showClosed ? closed : [])]
  const ids = visible.map((i) => i.callback.id)
  // One Tab stop: the row last focused, else the open one, else the first.
  const tabbable = tabId && ids.includes(tabId) ? tabId : selectedId && ids.includes(selectedId) ? selectedId : (ids[0] ?? null)

  const rows = () => Array.from(box.current?.querySelectorAll<HTMLElement>('.cb-row__main') ?? [])
  const focusAt = (i: number) => {
    const all = rows()
    all[Math.max(0, Math.min(all.length - 1, i))]?.focus()
  }
  const here = () => {
    const el = document.activeElement
    return el instanceof HTMLElement ? (el.closest<HTMLElement>('.cb-row')?.querySelector<HTMLElement>('.cb-row__main') ?? null) : null
  }
  function move(delta: number) {
    const all = rows()
    if (all.length === 0) return
    const current = here()
    if (!current) {
      const start = all.findIndex((el) => el.dataset.id === tabbable)
      focusAt(start === -1 ? 0 : start)
    } else focusAt(all.indexOf(current) + delta)
  }

  useShortcuts({
    j: { description: 'Next callback in the list', run: () => move(1) },
    k: { description: 'Previous callback in the list', run: () => move(-1) },
    ...(manage
      ? {
          x: {
            description: 'Tick or untick the callback in focus',
            run: () => {
              const id = here()?.dataset.id ?? selectedId
              if (id && ids.includes(id)) onTick(id, !ticked.has(id))
            },
          },
        }
      : {}),
  })

  useEffect(() => {
    if (tabId && !ids.includes(tabId)) setTabId(null)
  }, [tabId, ids.join('|')])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.cb-row')
    if (!row) return
    const all = rows()
    const at = all.indexOf(row.querySelector<HTMLElement>('.cb-row__main')!)
    if (e.key === 'ArrowDown') focusAt(at + 1)
    else if (e.key === 'ArrowUp') focusAt(at - 1)
    else if (e.key === 'Home') focusAt(0)
    else if (e.key === 'End') focusAt(all.length - 1)
    else return
    e.preventDefault()
  }

  if (loading) {
    return (
      <div className="cb-queue" aria-busy="true">
        <p role="status" className="sr-only">
          Loading callbacks…
        </p>
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="cb-queue__skeleton">
            <Skeleton width="55%" />
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
    )
  }
  if (total === 0) {
    return (
      <div className="cb-queue">
        <p className="split__empty">Nobody to call back. Missed calls and callers who ask for a call back appear here as they come in.</p>
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="cb-queue">
        <p className="split__empty">
          No callbacks match.{' '}
          <button type="button" className="btn-text" onClick={onClearFilters}>
            Clear the filters
          </button>{' '}
          to see them all.
        </p>
      </div>
    )
  }

  const rowFor = (i: QueueItem) => (
    <Row key={i.callback.id} item={i} now={now} selected={i.callback.id === selectedId} tabbable={i.callback.id === tabbable} manage={manage} ticked={ticked.has(i.callback.id)} onTick={onTick} onSelect={onSelect} onFocusRow={setTabId} />
  )

  const groups = GROUP_ORDER.filter((g) => g !== 'closed' && live.some((i) => i.group === g))
  return (
    <div className="cb-queue" ref={box} onKeyDown={onKeyDown}>
      {header}
      {live.length === 0 && <p className="cb-queue__quiet">Nobody is waiting for a call back.</p>}
      {groups.map((g) => {
        const list = live.filter((i) => i.group === g)
        const title = g === 'all' ? flatTitle(sort) : TITLE[g as Exclude<Group, 'all'>]
        return (
          <section key={g} className="cb-group" aria-labelledby={`${uid}-${g}`}>
            <h2 className={`cb-group__title cb-group__title--${g}`} id={`${uid}-${g}`}>
              {title} <span className="op-count">{list.length}</span>
            </h2>
            <ul className="cb-list">{list.map(rowFor)}</ul>
          </section>
        )
      })}
      {closed.length > 0 && (
        <section className="cb-group">
          <h2 className="cb-group__title">
            <button type="button" className="cb-group__toggle" aria-expanded={showClosed} aria-controls={`${uid}-closed`} onClick={() => setClosedOpen((o) => !o)}>
              <svg className="cb-group__chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="m4 2.5 3.5 3.5L4 9.5" />
              </svg>
              <span>{TITLE.closed}</span>{' '}
              <span className="op-count">{closed.length}</span>
            </button>
          </h2>
          <div id={`${uid}-closed`} hidden={!showClosed}>
            {showClosed && <ul className="cb-list">{closed.map(rowFor)}</ul>}
          </div>
        </section>
      )}
    </div>
  )
}

function Row({
  item,
  now,
  selected,
  tabbable,
  manage,
  ticked,
  onTick,
  onSelect,
  onFocusRow,
}: {
  item: QueueItem
  now: number
  selected: boolean
  tabbable: boolean
  manage: boolean
  ticked: boolean
  onTick(id: string, on: boolean): void
  onSelect(id: string): void
  onFocusRow(id: string): void
}) {
  const c = item.callback
  const name = nameOf(c)
  const others = item.duplicates.length
  return (
    <li className={`cb-row${selected ? ' is-selected' : ''}${item.overdue ? ' cb-row--overdue' : ''}${c.status !== 'open' ? ' cb-row--closed' : ''}`}>
      {manage && (
        <input
          type="checkbox"
          className="cb-row__tick"
          aria-label={`Select ${name}, ${c.callerPhone}`}
          checked={ticked}
          tabIndex={tabbable ? 0 : -1}
          onChange={(e) => onTick(c.id, e.target.checked)}
        />
      )}
      <button type="button" className="cb-row__main" data-id={c.id} aria-current={selected ? 'true' : undefined} tabIndex={tabbable ? 0 : -1} onClick={() => onSelect(c.id)} onFocus={() => onFocusRow(c.id)}>
        <span className="cb-row__top">
          <span className="cb-row__who">
            <span className={c.callerName ? '' : 'cb-row__unnamed'}>{name}</span>
            <span className="cb-row__phone num">{c.callerPhone}</span>
          </span>
          {c.status === 'open' ? (
            <DueLabel item={item} now={now} />
          ) : (
            <StatusPill tone={STATUS[c.status].tone}>{STATUS[c.status].text}</StatusPill>
          )}
        </span>
        <span className="cb-row__reason">{c.reason}</span>
        <span className="cb-row__meta">
          <span className="cb-row__who-has">
            <Avatar name={c.assignedTo?.name ?? null} />
            <span className={c.assignedTo ? '' : 'cb-row__nobody'}>{c.assignedTo ? c.assignedTo.name : 'Not given to anyone'}</span>
          </span>
          <i aria-hidden="true">·</i>
          <span>{triesText(c.attempts)}</span>
          {others > 0 && (
            <StatusPill tone="info" className="cb-row__dup">
              {others === 1 ? '1 other open for this number' : `${others} others open for this number`}
            </StatusPill>
          )}
        </span>
      </button>
    </li>
  )
}
