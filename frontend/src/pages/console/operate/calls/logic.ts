import type { Language } from '../../../../auth/types'
import type { CallOutcome, CallQuery, CallSummary, Sentiment, TranscriptTurn } from '../../../../console/types'
import { OUTCOME_LABEL } from '../shared'

/** Pure logic for the Call history page: the filters and their URL form,
 * the filters the server can't do (applied to what is loaded), and the
 * summary line. */

export type Days = CallQuery['days']
export const DAYS: Days[] = [1, 7, 30, 90]
export const DEFAULT_DAYS: Days = 7

export type CallLanguage = Language | 'mixed'
export const LANGUAGES: CallLanguage[] = ['tamil', 'english', 'tanglish', 'mixed']
export const SENTIMENTS: Sentiment[] = ['positive', 'neutral', 'negative']

/** What the page filters by. The first four go to the server; the rest are
 * applied to the calls already loaded (the call list doesn't carry them). */
export interface CallFilters {
  days: Days
  agentId: string
  outcome: CallOutcome | ''
  /** The search text, trimmed. */
  q: string
  language: CallLanguage | ''
  sentiment: Sentiment | ''
  success: '' | 'yes' | 'no'
}

export const NO_FILTERS: CallFilters = { days: DEFAULT_DAYS, agentId: '', outcome: '', q: '', language: '', sentiment: '', success: '' }

/** The address parameters this page owns. Others are left as they are. */
const KEYS = ['days', 'agent', 'outcome', 'q', 'lang', 'sentiment', 'success', 'call'] as const

const isDays = (n: number): n is Days => (DAYS as number[]).includes(n)

/** Filters (and the open call) from the address. Anything unknown, e.g.
 * ?days=12 or ?outcome=nonsense, is ignored rather than trusted. */
export function readParams(sp: URLSearchParams): { filters: CallFilters; callId: string | null } {
  const days = Number(sp.get('days'))
  const outcome = sp.get('outcome') ?? ''
  const lang = sp.get('lang') ?? ''
  const sentiment = sp.get('sentiment') ?? ''
  const success = sp.get('success') ?? ''
  return {
    filters: {
      days: isDays(days) ? days : DEFAULT_DAYS,
      agentId: sp.get('agent') ?? '',
      outcome: outcome in OUTCOME_LABEL ? (outcome as CallOutcome) : '',
      q: (sp.get('q') ?? '').trim(),
      language: (LANGUAGES as string[]).includes(lang) ? (lang as CallLanguage) : '',
      sentiment: (SENTIMENTS as string[]).includes(sentiment) ? (sentiment as Sentiment) : '',
      success: success === 'yes' || success === 'no' ? success : '',
    },
    callId: sp.get('call') || null,
  }
}

/** The address for these filters and open call, keeping any parameter this
 * page doesn't own. Defaults are left out, so the plain page has a plain
 * address. */
export function writeParams(current: URLSearchParams, filters: CallFilters, callId: string | null): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const k of KEYS) next.delete(k)
  if (filters.days !== DEFAULT_DAYS) next.set('days', String(filters.days))
  if (filters.agentId) next.set('agent', filters.agentId)
  if (filters.outcome) next.set('outcome', filters.outcome)
  if (filters.q.trim()) next.set('q', filters.q.trim())
  if (filters.language) next.set('lang', filters.language)
  if (filters.sentiment) next.set('sentiment', filters.sentiment)
  if (filters.success) next.set('success', filters.success)
  if (callId) next.set('call', callId)
  return next
}

/** What the call list doesn't hold but the call itself does (opened calls). */
export interface Analysed {
  sentiment: Sentiment
  success: boolean
}

/**
 * Applies the filters the server can't. Sentiment and success are only known
 * for calls whose analysis has been read (opened ones), so a call without
 * it can't be said to match: it is left out and counted in `unknown`, which
 * the page says out loud.
 */
export function applyClientFilters(calls: CallSummary[], f: Pick<CallFilters, 'language' | 'sentiment' | 'success'>, analysed: ReadonlyMap<string, Analysed>): { shown: CallSummary[]; unknown: number } {
  let unknown = 0
  const shown = calls.filter((c) => {
    if (f.language && c.language !== f.language) return false
    if (f.sentiment || f.success) {
      const a = analysed.get(c.id)
      if (!a) {
        unknown++
        return false
      }
      if (f.sentiment && a.sentiment !== f.sentiment) return false
      if (f.success && a.success !== (f.success === 'yes')) return false
    }
    return true
  })
  return { shown, unknown }
}

/** Whether a call counts as answered by the agents, and as handed to a
 * person (the same split Reports uses). */
export const answeredByAgent = (o: CallOutcome) => o === 'resolved' || o === 'booked'
export const handedToPerson = (o: CallOutcome) => o === 'handed_over' || o === 'emergency' || o === 'callback'

export interface CallSummaryLine {
  calls: number
  answered: number
  answeredPct: number
  handed: number
  handedPct: number
}

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)

/** The summary line's figures, for the calls shown. */
export function summarise(calls: Pick<CallSummary, 'outcome'>[]): CallSummaryLine {
  const answered = calls.filter((c) => answeredByAgent(c.outcome)).length
  const handed = calls.filter((c) => handedToPerson(c.outcome)).length
  return { calls: calls.length, answered, answeredPct: pct(answered, calls.length), handed, handedPct: pct(handed, calls.length) }
}

/**
 * The count line, honest about a partial list: "50 of 120 calls" when only
 * the newest were loaded; with a filter the server can't do, "3 of the 50
 * loaded calls" (the other matches in the period may not be loaded yet).
 */
export function countWording(shown: number, loaded: number, total: number, clientFiltered: boolean): string {
  const n = (x: number) => x.toLocaleString('en-IN')
  const calls = (x: number) => (x === 1 ? 'call' : 'calls')
  if (clientFiltered) return `${n(shown)} of the ${n(loaded)} loaded ${calls(loaded)}${loaded < total ? ` (${n(total)} in the period)` : ''}`
  return loaded < total ? `${n(loaded)} of ${n(total)} ${calls(total)}` : `${n(loaded)} ${calls(loaded)}`
}

/** The first `n` turns of a transcript, for a preview. */
export function firstTurns(turns: TranscriptTurn[], n = 4): TranscriptTurn[] {
  return turns.slice(0, n)
}
