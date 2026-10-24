import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from 'react'
import type { FlowNode, FlowNodeKind } from '../../../console/types'
import { ArrowDefs, EdgeView, NodeView, type FlowMark } from './FlowSvg'
import { FlowMinimap, type ViewRect } from './FlowMinimap'
import { ancestorIds, flatten, foldable, layoutFlow, type FlowDirection, type FlowLayout } from './layout'
import './FlowCanvas.css'

export type { FlowMark } from './FlowSvg'
export type { FlowDirection } from './layout'

/**
 * FlowCanvas: a conversation flow (FlowNode[]) as a diagram that can be
 * read, searched, walked with the keyboard and, where allowed, edited.
 *
 * What it draws. A flow is an ordered script, so an intent's steps are
 * chained (each leads to the next), and a branch forks off the step before
 * it as a side path, its condition written on the arrow. Intents are rounded
 * pills, steps are rectangles, branches are notched boxes; each also says
 * what it is in words. Nothing is told apart by colour alone.
 *
 * Accessibility. The diagram is a `tree` of `treeitem`s with spoken names,
 * levels and expanded state, with one node in the tab order (roving focus).
 * Arrow keys follow the arrows: down/up along the flow (next step / the step
 * before) and left/right between alternatives (top to bottom); in a left to
 * right diagram it is the other way round. Enter selects; Space, `-` and
 * `+` fold and unfold; Home/End jump to the first/last node; `/` finds;
 * `0` fits to the window; `z` / Shift+`z` zoom. The list version of the same
 * flow is the Outline view (FlowEditor); offer it beside this one.
 * Animations never run (panning and zooming are instant), so
 * reduced-motion needs no special case. Plain wheel is never captured: it
 * scrolls the page; Ctrl or ⌘ with the wheel (or a trackpad pinch) zooms.
 *
 * ── Drawing a call on the designed flow (Call detail)
 *
 *   const cmp = compareSteps(stepLabelsFromTheCall, designedFlow)   // compare.ts
 *   <FlowCanvas
 *     nodes={designedFlow}
 *     highlightPath={completePath(designedFlow, cmp.matchedIds)}  // heavier arrows,
 *                                                               // the rest recedes,
 *                                                               // numbered 1, 2, 3…
 *     exitAt={lastMatchedId}      // "Call left here": a flagged node and a barrier
 *     counts={{ [nodeId]: n }}    // optional badge per node, e.g. drop-off
 *     marks={{ [nodeId]: { tone: 'warn', text: 'Skipped' } }}   // icon + words
 *   />
 *
 * If you already hold node ids (a call that records the nodes it visited),
 * pass them straight to `highlightPath`; `completePath` adds each node's
 * intent and branch in front so the arrows from the top are drawn too.
 *
 * ── Comparing a detected pattern with the designed flow (Call history)
 *
 *   compareSteps(pattern.steps, designedFlow)
 *     → { rootId, matches[{ index, step, nodeId }], unmatched[{ index, step,
 *         elsewhereId? }], matchedIds, coverage }
 *
 * Labels are matched after normalising case, punctuation and filler words;
 * steps with no match are reported, never guessed. DetectedFlowChart takes
 * `designed` and does the marking for you.
 *
 * ── Selection, folding and editing
 *
 *   selectedId, onSelect(id)           clicked or Enter; the canvas scrolls
 *                                      a selection it doesn't show into view
 *   collapsed + onCollapsedChange      controlled folding (a Set of ids);
 *                                      leave both out and it keeps its own
 *   editable + the four callbacks      shows add / edit / move / delete
 *                                      buttons on the focused node. The canvas
 *                                      never changes `nodes`; the parent applies
 *                                      each callback with the flowTree.ts
 *                                      helpers (addNode, updateNode, moveNode,
 *                                      removeNode) and passes new nodes back:
 *        onAddChild(parentId | null, kind)   new node under parentId (null: a new intent)
 *        onRename(id)                        open the parent's editing form for id
 *        onMove(id, -1 | 1)                  one place earlier / later among its siblings
 *        onDelete(id)                        remove id (the parent confirms if it has steps)
 *   ref → { focusNode(id), revealNode(id), fit() }  to move focus or view from outside
 *
 * Direction (top to bottom or left to right) and whether the overview is
 * shown are remembered in localStorage when it is available.
 */

