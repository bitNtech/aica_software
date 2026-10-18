import { LINES, PROBLEM, QUESTIONS } from '../content'
import { clock, useOnScreen, useReducedMotion, useScrollProgress, useTicker } from '../lib/hooks'
import './Problem.css'

/**
 * The problem, told the way the film opens: a switchboard that never stops
 * ringing. The section is three screens tall and its stage is sticky, so
 * scrolling moves it through three beats — the same questions all day, the
 * calls nobody picks up after hours, and the caller a bot can't follow.
 */

const STATUS = { ringing: 'Ringing', waiting: 'Waiting', hold: 'On hold' } as const

/* What a single-language bot says back to a Tanglish caller. */
const BOT = 'Sorry, I didn’t understand.'

export default function Problem() {
  const reduced = useReducedMotion()
  const [trackRef, p] = useScrollProgress<HTMLElement>()
  const [stageRef, onScreen] = useOnScreen<HTMLDivElement>('0px')
  const seconds = useTicker(onScreen && !reduced)
  const beat = p < 0.34 ? 0 : p < 0.68 ? 1 : 2

  return (
    <section className={`problem is-beat-${beat}`} ref={trackRef} aria-labelledby="problem-title">
      <div className="problem__stage" ref={stageRef}>
        <div className="problem__inner wrap">
          <div className="problem__copy">
            <p className="label">
              <span className="problem__count">0{beat + 1}</span> <i>/</i> 03 <i>·</i> The problem
            </p>
            <h2 className="display problem__title" id="problem-title">
              Your team answers the same questions <em>all day.</em>
            </h2>

            {/* Every beat is in the DOM, so a screen reader and a crawler get
                all three; only the current one is on screen. */}
            <div className="problem__beats">
              {PROBLEM.map((b, i) => (
                <article key={b.key} className={`problem__beat${i === beat ? ' is-on' : ''}`} aria-hidden={i !== beat}>
                  <p className="problem__stat">
                    <b>{b.stat}</b>
                    <span>{b.statLabel}</span>
                  </p>
                  <h3>{b.title}</h3>
                  <p>{b.body}</p>
                </article>
              ))}
            </div>

            <ol className="problem__ticks" aria-hidden="true">
              {PROBLEM.map((b, i) => (
                <li key={b.key} className={i <= beat ? 'on' : ''} style={{ '--fill': i < beat ? 1 : i === beat ? (p * 3 - i) : 0 } as React.CSSProperties}>
                  <i />
                </li>
              ))}
            </ol>
          </div>

          <div className="board" aria-hidden="true">
            <div className="board__head">
              <span>Front desk</span>
              <span className="board__clock">{beat === 1 ? '11:48 PM' : `Tue 10:${String(12 + Math.floor(seconds / 60)).padStart(2, '0')} AM`}</span>
            </div>
            <ul className="board__grid">
              {LINES.map((l, i) => {
                const missedAt = `11:${String(47 - i).padStart(2, '0')} PM`
                /* Two lines at a time surface what their caller is asking. */
                const k = Math.floor(seconds / 2)
                const ask = i === (k * 5) % LINES.length ? k : i === (k * 5 + 7) % LINES.length ? k + 2 : -1
                const asking = beat === 0 && ask >= 0
                return (
                  <li key={l.n} className={`line line--${l.status}`} style={{ '--i': i } as React.CSSProperties}>
                    <span className="line__n">Line {l.n}</span>
                    <span className="line__state">
                      <span className="line__live">
                        <i />{STATUS[l.status]}
                        <em>{clock(l.t + seconds)}</em>
                      </span>
                      <span className="line__missed"><i />Missed call<em>{missedAt}</em></span>
                      <span className="line__bot">
                        <b lang="ta">{QUESTIONS[i % QUESTIONS.length]}</b>
                        <span><i>✕</i>{BOT}</span>
                      </span>
                    </span>
                    {asking && <span className="line__ask" lang="ta" key={k}>{QUESTIONS[ask % QUESTIONS.length]}</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
