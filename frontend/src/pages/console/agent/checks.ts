import type { AgentTab } from '../../../console/access'
import type { AgentSpec, AgentTool, Guardrails, Voice } from '../../../console/types'
import type { StepErrors } from '../builder/StepShared'
import { checkAttributes } from '../builder/steps/StepAttributes'
import { checkBehaviour } from '../builder/steps/StepBehaviour'
import { checkContext } from '../builder/steps/StepContext'
import { checkFlowStep } from '../builder/steps/StepFlow'
import { checkGlobalFlows } from '../builder/steps/StepGlobal'
import { checkPipeline } from '../builder/PipelineEditor'
import { checkAnalysis } from './tabs/AnalysisTab'

export function checkGuardrails(g: Guardrails): StepErrors {
  const e: StepErrors = {}
  if (!g.transferTo.trim()) e.transferTo = 'Say where handovers go, e.g. “Front desk, extension 100”.'
  if (!g.emergencyTo.trim()) e.emergencyTo = 'Say where emergencies go.'
  if (g.recordingNotice && !g.recordingNoticeText.trim()) e.recordingNoticeText = 'Write the recording notice callers hear.'
  return e
}

/** What stops publishing, by workspace tab. Ids from different checks are
 * kept apart by prefix, so two "no name" problems don't collide. */
export function specProblems(spec: AgentSpec, voices: Voice[], tools: AgentTool[]): Partial<Record<AgentTab, StepErrors>> {
  const prefix = (p: string, e: StepErrors) => Object.fromEntries(Object.entries(e).map(([k, v]) => [`${p}${k}`, v]))
  const context = checkContext(spec.context, spec.globalFlows, tools)
  const out: Partial<Record<AgentTab, StepErrors>> = {
    behaviour: checkBehaviour(spec.behaviour, voices.find((v) => v.id === spec.behaviour.voiceId)),
    flow: { ...checkFlowStep(spec.flow), ...prefix('attr:', checkAttributes(spec.attributes)), ...prefix('global:', checkGlobalFlows(spec.globalFlows)) },
    knowledge: context.knowledge ? { knowledge: context.knowledge } : {},
    tools: context.tools ? { tools: context.tools } : {},
    rules: checkGuardrails(spec.guardrails),
    pipeline: checkPipeline(spec.pipeline),
    analysis: checkAnalysis(spec.analysis),
  }
  for (const k of Object.keys(out) as AgentTab[]) if (Object.keys(out[k]!).length === 0) delete out[k]
  return out
}

/** Problem errors split back into what each editor on the Flow tab expects. */
export function splitFlowErrors(e: StepErrors): { flow: StepErrors; attributes: StepErrors; globals: StepErrors } {
  const pick = (p: string) => Object.fromEntries(Object.entries(e).filter(([k]) => k.startsWith(p)).map(([k, v]) => [k.slice(p.length), v]))
  return {
    flow: Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('attr:') && !k.startsWith('global:'))),
    attributes: pick('attr:'),
    globals: pick('global:'),
  }
}
