import type { FlowNode } from '../../../console/types'
import { ancestorIds, flatten } from './layout'

/**
 * Putting a call, or a detected pattern, onto the designed flow.
 *
 * Detected patterns and call paths name their steps in words, not ids, so
 * they are matched to designed nodes by label. Matching is forgiving about
 * case, punctuation, leading numbers and a few filler words, and strict
 * about everything else: a step with no match is reported as unmatched
 * rather than guessed at.
 */

const FILLER = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'then', 'step'])

/** A label reduced to what matters for matching: lower case, no
 * punctuation, no leading "1." or "Step 2:", no filler words. */
export function normaliseLabel(label: string): string {
  const words = label
    .toLowerCase()
    .replace(/^\s*(step\s*)?\d+\s*[.):-]\s*/, '')
    .replace(/[“”"'’`]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
  return words.join(' ')
}

export interface StepMatch {
  /** Where the step is in the detected sequence, from 0. */
  index: number
  step: string
  nodeId: string
}

export interface UnmatchedStep {
  index: number
  step: string
  /** The step is in the designed flow, but under another intent. */
  elsewhereId?: string
}

export interface FlowComparison {
  /** The intent the sequence follows most closely, or null if none matched. */
  rootId: string | null
  matches: StepMatch[]
  unmatched: UnmatchedStep[]
  /** The matched nodes, in the order of the sequence, de-duplicated. */
  matchedIds: string[]
  /** 0 to 1: the share of steps that matched. 1 for an empty sequence. */
  coverage: number
}

const same = (a: string, b: string): boolean => {
  if (!a || !b) return false
  if (a === b) return true
  // One names the other in full ("confirm booking" / "confirm the booking
  // with date"), but not on a stray word.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.split(' ').length >= 2 && ` ${long} `.includes(` ${short} `)
}

/**
 * Maps `steps` (labels, in order) onto `designed`.
 *
 * Labels repeat across intents ("Find the booking" under both Reschedule and
 * Cancel), so the sequence is matched against each intent in turn and the
 * intent it fits best wins (earlier on a tie). Within it, each step takes
 * the first unused node at or after the previous match, then any unused node
 * of that intent. Steps with no match inside the winning intent are
 * unmatched; if their label exists under another intent, `elsewhereId` says
 * where.
 */
export function compareSteps(steps: string[], designed: FlowNode[]): FlowComparison {
  const wanted = steps.map(normaliseLabel)
  const matchWithin = (root: FlowNode): StepMatch[] => {
    const nodes = flatten([root])
    const norm = nodes.map((n) => normaliseLabel(n.label))
    const used = new Set<number>()
    let from = 0
    const out: StepMatch[] = []
    wanted.forEach((w, index) => {
      let hit = -1
      for (let k = from; k < nodes.length && hit < 0; k++) if (!used.has(k) && same(norm[k], w)) hit = k
      for (let k = 0; k < from && hit < 0; k++) if (!used.has(k) && same(norm[k], w)) hit = k
      if (hit >= 0) {
        used.add(hit)
        from = hit + 1
        out.push({ index, step: steps[index], nodeId: nodes[hit].id })
      }
    })
    return out
  }

  let best: { root: FlowNode; matches: StepMatch[] } | null = null
  for (const root of designed) {
    const matches = matchWithin(root)
    if (matches.length > (best?.matches.length ?? 0)) best = { root, matches }
  }

  const matches = best?.matches ?? []
  const got = new Set(matches.map((m) => m.index))
  const everywhere = flatten(designed)
  const unmatched: UnmatchedStep[] = []
  steps.forEach((step, index) => {
    if (got.has(index)) return
    const elsewhere = wanted[index] ? everywhere.find((n) => same(normaliseLabel(n.label), wanted[index])) : undefined
    unmatched.push({ index, step, ...(elsewhere ? { elsewhereId: elsewhere.id } : {}) })
  })
  return {
    rootId: best?.root.id ?? null,
    matches,
    unmatched,
    matchedIds: [...new Set(matches.map((m) => m.nodeId))],
    coverage: steps.length ? matches.length / steps.length : 1,
  }
}

/**
 * The ids to hand `highlightPath`: `ids` in order, with each one's tree
 * ancestors (its intent, and any branch it sits under) put in front of it,
 * so the arrows from the intent down to the call's steps are drawn too.
 * Ids that aren't in `designed` are dropped.
 */
export function completePath(designed: FlowNode[], ids: string[]): string[] {
  const known = new Set(flatten(designed).map((n) => n.id))
  const out: string[] = []
  const push = (id: string) => {
    if (!out.includes(id)) out.push(id)
  }
  for (const id of ids) {
    if (!known.has(id)) continue
    ancestorIds(designed, id).forEach(push)
    push(id)
  }
  return out
}
