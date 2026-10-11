import { afterEach, describe, expect, it, vi } from 'vitest'
import { homeFor } from '../auth/AuthProvider'
import { createHttpAuthClient } from '../auth/httpClient'
import { AuthError } from '../auth/types'
import { apiBase } from '../lib/api'

function respond(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('createHttpAuthClient', () => {
  it('posts JSON to /api with the cookie and returns the session', async () => {
    const session = { user: { id: 'u1', name: 'A', email: 'a@x.in', memberships: [] }, remember: false, expiresAt: 'x' }
    const fetchMock = respond(200, session)
    vi.stubGlobal('fetch', fetchMock)
    const s = await createHttpAuthClient().signIn({ email: 'a@x.in', password: 'p', remember: false })
    expect(s).toEqual(session)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(JSON.parse(init.body)).toEqual({ email: 'a@x.in', password: 'p', remember: false })
  })

  it('turns the backend error shape into an AuthError, keeping retryAfter', async () => {
    vi.stubGlobal('fetch', respond(429, { error: { code: 'rate_limited', message: 'Too many attempts.', retryAfter: 900 } }))
    const err = await createHttpAuthClient().signIn({ email: 'a@x.in', password: 'p', remember: false }).catch((e) => e)
    expect(err).toBeInstanceOf(AuthError)
    expect(err).toMatchObject({ code: 'rate_limited', retryAfter: 900 })
  })

  it('treats a 401 on restore as signed out', async () => {
    vi.stubGlobal('fetch', respond(401, { error: { code: 'unauthenticated', message: 'Not signed in.' } }))
    await expect(createHttpAuthClient().restore()).resolves.toBeNull()
  })

  it('reports the backend being down as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(createHttpAuthClient().signOut()).rejects.toMatchObject({ code: 'network' })
    vi.stubGlobal('fetch', respond(502, '<html>Bad gateway</html>'))
    await expect(createHttpAuthClient().listOrgs()).rejects.toMatchObject({ code: 'network' })
  })

  it('sends the decline reason, and nothing for approve', async () => {
    const fetchMock = respond(204)
    vi.stubGlobal('fetch', fetchMock)
    const c = createHttpAuthClient()
    await c.reviewSignup('kaveri', 'decline', 'Not in our area yet, sorry.')
    await c.reviewSignup('kaveri', 'approve')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ops/signup-requests/kaveri/decline')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: 'Not in our area yet, sorry.' })
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined()
  })

  it('offers Google through the backend route', () => {
    expect(createHttpAuthClient().googleSignInUrl?.()).toBe('/api/auth/google/start')
  })

  it('calls a backend on its own host with the cookie', async () => {
    const fetchMock = respond(401, { error: { code: 'unauthenticated', message: 'Not signed in.' } })
    vi.stubGlobal('fetch', fetchMock)
    const c = createHttpAuthClient('https://api.aica.example')
    await c.restore()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.aica.example/api/auth/session')
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' })
    expect(c.googleSignInUrl?.()).toBe('https://api.aica.example/api/auth/google/start')
  })
})

describe('apiBase', () => {
  it('is same-origin when VITE_API_URL is unset or blank, and drops a trailing slash', () => {
    expect(apiBase({})).toBe('')
    expect(apiBase({ VITE_API_URL: '  ' })).toBe('')
    expect(apiBase({ VITE_API_URL: 'https://api.aica.example/' })).toBe('https://api.aica.example')
  })
})

describe('homeFor', () => {
  it('sends someone with no organisation (a new Google sign-in) to the business step', () => {
    expect(homeFor({ id: 'u', name: 'A', email: 'a@x.in', memberships: [] })).toBe('/signup/business')
  })
  it('still sends bitNtech accounts to /ops', () => {
    expect(homeFor({ id: 'u', name: 'A', email: 'a@x.in', platformRole: 'staff', memberships: [] })).toBe('/ops')
  })
})
