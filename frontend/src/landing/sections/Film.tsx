import { useEffect, useRef, useState } from 'react'
import { FILM } from '../content'
import { track } from '../lib/analytics'
import { prefersLessMotion } from '../lib/hooks'
import './Film.css'

/**
 * The 43-second film. It never autoplays: AICA is a voice product, so the
 * sound is the demo. The cover is a real button; pressing it — or any chapter,
 * or the hero's "Watch the film" — plays it with sound and English captions on.
 */

const EVENT = 'aica:play-film'

/** Play the film from `at` seconds, from anywhere on the page. */
export function playFilm(at = 0) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: at }))
}

/* Where the film's own beats fall, from its voiceover. */
const CHAPTERS = [
  { at: 0, label: 'The calls keep coming' },
  { at: 12, label: 'Meet AICA' },
  { at: 16, label: 'Tamil, English, or both' },
  { at: 21, label: 'Books the appointment' },
  { at: 27, label: 'Hands over to your team' },
  { at: 31, label: 'Day and night' },
]

export default function Film() {
  const sectionRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const [time, setTime] = useState(0)
  const reported = useRef({ play: false, done: false })

  const start = (at: number) => {
    const v = videoRef.current
    if (!v) return
    setStarted(true)
    v.muted = false
    v.volume = 1
    /* preload="none" means there is no duration yet; seeking still works once
       metadata arrives, so queue it rather than drop it. */
    const seek = () => { v.currentTime = at }
    if (v.readyState >= 1) seek()
    else v.addEventListener('loadedmetadata', seek, { once: true })
    void v.play().catch(() => { /* blocked: the native controls are showing now */ })
  }

  useEffect(() => {
    const on = (e: Event) => {
      const at = Number((e as CustomEvent).detail) || 0
      sectionRef.current?.querySelector('.film__frame')?.scrollIntoView({ behavior: prefersLessMotion() ? 'auto' : 'smooth', block: 'center' })
      start(at)
    }
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])

  /* Scrolled well away: stop talking. */
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const io = new IntersectionObserver(([e]) => { if (!e.isIntersecting && !v.paused) v.pause() }, { threshold: 0.15 })
    io.observe(v)
    return () => io.disconnect()
  }, [])

  const current = CHAPTERS.reduce((acc, c, i) => (time >= c.at ? i : acc), 0)

  return (
    <section className="film" id="film" ref={sectionRef} aria-labelledby="film-title">
      <div className="wrap">
        <header className="film__head rise">
          <p className="label">The film <i>/</i> 0:{FILM.seconds}</p>
          <h2 className="display film__title" id="film-title">
            Watch it <span className="ghost">with</span> <em>sound.</em>
            <span className="film__eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </h2>
          <p className="film__lede">The calls keep coming. Forty-three seconds on what happens when AICA picks up.</p>
        </header>

        <figure className={`film__frame${started ? ' is-started' : ''}${playing ? ' is-playing' : ''}`}>
          <video
            ref={videoRef}
            className="film__video"
            preload="none"
            playsInline
            controls={started}
            poster={FILM.poster}
            width={1920}
            height={1080}
            title={FILM.title}
            onPlay={() => {
              setPlaying(true)
              setStarted(true)
              if (!reported.current.play) { reported.current.play = true; track('video_play') }
            }}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onEnded={() => {
              setPlaying(false)
              if (!reported.current.done) { reported.current.done = true; track('video_complete') }
            }}
          >
            {/* MP4 (H.264 + AAC) first: Safari will pick a WebM it can show but
                not always hear. WebM is for browsers without H.264. */}
            <source src={FILM.mp4} type="video/mp4" />
            <source src={FILM.webm} type="video/webm" />
            {FILM.captions.map((c) => (
              <track key={c.lang} kind="captions" src={c.src} srcLang={c.lang} label={c.label} default={c.default} />
            ))}
          </video>

          {!started && (
            <button type="button" className="film__cover" onClick={() => start(0)}>
              <img src={FILM.poster} alt="" width="1280" height="720" loading="lazy" decoding="async" />
              <span className="film__play">
                <span className="film__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg>
                </span>
                <span>Watch with sound</span>
                <em>0:{FILM.seconds}</em>
              </span>
              <span className="sr-only"> — plays the AICA film with sound and captions</span>
            </button>
          )}
        </figure>

        <div className="film__meta">
          <ol className="film__chapters" aria-label="Jump to a moment in the film">
            {CHAPTERS.map((c, i) => (
              <li key={c.at}>
                <button
                  type="button"
                  className={started && i === current ? 'is-current' : ''}
                  onClick={() => start(c.at)}
                >
                  <b>0:{String(c.at).padStart(2, '0')}</b>
                  {c.label}
                </button>
              </li>
            ))}
          </ol>
          <p className="film__note">Sound on · Captions in English and தமிழ்</p>
        </div>
      </div>
    </section>
  )
}
