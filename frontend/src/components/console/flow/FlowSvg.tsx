import { memo } from 'react'
import type { FlowNodeKind } from '../../../console/types'
import type { FlowDirection, LayoutEdge, LayoutNode } from './layout'

/** The pieces FlowCanvas draws: node shapes, arrows and the arrowhead
 * definitions. Presentational; every bit of state arrives as a prop, and
 * events are handled once, on the <svg>, by looking for `data-flow-node`
 * and `data-toggle`. */

export type MarkTone = 'info' | 'warn' | 'danger'

/** A line of status on a node, drawn with an icon and words (never colour
 * alone): "Low confidence, 58%", "Not in the designed flow". */
export interface FlowMark {
  tone: MarkTone
  text: string
  /** Longer wording for screen readers and the tooltip. */
  detail?: string
}

/** The outline of a node's shape, `grow` px outside it: a stadium for an
 * intent, a plain rectangle for a step, a notched box (a hexagon) for a
 * branch. Each is also told apart by its caption, never by shape alone. */
export function shapePath(kind: FlowNodeKind, w: number, h: number, grow = 0): string {
  const x0 = -grow
  const y0 = -grow
  const x1 = w + grow
  const y1 = h + grow
  if (kind === 'branch') {
    const n = 14 + grow
    return `M${x0 + n} ${y0}H${x1 - n}L${x1} ${h / 2}L${x1 - n} ${y1}H${x0 + n}L${x0} ${h / 2}Z`
  }
  const r = Math.min(kind === 'intent' ? Math.min(h / 2, 28) + grow : 6 + grow, (h + grow * 2) / 2)
  return `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`
}

const PAD_Y = 8
const PAD_X: Record<FlowNodeKind, number> = { intent: 24, step: 14, branch: 26 }

/** Arrowheads. Ids carry the canvas's own prefix so two diagrams on a page
 * don't share (and restyle) each other's. */
export function ArrowDefs({ prefix }: { prefix: string }) {
  return (
    <defs>
      <marker id={`${prefix}-arrow`} className="flowc__arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
        <path d="M0 0.5 8 4 0 7.5z" />
      </marker>
      <marker id={`${prefix}-arrow-path`} className="flowc__arrow flowc__arrow--path" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
        <path d="M0 1 12 6 0 11z" />
      </marker>
    </defs>
  )
}

export const EdgeView = memo(function EdgeView({ edge, prefix, onPath, dim }: { edge: LayoutEdge; prefix: string; onPath: boolean; dim: boolean }) {
  const l = edge.label
  return (
    <g className={['flowc__edge', `flowc__edge--${edge.kind}`, onPath && 'is-on-path', dim && 'is-dim'].filter(Boolean).join(' ')} aria-hidden="true" data-edge={edge.id}>
      <path d={edge.d} markerEnd={`url(#${prefix}-arrow${onPath ? '-path' : ''})`} />
      {l && (
        <g className="flowc__label">
          <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={l.h > 24 ? 8 : l.h / 2} />
          {l.lines.map((line, i) => (
            <text key={i} x={l.x + l.w / 2} y={l.y + 4 + 11 + i * 14} textAnchor="middle">
              {line}
            </text>
          ))}
        </g>
      )}
    </g>
  )
})

function MarkIcon({ tone }: { tone: MarkTone }) {
  // Three different silhouettes: a triangle, an octagon-ish cross, a circle.
  return tone === 'warn' ? (
    <path className="flowc__mark-icon" d="M6 .8 11.4 10.6H.6z" />
  ) : tone === 'danger' ? (
    <path className="flowc__mark-icon" d="M3.6.6h4.8L11.4 3.6v4.8L8.4 11.4H3.6L.6 8.4V3.6z" />
  ) : (
    <circle className="flowc__mark-icon" cx="6" cy="6" r="5.4" />
  )
}

export interface NodeViewProps {
  ln: LayoutNode
  direction: FlowDirection
  /** Spoken name and description (the canvas builds them). */
  name: string
  desc: string
  descId: string
  /** The one node in the tab order. */
  active: boolean
  selected: boolean
  match: 'match' | 'current' | null
  onPath: boolean
  dim: boolean
  /** Number on the node's corner: its place on the call's path, or in the sequence. */
  ordinal: number | null
  count: number | null
  mark: FlowMark | null
  /** The call left the flow here. */
  exit: boolean
}

