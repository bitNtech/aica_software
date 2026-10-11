import { useState } from 'react'
import { USES } from '../content'
import './UseCases.css'

/**
 * "Built for businesses that live on the phone." An index, not a card grid:
 * one row per business, set big, opening to the calls AICA takes for it.
 * Hospitals open first — they are the first deployment focus.
 */
export default function UseCases() {
  const [open, setOpen] = useState<string>(USES[0].key)
  return (
    <section className="uses" aria-labelledby="uses-title">
      <div className="wrap">
        <header className="uses__head rise">
          <p className="label">05 <i>/</i> Use cases</p>
          <h2 className="display uses__title" id="uses-title">
            Built for businesses that <em>live on the phone.</em>
          </h2>
        </header>

        <ul className="uses__list">
          {USES.map((u, i) => {
            const isOpen = open === u.key
            return (
              <li key={u.key} className={`use rise${isOpen ? ' is-open' : ''}`} style={{ '--d': i } as React.CSSProperties}>
                <h3>
                  <button
                    type="button"
                    className="use__row"
                    aria-expanded={isOpen}
                    aria-controls={`use-${u.key}`}
                    onClick={() => setOpen(isOpen ? '' : u.key)}
                  >
                    <span className="use__n">{String(i + 1).padStart(2, '0')}</span>
                    <span className="use__name">{u.name}</span>
                    {u.tag && <span className="use__tag">{u.tag}</span>}
                    <span className="use__plus" aria-hidden="true" />
                  </button>
                </h3>
                <div className="use__panel" id={`use-${u.key}`} role="region" aria-label={u.name}>
                  <div className="use__panel-in">
                    {u.tag && <span className="use__tag use__tag--inline">{u.tag}</span>}
                    <p>{u.body}</p>
                    <ul className="use__calls">
                      {u.calls.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
