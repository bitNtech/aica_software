import { memo, useRef, type PointerEvent } from 'react'
import type { FlowLayout } from './layout'

/** The visible part of the diagram, in diagram px. */
export interface ViewRect {
  x: number
  y: number
  w: number
  h: number
}

const MAX_W = 176
const MAX_H = 112

const Boxes = memo(function Boxes({ layout }: { layout: FlowLayout }) {
  return (
    <>
      {layout.nodes.map((n) => (
        <rect key={n.id} className={`flowc__mini-node flowc__mini-node--${n.kind}`} x={n.x} y={n.y} width={n.w} height={n.h} rx={n.kind === 'intent' ? n.h / 2 : n.kind === 'step' ? 4 : 2} />
      ))}
    </>
  )
})

/**
 * A small overview of the whole diagram with the part in view outlined.
 * Click or drag on it to move there. It repeats nothing the diagram doesn't
 * say, so it is hidden from assistive tech, and from phones by CSS.
 */
export function FlowMinimap({ layout, view, onJump }: { layout: FlowLayout; view: ViewRect | null; onJump(x: number, y: number): void }) {
  const ref = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const { width: W, height: H } = layout
  const s = Math.min(MAX_W / W, MAX_H / H)

  const jump = (e: PointerEvent<SVGSVGElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const k = Math.min(r.width / W, r.height / H) || 1
    const ox = (r.width - W * k) / 2
    const oy = (r.height - H * k) / 2
    onJump((e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k)
  }

  return (
    <div className="flowc__mini" aria-hidden="true" data-testid="flow-minimap">
      <svg
        ref={ref}
        width={Math.max(40, Math.round(W * s))}
        height={Math.max(24, Math.round(H * s))}
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture?.(e.pointerId)
          jump(e)
        }}
        onPointerMove={(e) => dragging.current && jump(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <Boxes layout={layout} />
        {view && <rect className="flowc__mini-view" x={view.x} y={view.y} width={Math.min(view.w, W)} height={Math.min(view.h, H)} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  )
}
