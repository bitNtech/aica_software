import { STEPS } from '../content'
import { useScrollProgress } from '../lib/hooks'
import './Steps.css'

/**
 * "Live in three steps." — bitntech.in's process list: a line that fills as
 * the list passes the middle of the screen, and each numbered box fills as the
 * line reaches it.
 */
export default function Steps() {
  const [ref, p] = useScrollProgress<HTMLDivElement>('center')
  return (
    <section className="steps paper" aria-labelledby="steps-title">
      <div className="steps__inner wrap">
        <div className="steps__head rise">
          <p className="label">04 <i>/</i> How it works</p>
          <h2 className="display steps__title" id="steps-title">Live in <em>three</em> steps.</h2>
          <p className="steps__lede">We do the setup. Your team tells us how the desk works; AICA learns to work it.</p>
        </div>

        <div className="steps__track" ref={ref}>
          <div className="steps__rail" aria-hidden="true"><i style={{ transform: `scaleY(${p})` }} /></div>
          <ol className="steps__list">
            {STEPS.map(([n, title, body], k) => {
              const fill = Math.min(1, Math.max(0, p * STEPS.length - k))
              return (
                <li key={n} className={`steps__item${fill > 0 ? ' is-on' : ''}`}>
                  <span className="steps__num" style={{ '--fill': fill } as React.CSSProperties}><b>{n}</b></span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
