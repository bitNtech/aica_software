import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FILM, HERO } from '../content'
import { track } from '../lib/analytics'
import { useOnScreen, useReducedMotion, useTicker } from '../lib/hooks'
import { playFilm } from './Film'
import Showcase from './Showcase'
import './Hero.css'

/**
 * The opener: the promise on the left, AICA itself on the right — a
 * floating console replaying one example call, panel by panel. The one word
 * that changes (தமிழ் → English → Tanglish) is the proof under the promise.
 */

const WORDS = [
  { text: 'தமிழ்', lang: 'ta' },
  { text: 'English', lang: 'en' },
  { text: 'Tanglish', lang: 'en' },
] as const
const WORD_MS = 2400

/** One word in a sentence that keeps changing; the slot eases to each word's width. */
function Rotator({ running }: { running: boolean }) {
  const tick = useTicker(running, WORD_MS)
  const i = tick % WORDS.length
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  const [width, setWidth] = useState<number | undefined>(undefined)

  /* Rounded up: offsetWidth rounds down and shaved the last letter. */
  const measure = (k: number) => {
    const el = refs.current[k]
    if (el) setWidth(Math.ceil(el.getBoundingClientRect().width))
  }
  useLayoutEffect(() => measure(i), [i])
  /* Fonts land after first paint and change every width. */
  useEffect(() => {
    document.fonts?.ready.then(() => measure(i))
  }, [i])

  return (
    <span className="rot" style={width ? { width } : undefined}>
      {WORDS.map((w, k) => (
        <span
          key={w.text}
          ref={(el) => { refs.current[k] = el }}
          lang={w.lang}
          className={`rot__word${k === i ? ' is-on' : ''}${k === (i + WORDS.length - 1) % WORDS.length ? ' is-off' : ''}`}
        >
          {w.text}
        </span>
      ))}
    </span>
  )
}

export default function Hero() {
  const reduced = useReducedMotion()
  const [ref, onScreen] = useOnScreen<HTMLElement>()
  const live = onScreen && !reduced

  return (
    <section className="hero" id="top" ref={ref} aria-labelledby="hero-title">
      <div className="hero__inner wrap">
        <div className="hero__copy">
          <p className="label hero__label">{HERO.label}</p>
          <h1 className="hero__title display" id="hero-title">
            Every call <em>answered.</em>
            <span className="sr-only"> In your customer’s language — Tamil, English or Tanglish.</span>
          </h1>
          <p className="hero__in" aria-hidden="true">
            In <Rotator running={live} />, day and night.
          </p>

          <p className="hero__lead">{HERO.lead}</p>

          <div className="hero__ctas">
            <a className="btn btn--orange" href="#demo" onClick={() => track('cta_book_demo_click', { location: 'hero' })}>
              Book a demo <span className="arrow" aria-hidden="true">↗</span>
            </a>
            <a
              className="btn btn--line hero__watch"
              href="#film"
              onClick={(e) => {
                e.preventDefault()
                playFilm(0)
              }}
            >
              <span className="hero__play" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg>
              </span>
              Watch the film <em className="hero__dur">0:{FILM.seconds}</em>
            </a>
          </div>

          <ul className="hero__facts" aria-label="At a glance">
            <li><b lang="ta">தமிழ்</b> · English · Tanglish</li>
            <li><b>24/7</b> on every line</li>
            <li><b>Hands off</b> to your team</li>
          </ul>
        </div>

        <Showcase live={live} />
      </div>
    </section>
  )
}
