import { computeDelta, type Change } from './statDelta'

/**
 * One headline number: its label, the value, and how it moved against a
 * named earlier period. The change is said in words and marked with an
 * arrow, never colour alone; whether up is good decides the colour.
 */
export function StatTile({
  label,
  value,
  sub,
  change,
}: {
  label: string
  value: string
  /** A quieter line under the value, e.g. "of 214 calls". */
  sub?: string
  /** `words` for the direction, e.g. ["longer", "shorter"]; "more"/"fewer" by default. */
  change?: Change
}) {
  const delta = change ? computeDelta(change) : null
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
      {sub && <dd className="stat__sub">{sub}</dd>}
      {delta && (
        <dd className={`stat__delta stat__delta--${delta.tone}`}>
          {/* The arrow is for the eye; the words say the same. */}
          {delta.arrow && <span aria-hidden="true">{delta.arrow} </span>}
          {delta.text}
        </dd>
      )}
    </div>
  )
}
