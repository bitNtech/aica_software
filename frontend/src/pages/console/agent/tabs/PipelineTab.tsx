import { PipelineEditor, PipelineSummary } from '../../builder/PipelineEditor'
import type { TabProps } from '../shared'

/** How it listens and replies. The master admin's; others read it. */
export function PipelineTab({ spec, update, readOnly, errors, lib }: TabProps) {
  if (readOnly)
    return (
      <div className="ws__sections">
        <PipelineSummary pipeline={spec.pipeline} models={lib.models} />
      </div>
    )
  return (
    <div className="step ws__sections">
      <PipelineEditor pipeline={spec.pipeline} onChange={(pipeline) => update((s) => ({ ...s, pipeline }))} errors={errors} models={lib.models} />
    </div>
  )
}
