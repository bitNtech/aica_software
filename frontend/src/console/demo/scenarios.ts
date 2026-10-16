import type { AgentSpec, AgentTool, KnowledgeSource, Scenario, ScenarioRun } from '../types'
import { SIM_START, simulate } from '../../pages/console/builder/simulate'

/**
 * Test scenarios: a scripted caller, and what the agent should do. Run
 * here against the same text simulation as the Test tab; the real runner
 * would call the agent on AICA's servers and check its replies the same way.
 */

const scenario = (id: string, name: string, callerSays: string[], expect: Scenario['expect']): Scenario => ({ id, name, callerSays, expect, lastRun: null })

const SEEDS: Record<string, Scenario[]> = {
  agt_appointments: [
    scenario('scn_book', 'Books a first visit', ['I want to book an appointment', 'Cardiology', 'First visit'], { intent: 'Book an appointment', mustSay: ['visit'], handover: false }),
    scenario('scn_person', 'Asks for a person straight away', ['Can I talk to a person please'], { intent: '', mustSay: [], handover: true }),
    scenario('scn_emergency', 'Chest pain goes to emergency', ['My father has chest pain'], { intent: '', mustSay: ['emergency'], handover: true }),
  ],
  agt_reception: [
    scenario('scn_timings', 'Sunday timings', ['What are the Sunday timings?'], { intent: 'Ask about timings and directions', mustSay: [], handover: false }),
    scenario('scn_billing', 'Insurance goes to billing', ['I have a question about my insurance claim'], { intent: '', mustSay: [], handover: null }),
  ],
  agt_reports: [scenario('scn_report', 'Report status needs the patient ID', ['Is my blood test report ready?'], { intent: 'Check if a report is ready', mustSay: ['patient id'], handover: false })],
}

export function seedScenarios(agentId: string): Scenario[] {
  return structuredClone(SEEDS[agentId] ?? [])
}

/** Plays the caller's lines to the agent and checks what it did. */
export function runScenario(s: Scenario, spec: AgentSpec, tools: AgentTool[], knowledge: KnowledgeSource[], version: number | null): ScenarioRun {
  let state = SIM_START
  const replies: string[] = []
  const intents: string[] = []
  let handedOver = false
  for (const line of s.callerSays) {
    const { reply, state: next } = simulate(spec, tools, knowledge, state, line)
    state = next
    replies.push(reply.text)
    if (reply.path[0]) intents.push(reply.path[0])
    if (reply.global === 'handoff' || reply.global === 'emergency') handedOver = true
  }
  const said = replies.join(' ').toLowerCase()
  const problems: string[] = []
  if (s.expect.intent && !intents.includes(s.expect.intent)) problems.push(`Didn’t reach “${s.expect.intent}”${intents.length ? `; it went to “${intents[0]}”` : ''}.`)
  for (const w of s.expect.mustSay) if (!said.includes(w.toLowerCase())) problems.push(`Never said “${w}”.`)
  if (s.expect.handover === true && !handedOver) problems.push('Didn’t hand over to a person.')
  if (s.expect.handover === false && handedOver) problems.push('Handed over when it shouldn’t have.')
  return { at: new Date().toISOString(), passed: problems.length === 0, problems, replies, version }
}
