import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { DetectedFlowPattern } from '../../console/types'
import { Button } from '../ui/Button'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const PAN_STEP = 40
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

interface View {
  scale: number
  x: number
  y: number
}

/** The flat step sequence behind a DetectedFlowPattern, as a pannable,
 * zoomable flowchart, with the templated summary and a way to ask bitNtech
 * to build it. Presentational only: the page wires `onRequestFlow` to the
 * client. */
export function DetectedFlowChart({ pattern, onRequestFlow, busy }: { pattern: DetectedFlowPattern; onRequestFlow(): void; busy?: boolean }) {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; startX: number; startY: number; viewX: number; viewY: number } | null>(null)
  // Active pointers by id, for one-finger drag vs. two-finger pinch.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null)

  const zoomAt = (factor: number, origin?: { x: number; y: number }) => {
    setView((v) => {
      const next = clamp(v.scale * factor, MIN_ZOOM, MAX_ZOOM)
      if (next === v.scale) return v
      const rect = canvasRef.current?.getBoundingClientRect()
      const ox = origin?.x ?? (rect ? rect.width / 2 : 0)
      const oy = origin?.y ?? (rect ? rect.height / 2 : 0)
      const ratio = next / v.scale
      return { scale: next, x: ox - (ox - v.x) * ratio, y: oy - (oy - v.y) * ratio }
    })
  }

  const reset = () => setView({ scale: 1, x: 0, y: 0 })

  // A native listener, not React's onWheel: React attaches wheel listeners
  // as passive, so preventDefault() there is silently ignored and the
  // background page scrolls along with the zoom.
  const zoomAtRef = useRef(zoomAt)
  zoomAtRef.current = zoomAt
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAtRef.current(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    canvasRef.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y }
    } else if (pointers.current.size === 2) {
      drag.current = null
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale }
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const rect = canvasRef.current?.getBoundingClientRect()
      const origin = { x: (a.x + b.x) / 2 - (rect?.left ?? 0), y: (a.y + b.y) / 2 - (rect?.top ?? 0) }
      const { dist: startDist, scale: startScale } = pinchStart.current
      setView((v) => {
        const next = clamp(startScale * (dist / startDist), MIN_ZOOM, MAX_ZOOM)
        const ratio = next / v.scale
        return { scale: next, x: origin.x - (origin.x - v.x) * ratio, y: origin.y - (origin.y - v.y) * ratio }
      })
      return
    }

    if (drag.current?.id === e.pointerId) {
      const d = drag.current
      setView((v) => ({ ...v, x: d.viewX + (e.clientX - d.startX), y: d.viewY + (e.clientY - d.startY) }))
    }
  }

  const endPointer = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (drag.current?.id === e.pointerId) drag.current = null
    if (pointers.current.size < 2) pinchStart.current = null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const pan = (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
    if (e.key === 'ArrowUp') pan(0, PAN_STEP)
    else if (e.key === 'ArrowDown') pan(0, -PAN_STEP)
    else if (e.key === 'ArrowLeft') pan(PAN_STEP, 0)
    else if (e.key === 'ArrowRight') pan(-PAN_STEP, 0)
    else if (e.key === '+' || e.key === '=') zoomAt(1.2)
    else if (e.key === '-') zoomAt(1 / 1.2)
    else if (e.key === '0') reset()
    else return
    e.preventDefault()
  }

  return (
    <div className="detected-flow">
      <p className="detected-flow__summary">{pattern.summary}</p>
      <p className="detected-flow__count">
        Seen in {pattern.occurrences} of the last {pattern.windowSize} calls.
      </p>

      <div className="detected-flow__toolbar">
        <Button variant="line" size="sm" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out">
          −
        </Button>
        <Button variant="line" size="sm" onClick={reset}>
          Reset view
        </Button>
        <Button variant="line" size="sm" onClick={() => zoomAt(1.2)} aria-label="Zoom in">
          +
        </Button>
      </div>

      <div
        ref={canvasRef}
        className="detected-flow__canvas"
        tabIndex={0}
        role="group"
        aria-label="Detected flow diagram. Drag or use arrow keys to pan, scroll, pinch, the zoom buttons, or +/- to zoom, 0 to reset."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onKeyDown={onKeyDown}
      >
        <div className="detected-flow__surface" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <ol className="detected-flow__steps">
            {pattern.steps.map((step, i) => (
              <li key={i} className="detected-flow__step">
                <div className="detected-flow__node">
                  <span className="detected-flow__node-index">{i + 1}</span>
                  <span className="detected-flow__node-label">{step}</span>
                </div>
                {i < pattern.steps.length - 1 && <span className="detected-flow__connector" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Button variant="orange" size="sm" busy={busy} busyLabel="Sending…" onClick={onRequestFlow}>
        Ask bitNtech to build this flow
      </Button>
    </div>
  )
}
