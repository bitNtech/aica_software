import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { localDay } from '../lib/time'
import { can, canOpen, type Access, type PageKey } from './access'
import { useConsole } from './ConsoleProvider'
import { useOrg } from './useOrg'

/** How often the sidebar's counts are refreshed while the tab is in view. */
export const ATTENTION_POLL_MS = 15_000

/** What needs a person, counted. A source is `null` until it has loaded once
 * (or when this person can't see its page), and keeps its last value if a
 * refresh fails. */
export interface AttentionCounts {
  /** Callers waiting for a person. */
  waiting: number | null
  /** Open callbacks past their due time. */
  overdue: number | null
  /** Appointments in the next 7 days that need a check. */
  needsCheck: number | null
  /** Answers the agent got wrong, still open. */
  flags: number | null
}
type Source = keyof AttentionCounts

/**
 * Which sidebar item carries each count: one line to change when a count
 * moves to another page (the waiting callers are on Live calls, which holds
 * what used to be the handoff queue).
 */
export const ATTENTION_PAGE: Record<Source, PageKey> = {
  waiting: 'live',
  overdue: 'callbacks',
  needsCheck: 'appointments',
  flags: 'desk',
}

/** What a person must be allowed to do for a count to be fetched at all. */
const NEEDS: Record<Source, (a: Access) => boolean> = {
  // The waiting list is the handover queue, which the server only gives to
  // people who take calls; Live calls itself is open to people who only
  // watch, and they'd be refused.
  waiting: (a) => can(a, 'call.seeWaiting'),
  overdue: (a) => canOpen(a, 'callbacks'),
  needsCheck: (a) => canOpen(a, 'appointments'),
  flags: (a) => canOpen(a, 'desk'),
}

export interface Badge {
  count: number
  tone: 'attention' | 'danger'
  /** For screen readers: "3 overdue". */
  text: string
}

interface AttentionApi {
  counts: AttentionCounts
  /** Whether any waiting caller is an emergency. */
  emergency: boolean
  /** What to show beside a sidebar item, if anything. */
  badgeFor(page: PageKey): Badge | null
  /** Poll now, e.g. after taking a call. */
  refresh(): void
}

const EMPTY: AttentionCounts = { waiting: null, overdue: null, needsCheck: null, flags: null }
const AttentionContext = createContext<AttentionApi | null>(null)

/** The counts, or null on a page outside the console frame (Ops). */
export function useAttention(): AttentionApi | null {
  return use(AttentionContext)
}

const WORDS: Record<Source, (n: number, emergency: boolean) => string> = {
  waiting: (n, emergency) => `${n} waiting${emergency ? ', including an emergency' : ''}`,
  overdue: (n) => `${n} overdue`,
  needsCheck: (n) => `${n} to check`,
  flags: (n) => `${n} flagged`,
}

/**
 * One shared poll for the sidebar's counts (instead of each page and badge
 * fetching on its own): every 15 seconds while the tab is visible, and at
 * once when the window regains focus. It only asks for what this person can
 * open, uses the ordinary client methods, and fails silently, keeping the
 * last counts. A new emergency among the waiting callers is announced once,
 * assertively, to screen readers.
 */
export function AttentionProvider({ children }: { children: ReactNode }) {
  const client = useConsole()
  const { org, access } = useOrg()
  const [counts, setCounts] = useState<AttentionCounts>(EMPTY)
  const [emergency, setEmergency] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const announced = useRef(new Set<string>())
  const running = useRef(false)
  const pollNow = useRef<() => void>(() => {})

  const wants = (Object.keys(NEEDS) as Source[]).filter((s) => NEEDS[s](access))
  const wantKey = wants.join(',')

  useEffect(() => {
    const slug = org.orgSlug
    const sources = wantKey ? (wantKey.split(',') as Source[]) : []
    let alive = true
    // A different organisation or role starts from nothing.
    setCounts(EMPTY)
    setEmergency(false)
    announced.current = new Set()
    if (sources.length === 0) return

    const set = (patch: Partial<AttentionCounts>) => {
      if (alive) setCounts((c) => ({ ...c, ...patch }))
    }
    const fetchers: Record<Source, () => Promise<void>> = {
      waiting: () =>
        client.listHandoffs(slug).then((all) => {
          const waiting = all.filter((h) => h.status === 'waiting')
          const urgent = waiting.filter((h) => h.emergency)
          if (!alive) return
          set({ waiting: waiting.length })
          setEmergency(urgent.length > 0)
          const fresh = urgent.filter((h) => !announced.current.has(h.id))
          fresh.forEach((h) => announced.current.add(h.id))
          if (fresh.length > 0) {
            setAnnouncement(`Emergency: ${fresh.length === 1 ? 'a caller is' : `${fresh.length} callers are`} waiting for a person. ${waiting.length} waiting in all.`)
          }
        }),
      overdue: () =>
        client.listCallbacks(slug).then((all) => {
          const now = Date.now()
          set({ overdue: all.filter((c) => c.status === 'open' && Date.parse(c.dueBy) < now).length })
        }),
      needsCheck: () =>
        client.listAppointments(slug, localDay(0), localDay(7)).then((all) => set({ needsCheck: all.filter((a) => a.status === 'needs_check').length })),
      flags: () => client.getDesk(slug).then((desk) => set({ flags: desk.flags.filter((f) => f.status === 'open').length })),
    }

    const poll = async () => {
      if (running.current || document.hidden) return
      running.current = true
      // Each source on its own: one failing must not hide the others.
      await Promise.allSettled(sources.map((s) => fetchers[s]()))
      running.current = false
    }
    pollNow.current = () => void poll()

    void poll()
    const timer = setInterval(() => void poll(), ATTENTION_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void poll()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      running.current = false
      clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [client, org.orgSlug, wantKey])

  const refresh = useCallback(() => pollNow.current(), [])

  const api = useMemo<AttentionApi>(
    () => ({
      counts,
      emergency,
      refresh,
      badgeFor(page) {
        const source = (Object.keys(ATTENTION_PAGE) as Source[]).find((s) => ATTENTION_PAGE[s] === page)
        const n = source ? counts[source] : null
        if (!source || !n) return null
        const urgent = source === 'waiting' && emergency
        return { count: n, tone: urgent ? 'danger' : 'attention', text: WORDS[source](n, urgent) }
      },
    }),
    [counts, emergency, refresh],
  )

  return (
    <AttentionContext value={api}>
      {children}
      {/* Always present so a change is announced (aria-live without a role,
          so an empty one isn't mistaken for a page's own alert); in <body>
          and marked to stay active when a Drawer makes the page inert. */}
      {createPortal(
        <div className="sr-only" aria-live="assertive" aria-atomic="true" data-keep-active>
          {announcement}
        </div>,
        document.body,
      )}
    </AttentionContext>
  )
}
