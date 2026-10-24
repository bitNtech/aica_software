import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useShortcuts } from '../../../../components/console/KeyboardHelp'
import { Skeleton } from '../../../../components/console/Skeleton'
import { WaitTimer } from '../../../../components/console/WaitTimer'
import { callerName, factsOf, type QueueItem } from './queue'
import { CallClock, RowPills } from './parts'
import { timeOfDay } from '../shared'

interface Props {
  /** What passes the filters, in queue order. */
  items: QueueItem[]
  /** Everything in the queue, before filters (to tell "empty" from "filtered out"). */
  total: number
  selectedKey: string | null
  onSelect(key: string): void
  mayShowPersonal: boolean
  /** Whether this person can read the handover queue (`calls.take`); without it the "Needs a person" group would be empty for the wrong reason. */
  seesWaiting?: boolean
  /** The signed-in person's name, for "Taken by you". */
  me: string
  loading: boolean
  onClearFilters(): void
}

/**
 * The queue: callers waiting for a person first, then the calls the agents
 * are on, then (collapsed) the ones that ended or were taken lately.
 * Each group is a listbox of options: Tab enters at one row, ↑ ↓ (or j and
 * k from anywhere) move between rows, Home and End jump, Enter or Space
 * opens the row in the detail. A row's `aria-selected` says which is open;
 * moving between rows doesn't open them, so a phone's drawer doesn't pop up
 * while someone scans the list.
 */
