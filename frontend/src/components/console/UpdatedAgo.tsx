import { useRelativeTime } from '../../lib/useNow'

/**
 * "Updated 3 s ago": a live line for ConsolePage's `status`, ticking from
 * the shared one-second clock. Not a live region (it would chatter); the
 * full time is in its tooltip. Before the first load it says so.
 */
export function UpdatedAgo({ at, label = 'Updated' }: { at: Date | number | string | null | undefined; label?: string }) {
  const rel = useRelativeTime(at)
  const full = at === null || at === undefined ? undefined : new Date(at).toLocaleString('en-IN')
  return (
    <span className="console__status-text num" title={full}>
      {rel ? `${label} ${rel}` : 'Not updated yet'}
    </span>
  )
}
