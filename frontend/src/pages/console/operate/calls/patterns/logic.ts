import { compareSteps, normaliseLabel } from '../../../../../components/console/flow/compare'
import type { CallRecord, DetectedFlowPattern, FlowNode } from '../../../../../console/types'
import { renderTurnText } from '../../../calls/TranscriptDialog'

/** Pure logic for detected flow patterns on Call history. */

/** Position-based ids, so they are stable for a pattern. */
export const detectedId = (i: number) => `detected-${i}`

/**
 * The pattern as a flow the hospital can edit: the first step is the intent
 * (a call's path starts with it) and the rest follow it, one after another,
 * ready to have branches added anywhere along the way.
 */
export function patternToFlow(pattern: Pick<DetectedFlowPattern, 'steps'>): FlowNode[] {
  const [first] = pattern.steps
  if (first === undefined) return []
  const node = (i: number): FlowNode => {
    const kind = i === 0 ? 'intent' : 'step'
    return { id: detectedId(i), kind, label: pattern.steps[i], say: kind === 'step' ? '' : undefined, sourceCallIds: [], children: i + 1 < pattern.steps.length ? [node(i + 1)] : [] }
  }
  return [node(0)]
}

export interface StepStatus {
  index: number
  step: string
  /** In the designed flow, new, or in it but under another intent. */
  status: 'in' | 'new' | 'elsewhere'
}

/** Each step of the pattern: in the designed flow, new, or elsewhere in it. */
export function stepStatuses(steps: string[], designed: FlowNode[]): StepStatus[] {
  const cmp = compareSteps(steps, designed)
  const matched = new Set(cmp.matches.map((m) => m.index))
  const elsewhere = new Set(cmp.unmatched.filter((u) => u.elsewhereId).map((u) => u.index))
  return steps.map((step, index) => ({ index, step, status: matched.has(index) ? 'in' : elsewhere.has(index) ? 'elsewhere' : 'new' }))
}

/** How many of the given calls went through each step of the pattern. */
export function stepCounts(steps: string[], paths: string[][]): number[] {
  const wanted = steps.map(normaliseLabel)
  return wanted.map((w) => paths.filter((p) => p.some((s) => normaliseLabel(s) === w)).length)
}

/** The caller's first words, as shown (redacted when it should be), cut at
 * `max` characters; null when the caller said nothing. */
export function firstCallerLine(record: Pick<CallRecord, 'transcript'>, redact: boolean, max = 110): string | null {
  const turn = record.transcript.find((t) => t.speaker === 'caller')
  if (!turn) return null
  const text = renderTurnText(turn.text, redact).replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The pattern's calls that are among those loaded in the list. */
export function patternCallsIn<T extends { id: string }>(pattern: Pick<DetectedFlowPattern, 'callIds'>, loaded: T[]): T[] {
  const ids = new Set(pattern.callIds)
  return loaded.filter((c) => ids.has(c.id))
}

export interface FlowChanges {
  added: string[]
  removed: string[]
  renamed: { from: string; to: string }[]
  /** Steps still there but in another place. */
  moved: string[]
  /** Steps whose wording (what the agent says, or when a branch applies) changed. */
  reworded: string[]
  total: number
}

const walk = (nodes: FlowNode[]): FlowNode[] => nodes.flatMap((n) => [n, ...walk(n.children)])

/** What the hospital changed from the detected version, by node id. */
export function describeChanges(original: FlowNode[], edited: FlowNode[]): FlowChanges {
  const before = walk(original)
  const after = walk(edited)
  const was = new Map(before.map((n) => [n.id, n]))
  const now = new Map(after.map((n) => [n.id, n]))
  const name = (n: FlowNode) => n.label.trim() || 'an unnamed step'
  const added = after.filter((n) => !was.has(n.id)).map(name)
  const removed = before.filter((n) => !now.has(n.id)).map(name)
  const kept = after.filter((n) => was.has(n.id))
  const renamed = kept.filter((n) => was.get(n.id)!.label.trim() !== n.label.trim()).map((n) => ({ from: name(was.get(n.id)!), to: name(n) }))
  const reworded = kept
    .filter((n) => (was.get(n.id)!.say ?? '').trim() !== (n.say ?? '').trim() || (was.get(n.id)!.condition ?? '').trim() !== (n.condition ?? '').trim())
    .map(name)
  const moved = movedAgainstOrder(
    before.filter((n) => now.has(n.id)).map((n) => n.id),
    kept.map((n) => n.id),
  ).map((id) => name(now.get(id)!))
  return { added, removed, renamed, moved, reworded, total: added.length + removed.length + renamed.length + moved.length + reworded.length }
}

/** Ids that are out of place: not part of the longest run that keeps the
 * original order (so moving one step down doesn't count its neighbour). */
function movedAgainstOrder(before: string[], after: string[]): string[] {
  const rank = new Map(before.map((id, i) => [id, i]))
  const seq = after.map((id) => rank.get(id)!)
  // Longest increasing subsequence, O(n^2): flows are short.
  const len = seq.map(() => 1)
  const prev = seq.map(() => -1)
  let best = 0
  seq.forEach((v, i) => {
    for (let j = 0; j < i; j++) {
      if (seq[j] < v && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1
        prev[i] = j
      }
    }
    if (len[i] > len[best]) best = i
  })
  const keep = new Set<number>()
  for (let i = seq.length ? best : -1; i >= 0; i = prev[i]) keep.add(i)
  return after.filter((_, i) => !keep.has(i))
}

/** "Added 1 item, removed 1, renamed 1": the changes in a line. */
export function changesText(c: FlowChanges): string {
  const parts: string[] = []
  if (c.added.length) parts.push(`added ${c.added.length} ${c.added.length === 1 ? 'item' : 'items'}`)
  if (c.removed.length) parts.push(`removed ${c.removed.length}`)
  if (c.renamed.length) parts.push(`renamed ${c.renamed.length}`)
  if (c.moved.length) parts.push(`moved ${c.moved.length}`)
  if (c.reworded.length) parts.push(`reworded ${c.reworded.length}`)
  if (parts.length === 0) return 'No changes yet'
  const text = parts.join(', ')
  return text[0].toUpperCase() + text.slice(1)
}
