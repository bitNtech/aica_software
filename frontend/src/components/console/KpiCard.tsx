import type { ReactNode } from 'react'
import { Sparkline } from './Sparkline'
import { computeDelta, type Change } from './statDelta'
import './Workspace.css'

/** The row of KpiCards: a description list, so each label goes with its value. */
export function KpiGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl className="kpis" aria-label={label}>
      {children}
    </dl>
  )
}

/**
 * One headline number for a working screen: label, value, a quiet line
 * under it, how it moved (said in words and an arrow, the same wording as
 * StatTile) and an optional trend line. A figure that isn't measured yet says
 * so ("Not measured") instead of showing a misleading zero. Put several
 * inside <KpiGrid>.
 */
export function KpiCard({
  label,
  value,
  sub,
  change,
  series,
  seriesLabel,
  seriesFormat,
  notMeasured,
}: {
  label: string
  /** The figure as it should read, e.g. "212" or "92%". Null: not measured. */
  value: string | null
  sub?: string
  change?: Change
  /** Oldest first. */
  series?: number[]
  /** What the trend is, e.g. "Calls a day, last 14 days". */
  seriesLabel?: string
  seriesFormat?(n: number): string
  /** Why there is no figure, e.g. "Needs caller ratings". Shown with value null. */
  notMeasured?: string
}) {
  const missing = value === null
  const delta = !missing && change ? computeDelta(change) : null
  return (
    <div className={`kpi${missing ? ' kpi--missing' : ''}`}>
      <dt className="kpi__label">{label}</dt>
      <dd className="kpi__value num">
        {missing ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Not measured</span>
          </>
        ) : (
          value
        )}
      </dd>
      {missing ? (
        <dd className="kpi__sub">{notMeasured ?? 'Not measured yet'}</dd>
      ) : (
        sub && <dd className="kpi__sub">{sub}</dd>
      )}
      {delta && (
        <dd className={`kpi__delta kpi__delta--${delta.tone}`}>
          {/* The arrow is for the eye; the words say the same. */}
          {delta.arrow && <span aria-hidden="true">{delta.arrow} </span>}
          {delta.text}
        </dd>
      )}
      {!missing && series && series.length > 1 && (
        <dd className="kpi__trend">
          <Sparkline series={series} label={seriesLabel ?? label} format={seriesFormat} width={120} height={30} area />
        </dd>
      )}
    </div>
  )
}
