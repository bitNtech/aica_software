import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import { ALL_LIVE_SECTIONS, createHttpConsoleClient, DEFAULT_LIVE_SECTIONS, liveSections } from '../console/httpConsoleClient'
import { flowRequestDetail } from '../console/flowRequest'

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

const client = (base = '', sections = ALL_LIVE_SECTIONS) => createHttpConsoleClient(base, createDemoConsoleClient({ latency: 0 }), sections)

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
    expect(ALL_LIVE_SECTIONS.every((s) => c.isLive?.(s))).toBe(true)
    // The model catalogue is the pipeline's: no request, sample data.
    expect(await c.listModels()).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('calls the Phase 2 and 3 paths', async () => {
    const cases: [() => Promise<unknown>, string, string, unknown][] = [
      [() => client().listChangeRequests('arogya'), '/api/orgs/arogya/requests', 'GET', undefined],
      [() => client().requestNumber('arogya', 'For the branch'), '/api/orgs/arogya/requests/number', 'POST', { note: 'For the branch' }],
      [() => client().replyChangeRequest('arogya', 'cr_1', 'Any news?'), '/api/orgs/arogya/requests/cr_1/reply', 'POST', { text: 'Any news?' }],
      [() => client().withdrawChangeRequest('arogya', 'cr_1'), '/api/orgs/arogya/requests/cr_1/withdraw', 'POST', undefined],
      [() => client().updateChangeRequest('arogya', 'cr_1', { status: 'done', reply: 'Done.' }), '/api/orgs/arogya/requests/cr_1/update', 'POST', { status: 'done', reply: 'Done.' }],
      [() => client().listAllChangeRequests!(), '/api/ops/change-requests', 'GET', undefined],
      [() => client().listCallLog('arogya', { days: 7, outcome: 'booked', q: 'opd', limit: 50 }), '/api/orgs/arogya/calls?days=7&outcome=booked&q=opd&limit=50', 'GET', undefined],
      [() => client().getCallRecord('arogya', 'call_1'), '/api/orgs/arogya/calls/call_1', 'GET', undefined],
      [() => client().addCallNote('arogya', 'call_1', 'Hi'), '/api/orgs/arogya/calls/call_1/notes', 'POST', { text: 'Hi' }],
      [() => client().listCallbacks('arogya'), '/api/orgs/arogya/callbacks', 'GET', undefined],
      [() => client().updateCallback('arogya', 'cb_1', { assignedTo: null }), '/api/orgs/arogya/callbacks/cb_1', 'POST', { assignedTo: null }],
      [() => client().listAppointments('arogya', '2026-10-17', '2026-10-26'), '/api/orgs/arogya/appointments?from=2026-10-17&to=2026-10-26', 'GET', undefined],
      [() => client().updateAppointment('arogya', 'apt_1', { status: 'confirmed' }), '/api/orgs/arogya/appointments/apt_1', 'POST', { status: 'confirmed' }],
      [() => client().listHandoffs('arogya'), '/api/orgs/arogya/handoffs', 'GET', undefined],
      [() => client().takeHandoff('arogya', 'ho_1'), '/api/orgs/arogya/handoffs/ho_1/take', 'POST', undefined],
      [() => client().handoffToCallback('arogya', 'ho_1'), '/api/orgs/arogya/handoffs/ho_1/to-callback', 'POST', undefined],
    ]
    for (const [call, url, method, body] of cases) {
      const f = respond(200, url.includes('/appointments?') ? [] : {})
      vi.stubGlobal('fetch', f)
      await call()
      expect(sent(f).slice(0, 3)).toEqual([url, method, body])
    }
  })

  it('sends the agent’s name with a request, from the agents the console shows', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    const agent = (await demo.listAgents('arogya-demo'))[0]
    const f = respond(200, {})
    vi.stubGlobal('fetch', f)
    await createHttpConsoleClient('', demo, ['requests']).createChangeRequest('arogya-demo', { kind: 'flow_change', agentId: agent.id, title: 'Change it', detail: 'Please change the flow.', urgency: 'normal' })
    expect(sent(f)[2]).toMatchObject({ agentId: agent.id, agentName: agent.name })
  })

  it('keeps sections it isn’t told about on sample data', async () => {
    const f = respond(200, [])
    vi.stubGlobal('fetch', f)
    const c = client('', DEFAULT_LIVE_SECTIONS)
    expect(c.isLive?.('calls')).toBe(false)
    expect(c.isLive?.('requests')).toBe(true)
    await c.listCallbacks('arogya-demo')
    expect(f).not.toHaveBeenCalled()
  })

  it('reads the live sections from the environment, ignoring unknown names', () => {
    expect(liveSections(undefined)).toEqual([...DEFAULT_LIVE_SECTIONS])
    expect(liveSections(' team, calls ,billing,  ')).toEqual(['team', 'calls'])
  })

  it('keeps a detected-pattern request inside the 2,000-character limit', () => {
    const pattern = { agentId: 'a', agentName: 'Main', occurrences: 40, windowSize: 50, steps: ['Greet', 'Ask'], callIds: Array.from({ length: 400 }, (_, i) => `call_20000_${i}`) }
    const text = flowRequestDetail(pattern as never)
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text).toMatch(/and \d+ more$/)
    expect(flowRequestDetail({ ...pattern, callIds: ['c1'] } as never)).toMatch(/Calls: c1$/)
  })
})
