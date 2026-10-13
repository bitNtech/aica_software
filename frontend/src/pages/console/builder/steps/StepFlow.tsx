import { useCallback, useEffect, useRef, useState } from 'react'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { AgentDraft, FlowNode } from '../../../../console/types'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { ConfirmDialog } from '../../../../components/ui/Dialog'
import { Spinner } from '../../../../components/ui/Spinner'
import { FlowEditor } from '../FlowEditor'
import { SeenInDialog } from '../SeenInDialog'
import { checkFlow } from '../flowTree'
import { ErrorSummary, type StepErrors, type StepProps } from '../StepShared'

/** The flow, attributes, global flows and suggested knowledge and tools
 * that extraction fills in, taken from the server's copy of the draft. */
export const extracted = (x: AgentDraft) => (d: AgentDraft): AgentDraft => ({
  ...d,
  flow: x.flow,
  attributes: x.attributes,
  globalFlows: x.globalFlows,
  context: x.context,
  extraction: x.extraction,
})

/** Reads in progress, by draft: coming back to the step mid-read waits for
 * the same read instead of starting another. */
const reading = new Map<string, Promise<AgentDraft>>()

function readCalls(start: () => Promise<AgentDraft>, draftId: string): Promise<AgentDraft> {
  let p = reading.get(draftId)
  if (!p) {
    p = start().finally(() => reading.delete(draftId))
    reading.set(draftId, p)
  }
  return p
}

/** The calls or the job changed since the flow was read. */
export function flowIsStale(d: AgentDraft): boolean {
  const x = d.extraction
  if (!x) return false
  const same = x.callIds.length === d.sourceCallIds.length && x.callIds.every((id) => d.sourceCallIds.includes(id))
  return !same || x.subTypeId !== d.subTypeId
}

export function checkFlowStep(flow: FlowNode[]): StepErrors {
  if (flow.length === 0) return { flow: 'Add at least one intent: a conversation the agent should handle.' }
  return checkFlow(flow)
}

/** Step 3: the conversations found in the calls, as an editable outline. */
export function StepFlow({ draft, org, update, showErrors, attempt, validator }: StepProps) {
  const client = useConsole()
  const [phase, setPhase] = useState<'idle' | 'busy' | 'error'>('idle')
  const [error, setError] = useState<unknown>(null)
  const [confirmAgain, setConfirmAgain] = useState(false)
  const [seenIn, setSeenIn] = useState<FlowNode | null>(null)
  const started = useRef(false)
  const mounted = useRef(true)
  /** Reading failed and the person chose to write the flow themselves. */
  const [byHand, setByHand] = useState(false)
  /** Bumped after each read, so the outline starts fresh (no stale undo). */
  const [reads, setReads] = useState(0)
  /** Announced when a re-read finishes. */
  const [done, setDone] = useState('')
  /** After a requested re-read, focus goes to the flow's summary line. */
  const focusSummary = useRef(false)

  const extract = useCallback(async () => {
    setPhase('busy')
    setError(null)
    setDone('')
    try {
      const x = await readCalls(() => client.extractFlow(org.orgSlug, draft.id), draft.id)
      // Left the step meanwhile: the builder still takes the result.
      update(extracted(x))
      if (!mounted.current) return
      setPhase('idle')
      setReads((n) => n + 1)
      setDone(`Flow updated: ${x.flow.length} ${x.flow.length === 1 ? 'intent' : 'intents'}.`)
    } catch (err) {
      if (!mounted.current) return
      setError(err)
      setPhase('error')
    }
  }, [client, org.orgSlug, draft.id, update])

  useEffect(() => {
    if (phase === 'busy' || !focusSummary.current) return
    focusSummary.current = false
    document.getElementById('flow-summary')?.focus()
  }, [phase, reads])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // First visit: read the calls straight away. Once read, reading again is
  // only on request, even if every intent has been deleted since.
  useEffect(() => {
    if (started.current || draft.extraction || draft.flow.length > 0) return
    started.current = true
    void extract()
  }, [draft.extraction, draft.flow.length, extract])

  const check = () => (phase === 'busy' ? { flow: 'Wait for AICA to finish reading your calls.' } : checkFlowStep(draft.flow))
  validator.current = check
  const errors = showErrors ? check() : {}

  // Only the first read takes over the step; a re-read keeps the outline
  // (and the focused button) in place and reports progress below.
  if (phase === 'busy' && draft.flow.length === 0) {
    return (
      <div className="extracting" role="status">
        <Spinner />
        <div>
          <p className="extracting__title">Reading your {draft.sourceCallIds.length} calls…</p>
          <p className="extracting__text">Finding what callers ask, how your team answers, and what details they collect.</p>
        </div>
      </div>
    )
  }

  if (phase === 'error' && draft.flow.length === 0 && !byHand) {
    return (
      <Alert tone="error" title="Couldn't read your calls">
        <p>{asAuthError(error).message}</p>
        <p className="builder__alert-actions">
          <button type="button" className="btn-text" onClick={() => void extract()}>
            Try again
          </button>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              setByHand(true)
              setPhase('idle')
            }}
          >
            Write the flow yourself
          </button>
        </p>
      </Alert>
    )
  }

  return (
    <div className="step">
      <ErrorSummary errors={errors} attempt={attempt} hrefFor={(key) => (key === 'flow' ? undefined : `#node-${key}`)} />

      <div className="step__head-row">
        <p className="step__sub step__sub--flat">
          Confidence shows how sure AICA is that it read a conversation right. Check anything below 70% against the calls it came from.
        </p>
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus. */}
        <Button variant="line" size="sm" aria-disabled={phase === 'busy' || undefined} onClick={() => phase !== 'busy' && setConfirmAgain(true)}>
          {phase === 'busy' ? 'Reading…' : 'Read the calls again'}
        </Button>
      </div>

      {/* Always present, so the change is announced. */}
      <p className="sr-only" role="status">
        {phase === 'busy' ? `Reading your ${draft.sourceCallIds.length} calls…` : done}
      </p>

      {flowIsStale(draft) && phase !== 'busy' && (
        <Alert tone="warn" title="Your calls or the agent’s job changed">
          <p>This flow was read before you changed them. Read the calls again to update it, or keep it as it is.</p>
        </Alert>
      )}

      {phase === 'error' && (
        <Alert tone="error" title="Couldn't read your calls again">
          <p>{asAuthError(error).message} Your flow is unchanged.</p>
        </Alert>
      )}

      <FlowEditor
        key={reads}
        summaryId="flow-summary"
        flow={draft.flow}
        onChange={(flow) => update((d) => ({ ...d, flow }))}
        errors={showErrors ? errors : {}}
        onShowCalls={setSeenIn}
      />

      <ConfirmDialog
        open={confirmAgain}
        title="Read the calls again?"
        confirmLabel="Read again"
        danger
        onConfirm={() => {
          setConfirmAgain(false)
          focusSummary.current = true
          void extract()
        }}
        onCancel={() => setConfirmAgain(false)}
      >
        <p>AICA starts the flow, details to collect and global flows afresh from your calls. Changes you made to them here are lost.</p>
      </ConfirmDialog>

      <SeenInDialog orgSlug={org.orgSlug} node={seenIn} redact={draft.redact} onClose={() => setSeenIn(null)} />
    </div>
  )
}
