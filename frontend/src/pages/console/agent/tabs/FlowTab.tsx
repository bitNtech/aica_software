import { useId, useState } from 'react'
import { canOpen } from '../../../../console/access'
import type { FlowNode } from '../../../../console/types'
import { FlowEditor } from '../../builder/FlowEditor'
import { SeenInDialog } from '../../builder/SeenInDialog'
import { AttributesEditor } from '../../builder/steps/StepAttributes'
import { GlobalFlowsEditor } from '../../builder/steps/StepGlobal'
import { splitFlowErrors } from '../checks'
import type { TabProps } from '../shared'

/** Builder steps 3 to 5 together: the flow, the details it collects, and
 * what it does anywhere in a call. */
export function FlowTab({ org, spec, update, readOnly, errors }: TabProps) {
  const id = useId()
  const [seenIn, setSeenIn] = useState<FlowNode | null>(null)
  const e = splitFlowErrors(errors)
  // The calls behind the flow are Call uploads material: only for roles
  // that can open that page.
  const canSeeCalls = canOpen(org.role, 'uploads')
  return (
    <div className="ws__sections">
      <section className="step__section" aria-labelledby={`${id}-flow`}>
        <h2 id={`${id}-flow`} className="step__heading">
          Conversation flow
        </h2>
        {e.flow.flow && <p className="field__error">{e.flow.flow}</p>}
        <FlowEditor flow={spec.flow} onChange={(flow) => update((s) => ({ ...s, flow }))} errors={e.flow} readOnly={readOnly} onShowCalls={canSeeCalls ? setSeenIn : undefined} />
      </section>
      <section className="step__section" aria-labelledby={`${id}-attrs`}>
        <h2 id={`${id}-attrs`} className="step__heading">
          Details to collect
        </h2>
        <AttributesEditor attributes={spec.attributes} onChange={(attributes) => update((s) => ({ ...s, attributes }))} errors={e.attributes} readOnly={readOnly} />
      </section>
      <section className="step__section" aria-labelledby={`${id}-global`}>
        <h2 id={`${id}-global`} className="step__heading">
          Anywhere in a call
        </h2>
        <p className="step__sub">What the agent does whenever these happen, whatever it was in the middle of.</p>
        <GlobalFlowsEditor flows={spec.globalFlows} onChange={(globalFlows) => update((s) => ({ ...s, globalFlows }))} errors={e.globals} readOnly={readOnly} />
      </section>
      {canSeeCalls && <SeenInDialog orgSlug={org.orgSlug} node={seenIn} redact={spec.redact} onClose={() => setSeenIn(null)} />}
    </div>
  )
}
