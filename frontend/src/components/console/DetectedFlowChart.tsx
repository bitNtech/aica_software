import { useMemo } from 'react'
import type { DetectedFlowPattern, FlowNode } from '../../console/types'
import { Button } from '../ui/Button'
import { compareSteps } from './flow/compare'
import { FlowCanvas, type FlowMark } from './flow/FlowCanvas'

/** The pattern's steps as a chain of FlowNodes. Ids are positions, so they
 * are stable for a pattern and can't clash with the designed flow's. */
const stepId = (i: number) => `detected-${i}`

export interface DetectedFlowChartProps {
  pattern: DetectedFlowPattern
  onRequestFlow(): void
  busy?: boolean
  /** The agent's designed flow. With it, each step is marked as in the
   * design or not (matched by label; see compare.ts). */
  designed?: FlowNode[]
  /** Calls that reached each step, by position, when the page has them (the
   * pattern itself only knows how many calls followed all of it). Shown as a
   * number on each step. */
  stepCounts?: number[]
  /** Position of the step where calls left the pattern, when known. */
  exitIndex?: number
}

/** The flat step sequence behind a DetectedFlowPattern, as a diagram you
 * can pan, zoom, search and walk with the keyboard (FlowCanvas), with the
 * templated summary and a way to ask bitNtech to build it. Presentational
 * only: the page wires `onRequestFlow` to the client. */
export function DetectedFlowChart({ pattern, onRequestFlow, busy, designed, stepCounts, exitIndex }: DetectedFlowChartProps) {
  const nodes = useMemo<FlowNode[]>(
    () => pattern.steps.map((label, i) => ({ id: stepId(i), kind: 'step', label, sourceCallIds: [], children: [] })),
    [pattern.steps],
  )

  const marks = useMemo(() => {
    if (!designed || designed.length === 0) return undefined
    const cmp = compareSteps(pattern.steps, designed)
    const out: Record<string, FlowMark> = {}
    for (const m of cmp.matches) out[stepId(m.index)] = { tone: 'info', text: 'In the designed flow' }
    for (const u of cmp.unmatched)
      out[stepId(u.index)] = u.elsewhereId
        ? { tone: 'warn', text: 'Under another intent', detail: 'This step is in the designed flow, but under a different intent.' }
        : { tone: 'warn', text: 'Not in the designed flow' }
    return out
  }, [designed, pattern.steps])

  const counts = useMemo(() => {
    if (!stepCounts) return undefined
    return Object.fromEntries(stepCounts.slice(0, pattern.steps.length).map((n, i) => [stepId(i), n]))
  }, [stepCounts, pattern.steps.length])

  return (
    <div className="detected-flow">
      <p className="detected-flow__summary">{pattern.summary}</p>
      <p className="detected-flow__count">
        Seen in {pattern.occurrences} of the last {pattern.windowSize} calls.
      </p>

      <FlowCanvas
        nodes={nodes}
        label="Detected flow diagram"
        sequence
        ordinals
        marks={marks}
        counts={counts}
        exitAt={exitIndex !== undefined && exitIndex >= 0 && exitIndex < pattern.steps.length ? stepId(exitIndex) : undefined}
        height="min(24rem, 55vh)"
        defaultDirection="TB"
        description="The steps are also listed below the diagram."
        emptyText="No steps were recorded for this pattern."
      />

      <details className="detected-flow__list">
        <summary>The steps as a list</summary>
        <ol>
          {pattern.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </details>

      <Button variant="orange" size="sm" busy={busy} busyLabel="Sending…" onClick={onRequestFlow}>
        Ask bitNtech to build this flow
      </Button>
    </div>
  )
}
