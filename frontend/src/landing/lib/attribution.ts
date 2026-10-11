/**
 * The ad's tags, captured on landing and kept for the session, so a visitor
 * who reloads or scrolls around still submits the form with them.
 */
export const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const
const STORE = 'aica_attribution'

let cache: Record<string, string> | null = null

export function attribution(): Record<string, string> {
  if (cache) return cache
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.search)
  const fresh: Record<string, string> = {}
  for (const k of ATTR_KEYS) {
    const v = params.get(k)
    if (v) fresh[k] = v.slice(0, 200)
  }
  let stored: Record<string, string> = {}
  try {
    stored = JSON.parse(sessionStorage.getItem(STORE) || '{}')
  } catch {
    /* storage blocked */
  }
  cache = Object.keys(fresh).length ? fresh : stored
  try {
    sessionStorage.setItem(STORE, JSON.stringify(cache))
  } catch {
    /* storage blocked */
  }
  return cache
}
