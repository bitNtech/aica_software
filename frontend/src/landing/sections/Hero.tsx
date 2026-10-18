import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FILM, HERO } from '../content'
import { track } from '../lib/analytics'
import { useOnScreen, useReducedMotion, useTicker } from '../lib/hooks'
import { playFilm } from './Film'
import './Hero.css'

/**
 * The opener, staged like the film's own title card: the orb in the middle of
 * the dark, the line set across its foot. One idea per layer — the orb is the
 * product, the headline is the promise, and the one word that changes
 * (தமிழ் → English → Tanglish) is the proof. A call notification beside the orb
 * plays the call the film shows; the corners carry the small print, as they do
 * on bitntech.in's home hero.
 */

const WORDS = [
  { text: 'தமிழ்', lang: 'ta' },
  { text: 'English', lang: 'en' },
  { text: 'Tanglish', lang: 'en' },
] as const
const WORD_MS = 2400

const CALL = [
  { key: 'ring', tone: 'caller', top: 'Incoming call', main: 'Line 02 · Ringing' },
  { key: 'answer', tone: 'aica', top: 'Answered by AICA', main: 'வணக்கம்! How can I help?' },
  { key: 'hear', tone: 'caller', top: 'Caller', main: 'Appointment book பண்ணணும்…' },
  { key: 'done', tone: 'done', top: 'Booked on the call', main: 'Tomorrow · 10:30 AM' },
] as const

const isTamil = (s: string) => /[஀-௿]/.test(s)

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
      {running && <span className="rot__bar" key={tick} style={{ animationDuration: `${WORD_MS}ms` }} />}
    </span>
  )
}

export default function Hero() {
  const reduced = useReducedMotion()
  const [ref, onScreen] = useOnScreen<HTMLElement>()
  const live = onScreen && !reduced
  const step = useTicker(live, 2600) % CALL.length
  const now = CALL[step]

  return (
    <section className={`hero is-${now.key}`} id="top" ref={ref} aria-labelledby="hero-title">
      <div className="hero__sky" aria-hidden="true">
        <span className="hero__wave" />
        <span className="hero__wave hero__wave--2" />
        <span className="hero__wave hero__wave--3" />
      </div>

      <div className="hero__stage wrap">
        <div className="hero__orb" aria-hidden="true">
          <span className="orb__ripple" />
          <span className="orb__ripple orb__ripple--2" />
          <span className="orb__ring" />
          <picture>
            <source srcSet="/assets/img/aica-orb.webp" type="image/webp" />
            <img className="orb__img" src="/assets/img/aica-orb.jpg" alt="" width="560" height="560" decoding="async" fetchPriority="high" />
          </picture>

          <div className={`notif notif--${now.tone}`}>
            <span className="notif__icon">
              {now.tone === 'done'
                ? <svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9" /></svg>
                : <svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>}
            </span>
            <span className="notif__text" key={now.key}>
              <small>{now.top}</small>
              <b lang={isTamil(now.main) ? 'ta' : undefined}>{now.main}</b>
            </span>
          </div>
        </div>

        <h1 className="hero__title display" id="hero-title">
          <span className="hero__line">Every call</span> <span className="hero__line">answered<em>.</em></span>
          <span className="sr-only"> In your customer’s language — Tamil, English or Tanglish.</span>
        </h1>
        <p className="hero__in" aria-hidden="true">
          In <Rotator running={live} />.
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
      </div>

      <div className="hero__corners wrap" aria-hidden="true">
        <p className="hero__corner">
          <b>AICA</b> AI voice agent
          <span>by BitN<em>Tech</em></span>
        </p>
        <p className="hero__corner hero__corner--r">
          Answer. Understand.
          <span>Resolve. <em>24/7.</em></span>
        </p>
      </div>
    </section>
  )
}
