import type { Report } from '../../../console/types'
import { hourSpan, num } from './format'

/**
 * "What changed": short, computed findings about a report against the period
 * before it. Pure, so the thresholds are testable. A finding only appears
 * when the numbers behind it are big enough to mean something: a topic with
 * three calls, or a week with ten, says nothing, so it says nothing.
 *
 * The findings never stand in for a chart: each one names the card that
 * holds its evidence, and the page links to it.
 */

/** The cards a finding can point at: their ids on the page. */
export const SECTION = {
  kpis: 'hd-kpis',
  quality: 'hd-quality',
  ended: 'hd-ended',
  days: 'hd-days',
  topics: 'hd-topics',
  agents: 'hd-agents',
  when: 'hd-when',
  dropoff: 'hd-dropoff',
  languages: 'hd-languages',
  changes: 'hd-changes',
} as const
export type SectionId = (typeof SECTION)[keyof typeof SECTION]

/** Calls in a period (and in the one before, for a comparison) before any finding is made. */
export const MIN_CALLS = 30
/** Calls on one topic before it can be called out. */
export const MIN_TOPIC_CALLS = 10
/** Calls on one topic before the table compares it with the average at all. */
export const MIN_TOPIC_COMPARE = 5
/** Calls one agent needs before it is compared with another. */
export const MIN_AGENT_CALLS = 20
/** How far below the overall answered share a topic or agent must be to be called out, in points. */
export const GAP_POINTS = 10
/** How far the answered share must move against the period before, in points. */
export const ANSWERED_MOVE_POINTS = 5
/** The same for hang-ups. */
export const HANGUP_MOVE_POINTS = 3
/** The busiest hour must hold at least this many calls, and this share of them. */
export const MIN_PEAK_CALLS = 5
export const MIN_PEAK_SHARE = 0.1
/** One reply stage must be at least this share of the three to be named. */
export const MIN_STAGE_SHARE = 0.5

export interface Finding {
  id: string
  /** warn: worth a look · good: moved the right way · info: for the picture. */
  tone: 'warn' | 'good' | 'info'
  /** One short sentence, with its number. */
  text: string
  /** The card with the evidence. */
  evidence: SectionId
  evidenceLabel: string
}

/** A whole-number percentage, 0 when there are no calls (callers check first). */
export const percent = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

/**
 * How many points a topic's answered share sits above (+) or below (-) the
 * overall answered share, as the table shows both (whole percentages).
 * Null when it can't be said fairly: no overall figure, or too few calls.
 */
export function topicGap(topic: { calls: number; byAgent: number }, overallPercent: number | null): number | null {
  if (overallPercent === null || topic.calls < MIN_TOPIC_COMPARE) return null
  return percent(topic.byAgent, topic.calls) - overallPercent
}

const STAGES = [
  { key: 'speechMs', words: 'hearing the caller' },
  { key: 'languageMs', words: 'working out the reply' },
  { key: 'voiceMs', words: 'starting to speak' },
] as const

/**
 * The findings for a report, most important first. `previous` is the earlier
 * period in words, as it follows "than" ("the 7 days before").
 */
export function findings(r: Report, { previous }: { previous: string }): Finding[] {
  const calls = r.totals.calls
  if (calls < MIN_CALLS) return []
  const out: Finding[] = []
  const overall = percent(r.totals.byAgent, calls)

  // The topic the agents handle worst.
  const worst = r.intents
    .filter((t) => t.calls >= MIN_TOPIC_CALLS)
    .map((t) => ({ t, gap: topicGap(t, overall)! }))
    .sort((a, b) => a.gap - b.gap)[0]
  if (worst && worst.gap <= -GAP_POINTS) {
    out.push({
      id: 'topic-gap',
      tone: 'warn',
      text: `Callers asking about “${worst.t.label}” got an answer from the agents ${percent(worst.t.byAgent, worst.t.calls)}% of the time: ${-worst.gap} points below the ${overall}% for all calls.`,
      evidence: SECTION.topics,
      evidenceLabel: 'See what callers want',
    })
  }

  // Against the period before: only when that had enough calls too.
  if (r.previous.calls >= MIN_CALLS) {
    const hangNow = percent(r.totals.dropped, calls)
    const hangBefore = percent(r.previous.dropped, r.previous.calls)
    const hangMove = hangNow - hangBefore
    if (Math.abs(hangMove) >= HANGUP_MOVE_POINTS) {
      out.push({
        id: 'hangups',
        tone: hangMove > 0 ? 'warn' : 'good',
        text: `Callers hung up on ${hangNow}% of calls, ${Math.abs(hangMove)} points ${hangMove > 0 ? 'higher' : 'lower'} than ${previous} (${hangBefore}%).`,
        evidence: SECTION.kpis,
        evidenceLabel: 'See the figures',
      })
    }
    const before = percent(r.previous.byAgent, r.previous.calls)
    const move = overall - before
    if (Math.abs(move) >= ANSWERED_MOVE_POINTS) {
      out.push({
        id: 'answered',
        tone: move > 0 ? 'good' : 'warn',
        text: `The agents answered ${overall}% of calls on their own, ${Math.abs(move)} points ${move > 0 ? 'higher' : 'lower'} than ${previous} (${before}%).`,
        evidence: SECTION.ended,
        evidenceLabel: 'See how calls ended',
      })
    }
  }

  // The agent with the lowest answered share, when there are agents to compare.
  const agents = r.agents.filter((a) => a.calls >= MIN_AGENT_CALLS).map((a) => ({ a, share: percent(a.byAgent, a.calls) }))
  if (agents.length >= 2) {
    const low = agents.reduce((x, y) => (y.share < x.share ? y : x))
    const high = agents.reduce((x, y) => (y.share > x.share ? y : x))
    if (high.share - low.share >= GAP_POINTS) {
      out.push({
        id: 'agent-low',
        tone: 'warn',
        text: `${low.a.name} answered ${low.share}% of its ${num(low.a.calls)} calls on its own, ${high.share - low.share} points below ${high.a.name} (${high.share}%).`,
        evidence: SECTION.agents,
        evidenceLabel: 'See the agents',
      })
    }
  }

  // Where a reply's wait goes, when all three stages are measured.
  const q = r.quality
  if (q.speechMs !== null && q.languageMs !== null && q.voiceMs !== null) {
    const total = q.speechMs + q.languageMs + q.voiceMs
    if (total > 0) {
      const top = STAGES.map((s) => ({ ...s, value: q[s.key] as number })).reduce((x, y) => (y.value > x.value ? y : x))
      if (top.value / total >= MIN_STAGE_SHARE) {
        out.push({
          id: 'slow-stage',
          tone: 'info',
          text: `Most of the wait for a reply is spent ${top.words}: ${num(Math.round(top.value))} ms of about ${num(Math.round(total))} ms (${percent(top.value, total)}%).`,
          evidence: SECTION.quality,
          evidenceLabel: 'See where a reply’s wait goes',
        })
      }
    }
  }

  // The busiest hour.
  const peak = r.byHour.reduce((best, n, h) => (n > best.n ? { n, h } : best), { n: 0, h: 0 })
  if (peak.n >= MIN_PEAK_CALLS && peak.n / calls >= MIN_PEAK_SHARE) {
    out.push({
      id: 'busiest-hour',
      tone: 'info',
      text: `The busiest hour was ${hourSpan(peak.h)}: ${num(peak.n)} calls, ${percent(peak.n, calls)}% of the period’s calls.`,
      evidence: SECTION.when,
      evidenceLabel: 'See when people call',
    })
  }
  return out
}
