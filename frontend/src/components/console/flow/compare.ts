import { indexFlow, joinTarget, successors, type Placed } from '../../../console/flowGraph'
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
  const index = indexFlow(designed)
  const matchWithin = (root: FlowNode): StepMatch[] => {
    const nodes = flatten([root])
    const norm = nodes.map((n) => normaliseLabel(n.label))
    const at = new Map(nodes.map((n, k) => [n.id, k]))
    /** How many steps on from `above` node `k` is, following the call
     * (down the tree and where branches join back up); -1 if it can't be
     * reached from there. */
    const below = (k: number, above: number) => {
      const dist = new Map<number, number>([[above, 0]])
      const queue = [above]
      while (queue.length) {
        const q = queue.shift()!
        for (const next of successors(index, nodes[q])) {
          const j = at.get(next.id)
          if (j === undefined || dist.has(j)) continue
          dist.set(j, dist.get(q)! + 1)
          if (j === k) return dist.get(j)!
          queue.push(j)
        }
      }
      return -1
    }
    const used = new Set<number>()
    let from = 0
    let last = -1
    const out: StepMatch[] = []
    wanted.forEach((w, index) => {
      let hit = -1
      // A label can repeat down different branches: the nearest one below
      // the last match is the one the call went on to.
      if (last >= 0) {
        let best = Infinity
        nodes.forEach((_, k) => {
          if (used.has(k) || !same(norm[k], w)) return
          const d = below(k, last)
          if (d > 0 && d < best) {
            best = d
            hit = k
          }
        })
      }
      for (let k = from; k < nodes.length && hit < 0; k++) if (!used.has(k) && same(norm[k], w)) hit = k
      for (let k = 0; k < from && hit < 0; k++) if (!used.has(k) && same(norm[k], w)) hit = k
      if (hit >= 0) {
        used.add(hit)
        from = hit + 1
        last = hit
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

/** A detected pattern drawn on the designed flow. */
export interface GraftedPattern {
  /** The intent the pattern follows, with the pattern's new steps added as
   * a branch where the calls left the design; or, with nothing designed to
   * follow, the pattern alone as a path. */
  nodes: FlowNode[]
  /** The pattern's route through `nodes`, from the top, for `highlightPath`. */
  path: string[]
  /** The node each step of the pattern is drawn as, by position. */
  stepIds: string[]
  /** The branch holding the new steps, if the calls left the design. */
  branchId: string | null
}

/** Ids for the pattern's own nodes: positions, so they are stable for a
 * pattern and can't clash with the designed flow's. */
export const detectedNodeId = (i: number) => `detected-${i}`

/**
 * Puts a detected pattern (step labels, in order) on the designed flow as a
 * tree: the steps the design already has are followed down the intent the
 * pattern fits best, and from the last of them the rest of the pattern
 * hangs as a new branch, so the diagram shows exactly where calls went
 * their own way. Steps after that point are always drawn as new, even if
 * their label is elsewhere in the design. The design is followed where its
 * branches join back up, too.
 */
export function graftPattern(steps: string[], designed: FlowNode[], branchCondition: string): GraftedPattern {
  const chain = (from: number): FlowNode[] =>
    from >= steps.length ? [] : [{ id: detectedNodeId(from), kind: 'step', label: steps[from], say: '', sourceCallIds: [], children: chain(from + 1) }]
  const cmp = compareSteps(steps, designed)
  const root = designed.find((n) => n.id === cmp.rootId)
  if (!root) {
    // Nothing to follow: the first step names the conversation.
    if (!steps.length) return { nodes: [], path: [], stepIds: [], branchId: null }
    const nodes: FlowNode[] = [{ id: detectedNodeId(0), kind: 'intent', label: steps[0], sourceCallIds: [], children: chain(1) }]
    const ids = steps.map((_, i) => detectedNodeId(i))
    return { nodes, path: ids, stepIds: ids, branchId: null }
  }

  // Follow the design down from the intent while each step is the next
  // node on some way on (its children, or the children of a branch there).
  const byIndex = new Map(cmp.matches.map((m) => [m.index, m.nodeId]))
  const index = indexFlow(designed)
  const path: string[] = [root.id]
  const stepIds: string[] = []
  let at: FlowNode = root
  let i = 0
  for (; i < steps.length; i++) {
    const want = byIndex.get(i)
    if (want === undefined) break
    if (want === root.id && i === 0) {
      stepIds.push(root.id)
      continue
    }
    const route = routeTo(index, at, want)
    if (!route) break
    path.push(...route.map((n) => n.id))
    stepIds.push(want)
    at = route[route.length - 1]
  }
  if (i >= steps.length) return { nodes: [root], path, stepIds, branchId: null }

  const branchId = 'detected-branch'
  const branch: FlowNode = { id: branchId, kind: 'branch', label: 'New in these calls', condition: branchCondition, sourceCallIds: [], children: chain(i) }
  const graft = (n: FlowNode): FlowNode =>
    n.id === at.id ? { ...n, children: [branch, ...n.children] } : { ...n, children: n.children.map(graft) }
  for (let k = i; k < steps.length; k++) stepIds.push(detectedNodeId(k))
  return { nodes: [graft(root)], path: [...path, branchId, ...steps.slice(i).map((_, k) => detectedNodeId(i + k))], stepIds, branchId }
}

/** The nodes from just after `from` on to `id`, passing only branches on
 * the way (a call steps over them), or null when `id` isn't next. A node
 * that joins back up leads on to the step it joins at. */
function routeTo(index: Map<string, Placed>, from: FlowNode, id: string): FlowNode[] | null {
  for (const c of from.children) {
    if (c.id === id) return [c]
    if (c.kind === 'branch') {
      const deeper = routeTo(index, c, id)
      if (deeper) return [c, ...deeper]
    }
  }
  const j = joinTarget(index, from)
  return j && j.id === id ? [j] : null
}
