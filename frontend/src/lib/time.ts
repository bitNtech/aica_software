/** "under an hour", "5 hours", "2 days" — how long something has waited. */
export function waited(iso: string, now = Date.now()): string {
  const h = (now - Date.parse(iso)) / 36e5
  if (h < 1) return 'under an hour'
  if (h < 24) return `${Math.floor(h)} hour${Math.floor(h) === 1 ? '' : 's'}`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'}`
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const m = (now - Date.parse(iso)) / 6e4
  if (m < 1) return 'just now'
  if (m < 60) return `${Math.floor(m)} minute${Math.floor(m) === 1 ? '' : 's'} ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)} hour${Math.floor(h) === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : `on ${shortDate(iso)}`
}
