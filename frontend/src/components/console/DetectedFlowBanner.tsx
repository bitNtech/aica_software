import type { DetectedFlowPattern } from '../../console/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'

/** Sits above the call list when the last few calls to an agent followed a
 * step sequence outside its designed flow. */
export function DetectedFlowBanner({ pattern, onView }: { pattern: DetectedFlowPattern; onView(): void }) {
  return (
    <Alert tone="info" title="New call flow pattern detected">
      <p>{pattern.summary}</p>
      <Button variant="line" size="sm" onClick={onView}>
        View flow
      </Button>
    </Alert>
  )
}
