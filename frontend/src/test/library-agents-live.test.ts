import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { createDemoConsoleClient } from '../console/demoClient'
import { createHttpConsoleClient } from '../console/httpConsoleClient'
import type { AgentDetail, AgentSpec } from '../console/types'

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const client = () => createHttpConsoleClient('', createDemoConsoleClient({ latency: 0 }), ['numbers', 'tools', 'knowledge', 'uploads', 'agents'])
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(([url, init]) => [url as string, (init as RequestInit | undefined)?.method ?? 'GET', (init as RequestInit | undefined)?.body])

describe('the library and agents over HTTP', () => {
  it('uses the documented paths', async () => {
    const f = vi.fn().mockImplementation(async () => json({}))
    vi.stubGlobal('fetch', f)
    const c = client()
    await c.listNumbers('o')
    await c.updateNumber('o', 'num_1', { agentId: null })
    await c.testTool('o', 'tool_1', { patient_id: 'P1' })
    await c.setCredential('o', 'HIS_KEY', 'secret')
    await c.deleteCredential('o', 'HIS_KEY')
    await c.searchKnowledge('o', ['kn_1'], 'When?')
    await c.listAgentTypes()
    await c.publishDraft('o', 'draft_1', null)
    expect(calls(f).map(([u, m]) => `${m} ${u}`)).toEqual([
      'GET /api/orgs/o/numbers',
      'POST /api/orgs/o/numbers/num_1',
      'POST /api/orgs/o/tools/tool_1/test',
      'POST /api/orgs/o/credentials',
      'POST /api/orgs/o/credentials/HIS_KEY/delete',
      'POST /api/orgs/o/knowledge/search',
      'GET /api/catalogue/agent-types',
      'POST /api/orgs/o/drafts/draft_1/publish',
    ])
    expect(JSON.parse(calls(f)[3][2] as string)).toEqual({ name: 'HIS_KEY', value: 'secret' })
  })

  it('sends a knowledge file straight to storage, then says it arrived', async () => {
    const f = vi.fn().mockImplementation(async (url: string) =>
      url === '/api/orgs/o/knowledge'
        ? json({ source: { id: 'kn_9' }, upload: { url: 'https://storage.example/x?signed=1', method: 'PUT', headers: { 'Content-Type': 'application/pdf' } } })
        : url.startsWith('https://storage') ? new Response(null, { status: 200 }) : json({ id: 'kn_9', status: 'indexing' }),
    )
    vi.stubGlobal('fetch', f)
    const file = new Blob(['%PDF'], { type: 'application/pdf' })
    const k = await client().addKnowledge('o', { kind: 'document', name: 'Rules', description: '', fileName: 'r.pdf', size: 4, file, expiresAt: null })
    const [first, upload, done] = calls(f)
    expect(JSON.parse(first[2] as string)).not.toHaveProperty('file')
    expect(upload.slice(0, 2)).toEqual(['https://storage.example/x?signed=1', 'PUT'])
    expect((f.mock.calls[1][1] as RequestInit).credentials).toBeUndefined() // no cookies to storage
    expect(done.slice(0, 2)).toEqual(['/api/orgs/o/knowledge/kn_9/uploaded', 'POST'])
    expect(k.status).toBe('indexing')
  })

  it('removes a recording whose upload failed, and says which', async () => {
    const f = vi.fn().mockImplementation(async (url: string) =>
      url === '/api/orgs/o/uploads' && f.mock.calls.length === 1
        ? json({ calls: [{ id: 'c1', name: 'a.mp3' }], uploads: [{ id: 'c1', url: 'https://storage.example/c1', method: 'PUT', headers: {} }] })
        : url.startsWith('https://storage') ? new Response(null, { status: 403 }) : json(null, 204),
    )
    vi.stubGlobal('fetch', f)
    const err = await client().addRecordings('o', [{ name: 'a.mp3', size: 3, type: 'audio/mpeg', file: new Blob(['abc']) }]).catch((e) => e)
    expect(err).toBeInstanceOf(AuthError)
    expect(err.message).toBe("We couldn't upload a.mp3. Add it again.")
    expect(calls(f).map(([u]) => u)).toContain('/api/orgs/o/uploads/c1/delete')
  })

  it('sends the revision each save was made from', async () => {
    const detail = (revision: number) => ({ agent: { id: 'agt_1' }, working: {}, versions: [], revision }) as unknown as AgentDetail
    let rev = 3
    const f = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? json(detail(++rev)) : json(detail(rev))))
    vi.stubGlobal('fetch', f)
    const c = client()
    await c.getAgent('o', 'agt_1')
    await c.saveAgent('o', 'agt_1', {} as AgentSpec)
    await c.saveAgent('o', 'agt_1', {} as AgentSpec)
    const sent = calls(f).filter(([, m]) => m === 'POST').map(([, , b]) => JSON.parse(b as string).revision)
    expect(sent).toEqual([3, 4])
  })

  it('says plainly what needs the AI pipeline', async () => {
    const c = client()
    await expect(c.runScenarios('o', 'agt_1')).rejects.toThrow(/needs the AI pipeline/)
    await expect(c.extractFlow('o', 'draft_1')).rejects.toThrow(/needs the AI pipeline/)
  })
})

describe('review follow-ups', () => {
  it('doesn’t take a revision from a rename, and sends it with publish', async () => {
    let rev = 3
    const f = vi.fn().mockImplementation(async (url: string) => json({ agent: { id: 'agt_1' }, working: {}, versions: [], revision: url.endsWith('/settings') ? 9 : rev }))
    vi.stubGlobal('fetch', f)
    const c = client()
    await c.getAgent('o', 'agt_1')
    await c.updateAgent('o', 'agt_1', { name: 'New name' })
    await c.publishAgent('o', 'agt_1', '')
    rev = 4
    const bodies = f.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'POST').map(([, i]) => JSON.parse((i as RequestInit).body as string))
    expect(bodies[1]).toEqual({ note: '', revision: 3 })
  })

  it('removes a knowledge source whose file didn’t upload', async () => {
    const f = vi.fn().mockImplementation(async (url: string) =>
      url === '/api/orgs/o/knowledge'
        ? json({ source: { id: 'kn_9' }, upload: { url: 'https://storage.example/x', method: 'PUT', headers: {} } })
        : url.startsWith('https://storage') ? new Response(null, { status: 500 }) : json(null, 204),
    )
    vi.stubGlobal('fetch', f)
    await expect(client().addKnowledge('o', { kind: 'document', name: 'Rules', description: '', fileName: 'r.pdf', size: 4, file: new Blob(['x']), expiresAt: null })).rejects.toThrow(/couldn't upload Rules/)
    expect(calls(f).map(([u]) => u)).toContain('/api/orgs/o/knowledge/kn_9/delete')
  })
})
