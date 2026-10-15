import { useId } from 'react'
import { Button } from '../../../../components/ui/Button'
import { TestChat } from '../../builder/TestChat'
import type { TabProps } from '../shared'

/** Try the agent: a text simulation now, a test call once the voice
 * servers are connected. */
export function TestTab({ detail, spec, lib, hasChanges }: TabProps & { hasChanges: boolean }) {
  const id = useId()
  return (
    <div className="ws__sections">
      <section className="step__section" aria-labelledby={`${id}-call`}>
        <h2 id={`${id}-call`} className="step__heading">
          Test call in your browser
        </h2>
        <div className="ws__unavailable">
          <p>Talk to the agent through your microphone, as a caller would. This needs AICA’s voice servers, which aren’t connected yet.</p>
          <Button variant="line" size="sm" className="btn--inactive" aria-disabled aria-describedby={`${id}-why`}>
            Start a test call
          </Button>
          <p className="field__hint" id={`${id}-why`}>
            Not available yet.
          </p>
        </div>
      </section>
      <section className="step__section" aria-labelledby={`${id}-text`}>
        <h2 id={`${id}-text`} className="step__heading">
          Type as the caller
        </h2>
        <p className="step__sub">
          {hasChanges
            ? `This tries your draft changes, not version ${detail.agent.version} that callers get.`
            : `This tries version ${detail.agent.version}, the one callers get.`}
        </p>
        <TestChat draft={spec} tools={lib.tools} knowledge={lib.knowledge} />
      </section>
    </div>
  )
}
