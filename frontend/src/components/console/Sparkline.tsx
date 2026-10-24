import '../charts/charts.css'
import './Workspace.css'

/**
 * A small trend line with no axes: a 2px line in the first chart colour
 * (charts.css, validated for light and dark), the last point marked. It is
 * an image to assistive tech, summarised as low, high and latest; the same
 * sentence is the hover tooltip. Fewer than two points draws nothing.
 *
 * Meant to sit beside a figure that already says the number, not replace it.
 */
export function Sparkline({
  series,
  label,
  format = (n) => n.toLocaleString('en-IN', { maximumFractionDigits: 1 }),
  width = 96,
  height = 28,
  area,
}: {
  series: number[]
  /** What the series is, e.g. "Calls, last 14 days". */
  label?: string
  format?(n: number): string
  width?: number
  height?: number
  /** A faint fill under the line. */
  area?: boolean
}) {
  const points = series.filter((n) => Number.isFinite(n))
  if (points.length < 2) return null
  const pad = 3
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const span = hi - lo
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1)
  // A flat series sits on the middle line rather than the floor.
  const y = (n: number) => (span === 0 ? height / 2 : height - pad - ((n - lo) * (height - pad * 2)) / span)
  const line = points.map((n, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  const summary = `${label ? `${label}: ` : ''}lowest ${format(lo)}, highest ${format(hi)}, latest ${format(last)}`
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={summary}>
      <title>{summary}</title>
      {area && <path className="spark__area" d={`${line} L${x(points.length - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`} />}
      <path className="spark__line" d={line} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="spark__dot" cx={x(points.length - 1)} cy={y(last)} r="2.75" />
    </svg>
  )
}
