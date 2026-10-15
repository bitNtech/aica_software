import type { AgentTab } from '../../../console/access'
import type { Membership } from '../../../auth/types'
import type { AgentDetail, AgentSpec, AgentTool, KnowledgeSource, PhoneNumber, Voice } from '../../../console/types'
import type { StepErrors } from '../builder/StepShared'

export const TAB_ORDER: AgentTab[] = ['flow', 'behaviour', 'knowledge', 'tools', 'rules', 'test', 'versions', 'settings']

export const TAB_LABEL: Record<AgentTab, string> = {
  flow: 'Flow',
  behaviour: 'Behaviour and voice',
  knowledge: 'Knowledge',
  tools: 'Tools',
  rules: 'Handoff and guardrails',
  test: 'Test',
  versions: 'Versions',
  settings: 'Settings',
}

/** The organisation's library, loaded once for every tab. */
export interface Library {
  voices: Voice[]
  tools: AgentTool[]
  knowledge: KnowledgeSource[]
  numbers: PhoneNumber[]
}

/** What every workspace tab gets. */
export interface TabProps {
  org: Membership
  detail: AgentDetail
  /** The setup being edited: the live version plus unpublished changes. */
  spec: AgentSpec
  /** Every edit goes through here, so it's saved. */
  update(change: (s: AgentSpec) => AgentSpec): void
  /** Look only: this role can't change this tab. */
  readOnly: boolean
  /** This tab's problems, shown once publishing was tried. */
  errors: StepErrors
  lib: Library
}
