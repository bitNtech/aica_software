import type { CallAnalysis, CallMetrics, CallSummary, ReportQuality, Sentiment, TranscriptTurn } from '../types'
import { hash, rng } from './operations'

/**
 * Sample call quality: what the analysis noted about each call and how
 * quickly the agent replied. Worked out from the call's own seed, so a call
 * always shows the same figures. Real figures come from the voice servers'
 * timings once their contract is agreed.
 */

const SUCCESS: Record<CallSummary['outcome'], boolean> = {
  resolved: true,
  booked: true,
  emergency: true,
  handed_over: false,
  callback: false,
  dropped: false,
}

const REASON: Record<CallSummary['outcome'], string> = {
  resolved: 'Answered without a person.',
  booked: 'Booked without a person.',
  emergency: 'Sent to the emergency desk straight away, as it should.',
  handed_over: 'Needed a person to finish.',
  callback: 'The caller has to be called back.',
  dropped: 'The caller hung up before getting what they wanted.',
}

export function callQuality(s: CallSummary): { analysis: Omit<CallAnalysis, 'fields'>; metrics: CallMetrics } {
  const r = rng(hash(`${s.id}:quality`))
  const sentiment: Sentiment =
    s.outcome === 'dropped' ? (r() > 0.4 ? 'negative' : 'neutral') : s.outcome === 'handed_over' || s.outcome === 'callback' ? (r() > 0.6 ? 'negative' : 'neutral') : r() > 0.25 ? 'positive' : 'neutral'
  // Mixed-language calls take the speech model a little longer.
  const speechMs = Math.round(180 + r() * 120 + (s.language === 'mixed' || s.language === 'tanglish' ? 40 : 0))
  const languageMs = Math.round(320 + r() * 260)
  const voiceMs = Math.round(150 + r() * 110)
  const replyP50Ms = speechMs + languageMs + voiceMs
  return {
    analysis: { sentiment, success: SUCCESS[s.outcome], successReason: REASON[s.outcome] },
    metrics: {
      firstWordMs: Math.round(450 + r() * 500),
      replyP50Ms,
      replyP95Ms: Math.round(replyP50Ms * (1.5 + r() * 0.6)),
      speechMs,
      languageMs,
      voiceMs,
      interruptions: s.outcome === 'dropped' || sentiment === 'negative' ? Math.floor(r() * 4) : Math.floor(r() * 2),
    },
  }
}

/** Gives each agent turn its reply time, and marks the turns callers cut short. */
export function timeTurns(s: CallSummary, turns: TranscriptTurn[], m: CallMetrics): TranscriptTurn[] {
  const r = rng(hash(`${s.id}:turns`))
  let cuts = m.interruptions
  return turns.map((t, i) => {
    if (t.speaker !== 'agent') return t
    const latencyMs = i === 0 ? m.firstWordMs : Math.round(m.replyP50Ms * (0.75 + r() * 0.5))
    // Callers cut in on the longer replies, not the greeting.
    const interrupted = i > 0 && cuts > 0 && t.text.length > 50 && r() > 0.4
    if (interrupted) cuts--
    return { ...t, latencyMs, ...(interrupted ? { interrupted } : {}) }
  })
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export function qualityOf(calls: CallSummary[]): ReportQuality {
  const q = calls.map(callQuality)
  const count = (x: Sentiment) => q.filter((c) => c.analysis.sentiment === x).length
  return {
    success: q.filter((c) => c.analysis.success).length,
    sentiment: { positive: count('positive'), neutral: count('neutral'), negative: count('negative') },
    firstWordMs: median(q.map((c) => c.metrics.firstWordMs)),
    replyP50Ms: median(q.map((c) => c.metrics.replyP50Ms)),
    replyP95Ms: median(q.map((c) => c.metrics.replyP95Ms)),
    speechMs: median(q.map((c) => c.metrics.speechMs)),
    languageMs: median(q.map((c) => c.metrics.languageMs)),
    voiceMs: median(q.map((c) => c.metrics.voiceMs)),
    interruptionsPerCall: q.length ? Math.round((q.reduce((t, c) => t + c.metrics.interruptions, 0) / q.length) * 10) / 10 : 0,
  }
}
