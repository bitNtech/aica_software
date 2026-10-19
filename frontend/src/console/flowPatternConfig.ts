import type { Role } from '../auth/types'
import type { Access } from './access'

/** How many of an agent's most recent calls to check for a repeated,
 * undesigned flow. No simple per-agent save path exists yet without a
 * larger form-wiring effort, so this stays a shared default for now. */
export const FLOW_PATTERN_WINDOW = 5

/** Who sees detected-flow-pattern badges and banners. */
export const FLOW_PATTERN_ROLES: Role[] = ['owner', 'supervisor', 'front_desk']

export function canSeeFlowPatterns(access: Access): boolean {
  return !access.platform && FLOW_PATTERN_ROLES.includes(access.role)
}
