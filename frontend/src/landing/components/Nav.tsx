import { useEffect, useRef, useState } from 'react'
import { CONSOLE } from '../content'
import { track } from '../lib/analytics'
import { useSignedIn } from '../lib/session'
import './Nav.css'

/** The page's own chapters, in reading order. Each is a section id. */
const LINKS = [
  { href: '#film', label: 'Film' },
  { href: '#meet', label: 'What it does' },
  { href: '#languages', label: 'Languages' },
  { href: '#uses', label: 'Use cases' },
  { href: '#how', label: 'How it works' },
] as const

/**
 * A floating glass bar: the mark, the page's chapters (wide screens), a
 * quiet way into the console for existing customers, and "Book a demo".
 * A hairline along its foot fills as the page is read; the chapter in view
 * is marked.
 */
export default function Nav() {
  const fill = useRef<HTMLSpanElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [current, setCurrent] = useState('')
  const signedIn = useSignedIn()

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      setScrolled(y > 24)
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (fill.current) fill.current.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`
    }
    const on = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  /* Whichever chapter crosses the middle of the screen is the current one. */
  useEffect(() => {
    const els = LINKS.map((l) => document.querySelector(l.href)).filter((el): el is Element => !!el)
    if (!els.length || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setCurrent(`#${e.target.id}`)
    }, { rootMargin: '-50% 0px -50% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className={`nav${scrolled ? ' is-scrolled' : ''}`}>
      <header className="nav__bar">
        <a href="#top" className="nav__brand" aria-label="AICA by BitNTech — back to the top">
          <span className="nav__mark" aria-hidden="true"><i /></span>
          <span className="nav__word">AICA</span>
          <span className="nav__by">by BitNTech</span>
        </a>
        <nav className="nav__links" aria-label="On this page">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="nav__link" aria-current={current === l.href ? 'location' : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav__actions">
          <a
            href={signedIn ? CONSOLE.home : CONSOLE.signIn}
            className="nav__console"
            onClick={() => track('console_click', { location: 'nav', action: signedIn ? 'open' : 'sign_in' })}
          >
            {signedIn ? 'Open console' : 'Sign in'}
          </a>
          <a href="#demo" className="nav__cta" onClick={() => track('cta_book_demo_click', { location: 'nav' })}>
            Book a demo <span aria-hidden="true">↗</span>
          </a>
        </div>
        <span className="nav__progress" aria-hidden="true"><span ref={fill} /></span>
      </header>
    </div>
  )
}
