import type { CSSProperties } from 'react'
import './Workspace.css'

/**
 * A placeholder shaped like what is loading. Purely visual (aria-hidden), so
 * the loading state itself must be said elsewhere: put `aria-busy="true"` on
 * the region that is loading and keep one polite status, e.g.
 *
 *   <section aria-busy={loading}>
 *     {loading ? <><p role="status" className="sr-only">Loading calls…</p><Skeleton lines={3} /></> : rows}
 *   </section>
 *
 * The shimmer stops under prefers-reduced-motion.
 */
export function Skeleton({
  lines,
  block,
  width,
  height,
  className,
}: {
  /** A paragraph of this many lines; the last one is shorter. */
  lines?: number
  /** One solid block (a card, a chart), `height` tall. */
  block?: boolean
  width?: string
  height?: string
  className?: string
}) {
  const cls = `skeleton${className ? ` ${className}` : ''}`
  if (lines) {
    return (
      <span className={`skeleton-lines${className ? ` ${className}` : ''}`} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="skeleton skeleton--line" style={{ width: i === lines - 1 && lines > 1 ? '60%' : (width ?? '100%') }} />
        ))}
      </span>
    )
  }
  const style: CSSProperties = { width, height: height ?? (block ? '6rem' : undefined) }
  return <span className={`${cls}${block ? ' skeleton--block' : ' skeleton--line'}`} style={style} aria-hidden="true" />
}
