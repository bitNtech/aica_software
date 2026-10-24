/** How a headline number moved against a named earlier period. */
export interface Change {
  now: number
  before: number
  /** The earlier period, in words: "last week". */
  period: string
  /** Whether a rise is good news (decides the colour, never the wording). */
  upIsGood: boolean
  format?(n: number): string
  /** `words` for the direction, e.g. ["longer", "shorter"]; "more"/"fewer" by default. */
  words?: [string, string]
}

export interface Delta {
  arrow: string
  text: string
  tone: 'good' | 'bad' | 'flat'
}

/** The wording, arrow and tone for a change: shared by StatTile and
 * KpiCard so the two always say the same thing. */
export function computeDelta(change: Change): Delta {
  const diff = change.now - change.before
  const fmt = change.format ?? ((n: number) => n.toLocaleString('en-IN'))
  const [up, down] = change.words ?? ['more', 'fewer']
  if (diff === 0 || !Number.isFinite(diff)) return { arrow: '', text: `Same as ${change.period}`, tone: 'flat' }
  return {
    arrow: diff > 0 ? '▲' : '▼',
    text: `${fmt(Math.abs(diff))} ${diff > 0 ? up : down} than ${change.period}`,
    tone: diff > 0 === change.upIsGood ? 'good' : 'bad',
  }
}
