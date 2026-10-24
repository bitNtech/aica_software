import { createContext, use, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal } from '../ui/Dialog'
import './Workspace.css'

export interface Shortcut {
  /** Said in the help list: "Take the next caller". */
  description: string
  run(e: KeyboardEvent): void
}

/** Keys as `KeyboardEvent.key` spells them: "j", "n", "/", "Escape". Case matters. */
export type ShortcutMap = Record<string, Shortcut>

interface Registration {
  id: number
  map: ShortcutMap
}

interface ShortcutsApi {
  register(map: ShortcutMap): () => void
  /** What the current page has registered, in order. */
  list(): { key: string; description: string }[]
  count: number
  openHelp(): void
}

const NOOP: ShortcutsApi = { register: () => () => {}, list: () => [], count: 0, openHelp: () => {} }
const ShortcutsContext = createContext<ShortcutsApi>(NOOP)

/** True when typing: a field, or anything editable, is where keys go. */
function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/**
 * Registers keyboard shortcuts for the page that calls it (and removes them
 * when it unmounts), so each page contributes its own and the "?" help lists
 * exactly those. Keys are ignored while typing in a field and when Ctrl, Alt
 * or Meta is held, so browser and screen-reader shortcuts keep working.
 *
 *   useShortcuts({ n: { description: 'New callback', run: openNew } })
 *
 * Pass a stable-ish object; the latest handlers are always the ones called.
 */
export function useShortcuts(map: ShortcutMap) {
  const { register } = use(ShortcutsContext)
  // Handlers change every render; the registration doesn't have to.
  const latest = useRef(map)
  latest.current = map
  const signature = Object.entries(map)
    .map(([k, v]) => `${k}:${v.description}`)
    .join('|')
  useEffect(() => {
    const proxy: ShortcutMap = {}
    for (const key of Object.keys(latest.current)) {
      proxy[key] = { description: latest.current[key].description, run: (e) => latest.current[key]?.run(e) }
    }
    return register(proxy)
  }, [register, signature])
}

/** Opens the "?" help from a button. */
export function useKeyboardHelp() {
  const { openHelp, count } = use(ShortcutsContext)
  return { open: openHelp, count }
}

/**
 * Listens for shortcut keys for the whole console, and for "?" to open the
 * help dialog listing what the current page registered. Mounted once, by
 * <ConsoleShell>.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [regs, setRegs] = useState<Registration[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const next = useRef(1)
  const live = useRef<Registration[]>([])
  live.current = regs
  const headingId = useId()

  const register = useCallback((map: ShortcutMap) => {
    const id = next.current++
    setRegs((all) => [...all, { id, map }])
    return () => setRegs((all) => all.filter((r) => r.id !== id))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target)) return
      // A dialog or drawer owns the keyboard while it is open.
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }
      // The newest registration wins a clash.
      for (const reg of [...live.current].reverse()) {
        const hit = reg.map[e.key]
        if (hit) {
          e.preventDefault()
          hit.run(e)
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const listed = useMemo(() => {
    const seen = new Set<string>()
    const out: { key: string; description: string }[] = []
    for (const reg of [...regs].reverse()) {
      for (const [key, s] of Object.entries(reg.map)) {
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ key, description: s.description })
        }
      }
    }
    return out.reverse()
  }, [regs])

  const api = useMemo<ShortcutsApi>(() => ({ register, list: () => listed, count: listed.length, openHelp: () => setHelpOpen(true) }), [register, listed])

  return (
    <ShortcutsContext value={api}>
      {children}
      <Modal open={helpOpen} title="Keyboard shortcuts" onClose={() => setHelpOpen(false)}>
        <h3 id={headingId} className="sr-only">
          Shortcuts on this page
        </h3>
        <dl className="keys" aria-labelledby={headingId}>
          {listed.map((s) => (
            <div key={s.key} className="keys__row">
              <dt>
                <kbd className="kbd">{s.key === ' ' ? 'Space' : s.key}</kbd>
              </dt>
              <dd>{s.description}</dd>
            </div>
          ))}
          <div className="keys__row">
            <dt>
              <kbd className="kbd">?</kbd>
            </dt>
            <dd>Show this list</dd>
          </div>
        </dl>
        {listed.length === 0 && <p className="keys__none">This page has no shortcuts of its own.</p>}
      </Modal>
    </ShortcutsContext>
  )
}
