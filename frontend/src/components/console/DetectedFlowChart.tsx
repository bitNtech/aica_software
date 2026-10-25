import { useMemo } from 'react'
import type { DetectedFlowPattern, FlowNode } from '../../console/types'
import { Button } from '../ui/Button'
import { compareSteps, graftPattern } from './flow/compare'
import { FlowCanvas, type FlowMark } from './flow/FlowCanvas'

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

/** A DetectedFlowPattern drawn on the agent's designed flow, as a tree you
 * can pan, zoom, search and walk with the keyboard (FlowCanvas): the steps
 * the design has are followed down its intent, and where the calls went
 * their own way a new branch holds the rest. Without a design, the pattern
 * is drawn as a path. With the templated summary and a way to ask bitNtech
 * to build it. Presentational only: the page wires `onRequestFlow` to the
 * client. */
export function DetectedFlowChart({ pattern, onRequestFlow, busy, designed, stepCounts, exitIndex }: DetectedFlowChartProps) {
  const graft = useMemo(
    () => graftPattern(pattern.steps, designed ?? [], `${pattern.occurrences} of the last ${pattern.windowSize} calls went this way`),
    [pattern.steps, pattern.occurrences, pattern.windowSize, designed],
  )
  const stepId = (i: number) => graft.stepIds[i]

  const marks = useMemo(() => {
    if (!designed || designed.length === 0) return undefined
    const cmp = compareSteps(pattern.steps, designed)
    const designedIds = new Set(cmp.matches.map((m) => m.index))
    const out: Record<string, FlowMark> = {}
    pattern.steps.forEach((_, i) => {
      const id = graft.stepIds[i]
      if (!id) return
      if (!id.startsWith('detected-')) out[id] = { tone: 'info', text: 'In the designed flow' }
      else if (designedIds.has(i) || cmp.unmatched.some((u) => u.index === i && u.elsewhereId))
        out[id] = { tone: 'warn', text: 'Elsewhere in the design', detail: 'A step with this name is in the designed flow, but not at this point of the call.' }
      else out[id] = { tone: 'warn', text: 'Not in the designed flow' }
    })
    return out
  }, [designed, pattern.steps, graft])

  const counts = useMemo(() => {
    if (!stepCounts) return undefined
    return Object.fromEntries(stepCounts.slice(0, pattern.steps.length).map((n, i) => [graft.stepIds[i], n]))
  }, [stepCounts, pattern.steps.length, graft])

  return (
    <div className="detected-flow">
      <p className="detected-flow__summary">{pattern.summary}</p>
      <p className="detected-flow__count">
        Seen in {pattern.occurrences} of the last {pattern.windowSize} calls.
      </p>

      <FlowCanvas
        nodes={graft.nodes}
        label="Detected flow diagram"
        highlightPath={graft.path}
        marks={marks}
        counts={counts}
        exitAt={exitIndex !== undefined && exitIndex >= 0 && exitIndex < pattern.steps.length ? stepId(exitIndex) : undefined}
        height="min(24rem, 55vh)"
        defaultDirection="TB"
        description="The pattern’s way through the flow is highlighted and numbered. The steps are also listed below the diagram."
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
