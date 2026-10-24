import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ToneIcon, type Tone } from './StatusPill'
import './Workspace.css'

export interface ToastInput {
  message: string
  /** Defaults to neutral. Danger is announced assertively. */
  tone?: Exclude<Tone, 'live'>
  /** One follow-up, typically "Undo". Runs once, then the toast goes. */
  action?: { label: string; onClick(): void }
  /** How long it stays; 6 s, or 10 s when it has an action. 0 keeps it until dismissed. */
  timeoutMs?: number
}

interface ToastItem extends ToastInput {
  id: number
}

interface ToastApi {
  /** Shows a toast and returns its id. */
  show(toast: ToastInput): number
  dismiss(id: number): void
}

const MAX_VISIBLE = 4

/** With no provider (a page outside the console frame) toasts do nothing. */
const NONE: ToastApi = { show: () => -1, dismiss: () => {} }
const ToastContext = createContext<ToastApi>(NONE)

/** `const toast = useToast(); toast.show({ message: 'Callback closed', action: { label: 'Undo', onClick: reopen } })` */
export function useToast(): ToastApi {
  return use(ToastContext)
}

/**
 * Brief messages that don't take over the page, bottom-right (full width at
 * the bottom of a phone). They sit in two always-present live regions, so
 * screen readers hear them: polite for most, assertive for danger. (They use
 * aria-live without a role, so an empty one isn't mistaken for a page's own
 * status or alert.) A toast stops its countdown while the pointer is over it
 * or focus is inside it, has its own Dismiss button, and Escape dismisses the
 * newest. Mounted once, by <ConsoleShell>.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), [])
  const show = useCallback((toast: ToastInput) => {
    const id = next.current++
    setItems((all) => [...all, { ...toast, id }].slice(-MAX_VISIBLE))
    return id
  }, [])
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])

  // Escape dismisses the newest, unless something else (a dialog, a drawer)
  // is using the key.
  const newest = items[items.length - 1]?.id
  useEffect(() => {
    if (newest === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return
      dismiss(newest)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [newest, dismiss])

  const polite = items.filter((t) => t.tone !== 'danger')
  const urgent = items.filter((t) => t.tone === 'danger')

  return (
    <ToastContext value={api}>
      {children}
      {/* In <body>, marked to stay active when a Drawer makes the page inert. */}
      {createPortal(
        <div className="toasts" data-keep-active>
          <div className="toasts__region" aria-live="polite">
            {polite.map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </div>
          <div className="toasts__region" aria-live="assertive" aria-atomic="false">
            {urgent.map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext>
  )
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss(id: number): void }) {
  const tone = toast.tone ?? 'neutral'
  const total = toast.timeoutMs ?? (toast.action ? 10_000 : 6_000)
  const [paused, setPaused] = useState(false)
  // Time left survives a pause: it counts down only while nobody is on the toast.
  const left = useRef(total)
  const startedAt = useRef(0)

  useEffect(() => {
    if (paused || total === 0) return
    startedAt.current = Date.now()
    const t = setTimeout(() => onDismiss(toast.id), left.current)
    return () => {
      clearTimeout(t)
      left.current = Math.max(0, left.current - (Date.now() - startedAt.current))
    }
  }, [paused, total, toast.id, onDismiss])

  return (
    <div
      className={`toast toast--${tone}`}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false)
      }}
    >
      <ToneIcon tone={tone} size={16} />
      <p className="toast__message">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.action?.onClick()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast__close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="m3 3 6 6M9 3 3 9" />
        </svg>
      </button>
    </div>
  )
}
