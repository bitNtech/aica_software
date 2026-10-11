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
