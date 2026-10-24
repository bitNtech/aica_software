import type { Report } from '../console/types'

/**
 * A report with known numbers, for the Home tests: 100 calls, 70 answered by
 * the agents, with a billing topic well below the average, two agents, and
 * every quality figure measured. Override what a test needs.
 */
export function makeReport(over: Partial<Report> = {}): Report {
  const dates = ['2023-11-08', '2023-11-09', '2023-11-10', '2023-11-11', '2023-11-12', '2023-11-13', '2023-11-14']
  const resolved = [10, 10, 10, 10, 10, 10, 10]
  const handedOver = [3, 3, 3, 3, 3, 3, 2]
  const dropped = [2, 2, 1, 1, 1, 1, 2]
  const byHour = Array.from({ length: 24 }, () => 0)
  byHour[10] = 18
  byHour[11] = 12
  byHour[15] = 10
  byHour[9] = 10
  byHour[14] = 8
  return {
    days: 7,
    totals: { calls: 100, byAgent: 70, handedOver: 20, dropped: 10, avgDurationSec: 95 },
    previous: { calls: 90, byAgent: 70, handedOver: 12, dropped: 8, avgDurationSec: 80 },
    byDay: dates.map((date, i) => ({ date, resolved: resolved[i], handedOver: handedOver[i], dropped: dropped[i] })),
    byHour,
    byDayHour: Array.from({ length: 7 }, (_, d) => byHour.map((n) => (d === 1 ? n : 0))),
    languages: [
      { language: 'english', calls: 60 },
      { language: 'tamil', calls: 40 },
    ],
    intents: [
      { label: 'Book an appointment', calls: 40, byAgent: 36 },
      { label: 'Billing question', calls: 25, byAgent: 10 },
      { label: 'Doctor timings', calls: 3, byAgent: 3 },
    ],
    dropOff: [
      { step: 'Collect details', calls: 18 },
      { step: 'Greeting', calls: 12 },
    ],
    quality: {
      analysed: 100,
      success: 62,
      sentiment: { positive: 70, neutral: 20, negative: 10 },
      firstWordMs: 900,
      replyP50Ms: 1400,
      replyP95Ms: 3200,
      speechMs: 350,
      languageMs: 800,
      voiceMs: 300,
      interruptionsPerCall: 0.4,
    },
    agents: [
      { agentId: 'ag_1', name: 'Reception', calls: 60, byAgent: 45, success: 40, replyP50Ms: 1300 },
      { agentId: 'ag_2', name: 'Appointments', calls: 40, byAgent: 25, success: 22, replyP50Ms: 1500 },
    ],
    ...over,
  }
}

/** The same with nothing measured, as the API sends it before the voice servers send quality. */
export const NO_QUALITY: Report['quality'] = {
  success: null,
  sentiment: null,
  firstWordMs: null,
  replyP50Ms: null,
  replyP95Ms: null,
  speechMs: null,
  languageMs: null,
  voiceMs: null,
  interruptionsPerCall: null,
}
