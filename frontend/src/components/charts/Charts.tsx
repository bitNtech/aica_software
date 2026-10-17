import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import './charts.css'

/**
 * Small hand-made charts (no chart library): a column chart, stacked or
 * not, and a labelled bar list. Colours come from the --series-* tokens in
 * charts.css, validated for colour-blind separation on this app's light and
 * dark card colours. Every chart has a legend for two or more series, a
 * readout on hover and on keyboard focus, and a table view, so nothing
 * depends on colour or a pointer alone.
 */

export interface Series {
  key: string
  label: string
  /** 1-based slot in the categorical palette: identity, in fixed order. */
  slot: 1 | 2 | 3
  values: number[]
}

/** Width of an element, kept up to date. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    // Old browsers (and the test runner) without it: measured once.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** Round ticks for the axis: steps of 1, 2 or 5 × a power of ten, at most
 * five of them, with the top one at or above `v`. */
function niceTicks(v: number): number[] {
  const raw = Math.max(v, 1) / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const n = raw / p
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p)
  const top = Math.ceil(Math.max(v, 1) / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
}

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n))

/** Columns over categories (days, hours), stacked when there are several series. */
export function ColumnChart({
  title,
  categories,
  categoryName,
  series,
  height = 220,
  valueName = 'calls',
  labelStep = 1,
}: {
  /** Names the chart for screen readers and the table's caption. */
  title: string
  /** Short labels under the columns, e.g. "6 Oct". */
  categories: string[]
  /** Full names, for the readout and table, e.g. "Monday 6 October". */
  categoryName?(i: number): string
  series: Series[]
  height?: number
  valueName?: string
  /** Labels are thinned in multiples of this, e.g. 3 for hours. */
  labelStep?: number
}) {
  const [box, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  /** The last move was by keyboard: only those are read out. */
  const [byKey, setByKey] = useState(false)
  const [table, setTable] = useState(false)
  const id = useId()
  const n = categories.length
  const totals = categories.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0))
  const ticks = niceTicks(Math.max(...totals, 1))
  const max = ticks[ticks.length - 1]
  const left = 36
  const bottom = 26
  const plotW = Math.max(0, width - left - 4)
  const plotH = height - bottom - 8
  const band = n ? plotW / n : 0
  const barW = Math.max(1, Math.min(24, band * 0.62))
  const y = (v: number) => 8 + plotH - (v / max) * plotH
  // Labels every k-th column, so they don't collide.
  const room = Math.ceil(n / Math.max(1, Math.floor(plotW / 54)))
  const every = Math.max(labelStep, Math.ceil(room / labelStep) * labelStep)
  const full = (i: number) => categoryName?.(i) ?? categories[i]
  const num = (v: number) => v.toLocaleString('en-IN')
  const readout = (i: number) =>
    `${full(i)}: ${series.length > 1 ? series.map((s) => `${num(s.values[i] ?? 0)} ${s.label.toLowerCase()}`).join(', ') : `${num(totals[i])} ${valueName}`}`
  const top = totals.reduce((best, v, i) => (v > totals[best] ? i : best), 0)
  const summary = n ? `Highest: ${full(top)}, ${num(totals[top])} ${valueName}.` : 'No data.'

  function pointer(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.floor((e.clientX - rect.left - left) / band)
    setActive(i >= 0 && i < n ? i : null)
    setByKey(false)
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setActive(null)
      return
    }
    const last = n - 1
    const cur = active ?? last
    const next = e.key === 'ArrowLeft' ? Math.max(0, cur - 1) : e.key === 'ArrowRight' ? Math.min(last, cur + 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
    if (next === null) return
    e.preventDefault()
    setActive(next)
    setByKey(true)
  }

  const tipLeft = active !== null ? left + band * active + band / 2 : 0

  return (
    <figure className="chart">
      {series.length > 1 && <Legend series={series} />}
      <div className="chart__box" ref={box} style={{ height }}>
        {width > 0 && (
          <svg
            className="chart__svg"
            width={width}
            height={height}
            role="img"
            aria-label={`${title}. ${summary}`}
            aria-describedby={`${id}-how`}
            tabIndex={0}
            onPointerMove={pointer}
            onPointerLeave={() => !focused && setActive(null)}
            onKeyDown={key}
            onFocus={() => {
              setFocused(true)
              setActive((a) => a ?? n - 1)
            }}
            onBlur={() => {
              setFocused(false)
              setActive(null)
            }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className="chart__grid" x1={left} x2={width - 4} y1={y(t)} y2={y(t)} />
                <text className="chart__tick" x={left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {compact(t)}
                </text>
              </g>
            ))}
            {categories.map((c, i) => {
              const x = left + band * i + (band - barW) / 2
              let base = 0
              let drawn = 0
              const topSeg = series.reduce((last, s, k) => ((s.values[i] ?? 0) > 0 ? k : last), -1)
              return (
                <g key={c + i} className={active !== null && active !== i ? 'chart__col is-dim' : 'chart__col'}>
                  {series.map((s, k) => {
                    const v = s.values[i] ?? 0
                    if (v <= 0) return null
                    // Each segment above the first starts 2px higher: a gap in
                    // the surface colour, never a drawn border.
                    const yBottom = y(base) - (drawn > 0 ? 2 : 0)
                    const yTop = y(base + v)
                    base += v
                    drawn++
                    // Never thinner than 1px: a small count stays visible after the gap.
                    const h = Math.max(1, yBottom - yTop)
                    return <path key={s.key} className={`chart__mark chart__mark--${s.slot}`} d={columnPath(x, yBottom - h, barW, h, k === topSeg)} />
                  })}
                  {i % every === 0 && (
                    <text className="chart__tick" x={left + band * i + band / 2} y={height - 8} textAnchor="middle">
                      {c}
                    </text>
                  )}
                </g>
              )
            })}
            {active !== null && <line className="chart__cross" x1={tipLeft} x2={tipLeft} y1={8} y2={8 + plotH} />}
          </svg>
        )}
        {active !== null && (
          <div className="chart__tip" style={{ left: Math.min(Math.max(tipLeft, 80), Math.max(80, width - 80)) }} aria-hidden="true">
            <p className="chart__tip-title">{full(active)}</p>
            {series.length > 1 ? (
              [...series].reverse().map((s) => (
                <p key={s.key} className="chart__tip-row">
                  <span className={`chart__key chart__key--${s.slot}`} />
                  <strong>{num(s.values[active] ?? 0)}</strong> {s.label.toLowerCase()}
                </p>
              ))
            ) : (
              <p className="chart__tip-row">
                <strong>{num(totals[active])}</strong> {valueName}
              </p>
            )}
          </div>
        )}
      </div>
      {/* What the keyboard readout says, once per move. */}
      <p className="sr-only" id={`${id}-how`}>
        Use the left and right arrow keys to read each column, or show it as a table below.
      </p>
      <p className="sr-only" aria-live="polite">
        {focused && byKey && active !== null ? readout(active) : ''}
      </p>
      <TableToggle open={table} onToggle={() => setTable((t) => !t)} id={id}>
        <div className="chart__scroll" tabIndex={0} role="region" aria-label={`${title}, as a table`}>
        <table className="chart__table">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">{categoryName ? 'When' : 'Category'}</th>
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
              {series.length > 1 && <th scope="col">All</th>}
            </tr>
          </thead>
          <tbody>
            {categories.map((_, i) => (
              <tr key={i}>
                <th scope="row">{full(i)}</th>
                {series.map((s) => (
                  <td key={s.key}>{num(s.values[i] ?? 0)}</td>
                ))}
                {series.length > 1 && <td>{num(totals[i])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </TableToggle>
    </figure>
  )
}

/** A column: rounded 4px at the data end when it's the top segment, square at the base. */
function columnPath(x: number, yTop: number, w: number, h: number, round: boolean): string {
  if (h <= 0) return ''
  const r = round ? Math.min(4, w / 2, h) : 0
  return `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`
}

export function Legend({ series }: { series: Pick<Series, 'key' | 'label' | 'slot'>[] }) {
  return (
    <ul className="chart__legend" aria-label="Key">
      {series.map((s) => (
        <li key={s.key}>
          <span className={`chart__swatch chart__swatch--${s.slot}`} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

function TableToggle({ open, onToggle, id, children }: { open: boolean; onToggle(): void; id: string; children: ReactNode }) {
  return (
    <figcaption className="chart__foot">
      <button type="button" className="btn-text" aria-expanded={open} aria-controls={`${id}-table`} onClick={onToggle}>
        {open ? 'Hide the table' : 'Show as a table'}
      </button>
      <div id={`${id}-table`} hidden={!open}>
        {children}
      </div>
    </figcaption>
  )
}

/**
 * Horizontal bars, one series, each labelled with its value: a ranked list
 * you can read without the bars. The bars only show the proportions.
 */
export function BarList({ items, label, valueText }: { items: { label: string; value: number }[]; label: string; valueText?(v: number): string }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...items.map((i) => i.value), 1)
  const total = items.reduce((s, i) => s + i.value, 0)
  const num = (v: number) => v.toLocaleString('en-IN')
  const share = (v: number) => (total ? Math.round((v / total) * 100) : 0)
  const row = active !== null ? items[active] : null
  return (
    <div className="barlist-wrap">
      {/* Fixed-height readout, always in the layout: a hovered row's detail
          never floats over a sibling row, and nothing shifts when it fills in. */}
      <p className="barlist__readout" aria-hidden="true">
        {row && total > 0 ? (
          <>
            <strong>{row.label}</strong>: {valueText ? valueText(row.value) : num(row.value)} of {num(total)} · {share(row.value)}%
          </>
        ) : (
          ' '
        )}
      </p>
      <ul className="barlist" aria-label={label}>
        {items.map((i, k) => (
          <li
            key={i.label}
            className={`barlist__row${active === k ? ' is-active' : ''}`}
            tabIndex={0}
            onPointerEnter={() => setActive(k)}
            onPointerLeave={() => setActive((a) => (a === k ? null : a))}
            onFocus={() => setActive(k)}
            onBlur={() => setActive((a) => (a === k ? null : a))}
          >
            <span className="barlist__label">{i.label}</span>
            <span className="barlist__track" aria-hidden="true">
              <span className="barlist__bar" style={{ width: `${(i.value / max) * 100}%` }} />
            </span>
            <span className="barlist__value">{valueText ? valueText(i.value) : num(i.value)}</span>
            {/* The share is read out always; the readout line above only repeats it for the eye. */}
            {total > 0 && <span className="sr-only">{`, ${share(i.value)} percent of ${num(total)}`}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
