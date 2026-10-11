/**
 * Where the AICA backend lives. VITE_API_URL is its public origin when it is
 * deployed on its own host (e.g. https://api.aica.bitntech.in). Empty means
 * same origin: `npm run dev`, where Vite proxies /api to the local FastAPI.
 *
 * Cross-origin, the session cookie only travels with credentials: 'include',
 * and only because the two hosts share a site (SameSite=Lax) and the backend
 * lists this origin in ALLOWED_ORIGINS.
 */
export function apiBase(env: { VITE_API_URL?: string } = import.meta.env): string {
  return (env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')
}

export const apiUrl = (path: string, base = apiBase()) => `${base}${path}`

export const apiCredentials = (base = apiBase()): RequestCredentials => (base ? 'include' : 'same-origin')
