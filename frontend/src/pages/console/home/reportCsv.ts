import type { Report } from '../../../console/types'
import { DAYS_LABEL, type Days } from './format'

/** The report as a CSV download: every table on the page, one after another. */
export function downloadReportCsv(r: Report, days: Days, agentName?: string) {
  const esc = (v: string | number | null) => {
    if (v === null) return ''
    let t = String(v)
    if (typeof v === 'string' && /^[=+\-@]/.test(t)) t = `'${t}`
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const rows: (string | number | null)[][] = [
    ['AICA report', DAYS_LABEL[days], agentName ?? 'All agents'],
    [],
    ['Day', 'Answered by the agents', 'Handed to your team', 'Caller hung up'],
    ...r.byDay.map((d) => [d.date, d.resolved, d.handedOver, d.dropped]),
    [],
    ['Asked about', 'Calls', 'Answered by the agents'],
    ...r.intents.map((i) => [i.label, i.calls, i.byAgent]),
    [],
    ['Hour', 'Calls'],
    ...r.byHour.map((n, h) => [`${String(h).padStart(2, '0')}:00`, n]),
    [],
    ['Quality', 'Value'],
    ['Successful calls', r.quality.success],
    ['Callers pleased', r.quality.sentiment?.positive ?? null],
    ['Callers neutral', r.quality.sentiment?.neutral ?? null],
    ['Callers unhappy', r.quality.sentiment?.negative ?? null],
    ['Typical reply (ms)', r.quality.replyP50Ms],
    ['Slowest 1 in 20 replies (ms)', r.quality.replyP95Ms],
    ['First words (ms)', r.quality.firstWordMs],
    ['Caller cut in, per call', r.quality.interruptionsPerCall],
    [],
    ['Agent', 'Calls', 'Answered by the agent', 'Successful', 'Typical reply (ms)'],
    ...r.agents.map((a) => [a.name, a.calls, a.byAgent, a.success, a.replyP50Ms]),
  ]
  const blob = new Blob([rows.map((row) => row.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `aica-report-${days}d.csv`
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}
