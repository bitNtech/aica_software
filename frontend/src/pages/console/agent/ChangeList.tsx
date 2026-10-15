import type { SpecChange } from './diff'

/** What changed between two setups, area by area. */
export function ChangeList({ changes, empty }: { changes: SpecChange[]; empty: string }) {
  if (changes.length === 0) return <p className="empty-note">{empty}</p>
  return (
    <dl className="changes">
      {changes.map((c) => (
        <div key={c.area} className="changes__area">
          <dt>{c.area}</dt>
          <dd>
            <ul>
              {c.changes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  )
}
