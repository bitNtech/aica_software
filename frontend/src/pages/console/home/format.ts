import type { ReportQuery } from '../../../console/types'
import { seconds } from '../calls/TranscriptDialog'

export type Days = ReportQuery['days']
export const PERIODS: Days[] = [1, 7, 30, 90]
export const DAYS_LABEL: Record<Days, string> = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' }
/** What the previous period is called, after "than". */
export const PERIOD: Record<Days, string> = { 1: 'yesterday by this time', 7: 'the 7 days before', 30: 'the 30 days before', 90: 'the 90 days before' }

export const shortDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
export const longDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
export const hourLabel = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`)
export const hourSpan = (h: number) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`
export const num = (n: number) => n.toLocaleString('en-IN')

/** A whole-number percentage of `of`, or null when there is nothing to divide. */
export const pctOrNull = (n: number | null, of: number): string | null => (n !== null && of > 0 ? `${Math.round((n / of) * 100)}%` : null)
/** The same, with a dash where there is nothing to show (table cells). */
export const pct = (n: number | null, of: number) => pctOrNull(n, of) ?? '-'
/** A timing, or a dash until the voice servers send timings. */
export const secs = (ms: number | null) => (ms === null ? '-' : seconds(ms))
export const ms = (n: number) => `${num(Math.round(n))} ms`

/** A length of time in words, either way round: "under a minute", "40 minutes", "2 hours 5 min". */
export function inWords(milliseconds: number): string {
  const s = Math.floor(Math.abs(milliseconds) / 1000)
  if (s < 60) return 'under a minute'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}${m % 60 ? ` ${m % 60} min` : ''}`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'}`
}

/** "3:05 pm" from a "HH:mm" appointment time. */
export function clockTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}