export function LiveQueue({ items, total, selectedKey, onSelect, mayShowPersonal, seesWaiting = true, me, loading, onClearFilters }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const recentId = useId()
  const [tabKey, setTabKey] = useState<string | null>(null)
  const [recentOpen, setRecentOpen] = useState(false)

  const needs = items.filter((i) => i.section === 'emergency' || i.section === 'waiting')
  const onCalls = items.filter((i) => i.section === 'flagged' || i.section === 'active')
  const recent = items.filter((i) => i.section === 'recent')
  const selectedInRecent = recent.some((i) => i.key === selectedKey)
  // A taken or ended call that is open stays visible, whatever the disclosure says.
  const showRecent = recentOpen || selectedInRecent
  const visible = [...needs, ...onCalls, ...(showRecent ? recent : [])]
  const rowKeys = visible.map((i) => i.key)
  // One Tab stop: the row last focused, else the open one, else the first.
  const tabbable = tabKey && rowKeys.includes(tabKey) ? tabKey : selectedKey && rowKeys.includes(selectedKey) ? selectedKey : (rowKeys[0] ?? null)

  const rows = () => Array.from(box.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
  function focusAt(i: number) {
    const all = rows()
    const el = all[Math.max(0, Math.min(all.length - 1, i))]
    el?.focus()
  }
  function move(delta: number) {
    const all = rows()
    if (all.length === 0) return
    const here = all.findIndex((el) => el === document.activeElement)
    if (here === -1) {
      const start = all.findIndex((el) => el.dataset.key === tabbable)
      focusAt(start === -1 ? 0 : start)
    } else focusAt(here + delta)
  }

  useShortcuts({
    j: { description: 'Next caller in the queue', run: () => move(1) },
    k: { description: 'Previous caller in the queue', run: () => move(-1) },
  })

  // The tab stop must exist: if its row went, it falls back to the first.
  useEffect(() => {
    if (tabKey && !rowKeys.includes(tabKey)) setTabKey(null)
  }, [tabKey, rowKeys.join('|')])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]')
    if (!el) return
    const all = rows()
    const at = all.indexOf(el)
    if (e.key === 'ArrowDown') focusAt(at + 1)
    else if (e.key === 'ArrowUp') focusAt(at - 1)
    else if (e.key === 'Home') focusAt(0)
    else if (e.key === 'End') focusAt(all.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') onSelect(el.dataset.key!)
    else return
    e.preventDefault()
  }

  if (loading) {
    return (
      <div className="live-queue" aria-busy="true">
        <p role="status" className="sr-only">
          Loading live calls…
        </p>
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="live-queue__skeleton">
            <Skeleton width="55%" />
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="live-queue">
        <p className="split__empty">No calls right now. New calls appear here as they come in.</p>
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="live-queue">
        <p className="split__empty">
          No calls match.{' '}
          <button type="button" className="btn-text" onClick={onClearFilters}>
            Clear the filters
          </button>{' '}
          to see everyone.
        </p>
      </div>
    )
  }

  const group = (slot: string, title: string, list: QueueItem[], empty: string) => (
    <section className="live-group" aria-labelledby={`${recentId}-${slot}`}>
      <h2 className="live-group__title" id={`${recentId}-${slot}`}>
        {title} <span className="op-count">{list.length}</span>
      </h2>
      {list.length === 0 ? (
        <p className="live-group__empty">{empty}</p>
      ) : (
        <ul className="live-list" role="listbox" aria-label={title}>
          {list.map((i) => (
            <Row key={i.key} item={i} selected={i.key === selectedKey} tabbable={i.key === tabbable} me={me} mayShowPersonal={mayShowPersonal} onSelect={onSelect} onFocusRow={setTabKey} />
          ))}
        </ul>
      )}
    </section>
  )

  return (
    <div className="live-queue" ref={box} onKeyDown={onKeyDown}>
      {/* Who is waiting comes from the handover queue, which only people who
          take calls can read: saying "nobody" to anyone else would be wrong. */}
      {seesWaiting ? (
        group('needs', 'Needs a person', needs, 'Nobody is waiting for a person.')
      ) : (
        <p className="live-group__empty">Callers waiting for a person show to people who take calls.</p>
      )}
      {group('calls', 'With the agent', onCalls, 'The agents have no calls in progress.')}
      {recent.length > 0 && (
        <section className="live-group">
          <h2 className="live-group__title">
            <button type="button" className="live-group__toggle" aria-expanded={showRecent} aria-controls={`${recentId}-recent`} onClick={() => setRecentOpen((o) => !o)}>
              <svg className="live-group__chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="m4 2.5 3.5 3.5L4 9.5" />
              </svg>
              <span>Recently ended or taken</span>
              <span className="op-count">{recent.length}</span>
            </button>
          </h2>
          <div id={`${recentId}-recent`} hidden={!showRecent}>
            {showRecent && (
              <ul className="live-list" role="listbox" aria-label="Recently ended or taken">
                {recent.map((i) => (
                  <Row key={i.key} item={i} selected={i.key === selectedKey} tabbable={i.key === tabbable} me={me} mayShowPersonal={mayShowPersonal} onSelect={onSelect} onFocusRow={setTabKey} />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function Row({
  item,
  selected,
  tabbable,
  me,
  mayShowPersonal,
  onSelect,
  onFocusRow,
}: {
  item: QueueItem
  selected: boolean
  tabbable: boolean
  me: string
  mayShowPersonal: boolean
  onSelect(key: string): void
  onFocusRow(key: string): void
}) {
  const f = factsOf(item)
  const name = callerName(item, mayShowPersonal)
  const recent = item.section === 'recent'
  const trail = [f.intent, f.step && !item.ended ? `now: ${f.step}` : null].filter(Boolean).join(' · ')
  // What the row says in a few words: why they want a person, else what they want.
  const what = f.waiting ? f.reason : (f.intent ?? (item.call ? 'Finding out what they need' : f.reason))
  const state = f.takenBy
    ? `Taken by ${f.takenBy === me ? 'you' : f.takenBy}${f.takenAt ? ` at ${timeOfDay(f.takenAt)}` : ''}`
    : f.missed
      ? 'Caller hung up before anyone answered'
      : item.ended
        ? `Call ended${item.endedAt ? ` at ${timeOfDay(new Date(item.endedAt).toISOString())}` : ''}`
        : null

  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      data-key={item.key}
      className={`live-row live-row--${item.section}${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(item.key)}
      onFocus={() => onFocusRow(item.key)}
    >
      <span className="live-row__top">
        <span className="live-row__who">
          {name ?? f.callerPhone}
          {name && <span className="live-row__phone num">{f.callerPhone}</span>}
        </span>
        {f.waiting && f.waitingSince ? (
          <WaitTimer since={f.waitingSince} compact />
        ) : recent ? (
          <time className="live-row__at num" dateTime={new Date(item.recentAt).toISOString()}>
            {timeOfDay(new Date(item.recentAt).toISOString())}
          </time>
        ) : f.startedAt ? (
          <CallClock startedAt={f.startedAt} />
        ) : null}
      </span>
      <span className="live-row__meta">
        {f.agentName}
        <i aria-hidden="true"> · </i>
        {f.line}
      </span>
      {what && !f.missed && <span className="live-row__what">{what}</span>}
      {trail && !recent && <span className="live-row__trail">{trail}</span>}
      {recent && state && <span className="live-row__trail">{state}</span>}
      {recent && f.summary && <span className="live-row__summary">{f.summary}</span>}
      <RowPills item={item} me={me} />
    </li>
  )
}
