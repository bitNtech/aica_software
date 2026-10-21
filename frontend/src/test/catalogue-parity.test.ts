import { describe, expect, it } from 'vitest'
// @ts-ignore -- Vercel builds frontend/ on its own, without backend/, and the
// build typechecks tests too. Tests run (CI, locally) with the whole repo.
import shared from '../../../backend/app/catalogue.json'
import { defaultAnalysis, defaultPipeline } from '../console/demo/agentConfig'
import { seedTools } from '../console/demo/library'
import { defaultGuardrails, defaultSpeech } from '../console/demo/specs'
import { AGENT_TYPES, defaultBehaviour, VOICES } from '../console/demo/templates'

/**
 * The backend starts new agents from backend/app/catalogue.json; the demo
 * from the functions here. They must say the same, or an agent built on the
 * server differs from what the console shows and tests.
 */
const c = shared as unknown as Record<string, unknown> & { analysis: Record<string, unknown> }

describe('the agent catalogue matches the backend', () => {
  it('has the same agent types and voices', () => {
    expect(c.agentTypes).toEqual(AGENT_TYPES)
    expect(c.voices).toEqual(VOICES)
  })

  it('starts agents from the same defaults', () => {
    expect(c.behaviour).toEqual(defaultBehaviour('{orgName}'))
    expect(c.pipeline).toEqual(defaultPipeline())
    expect(c.speech).toEqual(defaultSpeech())
    expect(c.guardrails).toEqual(defaultGuardrails())
    expect(c.analysis.default).toEqual(defaultAnalysis(null))
    for (const s of ['appointments', 'reports', 'enquiries']) expect(c.analysis[s]).toEqual(defaultAnalysis(s))
  })

  it('has the same built-in tools', () => {
    expect(c.builtinTools).toEqual(seedTools().filter((t) => t.kind === 'builtin'))
  })
})
