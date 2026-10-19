import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import { createHttpConsoleClient, LIVE_SECTIONS } from '../console/httpConsoleClient'

function respond(status: number, body?: unknown) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(status === 204 || body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

afterEach(() => vi.unstubAllGlobals())

const client = (base = '') => createHttpConsoleClient(base, createDemoConsoleClient({ latency: 0 }))

/** The request fetch was called with: [url, method, parsed body]. */
function sent(fetchMock: ReturnType<typeof respond>, i = 0) {
  const [url, init] = fetchMock.mock.calls[i]
  return [url, init.method, init.body === undefined ? undefined : JSON.parse(init.body), init.credentials] as const
}

describe('createHttpConsoleClient', () => {
  it('calls the documented paths with the documented bodies', async () => {
    const m = { id: 'u1', name: 'A', email: 'a@x.in', role: 'viewer', permissions: null, lastActiveAt: null, status: 'active' }
    const cases: [() => Promise<unknown>, string, string, unknown][] = [
      [() => client().listMembers('arogya'), '/api/orgs/arogya/members', 'GET', undefined],
      [() => client().inviteMember('arogya', { email: ' a@x.in ', role: 'admin' }), '/api/orgs/arogya/members/invite', 'POST', { email: 'a@x.in', role: 'admin' }],
      [() => client().resendInvite('arogya', 'inv_1'), '/api/orgs/arogya/members/inv_1/resend', 'POST', undefined],
      [() => client().changeRole('arogya', 'u1', 'supervisor'), '/api/orgs/arogya/members/u1/role', 'POST', { role: 'supervisor' }],
      [() => client().setPermissions('arogya', 'u1', ['calls.take']), '/api/orgs/arogya/members/u1/permissions', 'POST', { permissions: ['calls.take'] }],
      [() => client().setPermissions('arogya', 'u1', null), '/api/orgs/arogya/members/u1/permissions', 'POST', { permissions: null }],
      [() => client().getOrgSettings('arogya'), '/api/orgs/arogya/settings', 'GET', undefined],
    ]
    for (const [call, url, method, body] of cases) {
      const f = respond(200, m)
      vi.stubGlobal('fetch', f)
      await call()
      const [u, me, b, cred] = sent(f)
      expect([u, me, b, cred]).toEqual([url, method, body, 'same-origin'])
    }
  })

  it('removes with a POST and resolves on 204', async () => {
    const f = respond(204)
    vi.stubGlobal('fetch', f)
    await expect(client().removeMember('arogya', 'u/1')).resolves.toBeUndefined()
    expect(sent(f)[0]).toBe('/api/orgs/arogya/members/u%2F1/remove')
  })

  it('sends only the settings fields', async () => {
    const f = respond(200, {})
    vi.stubGlobal('fetch', f)
    const input = { name: 'Arogya', city: 'Coimbatore', languages: ['tamil' as const], hours: [], closed: [], updatedAt: 'x', updatedBy: 'y' }
    await client().updateOrgSettings('arogya', input)
    expect(Object.keys(sent(f)[2])).toEqual(['name', 'city', 'languages', 'hours', 'closed'])
  })

  it('builds the activity query and pages with the cursor', async () => {
    const f = respond(200, { entries: [], nextBefore: null })
    vi.stubGlobal('fetch', f)
    await client().listActivity('arogya', {})
    await client().listActivity('arogya', { area: 'team', actorId: 'u 1', before: 'act_9' })
    expect(sent(f, 0)[0]).toBe('/api/orgs/arogya/activity')
    expect(sent(f, 1)[0]).toBe('/api/orgs/arogya/activity?area=team&actorId=u+1&before=act_9')
  })

  it('sends the cookie cross-origin to a separate API host', async () => {
    const f = respond(200, [])
    vi.stubGlobal('fetch', f)
    await client('https://api.example').listMembers('arogya')
    expect(sent(f)[0]).toBe('https://api.example/api/orgs/arogya/members')
    expect(sent(f)[3]).toBe('include')
  })

  it('passes the server’s message through as an AuthError', async () => {
    vi.stubGlobal('fetch', respond(409, { error: { code: 'invalid_input', message: 'The organisation needs at least one owner.' } }))
    const err = await client().changeRole('arogya', 'u1', 'admin').catch((e) => e)
    expect(err).toBeInstanceOf(AuthError)
    expect(err).toMatchObject({ code: 'invalid_input', message: 'The organisation needs at least one owner.' })
    vi.stubGlobal('fetch', respond(502, '<html>Bad gateway</html>'))
    await expect(client().listMembers('arogya')).rejects.toMatchObject({ code: 'network' })
  })

  it('serves the rest from the demo client, and says which sections are live', async () => {
    const f = respond(200, [])
    vi.stubGlobal('fetch', f)
    const c = client()
    expect(c.isDemo).toBe(true)
    expect(LIVE_SECTIONS.every((s) => c.isLive?.(s))).toBe(true)
    // Agents aren't built yet: no request, sample data.
    expect((await c.listAgents('arogya')).length).toBeGreaterThan(0)
    expect(f).not.toHaveBeenCalled()
  })
})
