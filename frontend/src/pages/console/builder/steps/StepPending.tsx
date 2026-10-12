import { EmptyState } from '../../../../components/ui/EmptyState'
import type { StepProps } from '../StepShared'

/** Steps 3 to 7 before they're built: says so plainly. Replaced step by step. */
export function StepPending({ validator }: StepProps) {
  validator.current = () => ({})
  return (
    <EmptyState title="This step is being built">
      <p>Your draft is saved. You can come back to it from Agents.</p>
    </EmptyState>
  )
}
