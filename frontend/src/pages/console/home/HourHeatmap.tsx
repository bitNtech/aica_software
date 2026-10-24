import { useState } from 'react'
import { hourLabel, hourSpan, num } from './format'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * Calls by weekday and hour. Only the weekdays the period actually covers get
 * a row, so "Today" is one row rather than six empty ones.
 */
export function HourHeatmap({ data, dates }: { data: number[][]; dates: string[] }) {
  const [active, setActive] = useState<{ row: number; h: number } | null>(null)
  const covered = new Set(dates.map((d) => (new Date(`${d}T12:00:00`).getDay() + 6) % 7))
  const rows = WEEKDAYS.map((name, i) => ({ name, i })).filter((r) => covered.has(r.i))
  const shown = rows.length ? rows : WEEKDAYS.map((name, i) => ({ name, i }))
  const max = Math.max(...shown.flatMap((r) => data[r.i] ?? []), 1)
  const total = shown.reduce((s, r) => s + (data[r.i] ?? []).reduce((a, b) => a + b, 0), 0)
  const busiest = shown
    .flatMap((r) => (data[r.i] ?? []).map((count, h) => ({ count, h, day: r.name })))
    .reduce((a, b) => (b.count > a.count ? b : a), { count: 0, h: 0, day: '' })
  const span = hourSpan

  const hovered = active ? { day: shown.find((r) => r.i === active.row)?.name ?? '', count: data[active.row]?.[active.h] ?? 0, h: active.h } : null

  return (
    <div className="heatmap">
      <p className="heatmap__summary">
        Busiest: <strong>{busiest.day}</strong> at <strong>{span(busiest.h)}</strong> — {num(busiest.count)} calls.
      </p>
      {/* Fixed-height readout, always in the layout: it never floats over a
          neighbouring weekday row the way a per-cell tooltip would in a
          7-row grid with only a few pixels between rows. */}
      <p className="heatmap__readout" aria-hidden="true">
        {hovered && total > 0 ? (
          <>
            <strong>{hovered.day}</strong>, {span(hovered.h)}: <strong>{num(hovered.count)}</strong> calls · {Math.round((hovered.count / total) * 100)}% of the period
          </>
        ) : (
          ' '
        )}
      </p>
      <div
        className="heatmap__rows"
        role="img"
        aria-label={`Calls by weekday and hour. Busiest: ${busiest.day} at ${hourLabel(busiest.h)}, ${num(busiest.count)} calls of ${num(total)}.`}
        onPointerLeave={() => setActive(null)}
      >
        {shown.map((r) => (
          <div key={r.i} className="heatmap__row">
            <span className="heatmap__day" aria-hidden="true">{r.name.slice(0, 3)}</span>
            <div className="heatmap__grid">
              {Array.from({ length: 24 }, (_, h) => {
                const count = data[r.i]?.[h] ?? 0
                const on = active?.row === r.i && active.h === h
                return (
                  <div
                    key={h}
                    className={`heatmap__cell${on ? ' is-active' : ''}`}
                    style={{ '--heat': count / max } as React.CSSProperties}
                    onPointerEnter={() => setActive({ row: r.i, h })}
                  />
                )
              })}
            </div>
          </div>
        ))}
        <div className="heatmap__row heatmap__row--axis" aria-hidden="true">
          <span className="heatmap__day" />
          <div className="heatmap__grid">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="heatmap__tick">{h % 3 === 0 ? hourLabel(h) : ''}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="heatmap__legend" aria-hidden="true">
        <span>Quiet</span>
        <span className="heatmap__legend-bar" />
        <span>Busy</span>
        <span className="heatmap__legend-max">Peak {num(max)} calls an hour</span>
      </div>
    </div>
  )
}
