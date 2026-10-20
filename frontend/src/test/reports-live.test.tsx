import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import { createHttpConsoleClient } from '../console/httpConsoleClient'
import type { ConsoleClient, Report } from '../console/types'
import { renderApp, signIn } from './renderApp'

afterEach(() => vi.unstubAllGlobals())

/** A report as the API sends it before the voice servers send quality. */
function bareReport(base: Report): Report {
  return {
    ...base,
    quality: { success: null, sentiment: null, firstWordMs: null, replyP50Ms: null, replyP95Ms: null, speechMs: null, languageMs: null, voiceMs: null, interruptionsPerCall: null },
    agents: base.agents.map((a) => ({ ...a, success: null, replyP50Ms: null })),
  }
}

describe('reports from the API', () => {
  it('shows a report without quality figures instead of breaking', async () => {
    const demo = createDemoConsoleClient({ latency: 0 })
    const client: ConsoleClient = { ...demo, getReport: async (o, q) => bareReport(await demo.getReport(o, q)) }
    const view = renderApp('/o/arogya-demo', { consoleClient: client })
    await signIn(view.user, 'owner@example.com')
    expect(await screen.findByText('Successful calls')).toBeInTheDocument()
    expect(screen.getAllByText('Not measured yet').length).toBeGreaterThan(0)
  })

  it('asks for the report and the CSV at the documented paths', async () => {
    const f = vi.fn().mockImplementation(async (url: string) =>
      url.includes('.csv') ? new Response('a,b\n', { status: 200, headers: { 'Content-Type': 'text/csv' } }) : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', f)
    const c = createHttpConsoleClient('', createDemoConsoleClient({ latency: 0 }), ['reports'])
    await c.getReport('arogya', { days: 30, agentId: 'ag_1' })
    const blob = await c.exportCallLog!('arogya', { days: 7 })
    expect(f.mock.calls[0][0]).toBe('/api/orgs/arogya/reports?days=30&agentId=ag_1')
    expect(f.mock.calls[1][0]).toBe('/api/orgs/arogya/reports/calls.csv?days=7')
    expect(f.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin' })
    expect(await blob.text()).toBe('a,b\n')
  })

  it('turns a refused export into the server’s message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'forbidden', message: "You don't have permission to download call lists." } }), { status: 403 })))
    const c = createHttpConsoleClient('', createDemoConsoleClient({ latency: 0 }), ['reports'])
    await expect(c.exportCallLog!('arogya', { days: 7 })).rejects.toMatchObject({ code: 'forbidden', message: "You don't have permission to download call lists." })
  })
})
