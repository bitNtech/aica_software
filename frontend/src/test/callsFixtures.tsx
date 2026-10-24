import { useLocation, useNavigate } from 'react-router'
import { createDemoConsoleClient } from '../console/demoClient'
import type { CallLogPage, CallRecord, CallSummary, ConsoleClient, DetectedFlowPattern } from '../console/types'
import { renderApp, signIn } from './renderApp'

export const O = '/o/arogya-demo'
export const ORG = 'arogya-demo'

/** The demo with no delay and nothing kept between tests. */
export const demo = () => createDemoConsoleClient({ latency: 0, persist: false })

/** Shows the address, and goes back and forward, so a test can see what the page put there. */
export function Probe() {
  const loc = useLocation()
  const go = useNavigate()
  return (
    <div>
      <output data-testid="loc">{loc.pathname + loc.search}</output>
      <button type="button" onClick={() => go(-1)}>
        probe back
      </button>
      <button type="button" onClick={() => go(1)}>
        probe forward
      </button>
    </div>
  )
}

/** The address now, as { path, params }. */
export function address(screen: { getByTestId(id: string): HTMLElement }) {
  const text = screen.getByTestId('loc').textContent ?? ''
  const [path, search = ''] = text.split('?')
  return { path, params: new URLSearchParams(search) }
}

export async function open(email: string, path: string, consoleClient: ConsoleClient = demo()) {
  const view = renderApp(path, { consoleClient, probe: <Probe /> })
  await signIn(view.user, email)
  return { ...view, client: consoleClient }
}

/** The demo's calls for the last week, newest first. */
export async function loadCalls(client: ConsoleClient, over: { days?: 1 | 7 | 30 | 90; limit?: number } = {}): Promise<CallLogPage> {
  return client.listCallLog(ORG, { days: over.days ?? 7, limit: over.limit ?? 50 })
}

/** The first call the demo has with this outcome, as the list and in full. */
export async function callWith(client: ConsoleClient, outcome: CallSummary['outcome']): Promise<{ summary: CallSummary; record: CallRecord }> {
  const page = await loadCalls(client)
  const summary = page.calls.find((c) => c.outcome === outcome)
  if (!summary) throw new Error(`The demo has no ${outcome} call in the last week.`)
  return { summary, record: await client.getCallRecord(ORG, summary.id) }
}

/** The first call the demo has for this intent (its path starts with it, and the agent's designed flow has it). */
export async function callFor(client: ConsoleClient, intent: string, outcome?: CallSummary['outcome']): Promise<{ summary: CallSummary; record: CallRecord }> {
  const page = await loadCalls(client)
  const summary = page.calls.find((c) => c.intent === intent && (!outcome || c.outcome === outcome))
  if (!summary) throw new Error(`The demo has no “${intent}” call in the last week.`)
  return { summary, record: await client.getCallRecord(ORG, summary.id) }
}

/** A pattern whose calls are real ones from the demo: their own path, plus a step the design doesn't have. */
export async function patternFor(client: ConsoleClient, summary: CallSummary, record: CallRecord, extra = 'Ask about insurance cover'): Promise<DetectedFlowPattern> {
  const page = await loadCalls(client)
  const same = page.calls.filter((c) => c.agentId === summary.agentId).slice(0, 3)
  return {
    id: 'fp_test',
    agentId: summary.agentId,
    agentName: summary.agentName,
    steps: [...record.path.slice(0, 2), extra],
    occurrences: same.length,
    windowSize: 5,
    callIds: same.map((c) => c.id),
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    summary: `${same.length} of the last 5 calls to ${summary.agentName} followed a step sequence that isn't part of its current design.`,
  }
}

/** The demo, with some calls changed. It keeps its own state: call through to `base`. */
export const withOverrides = (base: ConsoleClient, over: Partial<ConsoleClient>) => ({ ...base, ...over }) as ConsoleClient
