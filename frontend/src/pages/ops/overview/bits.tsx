import { useId, type ReactNode } from 'react'
import { asAuthError } from '../../../auth/types'
import { Skeleton } from '../../../components/console/Skeleton'
import type { Tone } from '../../../components/console/StatusPill'
import type { Health } from '../../../ops/types'

export const num = (n: number) => n.toLocaleString('en-IN')
/** A share, 0 to 1, as "94%"; a dash when there's nothing to measure. */
export const pct = (r: number | null, digits = 0) => (r === null ? '—' : `${(r * 100).toFixed(digits)}%`)
export const ms = (n: number | null) => (n === null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`)
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

export const HEALTH_TONE: Record<Health, Tone> = { ok: 'ok', degraded: 'warn', down: 'danger' }
export const HEALTH_LABEL: Record<Health, string> = { ok: 'Working', degraded: 'Slow', down: 'Down' }

/** How long since `at`, in words: "12 min", "5 hours", "2 days". */
export function since(at: string, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000))
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return plural(h, 'hour')
  return plural(Math.floor(h / 24), 'day')
}

/** "21 Oct, 10:42 am", or just the time today. */
export function when(at: string, now = Date.now()): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`
}

/** One block on the overview: a titled card, saying when its figures are sample data. */
export function Panel({
  title,
  note,
  demo,
  action,
  wide,
  className,
  children,
}: {
  title: string
  /** A quiet line beside the title: the period, how it's sorted. */
  note?: ReactNode
  demo?: boolean
  /** A link to the full page, top right. */
  action?: ReactNode
  /** Spans both columns of the grid. */
  wide?: boolean
  className?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section className={`ov-panel${wide ? ' ov-panel--wide' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={id}>
      <div className="ov-panel__head">
        <h3 id={id} className="ov-panel__title">
          {title}
        </h3>
        {demo && <span className="demo-chip">Demo data</span>}
        {note && <p className="ov-panel__note">{note}</p>}
        {action && <div className="ov-panel__action">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/** What a panel shows before its data arrives, or when it couldn't load. The
 * page keeps one polite status for loading, so this stays quiet. */
export function PanelState({ error, onRetry, height = '8rem' }: { error?: unknown; onRetry(): void; height?: string }) {
  if (error)
    return (
      <p className="ov-error">
        Couldn’t load this. {asAuthError(error).message}{' '}
        <button type="button" className="btn-text" onClick={onRetry}>
          Try again
        </button>
      </p>
    )
  return <Skeleton block height={height} />
}

/** A group of panels under one heading (Analytics, Agents…). */
export function Group({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="ov-group" id={id} aria-labelledby={`${id}-h`} tabIndex={-1}>
      <div className="ops-section__head">
        <h2 id={`${id}-h`} className="ops-section__title">
          {title}
        </h2>
        {note && <p className="ops-section__note">{note}</p>}
      </div>
      {children}
    </section>
  )
}
