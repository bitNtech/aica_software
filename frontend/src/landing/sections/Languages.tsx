import { useEffect, useRef, useState } from 'react'
import { SAMPLES } from '../content'
import { track } from '../lib/analytics'
import { useOnScreen, useReducedMotion } from '../lib/hooks'
import './Languages.css'

/**
 * "Tamil. English. Tanglish." — the heading is the switch. Each word picks a
 * conversation; the caller's line is set big and AICA's reply types itself out
 * under it. It moves on by itself while on screen until someone picks one.
 */

const ADVANCE_MS = 7000

/* Typed out by grapheme, so a Tamil vowel sign never shows up without its letter. */
const graphemes = (text: string): string[] =>
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? Array.from(new Intl.Segmenter('ta', { granularity: 'grapheme' }).segment(text), (g) => g.segment)
    : [...text]

export default function Languages() {
  const reduced = useReducedMotion()
  const [i, setI] = useState(0)
  const [held, setHeld] = useState(false)
  const [typed, setTyped] = useState(0)
  const [ref, onScreen] = useOnScreen<HTMLElement>('0px')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const s = SAMPLES[i]
  const reply = graphemes(s.reply)

  useEffect(() => {
    setTyped(reduced ? reply.length : 0)
  }, [i, reduced, reply.length])

  useEffect(() => {
    if (!onScreen || reduced || typed >= reply.length) return
    const t = window.setTimeout(() => setTyped((n) => n + 1), typed === 0 ? 700 : 28)
    return () => window.clearTimeout(t)
  }, [onScreen, reduced, typed, reply.length])

  useEffect(() => {
    if (!onScreen || reduced || held) return
    const t = window.setTimeout(() => setI((v) => (v + 1) % SAMPLES.length), ADVANCE_MS)
    return () => window.clearTimeout(t)
  }, [onScreen, reduced, held, i])

  const pick = (k: number) => {
    setHeld(true)
    setI(k)
  }

  const play = () => {
    if (!s.audio) return
    audioRef.current?.pause()
    audioRef.current = new Audio(s.audio)
    void audioRef.current.play()
    track('audio_sample_play', { sample: s.key })
  }

  return (
    <section className="langs" ref={ref} aria-labelledby="langs-title">
      <div className="langs__glow" aria-hidden="true" />
      <div className="wrap">
        <p className="label">03 <i>/</i> Languages</p>
        <h2 className="sr-only" id="langs-title">Tamil. English. Tanglish. All in one call.</h2>

        <div className="langs__switch rise" role="tablist" aria-label="Choose a language">
          {SAMPLES.map((x, k) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              id={`lang-tab-${x.key}`}
              aria-selected={k === i}
              aria-controls="lang-panel"
              className={`langs__word display${k === i ? ' is-on' : ''}`}
              onClick={() => pick(k)}
            >
              {x.tab}<span className="langs__dot">.</span>
              {k === i && !held && !reduced && <span className="langs__timer" key={i} style={{ animationDuration: `${ADVANCE_MS}ms` }} />}
            </button>
          ))}
        </div>
        <p className="langs__tag display" aria-hidden="true">All in <em>one call.</em></p>

        <div className="langs__panel" id="lang-panel" role="tabpanel" aria-labelledby={`lang-tab-${s.key}`} key={s.key}>
          <div className="langs__caller">
            <span className="langs__who">Caller</span>
            <p className="langs__said" lang={s.callerLang}>{s.caller}</p>
          </div>
          <div className="langs__aica">
            <span className="langs__who langs__who--aica"><i />AICA</span>
            <p className="langs__reply" lang={s.replyLang}>
              <span className="sr-only">{s.reply}</span>
              <span aria-hidden="true">{reply.slice(0, typed).join('')}</span>
              <span className={`langs__caret${typed >= reply.length ? ' is-done' : ''}`} aria-hidden="true" />
            </p>
            {s.audio && (
              <button type="button" className="btn btn--line btn--sm langs__play" onClick={play}>▶ Hear it</button>
            )}
          </div>
          {s.gloss && <p className="langs__gloss">{s.gloss}</p>}
        </div>

        <p className="langs__foot">
          AICA replies in the register the caller speaks in — not formal written Tamil, not a translation layer.
          <span> Example conversations.</span>
        </p>
      </div>
    </section>
  )
}
