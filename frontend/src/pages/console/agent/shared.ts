import type { Access, AgentTab } from '../../../console/access'
import type { Membership } from '../../../auth/types'
import type { AgentDetail, AgentSpec, AgentTool, KnowledgeSource, ModelCatalogue, PhoneNumber, Voice } from '../../../console/types'
import type { StepErrors } from '../builder/StepShared'

export const TAB_ORDER: AgentTab[] = ['flow', 'behaviour', 'pipeline', 'knowledge', 'tools', 'rules', 'analysis', 'test', 'versions', 'settings']

export const TAB_LABEL: Record<AgentTab, string> = {
  flow: 'Flow',
  behaviour: 'Behaviour and voice',
  pipeline: 'Voice pipeline',
  knowledge: 'Knowledge',
  tools: 'Tools',
  rules: 'Handoff and guardrails',
  analysis: 'After each call',
  test: 'Test',
  versions: 'Versions',
  settings: 'Settings',
}

/** Tabs whose setup is bitNtech's: a hospital reads them and asks for changes. */
export const STRUCTURE_TABS: ReadonlySet<AgentTab> = new Set(['flow', 'pipeline', 'tools'])

/** The organisation's library, loaded once for every tab. */
export interface Library {
  voices: Voice[]
  tools: AgentTool[]
  knowledge: KnowledgeSource[]
  numbers: PhoneNumber[]
  models: ModelCatalogue
}

/** What every workspace tab gets. */
export interface TabProps {
  org: Membership
  /** What the person may do (console/access.ts). */
  access: Access
  /** `/o/:slug`, or `/ops/orgs/:slug` from Ops. */
  base: string
  detail: AgentDetail
  /** The setup being edited: the live version plus unpublished changes. */
  spec: AgentSpec
  /** Every edit goes through here, so it's saved. */
  update(change: (s: AgentSpec) => AgentSpec): void
  /** Look only: this person can't change this tab. */
  readOnly: boolean
  /** This tab's problems, shown once publishing was tried. */
  errors: StepErrors
  lib: Library
}