export interface FlowCanvasHandle {
  /** Moves keyboard focus to a node (expanding anything that hides it). */
  focusNode(id: string): void
  /** Scrolls a node into the middle of the view. */
  revealNode(id: string): void
  /** Zooms so the whole diagram fits. */
  fit(): void
}

export interface FlowCanvasProps {
  nodes: FlowNode[]
  /** The diagram's spoken name. */
  label?: string
  selectedId?: string | null
  onSelect?(id: string): void
  /** Node ids along a call's route, in order. */
  highlightPath?: string[]
  /** The node where the call left the flow. */
  exitAt?: string
  /** A number on each node's corner (calls that reached it, say). */
  counts?: Record<string, number>
  /** What `counts` counts, singular and plural, for screen readers. Default call / calls. */
  countNoun?: [string, string]
  /** A line of status on a node: an icon and words. */
  marks?: Record<string, FlowMark>
  /** Everything but these recedes (and their arrows). */
  dimExcept?: string[]
  /** Number every node by its place in reading order. */
  ordinals?: boolean
  /** Chain the top-level nodes one after another (a detected sequence). */
  sequence?: boolean
  collapsed?: ReadonlySet<string>
  onCollapsedChange?(next: Set<string>): void
  editable?: boolean
  onAddChild?(parentId: string | null, kind: FlowNodeKind): void
  onRename?(id: string): void
  onMove?(id: string, dir: -1 | 1): void
  onDelete?(id: string): void
  defaultDirection?: FlowDirection
  /** CSS height of the view, e.g. "28rem". */
  height?: string
  className?: string
  /** Said when there is nothing to draw. */
  emptyText?: string
  /** Extra sentence for screen readers, e.g. where the list version is. */
  description?: string
  ref?: Ref<FlowCanvasHandle>
}

const MIN_ZOOM = 0.25
/** The smallest scale the diagram opens at, so its text stays legible. */
const READABLE_ZOOM = 0.85
const MAX_ZOOM = 2.5
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const PREF = { direction: 'aica.flow.direction', overview: 'aica.flow.overview' }
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode or blocked storage: the choice just isn't remembered */
  }
}

/** Below this a node is marked as one to check against its calls. Matches
 * NEEDS_REVIEW in the builder's flowTree.ts. */
export const LOW_CONFIDENCE = 0.7

const STEP_KEYS: Record<FlowDirection, { next: string; prev: string; before: string; after: string }> = {
  TB: { next: 'ArrowDown', prev: 'ArrowUp', before: 'ArrowLeft', after: 'ArrowRight' },
  LR: { next: 'ArrowRight', prev: 'ArrowLeft', before: 'ArrowUp', after: 'ArrowDown' },
}

const idOf = (el: EventTarget | null): string | null => (el instanceof Element ? el.closest('[data-flow-node]')?.getAttribute('data-flow-node') ?? null : null)

