import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './Workspace.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Makes everything else on the page inert, except the drawer itself and
 * anything marked `data-keep-active` (the toast and alert regions, which
 * must stay reachable). Returns what undoes it. */
function inertRest(except: HTMLElement): () => void {
  const touched: HTMLElement[] = []
  for (const el of Array.from(document.body.children)) {
    if (!(el instanceof HTMLElement) || el === except || el.hasAttribute('data-keep-active') || el.inert) continue
    el.inert = true
    touched.push(el)
  }
  return () => touched.forEach((el) => (el.inert = false))
}

/**
 * A panel sliding in from the right over the page, for detail that has no
 * room beside the list. It is modal: focus moves into it and wraps at its
 * ends, the page behind is inert, Escape or the Close button or a click on
 * the dim area closes it, and focus returns to whatever opened it. Under
 * prefers-reduced-motion it simply appears. Used by <SplitView> on narrow
 * screens, and fine to use alone.
 */
export function Drawer({ open, onClose, label, children }: { open: boolean; onClose(): void; label: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open || !root.current) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const undoInert = inertRest(root.current)
    const html = document.documentElement
    const overflow = html.style.overflow
    html.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      undoInert()
      html.style.overflow = overflow
      // Back to whatever opened it, if it is still on the page.
      if (opener && opener.isConnected) opener.focus()
    }
  }, [open])

  if (!open) return null

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Marked handled, so a toast's own Escape doesn't also fire.
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="drawer" ref={root} onKeyDown={onKeyDown}>
      <div className="drawer__scrim" onClick={onClose} />
      <div ref={panel} className="drawer__panel" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
        <div className="drawer__head">
          <h2 id={`${id}-title`} className="drawer__title">
            {label}
          </h2>
          <button type="button" className="dialog__close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer__body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
