import { useEffect, useRef, type CSSProperties } from 'react'
import { CAPABILITIES } from '../content'
import { clock, useTicker } from '../lib/hooks'
import './Showcase.css'

/**
 * The hero's floating console: an illustration of one example call at a
 * hospital front desk, replayed panel by panel. It is labelled as an
 * illustration on screen and hidden from assistive tech — the same story is
 * told in words by the sections below. No numbers here are live data.
 */

const STEPS = [
  { key: 'ring', who: 'caller', top: 'Incoming call', text: 'Line 02 · Ringing' },
  { key: 'answer', who: 'aica', top: 'AICA', text: 'வணக்கம்! How can I help?' },
  { key: 'hear', who: 'caller', top: 'Caller', text: 'Appointment book பண்ணணும்…' },
  { key: 'book', who: 'aica', top: 'AICA', text: 'Sure. Tomorrow 10:30 AM slot free-ஆ இருக்கு.' },
  { key: 'done', who: 'done', top: 'Booked on the call', text: 'Tomorrow · 10:30 AM' },
] as const
const STEP_MS = 2600

/* The first four moments of a call, from the page's own capability list. */
const MOMENTS = CAPABILITIES.slice(0, 4)

const isTamil = (s: string) => /[஀-௿]/.test(s)
/* A fixed waveform shape: the same bars on the server and in the browser. */
const BARS = Array.from({ length: 36 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21)))

export default function Showcase({ live }: { live: boolean }) {
  const step = useTicker(live, STEP_MS) % STEPS.length
  const seconds = useTicker(live)
  const stage = useRef<HTMLDivElement>(null)
  const now = STEPS[step]
  const speaking = now.who === 'aica'
  const shown = STEPS.slice(1, step + 1).filter((s) => s.key !== 'done')

  /* A gentle tilt toward the pointer, clamped; none on touch or with reduced motion. */
  useEffect(() => {
    const el = stage.current
    if (!el || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    let x = 0
    let y = 0
    const apply = () => {
      frame = 0
      el.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`)
      el.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`)
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)))
      y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)))
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const onLeave = () => {
      x = 0
      y = 0
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const host = el.closest('section') ?? el
    host.addEventListener('pointermove', onMove as EventListener)
    host.addEventListener('pointerleave', onLeave)
    return () => {
      host.removeEventListener('pointermove', onMove as EventListener)
      host.removeEventListener('pointerleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <figure className={`show is-${now.key}`} aria-hidden="true">
      <div className="show__stage" ref={stage}>
        {/* The main window: the call as AICA handles it. */}
        <div className="show__main">
          <div className="show__bar">
            <span className="show__title"><i />Front desk · Line 02</span>
            <span className="show__tag">Illustration</span>
          </div>

          <div className="show__call">
            <div className="show__orb">
              <picture>
                <source srcSet="/assets/img/aica-orb.webp" type="image/webp" />
                <img src="/assets/img/aica-orb.jpg" alt="" width="560" height="560" decoding="async" />
              </picture>
              <span className="show__ring" />
            </div>
            <div className="show__status">
              <small>{now.key === 'ring' ? 'Incoming' : now.key === 'done' ? 'Call wrapping up' : 'On the call'}</small>
              <b>{now.key === 'ring' ? 'Ringing…' : speaking ? 'AICA is speaking' : now.key === 'done' ? 'Appointment booked' : 'Listening'}</b>
              <span className="show__time">{clock(now.key === 'ring' ? 0 : 1 + (seconds % 50))}</span>
            </div>
          </div>

          <div className={`show__wave${speaking ? ' is-speaking' : now.key === 'hear' ? ' is-hearing' : ''}`}>
            {BARS.map((h, i) => (
              <span key={i} style={{ '--h': h.toFixed(3), '--i': i } as CSSProperties} />
            ))}
          </div>

          <ol className="show__talk">
            {shown.map((s) => (
              <li key={s.key} className={`show__msg show__msg--${s.who}`}>
                <small>{s.top}</small>
                <span lang={isTamil(s.text) ? 'ta' : undefined}>{s.text}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* A floating panel: the moments of a call, the current one lit. */}
        <div className="show__side show__moments">
          <p className="show__head">On this call</p>
          <ol>
            {MOMENTS.map((m, k) => (
              <li key={m.key} className={k <= Math.max(0, step - 1) ? 'is-on' : ''}>
                <span>{m.at}</span>
                {m.title}
              </li>
            ))}
          </ol>
        </div>

        {/* A floating chip: the languages AICA answers in. */}
        <div className="show__side show__langs">
          <span className={now.key === 'answer' || now.key === 'book' ? 'is-on' : ''} lang="ta">தமிழ்</span>
          <span>English</span>
          <span className={now.key === 'hear' ? 'is-on' : ''}>Tanglish</span>
        </div>

        {/* The outcome, arriving when the booking is made. */}
        <div className={`show__side show__done${now.key === 'done' ? ' is-on' : ''}`}>
          <span className="show__tick"><svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9" /></svg></span>
          <span><small>Booked on the call</small><b>Tomorrow · 10:30 AM</b></span>
        </div>
      </div>
      <figcaption className="show__cap">Illustration · an example call at a hospital front desk</figcaption>
    </figure>
  )
}
