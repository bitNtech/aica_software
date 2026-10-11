import { useEffect, useRef, useState } from 'react'
import { CAPABILITIES, type CapabilityKey } from '../content'
import CallScreen from './CallScreen'
import './Capabilities.css'

/**
 * "Meet AICA." — what it does, shown on one call from first ring to hand-off
 * rather than claimed in a grid. On wide screens the call card holds still
 * while the beats scroll past it, and redraws as each one reaches the middle
 * of the screen; on phones every beat carries its own card.
 */
export default function Capabilities() {
  const [active, setActive] = useState<CapabilityKey>(CAPABILITIES[0].key)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const items = listRef.current?.querySelectorAll<HTMLElement>('[data-beat]')
    if (!items?.length) return
    /* A thin band across the middle of the screen: whichever beat is in it is the one on the card. */
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.getAttribute('data-beat') as CapabilityKey)
    }, { rootMargin: '-48% 0px -48% 0px' })
    items.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <section className="caps paper" id="meet" aria-labelledby="caps-title">
      <div className="wrap">
        <header className="caps__head rise">
          <p className="caps__meet display" aria-hidden="true">
            <span className="ghost">Meet</span> AICA<em>.</em>
          </p>
          <div className="caps__intro">
            <p className="label">02 <i>/</i> Capabilities</p>
            <h2 className="display caps__title" id="caps-title">What AICA does on <em>every call.</em></h2>
            <p className="caps__lede">One call, start to finish — and the ones after hours.</p>
          </div>
        </header>

        <div className="caps__body">
          <div className="caps__screen" aria-hidden="true">
            <div className="caps__sticky">
              <CallScreen key={active} beat={active} />
              <p className="caps__note">Example call · a hospital front desk</p>
            </div>
          </div>

          <ol className="caps__list" ref={listRef}>
            {CAPABILITIES.map((c, i) => (
              <li key={c.key} data-beat={c.key} className={`caps__beat${active === c.key ? ' is-active' : ''}`}>
                <span className="caps__at">{c.at}</span>
                <h3>
                  <span className="caps__n">{String(i + 1).padStart(2, '0')}</span>
                  {c.title}
                </h3>
                <p>{c.body}</p>
                <div className="caps__inline" aria-hidden="true">
                  <CallScreen beat={c.key} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
