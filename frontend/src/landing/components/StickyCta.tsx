import { useEffect, useState } from 'react'
import { track } from '../lib/analytics'
import './StickyCta.css'

/** Phones only: "Book a demo" stays in reach between the hero and the form, and gets out of the way after. */
export default function StickyCta() {
  const [on, setOn] = useState(false)

  useEffect(() => {
    const hero = document.getElementById('top')
    const demo = document.getElementById('demo')
    let frame = 0
    const measure = () => {
      frame = 0
      const pastHero = hero ? hero.getBoundingClientRect().bottom < 0 : window.scrollY > 600
      const beforeForm = demo ? demo.getBoundingClientRect().top > window.innerHeight * 0.85 : true
      setOn(pastHero && beforeForm)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <a
      href="#demo"
      className={`sticky-cta btn btn--orange${on ? ' is-on' : ''}`}
      aria-hidden={!on}
      tabIndex={on ? 0 : -1}
      onClick={() => track('cta_book_demo_click', { location: 'sticky' })}
    >
      Book a demo <span className="arrow" aria-hidden="true">↗</span>
    </a>
  )
}
