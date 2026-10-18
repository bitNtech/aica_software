import { useEffect, useRef } from 'react'
import { CONTACT } from '../content'
import './Footer.css'

/**
 * bitntech.in's footer, as it is there: the pink that pours up into the page
 * above it, the "What if" lines, both link columns and the BitNTech watermark.
 * The only changes are that its links point at bitntech.in (this page is on
 * its own subdomain) and the bubbles are seeded, so the prerendered HTML and
 * the hydrated page draw the same ones.
 */

const BUBBLE_COUNT = 60

const WHAT_IF = [
  'What if your idea wasn’t just an idea?',
  'What if it could move?',
  'What if it could see?',
  'What if it could think?',
  'What if it could scale?',
]

const SITE = CONTACT.site
const NAV_COLUMNS = [
  {
    heading: 'BitNtech',
    links: [
      { label: 'About', href: `${SITE}/about` },
      { label: 'Products', href: `${SITE}/products` },
      { label: 'Solutions', href: `${SITE}/#solutions` },
      { label: 'Industries', href: `${SITE}/#industries` },
      { label: 'Contact', href: `${SITE}/contact` },
    ],
  },
  {
    heading: 'Connect',
    links: [
      { label: 'LinkedIn', href: CONTACT.linkedin },
      { label: 'Instagram', href: CONTACT.instagram },
      { label: 'GitHub', href: CONTACT.github },
      { label: 'Email', href: CONTACT.emailHref },
      { label: CONTACT.phone, href: CONTACT.phoneHref },
    ],
  },
] as const

/* Mulberry32: the same sixty bubbles on the server and in the browser. */
function seeded(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = seeded(20261005)
const bubbles = Array.from({ length: BUBBLE_COUNT }, (_, i) => ({
  key: i,
  size: 2 + rand() * 4,
  distance: 6 + rand() * 4,
  position: -5 + rand() * 110,
  time: 2 + rand() * 2,
  delay: -1 * (2 + rand() * 2),
}))

const external = (href: string) => /^https?:/.test(href)

export default function Footer() {
  /* Sixty circles under a gaussian filter is the most expensive paint on the
     page; it only runs while the footer is near the screen. */
  const bubblesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bubblesRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => el.classList.toggle('is-paused', !entry.isIntersecting),
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <footer className="site-footer">
      <div className="bubbles is-paused" ref={bubblesRef}>
        {bubbles.map((b) => (
          <div
            className="bubble"
            key={b.key}
            style={
              {
                '--size': `${b.size.toFixed(3)}rem`,
                '--distance': `${b.distance.toFixed(3)}rem`,
                '--position': `${b.position.toFixed(3)}%`,
                '--time': `${b.time.toFixed(3)}s`,
                '--delay': `${b.delay.toFixed(3)}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="content">
        <div className="footer-grid">
          {[NAV_COLUMNS[0]].map((col) => (
            <div className="columns" key={col.heading}>
              <b>{col.heading}</b>
              {col.links.map((link) => (
                <a key={link.label} href={link.href}>{link.label}</a>
              ))}
            </div>
          ))}

          <div className="what-if">
            {WHAT_IF.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p className="what-if-final">Engineering the next Evolution.</p>
            <a className="what-if-cta" href={`${SITE}/contact`}>Start a Project</a>
            <hr className="what-if-divider" />
          </div>

          <div className="columns">
            <b>{NAV_COLUMNS[1].heading}</b>
            {NAV_COLUMNS[1].links.map((link) => (
              <a key={link.label} href={link.href} {...(external(link.href) ? { target: '_blank', rel: 'noreferrer' } : {})}>
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div className="brand-watermark" aria-hidden="true">BitN<em>Tech</em></div>
      </div>

      <svg aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id="blob">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="blob" />
          </filter>
        </defs>
      </svg>
    </footer>
  )
}
