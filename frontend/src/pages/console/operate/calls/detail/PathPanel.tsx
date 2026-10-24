import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react'
import { FlowCanvas, type FlowCanvasHandle } from '../../../../../components/console/flow/FlowCanvas'
import { flatten } from '../../../../../components/console/flow/layout'
import { Skeleton } from '../../../../../components/console/Skeleton'
import type { CallRecord } from '../../../../../console/types'
import type { DesignedFlow } from '../useDesignedFlow'
import { Section } from './parts'
import { pathOnFlow } from './logic'

export interface PathPanelHandle {
  focusFlow(): void
}

interface Props {
  call: CallRecord
  designed: DesignedFlow
  /** The step of the call's path last jumped to (by position), for marking. */
  activeStep: number | null
  /** A step was picked, in the diagram or in the list: where it is in the path. */
  onStep(index: number): void
  /** A node of the designed flow was picked that the call never reached. */
  onOffPath(label: string): void
  ref?: Ref<PathPanelHandle>
}

/**
 * The call's route, drawn on the flow the agent was designed with: the
 * steps it took in heavy arrows and numbered, the rest receding, and where
 * the call left (handed over, hung up) flagged. Picking a step, in the
 * diagram or in the list under it, jumps to that moment in the
 * conversation. Without the designed flow (no permission, or none
 * published) the call's own steps are listed on their own.
 */
export function PathPanel({ call, designed, activeStep, onStep, onOffPath, ref }: Props) {
  const canvas = useRef<FlowCanvasHandle>(null)
  const list = useRef<HTMLOListElement>(null)
  const flow = designed.state === 'ready' ? designed.flow : null
  const on = useMemo(() => (flow ? pathOnFlow(call.path, flow, call.outcome) : null), [flow, call.path, call.outcome])

  useImperativeHandle(
    ref,
    () => ({
      focusFlow: () => {
        const first = on?.matches[0]
        if (flow && first) canvas.current?.focusNode(first.nodeId)
        else list.current?.querySelector<HTMLElement>('button')?.focus()
      },
    }),
    [flow, on],
  )

  // Open on the call, not the top-left of the flow: its intent may be off to one side.
  const firstOnPath = on?.matches[0]?.nodeId
  useEffect(() => {
    if (firstOnPath) canvas.current?.revealNode(firstOnPath)
  }, [firstOnPath])

  // Which designed node each step of the path is on, to find the step a picked node stands for.
  const nodeStep = useMemo(() => new Map((on?.matches ?? []).map((m) => [m.nodeId, m.index])), [on])
  const statusOf = (i: number) => (on ? (on.matches.some((m) => m.index === i) ? 'in' : 'out') : null)
  const exitIndex = on?.exitId ? on.matches.find((m) => m.nodeId === on.exitId)?.index : undefined
  const matched = on?.matches.length ?? 0

  return (
    <Section title="Path through the flow" className="cd-path">
      {designed.state === 'loading' && (
        <div role="status">
          <span className="sr-only">Reading the designed flow…</span>
          <Skeleton block height="9rem" />
        </div>
      )}
      {designed.state === 'unavailable' && <p className="row__meta">The designed flow isn’t available to draw this on, so the steps are listed on their own.</p>}
      {flow && on && (
        <>
          <p className="row__meta cd-path__lede">
            {matched === 0
              ? 'None of this call’s steps are in the designed flow.'
              : `${matched} of ${call.path.length} ${call.path.length === 1 ? 'step' : 'steps'} on the designed flow${on.exitText ? `. ${on.exitText}` : ''}.`}
          </p>
          <FlowCanvas
            ref={canvas}
            nodes={flow}
            label="This call’s path on the designed flow"
            description="The steps are also listed below the diagram. Picking a step jumps to roughly where it happened in the conversation."
            highlightPath={on.highlight}
            exitAt={on.exitId}
            selectedId={activeStep !== null ? (on.matches.find((m) => m.index === activeStep)?.nodeId ?? null) : null}
            onSelect={(id) => {
              const step = nodeStep.get(id)
              if (step !== undefined) onStep(step)
              else onOffPath(flatten(flow).find((n) => n.id === id)?.label ?? 'That step')
            }}
            height="min(22rem, 55vh)"
            defaultDirection="TB"
          />
        </>
      )}
      {call.path.length === 0 ? (
        <p className="row__meta">No steps were recorded.</p>
      ) : (
        <>
          {flow && <p className="row__meta cd-path__hint">The steps in order. Picking one jumps to about where it happened (the steps are placed along the conversation by order, so it is approximate).</p>}
          <ol ref={list} className="op-path cd-path__list">
            {call.path.map((step, i) => (
              <li key={step + i} className={activeStep === i ? 'is-active' : undefined}>
                <button type="button" className="cd-path__step" aria-current={activeStep === i ? 'step' : undefined} onClick={() => onStep(i)}>
                  {step}
                </button>
                {statusOf(i) === 'out' && <span className="cd-path__tag"> · not in the designed flow</span>}
                {exitIndex === i && on?.exitText && <span className="cd-path__tag cd-path__tag--exit"> · {on.exitText.toLowerCase()}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </Section>
  )
}
