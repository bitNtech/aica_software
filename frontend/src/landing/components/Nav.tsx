import { useEffect, useRef, useState } from 'react'
import { CONSOLE } from '../content'
import { track } from '../lib/analytics'
import { useSignedIn } from '../lib/session'
import './Nav.css'

/**
 * bitntech.in's bar, cut down to what an ad page asks for: the mark,
 * "Book a demo", and a quiet way into the console for existing customers.
 * Same segmented progress strip along the top (one segment per section),
 * same glass that closes around the bar once the page moves,
 * and the same trick for the wordmark — it reads the ground under itself and
 * turns plum on paper, ivory on dark.
 */

function isDark(color: string): boolean | null {
  const rgb = color.match(/[\d.]+/g)
  if (!rgb || rgb.length < 3 || Number(rgb[3] ?? 1) < 0.5) return null
  const [r, g, b] = rgb.map(Number)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.55
}

function groundIsDark(x: number, y: number): boolean | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('.nav')) continue
    const style = getComputedStyle(el)
    if (style.mixBlendMode !== 'normal' || Number(style.opacity) < 0.9) continue
    const flat = isDark(style.backgroundColor)
    if (flat !== null) return flat
    for (const stop of style.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []) {
      const g = isDark(stop)
      if (g !== null) return g
    }
  }
  return null
}

export default function Nav() {
  const brandRef = useRef<HTMLAnchorElement>(null)
  const fills = useRef<(HTMLDivElement | null)[]>([])
  const [segments, setSegments] = useState(8)
  const [scrolled, setScrolled] = useState(false)
  const [onDark, setOnDark] = useState(true)
  const signedIn = useSignedIn()

  useEffect(() => {
    setSegments(Math.max(1, document.querySelectorAll('main > section').length))
  }, [])

  useEffect(() => {
    let frame = 0
    let idle = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      setScrolled(y > 36)
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? Math.min(1, y / max) : 0
      fills.current.forEach((el, i) => {
        if (el) el.style.transform = `scaleX(${Math.min(1, Math.max(0, p * segments - i))})`
      })
      const box = brandRef.current?.getBoundingClientRect()
      if (box) {
        const d = groundIsDark(box.left + box.width / 2, box.top + box.height / 2)
        if (d !== null) setOnDark(d)
      }
    }
    const on = () => {
      window.clearTimeout(idle)
      idle = window.setTimeout(update, 120)
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      window.clearTimeout(idle)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [segments])

  return (
    <div className={`nav${onDark ? ' nav--dark' : ''}${scrolled ? ' is-scrolled' : ''}`}>
      <div className="nav__progress" aria-hidden="true">
        {Array.from({ length: segments }, (_, i) => (
          <div key={i} className="nav__seg">
            <div ref={(el) => { fills.current[i] = el }} className="nav__fill" />
          </div>
        ))}
      </div>
      <header className="nav__bar">
        <span className="nav__glass" aria-hidden="true" />
        <a href="#top" className="nav__brand" ref={brandRef} aria-label="AICA by BitNTech — back to the top">
          <span className="nav__word">AICA<i>.</i></span>
          <span className="nav__by">by BitN<em>Tech</em></span>
        </a>
        <div className="nav__actions">
          <a
            href={signedIn ? CONSOLE.home : CONSOLE.signIn}
            className="nav__link"
            onClick={() => track('console_click', { location: 'nav', action: signedIn ? 'open' : 'sign_in' })}
          >
            {signedIn ? 'Open console' : 'Sign in'}
          </a>
          <a href="#demo" className="nav__cta" onClick={() => track('cta_book_demo_click', { location: 'nav' })}>
            Book a demo <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>
    </div>
  )
}
