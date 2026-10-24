import { useMemo, useState } from 'react'
import { FlowCanvas, type FlowMark } from '../../../../../components/console/flow/FlowCanvas'
import { SegFilter } from '../../../../../components/console/ListTools'
import { Button } from '../../../../../components/ui/Button'
import { TextAreaField } from '../../../../../components/ui/Field'
import type { DetectedFlowPattern, FlowNode } from '../../../../../console/types'
import { FlowEditor } from '../../../builder/FlowEditor'
import { changesText, describeChanges, detectedId, patternToFlow, stepStatuses } from './logic'

type View = 'yours' | 'detected' | 'both'

export const NOTE_MAX = 500

/** Whether every item has a name, and there is something to build. */
export function editProblem(flow: FlowNode[]): string | null {
  const names = (nodes: FlowNode[]): boolean => nodes.every((n) => n.label.trim() !== '' && names(n.children))
  if (flow.length === 0) return 'Your version has nothing in it. Add an intent, or go back to the detected flow.'
  if (!names(flow)) return 'Give every step a name before you send it.'
  return null
}

interface Props {
  pattern: DetectedFlowPattern
  flow: FlowNode[]
  onFlow(flow: FlowNode[]): void
  note: string
  onNote(note: string): void
  /** The designed flow, to mark the detected steps against, when it can be read. */
  designed?: FlowNode[]
  busy: boolean
  error: string | null
  onRequest(): void
  onBack(): void
}

/**
 * "Edit as a diagram": the detected steps as a copy the hospital can
 * change before asking bitNtech to build it: add, rename, remove and
 * reorder steps, add a branch, and add a note. "As detected" stays
 * available beside "Your version", so what changed is never in doubt. The
 * copy lives here until the dialog closes; nothing is saved or sent until
 * the request is.
 */
export function PatternEditor({ pattern, flow, onFlow, note, onNote, designed, busy, error, onRequest, onBack }: Props) {
  const original = useMemo(() => patternToFlow(pattern), [pattern])
  const [view, setView] = useState<View>('yours')
  const changes = describeChanges(original, flow)
  const problem = editProblem(flow)

  // The detected version, marked: in the designed flow or new, and what the edit took out.
  const marks = useMemo(() => {
    const out: Record<string, FlowMark> = {}
    const kept = new Set<string>()
    const walk = (nodes: FlowNode[]) =>
      nodes.forEach((n) => {
        kept.add(n.id)
        walk(n.children)
      })
    walk(flow)
    if (designed) {
      for (const s of stepStatuses(pattern.steps, designed)) {
        out[detectedId(s.index)] = s.status === 'in' ? { tone: 'info', text: 'In the designed flow' } : { tone: 'warn', text: s.status === 'elsewhere' ? 'Under another intent' : 'Not in the designed flow' }
      }
    }
    for (const n of [...original, ...original.flatMap((o) => o.children)]) {
      if (!kept.has(n.id)) out[n.id] = { tone: 'danger', text: 'Removed in your version' }
    }
    return out
  }, [designed, pattern.steps, original, flow])

  const detectedView = (
    <div className="pt-edit__pane">
      <h4 className="pt-edit__pane-title">As detected</h4>
      <FlowCanvas nodes={original} label="Flow as detected" marks={marks} height="min(22rem, 50vh)" defaultDirection="TB" emptyText="No steps were recorded for this pattern." />
    </div>
  )
  const yoursView = (
    <div className="pt-edit__pane">
      <h4 className="pt-edit__pane-title">Your version</h4>
      <FlowEditor flow={flow} onChange={onFlow} initialView="diagram" />
    </div>
  )

  return (
    <div className="pt-edit">
      <p className="pt-edit__lede">
        Change the steps the way you want the agent to handle this call, then ask bitNtech to build your version. Nothing is sent until you do. The first item is the intent; add steps or a branch under it.
      </p>
      <SegFilter<View>
        legend="Show"
        value={view}
        onChange={setView}
        options={[
          { value: 'yours', label: 'Your version' },
          { value: 'detected', label: 'As detected' },
          { value: 'both', label: 'Side by side' },
        ]}
      />
      <div className={view === 'both' ? 'pt-edit__both' : undefined}>
        {view !== 'detected' && yoursView}
        {view !== 'yours' && detectedView}
      </div>

      <p className="pt-edit__changes" role="status">
        {changesText(changes)}
        {changes.total > 0 && <span className="pt-edit__count"> ({changes.total} {changes.total === 1 ? 'change' : 'changes'} from what was detected)</span>}
      </p>

      <TextAreaField label="A note for bitNtech" hint="Optional. For example, when callers take this path, or what the agent should say." rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => onNote(e.target.value)} />

      {(problem || error) && (
        <p className="field__error" role="alert">
          {problem ?? error}
        </p>
      )}

      <div className="pt-edit__actions">
        <Button variant="orange" size="sm" busy={busy} busyLabel="Sending…" disabled={!!problem} onClick={onRequest}>
          Ask bitNtech to build your version
        </Button>
        <Button variant="line" size="sm" disabled={changes.total === 0} onClick={() => onFlow(original)}>
          Put back as detected
        </Button>
        <button type="button" className="btn-text" onClick={onBack}>
          Back to the detected flow
        </button>
      </div>
    </div>
  )
}
