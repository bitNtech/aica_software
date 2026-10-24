import type { ReactNode } from 'react'
import { ago, useNow } from '../../lib/useNow'
import './Workspace.css'

export type TimelineKind = 'call' | 'agent' | 'person' | 'note' | 'alert' | 'system'

export interface TimelineItem {
  /** Optional: falls back to the position. */
  id?: string
  at: Date | string
  /** Who did it: "Aarti (front desk)", "The agent". */
  who?: string
  kind: TimelineKind
  title: ReactNode
  body?: ReactNode
}

/** What each kind is called to a screen reader, and its small icon. */
const KIND: Record<TimelineKind, { label: string; icon: ReactNode }> = {
  call: { label: 'Call', icon: <path d="M3.5 3h2.5l1 3-1.5 1a7 7 0 0 0 3 3l1-1.5 3 1v2.5a1 1 0 0 1-1 1A9.5 9.5 0 0 1 2.5 4a1 1 0 0 1 1-1z" /> },
  agent: { label: 'Agent', icon: <path d="M2.5 8h1.2M5 5.6v4.8M7.4 3.8v8.4M9.8 5.6v4.8M12.2 7v2M13.5 8h0" /> },
  person: { label: 'Staff', icon: <path d="M8 7.8a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM3.2 13.5a4.8 4.8 0 0 1 9.6 0" /> },
  note: { label: 'Note', icon: <path d="M3.5 3h9v7.5l-3 2.5h-6zM9.5 13v-2.5h3M5.5 6h5M5.5 8.5h3" /> },
  alert: { label: 'Alert', icon: <path d="M8 2 14.5 13h-13zM8 6.5v3M8 11.2h0" /> },
  system: { label: 'System', icon: <path d="M8 13.5A5.5 5.5 0 1 0 8 2.5a5.5 5.5 0 0 0 0 11zM8 5.5V8l1.8 1.2" /> },
}

function toDate(at: Date | string): Date {
  return at instanceof Date ? at : new Date(at)
}

/** "10:42 am" for today, "21 Oct, 10:42 am" otherwise. */
function absolute(d: Date, now: number): string {
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return sameDay ? time : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`
}

/**
 * What happened, in order, as an ordered list: each entry has a kind (an
 * icon and a screen-reader word), who did it, a title and optional detail,
 * and its time both as clock time and "3 min ago" (a <time> with the full
 * ISO value). Pass items in the order to show; nothing is re-sorted.
 */
export function Timeline({ items, label }: { items: TimelineItem[]; label?: string }) {
  const now = useNow(30_000)
  return (
    <ol className="tl" aria-label={label}>
      {items.map((item, i) => {
        const d = toDate(item.at)
        const valid = !Number.isNaN(d.getTime())
        const kind = KIND[item.kind]
        return (
          <li key={item.id ?? i} className={`tl__item tl__item--${item.kind}`}>
            <span className="tl__mark" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                {kind.icon}
              </svg>
            </span>
            <div className="tl__main">
              <p className="tl__title">
                <span className="sr-only">{kind.label}: </span>
                {item.title}
                {item.who && <span className="tl__who"> · {item.who}</span>}
              </p>
              {item.body && <div className="tl__body">{item.body}</div>}
            </div>
            {valid && (
              <time className="tl__time num" dateTime={d.toISOString()} title={d.toLocaleString('en-IN')}>
                <span>{absolute(d, now)}</span>
                <span className="tl__ago">{ago(d.getTime(), now)}</span>
              </time>
            )}
          </li>
        )
      })}
    </ol>
  )
}