export const NodeView = memo(function NodeView(p: NodeViewProps) {
  const { ln } = p
  const { w, h, kind } = ln
  const padX = PAD_X[kind]
  const centred = kind !== 'step'
  const tx = centred ? w / 2 : padX
  const anchor = centred ? 'middle' : 'start'
  let y = PAD_Y + 11
  const caption = y
  y = PAD_Y + 14 + 13
  const labelYs = ln.lines.map((_, i) => y + i * 17)
  y = PAD_Y + 14 + ln.lines.length * 17 + 4 + 11
  const detailYs = ln.detail.map((_, i) => y + i * 15)
  const hasMark = ln.marked && (p.mark || p.exit)
  const markText = p.exit ? 'Call left here' : (p.mark?.text ?? '')
  const markTone: MarkTone = p.exit ? 'danger' : (p.mark?.tone ?? 'info')
  const maxChars = Math.max(6, Math.floor((w - padX * 2 - 16) / 6))
  const shown = markText.length > maxChars ? `${markText.slice(0, maxChars - 1)}…` : markText
  const tb = p.direction === 'TB'
  const cls = [
    'flowc__node',
    `flowc__node--${kind}`,
    p.selected && 'is-selected',
    p.onPath && 'is-on-path',
    p.dim && 'is-dim',
    p.match && `is-${p.match}`,
    p.exit && 'is-exit',
    p.mark && `has-mark has-mark--${p.mark.tone}`,
  ]
    .filter(Boolean)
    .join(' ')
  const countText = p.count !== null ? String(p.count) : ''
  const badgeW = Math.max(20, countText.length * 7 + 12)
  return (
    <g
      className={cls}
      transform={`translate(${ln.x} ${ln.y})`}
      role="treeitem"
      tabIndex={p.active ? 0 : -1}
      data-flow-node={ln.id}
      data-kind={kind}
      data-on-path={p.onPath ? 'true' : undefined}
      data-match={p.match ?? undefined}
      aria-label={p.name}
      aria-describedby={p.descId}
      aria-level={ln.depth + 1}
      aria-posinset={ln.posInSet}
      aria-setsize={ln.setSize}
      aria-expanded={ln.hasChildren ? !ln.collapsed : undefined}
      aria-selected={p.selected}
      aria-current={p.onPath ? 'true' : undefined}
    >
      <title>{p.name}</title>
      <desc id={p.descId}>{p.desc}</desc>
      <path className="flowc__focus" d={shapePath(kind, w, h, 7)} />
      {(p.selected || p.match) && <path className={`flowc__ring ${p.selected ? 'flowc__ring--selected' : 'flowc__ring--match'}`} d={shapePath(kind, w, h, 4)} />}
      <path className="flowc__body" d={shapePath(kind, w, h)} />
      <text className="flowc__caption" x={tx} y={caption} textAnchor={anchor}>
        {ln.caption.toUpperCase()}
      </text>
      {ln.lines.map((line, i) => (
        <text key={i} className="flowc__text" x={tx} y={labelYs[i]} textAnchor={anchor}>
          {line}
        </text>
      ))}
      {ln.detail.map((line, i) => (
        <text key={i} className="flowc__detail" x={tx} y={detailYs[i]} textAnchor={anchor}>
          {line}
        </text>
      ))}
      {hasMark && (
        <g className={`flowc__mark flowc__mark--${markTone}`} transform={`translate(${centred ? (w - (shown.length * 6 + 16)) / 2 : padX} ${h - PAD_Y - 14})`}>
          <g transform="translate(0 1)">
            <MarkIcon tone={markTone} />
          </g>
          <text x="16" y="10">
            {shown}
          </text>
        </g>
      )}
      {p.exit && (
        // A bar across the arrow the call didn't follow.
        <path className="flowc__barrier" d={tb ? `M${w / 2 - 16} ${h + 8}H${w / 2 + 16}` : `M${w + 8} ${h / 2 - 16}V${h / 2 + 16}`} />
      )}
      {p.ordinal !== null && (
        <g className="flowc__ordinal" transform="translate(2 2)">
          <circle r="10" />
          <text y="4" textAnchor="middle">
            {p.ordinal}
          </text>
        </g>
      )}
      {p.count !== null && (
        <g className="flowc__count" transform={`translate(${w - badgeW / 2 - (kind === 'branch' ? 10 : 2)} 0)`}>
          <rect x={-badgeW / 2} y="-9" width={badgeW} height="18" rx="9" />
          <text y="4" textAnchor="middle">
            {countText}
          </text>
        </g>
      )}
      {ln.hasChildren && (
        <g className="flowc__toggle" data-toggle={ln.id} transform={tb ? `translate(${w / 2} ${h})` : `translate(${w} ${h / 2})`}>
          {ln.collapsed ? (
            <>
              <rect x="-17" y="-10" width="34" height="20" rx="10" />
              <text y="4" textAnchor="middle">
                +{ln.hiddenCount}
              </text>
            </>
          ) : (
            <>
              <circle r="9" />
              <path d="M-4 0H4" />
            </>
          )}
        </g>
      )}
    </g>
  )
})
