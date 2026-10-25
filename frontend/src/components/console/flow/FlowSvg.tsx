import { memo } from 'react'
import type { FlowNodeKind } from '../../../console/types'
import { CARD, type FlowDirection, type LayoutEdge, type LayoutNode } from './layout'

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

/** A card's outline, `grow` px outside it. Every kind is the same rounded
 * card; the kind is told by its chip (in words) and its edge colour. */
export function cardPath(w: number, h: number, grow = 0): string {
  const r = 10 + grow
  const x0 = -grow
  const y0 = -grow
  const x1 = w + grow
  const y1 = h + grow
  return `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`
}

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
      <path d={edge.d} markerEnd={onPath ? `url(#${prefix}-arrow-path)` : undefined} />
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
  /** Number on the card's corner: its place on the call's path, or in the sequence. */
  ordinal: number | null
  count: number | null
  mark: FlowMark | null
  /** The call left the flow here. */
  exit: boolean
  /** Shows Edit and × on the card (for the mouse; the keyboard has the
   * canvas's edit bar, F2 and Delete). */
  editable: boolean
}

const CHIP_CHAR = 6.4
const chipW = (text: string) => Math.round(text.length * CHIP_CHAR + 26)

/** The kind's mark inside its chip: a flag, a speech line, a fork. */
function KindIcon({ kind }: { kind: FlowNodeKind }) {
  return kind === 'intent' ? (
    <path className="flowc__chip-icon" d="M2 11V1.5M2 2h6.5l-1.3 2.2L8.5 6.4H2" />
  ) : kind === 'branch' ? (
    <path className="flowc__chip-icon" d="M2 1.5v3.5M2 5c0 2.5 6.5 1 6.5 4.5M2 5v5.5" />
  ) : (
    <path className="flowc__chip-icon" d="M1.5 3h8M1.5 6h8M1.5 9h5" />
  )
}