export function FlowCanvas({
  nodes,
  label = 'Conversation flow diagram',
  selectedId = null,
  onSelect,
  highlightPath,
  exitAt,
  counts,
  countNoun = ['call', 'calls'],
  marks,
  dimExcept,
  ordinals,
  sequence,
  collapsed: collapsedProp,
  onCollapsedChange,
  editable,
  onAddChild,
  onRename,
  onMove,
  onDelete,
  defaultDirection = 'TB',
  height,
  className,
  emptyText = 'There is no flow to draw yet.',
  description,
  ref,
}: FlowCanvasProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const hintId = `${uid}-hint`
  const rootRef = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const fullBtn = useRef<HTMLButtonElement>(null)
  const findRef = useRef<HTMLInputElement>(null)

  const [direction, setDirectionState] = useState<FlowDirection>(() => {
    const v = readPref(PREF.direction)
    return v === 'LR' || v === 'TB' ? v : defaultDirection
  })
  const [overview, setOverviewState] = useState(() => readPref(PREF.overview) !== 'off')
  const [localCollapsed, setLocalCollapsed] = useState<Set<string>>(new Set())
  const collapsed = collapsedProp ?? localCollapsed
  const setCollapsed = (next: Set<string>) => (onCollapsedChange ? onCollapsedChange(next) : setLocalCollapsed(next))

  const [scale, setScale] = useState(1)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<ViewRect | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [within, setWithin] = useState(false)
  const [query, setQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const [mode, setMode] = useState<'off' | 'native' | 'overlay'>('off')
  const [announce, setAnnounce] = useState('')

  /* ---- layout (once per tree, folding or direction; never for pan or zoom) ---- */

  const markedKey = [...new Set([...Object.keys(marks ?? {}), ...(exitAt ? [exitAt] : [])])].join('\u0000')
  const marked = useMemo(() => new Set(markedKey ? markedKey.split('\u0000') : []), [markedKey])
  const layout: FlowLayout = useMemo(() => layoutFlow(nodes, { direction, collapsed, marked, sequence }), [nodes, direction, collapsed, marked, sequence])

  const activeId = focusId && layout.byId.has(focusId) ? focusId : selectedId && layout.byId.has(selectedId) ? selectedId : (layout.nodes[0]?.id ?? null)
  const active = activeId ? layout.byId.get(activeId) : undefined

  // Handlers read the latest values through here, so listeners attached once
  // (wheel) and callbacks held by effects never go stale.
  const live = useRef({ scale, layout })
  live.current = { scale, layout }

  /* ---- zoom, fit and scroll ---- */

  const autoFit = useRef(true)
  const anchor = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null)
  const offsetX = (el: HTMLElement, s: number, w = live.current.layout.width) => Math.max(0, (el.clientWidth - w * s) / 2)

  const fitScale = useCallback(() => {
    if (!size.w || !size.h) return 1
    return Math.min((size.w - 4) / layout.width, (size.h - 4) / layout.height)
  }, [size, layout.width, layout.height])

  const zoomTo = useCallback((next: number, px?: number, py?: number) => {
    const el = scroller.current
    const s = live.current.scale
    next = clamp(next, MIN_ZOOM, MAX_ZOOM)
    if (next === s) return
    autoFit.current = false
    if (el) {
      const x = px ?? el.clientWidth / 2
      const y = py ?? el.clientHeight / 2
      anchor.current = { cx: (el.scrollLeft + x - offsetX(el, s)) / s, cy: (el.scrollTop + y) / s, px: x, py: y }
    }
    setScale(next)
  }, [])

  // Keep the point under the cursor (or the middle) where it was.
  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    if (!el || !a) return
    anchor.current = null
    el.scrollLeft = a.cx * scale + offsetX(el, scale) - a.px
    el.scrollTop = a.cy * scale - a.py
  }, [scale])

  // Until someone zooms, the diagram fits if it can, but never shrinks below
  // a size whose text is still readable: past that it scrolls (Fit shows all).
  useLayoutEffect(() => {
    if (autoFit.current && size.w) setScale(clamp(fitScale(), READABLE_ZOOM, 1))
  }, [fitScale, size.w])

  const fit = useCallback(() => {
    autoFit.current = false
    setScale(clamp(fitScale(), 0.1, 1))
    const el = scroller.current
    if (el) {
      el.scrollLeft = 0
      el.scrollTop = 0
    }
  }, [fitScale])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const syncView = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const s = live.current.scale
    const next = { x: (el.scrollLeft - offsetX(el, s)) / s, y: el.scrollTop / s, w: el.clientWidth / s, h: el.clientHeight / s }
    setView((v) => (v && Math.abs(v.x - next.x) + Math.abs(v.y - next.y) + Math.abs(v.w - next.w) + Math.abs(v.h - next.h) < 0.5 ? v : next))
  }, [])
  useLayoutEffect(() => {
    if (overview) syncView()
  }, [overview, scale, size, layout, syncView])
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  /** Brings a node into view: the nearest edge, or the middle. */
  const reveal = useCallback((id: string, centre: boolean) => {
    const el = scroller.current
    const ln = live.current.layout.byId.get(id)
    if (!el || !ln) return
    const s = live.current.scale
    const left = ln.x * s + offsetX(el, s)
    const top = ln.y * s
    const right = left + ln.w * s
    const bottom = top + ln.h * s
    const vw = el.clientWidth
    const vh = el.clientHeight
    const m = 36
    let sl = el.scrollLeft
    let st = el.scrollTop
    if (centre) {
      sl = (left + right) / 2 - vw / 2
      st = (top + bottom) / 2 - vh / 2
    } else {
      if (left < sl + m) sl = left - m
      else if (right > sl + vw - m) sl = right - vw + m
      if (top < st + m) st = top - m
      else if (bottom > st + vh - m) st = bottom - vh + m
    }
    el.scrollLeft = Math.max(0, sl)
    el.scrollTop = Math.max(0, st)
  }, [])

  /** Expands whatever hides `id`, then reveals it once drawn. */
  const pending = useRef<{ id: string; centre: boolean; focus: boolean } | null>(null)
  const [tick, setTick] = useState(0)
  const request = (id: string, opts: { centre?: boolean; focus?: boolean } = {}) => {
    const hidden = ancestorIds(nodes, id).filter((a) => collapsed.has(a))
    if (hidden.length) setCollapsed(new Set([...collapsed].filter((c) => !hidden.includes(c))))
    pending.current = { id, centre: !!opts.centre, focus: !!opts.focus }
    setFocusId(id)
    setTick((t) => t + 1)
  }
  useEffect(() => {
    const p = pending.current
    if (!p || !layout.byId.has(p.id)) return
    pending.current = null
    if (p.focus) {
      const g = [...(svgRef.current?.querySelectorAll('[data-flow-node]') ?? [])].find((n) => n.getAttribute('data-flow-node') === p.id) as SVGElement | undefined
      g?.focus({ preventScroll: true })
    }
    reveal(p.id, p.centre)
  }, [layout, tick, reveal])

  useImperativeHandle(ref, () => ({ focusNode: (id) => request(id, { focus: true }), revealNode: (id) => request(id, { centre: true }), fit }))

  // A selection made elsewhere (the outline) scrolls into view here.
  useEffect(() => {
    if (selectedId) request(selectedId, {})
  }, [selectedId])

  /* ---- folding ---- */

  const toggle = (id: string, to?: 'fold' | 'unfold') => {
    const ln = layout.byId.get(id)
    if (!ln || !ln.hasChildren) return
    const fold = to ? to === 'fold' : !ln.collapsed
    if (fold === ln.collapsed) return
    const next = new Set(collapsed)
    if (fold) next.add(id)
    else next.delete(id)
    setCollapsed(next)
    setAnnounce(fold ? `Folded ${ln.node.label || 'unnamed'}, hiding ${ln.hiddenCount || nodeCount(ln.node)}.` : `Unfolded ${ln.node.label || 'unnamed'}.`)
  }

  /* ---- find ---- */

  const q = query.trim().toLowerCase()
  const matches = useMemo(
    () => (q ? flatten(nodes).filter((n) => [n.label, n.say, n.condition].some((t) => t?.toLowerCase().includes(q))).map((n) => n.id) : []),
    [nodes, q],
  )
  const matchSet = useMemo(() => new Set(matches), [matches])
  const current = matches.length ? matches[matchIdx % matches.length] : null
  const goToMatch = (i: number) => {
    if (!matches.length) return
    const k = ((i % matches.length) + matches.length) % matches.length
    setMatchIdx(k)
    request(matches[k], { centre: true })
    setAnnounce(`Match ${k + 1} of ${matches.length}.`)
  }

  /* ---- what the nodes carry ---- */

  const pathKey = (highlightPath ?? []).join('\u0000')
  const dimKey = dimExcept ? dimExcept.join('\u0000') : null
  const countsKey = counts ? JSON.stringify(counts) : ''
  const marksKey = marks ? JSON.stringify(marks) : ''

  const body = useMemo(() => {
    const path = pathKey ? pathKey.split('\u0000') : []
    const pathAt = new Map(path.map((id, i) => [id, i]))
    const keep = dimKey === null ? null : new Set(dimKey ? dimKey.split('\u0000') : [])
    const dimmed = (id: string) => (path.length ? !pathAt.has(id) : keep ? !keep.has(id) : false)
    const edgeOn = (from: string, to: string) => pathAt.has(from) && pathAt.has(to) && pathAt.get(to)! > pathAt.get(from)!
    return (
      <>
        <ArrowDefs prefix={uid} />
        <g className="flowc__edges">
          {layout.edges.map((e) => (
            <EdgeView key={e.id} edge={e} prefix={uid} onPath={edgeOn(e.from, e.to)} dim={path.length ? !edgeOn(e.from, e.to) : keep ? dimmed(e.from) || dimmed(e.to) : false} />
          ))}
        </g>
        <g className="flowc__nodes">
          {layout.nodes.map((ln) => {
            const n = ln.node
            const count = counts?.[ln.id] ?? null
            const mark = marks?.[ln.id] ?? null
            const at = pathAt.get(ln.id)
            const exit = exitAt === ln.id
            const name = [
              `${ln.caption}: ${n.label.trim() || 'Unnamed'}`,
              n.kind === 'branch' && n.condition?.trim() ? `when ${n.condition.trim()}` : '',
              count !== null ? `${count} ${count === 1 ? countNoun[0] : countNoun[1]}` : '',
              at !== undefined ? `number ${at + 1} on the call’s path` : '',
              exit ? 'the call left here' : '',
              mark ? mark.text : '',
              ln.collapsed ? `${ln.hiddenCount} hidden inside` : '',
            ]
              .filter(Boolean)
              .join(', ')
            const desc = [
              n.kind === 'step' && n.say?.trim() ? `The agent says: ${n.say.trim()}` : '',
              n.kind === 'branch' && n.condition?.trim() ? `Applies when: ${n.condition.trim()}` : '',
              n.confidence !== undefined ? `Confidence ${Math.round(n.confidence * 100)}%.` : '',
              mark?.detail ?? '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <NodeView
                key={ln.id}
                ln={ln}
                direction={layout.direction}
                name={name}
                desc={desc}
                descId={`${uid}-d-${ln.order}`}
                active={ln.id === activeId}
                selected={ln.id === selectedId}
                match={current === ln.id ? 'current' : matchSet.has(ln.id) ? 'match' : null}
                onPath={at !== undefined}
                dim={dimmed(ln.id)}
                ordinal={at !== undefined ? at + 1 : ordinals ? ln.order + 1 : null}
                count={count}
                mark={mark}
                exit={exit}
              />
            )
          })}
        </g>
      </>
    )
    // `counts` and `marks` are tracked by their serialised keys.
  }, [layout, uid, activeId, selectedId, current, matchSet, pathKey, dimKey, countsKey, marksKey, exitAt, ordinals, countNoun[0], countNoun[1]])

  /* ---- keyboard ---- */

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const id = idOf(e.target) ?? activeId
    const ln = id ? layout.byId.get(id) : undefined
    if (!ln) return
    const k = STEP_KEYS[direction]
    const lane = ln.nav.lane
    const at = lane.indexOf(ln.id)
    let to: string | null | undefined
    switch (e.key) {
      case k.next:
        to = ln.nav.next
        break
      case k.prev:
        to = ln.nav.prev
        break
      case k.before:
        to = lane[at - 1]
        break
      case k.after:
        to = lane[at + 1]
        break
      case 'Home':
        to = layout.nodes[0]?.id
        break
      case 'End':
        to = layout.nodes[layout.nodes.length - 1]?.id
        break
      case 'Enter':
        onSelect?.(ln.id)
        e.preventDefault()
        return
      case ' ':
        toggle(ln.id)
        e.preventDefault()
        return
      case '-':
        toggle(ln.id, 'fold')
        e.preventDefault()
        return
      case '+':
      case '=':
        toggle(ln.id, 'unfold')
        e.preventDefault()
        return
      case '0':
        fit()
        e.preventDefault()
        return
      case 'z':
        zoomTo(live.current.scale * 1.2)
        e.preventDefault()
        return
      case 'Z':
        zoomTo(live.current.scale / 1.2)
        e.preventDefault()
        return
      case '/':
        findRef.current?.focus()
        e.preventDefault()
        return
      case 'F2':
        if (editable) onRename?.(ln.id)
        e.preventDefault()
        return
      case 'Delete':
        if (editable) onDelete?.(ln.id)
        e.preventDefault()
        return
      default:
        return
    }
    e.preventDefault()
    if (to) request(to, { focus: true })
  }

  /* ---- pointer: drag to pan, pinch to zoom, Ctrl/⌘ + wheel to zoom ---- */

  const drag = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean; id: number } | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const swallowClick = useRef(false)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = scroller.current
    if (!el) return
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()]
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: live.current.scale }
      }
      return
    }
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('.flowc__edit'))) return
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false, id: e.pointerId }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = scroller.current
    if (!el) return
    if (e.pointerType === 'touch') {
      if (!touches.current.has(e.pointerId)) return
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2 && pinch.current) {
        const [a, b] = [...touches.current.values()]
        const rect = el.getBoundingClientRect()
        zoomTo(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top)
      }
      return
    }
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true
      // Only now: capturing at pointer-down would turn every click on a node into a click on the view.
      el.setPointerCapture?.(e.pointerId)
      el.classList.add('is-dragging')
    }
    if (d.moved) {
      el.scrollLeft = d.sl - dx
      el.scrollTop = d.st - dy
    }
  }
  const endPointer = (e: PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinch.current = null
    const d = drag.current
    if (d && d.id === e.pointerId) {
      if (d.moved) swallowClick.current = true
      drag.current = null
      scroller.current?.classList.remove('is-dragging')
    }
  }

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // Native and not passive, so a zoom can stop the page zooming with it.
    // Without Ctrl or ⌘ nothing is intercepted: the wheel scrolls as usual.
    const onWheel = (e: globalThis.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomTo(live.current.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo])

  /* ---- full screen ---- */

  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement === rootRef.current) setMode('native')
      else setMode((m) => (m === 'native' ? 'off' : m))
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    if (mode !== 'overlay') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mode])
  const wasFull = useRef(false)
  useEffect(() => {
    if (mode !== 'off') wasFull.current = true
    else if (wasFull.current) {
      wasFull.current = false
      fullBtn.current?.focus()
    }
  }, [mode])

  const toggleFull = async () => {
    if (mode !== 'off') {
      if (mode === 'native') await document.exitFullscreen?.().catch(() => undefined)
      setMode('off')
      return
    }
    const el = rootRef.current
    if (el?.requestFullscreen) {
      try {
        await el.requestFullscreen()
        return
      } catch {
        /* refused: fall back to the overlay */
      }
    }
    setMode('overlay')
  }

  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'overlay') return
    if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement && e.target.value)) {
      e.stopPropagation()
      setMode('off')
    } else if (e.key === 'Tab') {
      // The overlay covers the page, so Tab stays inside it.
      const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, summary, [tabindex="0"]') ?? [])]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        last.focus()
        e.preventDefault()
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus()
        e.preventDefault()
      }
    }
  }

  /* ---- controls ---- */

  const setDirection = (d: FlowDirection) => {
    if (d === direction) return
    setDirectionState(d)
    writePref(PREF.direction, d)
    if (activeId) request(activeId, { centre: true })
  }
  const setOverview = (on: boolean) => {
    setOverviewState(on)
    writePref(PREF.overview, on ? 'on' : 'off')
  }
  const foldAll = () => setCollapsed(new Set(nodes.filter((n) => n.children.length > 0).map((n) => n.id)))
  const hasFolds = foldable(nodes).length > 0
  const shownAll = view !== null && view.w >= layout.width - 1 && view.h >= layout.height - 1

  const toolbarAt = (() => {
    if (!editable || !within || !active) return null
    const above = active.y * scale > 44
    const left = active.x * scale
    const flip = left > layout.width * scale - 300
    return {
      style: { top: above ? active.y * scale - 38 : (active.y + active.h) * scale + 14, ...(flip ? { right: Math.max(0, (layout.width - active.x - active.w) * scale) } : { left }) } as CSSProperties,
    }
  })()
  const pos = active ? { first: active.posInSet === 1, last: active.posInSet === active.setSize } : null
  const name = active?.node.label.trim() || 'unnamed'
  const along = direction === 'TB' ? ['↑', '↓'] : ['←', '→']
  const full = mode !== 'off'

  return (
    <div
      ref={rootRef}
      className={['flowc', mode === 'overlay' && 'is-overlay', full && 'is-full', className].filter(Boolean).join(' ')}
      style={height ? ({ '--flowc-h': height } as CSSProperties) : undefined}
      data-direction={direction}
      onKeyDown={onRootKeyDown}
    >
      <div className="flowc__bar" role="group" aria-label="Diagram controls">
        <div className="flowc__find">
          <label className="sr-only" htmlFor={`${uid}-find`}>
            Find a step in the diagram
          </label>
          <input
            ref={findRef}
            id={`${uid}-find`}
            type="search"
            className="flowc__input"
            placeholder="Find a step"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setMatchIdx(0)
              const t = e.target.value.trim().toLowerCase()
              const first = t ? flatten(nodes).find((n) => [n.label, n.say, n.condition].some((s) => s?.toLowerCase().includes(t))) : undefined
              if (first) request(first.id, { centre: true })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                goToMatch(matchIdx + (e.shiftKey ? -1 : 1))
              } else if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setQuery('')
              }
            }}
          />
          <span className="flowc__found" role="status">
            {q ? (matches.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}, ${(matchIdx % matches.length) + 1} shown` : 'No match') : ''}
          </span>
        </div>
        <div className="flowc__group" role="group" aria-label="Zoom">
          <button type="button" className="flowc__btn" aria-label="Zoom out" onClick={() => zoomTo(scale / 1.2)}>
            −
          </button>
          <span className="flowc__zoom">
            {Math.round(scale * 100)}%
          </span>
          <button type="button" className="flowc__btn" aria-label="Zoom in" onClick={() => zoomTo(scale * 1.2)}>
            +
          </button>
          <button type="button" className="flowc__btn" aria-label="Fit to screen" onClick={fit}>
            Fit
          </button>
        </div>
        <div className="flowc__group" role="group" aria-label="Direction">
          <button type="button" className="flowc__btn" aria-pressed={direction === 'TB'} onClick={() => setDirection('TB')}>
            Top to bottom
          </button>
          <button type="button" className="flowc__btn" aria-pressed={direction === 'LR'} onClick={() => setDirection('LR')}>
            Left to right
          </button>
        </div>
        <div className="flowc__group">
          {hasFolds && (
            <>
              <button type="button" className="flowc__btn" aria-label="Unfold everything in the diagram" onClick={() => setCollapsed(new Set())}>
                Unfold all
              </button>
              <button type="button" className="flowc__btn" aria-label="Fold every intent in the diagram" onClick={foldAll}>
                Fold all
              </button>
            </>
          )}
          <button type="button" className="flowc__btn flowc__btn--overview" aria-pressed={overview} onClick={() => setOverview(!overview)}>
            Overview
          </button>
          <button ref={fullBtn} type="button" className="flowc__btn" onClick={() => void toggleFull()}>
            {full ? 'Exit full screen' : 'Full screen'}
          </button>
          {editable && (
            <button type="button" className="flowc__btn flowc__btn--add" onClick={() => onAddChild?.(null, 'intent')}>
              Add an intent
            </button>
          )}
        </div>
      </div>

      <p className="sr-only" id={hintId}>
        {`${description ? `${description} ` : ''}Use the arrow keys to move along the arrows: ${
          direction === 'TB' ? 'down and up follow the flow, left and right move between alternatives' : 'right and left follow the flow, up and down move between alternatives'
        }. Enter selects. Space, minus and plus fold and unfold. Home and End go to the first and last. Slash finds.${editable ? ' Edit buttons appear on the focused node.' : ''}`}
      </p>

      <div className="flowc__stage">
        <div
          ref={scroller}
          className="flowc__scroll"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onScroll={() => {
            if (!overview) return
            cancelAnimationFrame(raf.current)
            raf.current = requestAnimationFrame(syncView)
          }}
          onClickCapture={(e) => {
            if (swallowClick.current) {
              swallowClick.current = false
              e.stopPropagation()
            }
          }}
        >
          <div
            className="flowc__content"
            style={{ width: layout.width * scale, height: layout.height * scale }}
            onFocusCapture={() => setWithin(true)}
            onBlurCapture={(e) => {
              if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setWithin(false)
            }}
          >
            {layout.nodes.length === 0 ? (
              <p className="flowc__empty">{emptyText}</p>
            ) : (
              <svg
                ref={svgRef}
                className="flowc__svg"
                role="tree"
                aria-label={label}
                aria-describedby={hintId}
                width={layout.width * scale}
                height={layout.height * scale}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                onKeyDown={onKeyDown}
                onFocus={(e) => {
                  const id = idOf(e.target)
                  if (id) setFocusId(id)
                }}
                onClick={(e) => {
                  if (!(e.target instanceof Element)) return
                  const tog = e.target.closest('[data-toggle]')
                  if (tog) {
                    toggle(tog.getAttribute('data-toggle')!)
                    return
                  }
                  const id = idOf(e.target)
                  if (id) {
                    setFocusId(id)
                    onSelect?.(id)
                  }
                }}
              >
                {body}
              </svg>
            )}
            {toolbarAt && active && pos && (
              <div className="flowc__edit" role="group" aria-label={`Edit ${name}`} style={toolbarAt.style}>
                {active.kind !== 'step' && (
                  <button type="button" className="flowc__btn" aria-label={`Add a step under ${name}`} onClick={() => onAddChild?.(active.id, 'step')}>
                    + Step
                  </button>
                )}
                {active.kind === 'intent' && (
                  <button type="button" className="flowc__btn" aria-label={`Add a branch under ${name}`} onClick={() => onAddChild?.(active.id, 'branch')}>
                    + Branch
                  </button>
                )}
                <button type="button" className="flowc__btn" aria-label={`Edit details of ${name}`} onClick={() => onRename?.(active.id)}>
                  Edit
                </button>
                <button type="button" className="flowc__btn flowc__btn--icon" aria-label={`Move ${name} earlier`} disabled={pos.first} onClick={() => onMove?.(active.id, -1)}>
                  {along[0]}
                </button>
                <button type="button" className="flowc__btn flowc__btn--icon" aria-label={`Move ${name} later`} disabled={pos.last} onClick={() => onMove?.(active.id, 1)}>
                  {along[1]}
                </button>
                <button type="button" className="flowc__btn flowc__btn--danger" aria-label={`Delete ${name}`} onClick={() => onDelete?.(active.id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
        {overview && layout.nodes.length > 0 && !shownAll && (
          <FlowMinimap
            layout={layout}
            view={view}
            onJump={(x, y) => {
              const el = scroller.current
              if (!el) return
              el.scrollLeft = x * scale + offsetX(el, scale) - el.clientWidth / 2
              el.scrollTop = y * scale - el.clientHeight / 2
            }}
          />
        )}
      </div>

      <p className="sr-only" role="status">
        {announce}
      </p>

      <details className="flowc__keys">
        <summary>Keyboard and mouse</summary>
        <dl>
          <dt>Arrow keys</dt>
          <dd>Move along the arrows. {direction === 'TB' ? 'Down: next step. Up: the step before. Left and right: the alternatives beside it.' : 'Right: next step. Left: the step before. Up and down: the alternatives beside it.'}</dd>
          <dt>Enter</dt>
          <dd>Select the node.</dd>
          <dt>Space, − and +</dt>
          <dd>Fold or unfold what is inside an intent or branch.</dd>
          <dt>/ , 0 , z and Shift+z</dt>
          <dd>Find, fit to the window, zoom in and zoom out.</dd>
          <dt>Mouse</dt>
          <dd>Drag to pan. Hold Ctrl or ⌘ and scroll to zoom; scrolling alone moves the page.</dd>
        </dl>
      </details>
    </div>
  )
}

function nodeCount(n: FlowNode): number {
  return n.children.reduce((s, c) => s + 1 + nodeCount(c), 0)
}
