import { compareSteps, completePath, type StepMatch, type UnmatchedStep } from '../../../../../components/console/flow/compare'
import type { CallOutcome, FlowNode, TranscriptTurn } from '../../../../../console/types'
import { renderTurnText } from '../../../calls/TranscriptDialog'

/** Pure logic for Call detail: the call's path on the designed flow, which
 * moment of the conversation a step belongs to, and searching the
 * transcript. */

/** Outcomes where the call left the flow rather than finishing it. */
const LEFT: Partial<Record<CallOutcome, string>> = {
  handed_over: 'Handed over here',
  dropped: 'Caller hung up here',
  emergency: 'Emergency, put through here',
  callback: 'Callback asked for here',
}

export interface PathOnFlow {
  /** Each step of the call's path that is in the designed flow. */
  matches: StepMatch[]
  /** Steps with no match (a handover step the flow doesn't have, say). */
  unmatched: UnmatchedStep[]
  /** For FlowCanvas `highlightPath`: matched nodes with their intents in front. */
  highlight: string[]
  /** The last matched node when the call left the flow, for `exitAt`. */
  exitId?: string
  /** Where the call left, in words ("Caller hung up here"). */
  exitText?: string
  coverage: number
}

/** The call's path (step labels, in order) drawn on the designed flow. */
export function pathOnFlow(path: string[], designed: FlowNode[], outcome: CallOutcome): PathOnFlow {
  const cmp = compareSteps(path, designed)
  const last = cmp.matches[cmp.matches.length - 1]
  const exitText = LEFT[outcome]
  return {
    matches: cmp.matches,
    unmatched: cmp.unmatched,
    highlight: completePath(designed, cmp.matchedIds),
    exitId: exitText && last ? last.nodeId : undefined,
    exitText: exitText && last ? exitText : undefined,
    coverage: cmp.coverage,
  }
}

/** Positions of the agent's turns in the transcript. */
export const agentTurns = (turns: TranscriptTurn[]): number[] => turns.flatMap((t, i) => (t.speaker === 'agent' ? [i] : []))

/**
 * Which turn a step of the path belongs to. Turns carry no step, so this
 * goes by order: the steps are spread evenly over the agent's turns, the
 * first step at its first turn and the last at its last. That is
 * approximate, and the page says so. Null when there is no agent turn.
 */
export function turnForStep(stepIndex: number, pathLength: number, turns: TranscriptTurn[]): number | null {
  const agent = agentTurns(turns)
  if (agent.length === 0 || stepIndex < 0 || stepIndex >= pathLength) return null
  if (pathLength <= 1) return agent[0]
  return agent[Math.round((stepIndex * (agent.length - 1)) / (pathLength - 1))]
}

/** The turn for a node of the designed flow the call went through (its
 * first visit), or null when the call never reached it. */
export function turnForNode(nodeId: string, matches: StepMatch[], pathLength: number, turns: TranscriptTurn[]): number | null {
  const hit = matches.find((m) => m.nodeId === nodeId)
  return hit ? turnForStep(hit.index, pathLength, turns) : null
}

export interface TurnMatch {
  /** Index of the turn. */
  turn: number
  /** Where the match sits in the text as shown (after redaction). */
  start: number
  end: number
}

/**
 * Every place `query` occurs in the transcript as it is shown. Redacted
 * text is searched as it reads ("[name]"), so a hidden detail can't be
 * found by searching for it.
 */
export function searchTurns(turns: TranscriptTurn[], query: string, redact: boolean): TurnMatch[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const out: TurnMatch[] = []
  turns.forEach((t, turn) => {
    const text = renderTurnText(t.text, redact).toLowerCase()
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) out.push({ turn, start: at, end: at + needle.length })
  })
  return out
}

/** A turn's text cut into plain and matched parts, in order. `current` is
 * the index (within `matches`) of the match to mark as the current one. */
export function splitMatches(text: string, matches: { start: number; end: number; index: number }[]): { text: string; match?: number }[] {
  const parts: { text: string; match?: number }[] = []
  let at = 0
  for (const m of matches) {
    if (m.start > at) parts.push({ text: text.slice(at, m.start) })
    parts.push({ text: text.slice(m.start, m.end), match: m.index })
    at = m.end
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}