export const NodeView = memo(function NodeView(p: NodeViewProps) {
  const { ln } = p
  const { w, h, kind } = ln
  const x0 = CARD.padX
  let y = CARD.top + CARD.head + CARD.afterHead
  const labelYs = ln.lines.map((_, i) => y + 13 + i * CARD.label)
  y += ln.lines.length * CARD.label
  if (ln.detail.length) y += CARD.detailGap
  const detailYs = ln.detail.map((_, i) => y + 11 + i * CARD.detail)
  y += ln.detail.length * CARD.detail
  const hasMark = ln.marked && (p.mark || p.exit)
  const markY = y + CARD.markGap
  if (ln.marked) y += CARD.markGap + CARD.mark
  const footY = y + CARD.footGap
  if (ln.foot) y += CARD.footGap + CARD.foot
  const editY = y + CARD.editGap
  const markText = p.exit ? 'Call left here' : (p.mark?.text ?? '')
  const markTone: MarkTone = p.exit ? 'danger' : (p.mark?.tone ?? 'info')
  const maxChars = Math.max(6, Math.floor((w - x0 * 2 - 16) / 6))
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

  // The head: its number, "Start" on an intent, the kind on the right.
  const numW = ln.number ? Math.max(26, ln.number.length * 8 + 14) : 0
  const kindW = chipW(ln.caption)
  const kindX = w - x0 - kindW - (p.editable ? 22 : 0)
  const startX = x0 + (numW ? numW + 6 : 0)
  // The handles where lines meet the card: in at the head, out at the foot.
  const inAt = tb ? { x: w / 2, y: 0 } : { x: 0, y: h / 2 }
  const outAt = tb ? { x: w / 2, y: h } : { x: w, y: h / 2 }
  const leadsOn = ln.hasChildren || !!ln.joins

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
      <path className="flowc__focus" d={cardPath(w, h, 6)} />
      {(p.selected || p.match) && <path className={`flowc__ring ${p.selected ? 'flowc__ring--selected' : 'flowc__ring--match'}`} d={cardPath(w, h, 3)} />}
      <path className="flowc__body" d={cardPath(w, h)} />
      {/* The kind's colour down the card's left edge (its chip says it in words). */}
      <path className="flowc__accent" d={`M12 2A10 10 0 0 0 2 12V${h - 12}A10 10 0 0 0 12 ${h - 2}`} />

      {ln.number && (
        <g className="flowc__num" transform={`translate(${x0} ${CARD.top})`}>
          <rect width={numW} height={CARD.head} rx="6" />
          <text x={numW / 2} y="15" textAnchor="middle">
            {ln.number}
          </text>
        </g>
      )}
      {kind === 'intent' && (
        <g className="flowc__chip flowc__chip--start" transform={`translate(${startX} ${CARD.top})`}>
          <rect width={chipW('Start')} height={CARD.head} rx={CARD.head / 2} />
          <g transform="translate(8 5.5)">
            <KindIcon kind="intent" />
          </g>
          <text x="22" y="15">
            Start
          </text>
        </g>
      )}
      <g className={`flowc__chip flowc__chip--${kind}`} transform={`translate(${kindX} ${CARD.top})`}>
        <rect width={kindW} height={CARD.head} rx={CARD.head / 2} />
        <g transform="translate(8 5.5)">
          <KindIcon kind={kind} />
        </g>
        <text x="22" y="15">
          {ln.caption}
        </text>
      </g>
      {p.editable && (
        // For the mouse only: the keyboard deletes with Delete or the edit bar.
        <g className="flowc__x" data-act="delete" aria-hidden="true" transform={`translate(${w - x0 - 14} ${CARD.top + 3})`}>
          <rect width="16" height="16" rx="4" />
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </g>
      )}

      {ln.lines.map((line, i) => (
        <text key={i} className="flowc__text" x={x0} y={labelYs[i]}>
          {line}
        </text>
      ))}
      {ln.detail.map((line, i) => (
        <text key={i} className="flowc__detail" x={x0} y={detailYs[i]}>
          {line}
        </text>
      ))}
      {hasMark && (
        <g className={`flowc__mark flowc__mark--${markTone}`} transform={`translate(${x0} ${markY + 2})`}>
          <g transform="translate(0 1)">
            <MarkIcon tone={markTone} />
          </g>
          <text x="16" y="10">
            {shown}
          </text>
        </g>
      )}
      {ln.foot && (
        <text className="flowc__foot" x={x0} y={footY + 12}>
          ↳ {ln.foot}
        </text>
      )}
      {p.editable && (
        <g className="flowc__editbtn" data-act="edit" aria-hidden="true" transform={`translate(${x0} ${editY})`}>
          <rect width="58" height={CARD.edit} rx="6" />
          <path className="flowc__chip-icon" d="M9 16.5l1-3.5 6-6 2.5 2.5-6 6zM15 8l2.5 2.5" />
          <text x="23" y="16.5">
            Edit
          </text>
        </g>
      )}

      {ln.parentId !== null && <circle className="flowc__handle" cx={inAt.x} cy={inAt.y} r="4" />}
      {p.exit && (
        // A bar across the line the call didn't follow.
        <path className="flowc__barrier" d={tb ? `M${w / 2 - 16} ${h + 14}H${w / 2 + 16}` : `M${w + 14} ${h / 2 - 16}V${h / 2 + 16}`} />
      )}
      {p.ordinal !== null && (
        <g className="flowc__ordinal" transform="translate(0 0)">
          <circle r="10" />
          <text y="4" textAnchor="middle">
            {p.ordinal}
          </text>
        </g>
      )}
      {p.count !== null && (
        <g className="flowc__count" transform={`translate(${w - badgeW / 2 + 4} -4)`}>
          <rect x={-badgeW / 2} y="-9" width={badgeW} height="18" rx="9" />
          <text y="4" textAnchor="middle">
            {countText}
          </text>
        </g>
      )}
      {ln.hasChildren ? (
        <g className="flowc__toggle" data-toggle={ln.id} transform={`translate(${outAt.x} ${outAt.y})`}>
          {ln.collapsed ? (
            <>
              <rect x="-17" y="-10" width="34" height="20" rx="10" />
              <text y="4" textAnchor="middle">
                +{ln.hiddenCount}
              </text>
            </>
          ) : (
            <>
              <circle r="8" />
              <path d="M-3.5 0H3.5" />
            </>
          )}
        </g>
      ) : (
        leadsOn && <circle className="flowc__handle" cx={outAt.x} cy={outAt.y} r="4" />
      )}
    </g>
  )
})
