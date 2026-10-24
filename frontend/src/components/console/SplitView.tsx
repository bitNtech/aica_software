import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { Drawer } from './Drawer'
import './Workspace.css'

/** From this viewport width the detail sits beside the list; below it, in a Drawer. */
const WIDE = '(min-width: 1100px)'
/** Keep this much for the detail pane whatever the list is dragged to. */
const DETAIL_MIN = 360

function readWidth(key: string): number | null {
  try {
    const n = Number.parseInt(localStorage.getItem(key) ?? '', 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
function saveWidth(key: string, n: number) {
  try {
    localStorage.setItem(key, String(Math.round(n)))
  } catch {
    // Private mode or storage off: the width just isn't remembered.
  }
}

interface Props {
  /** The list pane's content, e.g. a queue of callers. */
  list: ReactNode
  /** The detail pane's content: shown when `detailOpen`. */
  detail: ReactNode
  detailOpen: boolean
  /** Called by the Drawer's Close, Escape and scrim (narrow screens only). */
  onCloseDetail(): void
  /** Names the detail pane (wide) and the Drawer (narrow): "Caller details". */
  detailLabel: string
  /** Names the list pane for screen readers. */
  listLabel?: string
  /** Shown in the wide detail pane while nothing is selected. */
  detailEmpty?: ReactNode
  /** localStorage key remembering the list width, e.g. "aica.split.live". */
  storageKey: string
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
}

/**
 * A list beside its detail, for work done one item at a time. The panes
 * share the height below the page header and each scrolls on its own, so
 * the list stays put while a long detail scrolls. A separator between them
 * resizes the list: drag it, or focus it and use the arrow keys (Shift for
 * bigger steps, Home and End for the limits, Enter to reset); the width is
 * remembered per `storageKey`. Below 1100px there is no room for both, so
 * the list fills the width and the detail opens in a <Drawer>.
 */
export function SplitView({
  list,
  detail,
  detailOpen,
  onCloseDetail,
  detailLabel,
  listLabel = 'List',
  detailEmpty,
  storageKey,
  defaultWidth = 380,
  minWidth = 280,
  maxWidth = 640,
}: Props) {
  const wide = useMediaQuery(WIDE, true)
  const box = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [width, setWidth] = useState(() => Math.min(maxWidth, Math.max(minWidth, readWidth(storageKey) ?? defaultWidth)))
  const [dragging, setDragging] = useState(false)

  /** Within the limits, and never so wide the detail pane is squeezed out. */
  const clamp = useCallback(
    (n: number) => {
      const room = box.current?.offsetWidth ? box.current.offsetWidth - DETAIL_MIN : maxWidth
      return Math.round(Math.min(Math.max(minWidth, Math.min(maxWidth, room)), Math.max(minWidth, n)))
    },
    [minWidth, maxWidth],
  )

  // Remember the width once a drag or key press settles.
  useEffect(() => {
    if (!dragging) saveWidth(storageKey, width)
  }, [width, dragging, storageKey])

  // The panes fill the screen below the page header, wherever that ends.
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !wide) return
    const place = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      el.style.setProperty('--split-top', `${Math.round(top)}px`)
    }
    place()
    window.addEventListener('resize', place)
    const head = el.previousElementSibling
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (head) ro?.observe(head)
    return () => {
      window.removeEventListener('resize', place)
      ro?.disconnect()
    }
  }, [wide])

  function onKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? 64 : 16
    const next =
      e.key === 'ArrowLeft' ? width - step : e.key === 'ArrowRight' ? width + step : e.key === 'Home' ? minWidth : e.key === 'End' ? maxWidth : e.key === 'Enter' ? defaultWidth : null
    if (next === null) return
    e.preventDefault()
    setWidth(clamp(next))
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDragging(true)
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging || !box.current) return
    setWidth(clamp(e.clientX - box.current.getBoundingClientRect().left))
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragging(false)
  }

  if (!wide) {
    return (
      <>
        <div className="split split--stacked">
          <section className="split__list" aria-label={listLabel}>
            {list}
          </section>
        </div>
        <Drawer open={detailOpen} onClose={onCloseDetail} label={detailLabel}>
          {detail}
        </Drawer>
      </>
    )
  }

  return (
    <div ref={box} className={`split${dragging ? ' is-dragging' : ''}`} style={{ '--split-list': `${width}px` } as CSSProperties}>
      <section id={listId} className="split__list" aria-label={listLabel}>
        {list}
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the list"
        aria-controls={listId}
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuetext={`${width} pixels wide`}
        tabIndex={0}
        className="split__bar"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setWidth(clamp(defaultWidth))}
      />
      <section className="split__detail" aria-label={detailLabel} tabIndex={0}>
        {detailOpen ? detail : (detailEmpty ?? <p className="split__empty">Pick one from the list to see it here.</p>)}
      </section>
    </div>
  )
}
