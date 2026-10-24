import { useEffect, useRef } from 'react'
import type { Appointment } from '../../../../console/types'
import { sourceOf } from './model'

/**
 * Tells the person when the agent sends in a request while the page is
 * open: `onNew` gets requests made since the page opened and not seen
 * before, newest first. Opening the page, or looking at other days, says
 * nothing about older ones.
 */
export function useNewRequests(rows: Appointment[] | null, onNew: (fresh: Appointment[]) => void) {
  const seen = useRef<Set<string> | null>(null)
  const since = useRef('')
  const latest = useRef(onNew)
  latest.current = onNew
  useEffect(() => {
    if (!rows) return
    const requests = rows.filter((a) => a.status === 'pending' && sourceOf(a) === 'ai_call')
    if (!seen.current) {
      seen.current = new Set(requests.map((a) => a.id))
      since.current = new Date().toISOString()
      return
    }
    const fresh = requests.filter((a) => !seen.current!.has(a.id) && a.createdAt >= since.current).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    for (const a of requests) seen.current.add(a.id)
    if (fresh.length) latest.current(fresh)
  }, [rows])
}
