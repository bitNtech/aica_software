import { memo, type CSSProperties } from 'react'

export type PulseMode = 'idle' | 'listening' | 'busy' | 'ok' | 'error'

const BARS = 56

/** A fixed, speech-like envelope, so the line looks the same on every
 * render and in every screenshot. */
const SHAPE = Array.from({ length: BARS }, (_, i) => {
  const t = i / (BARS - 1)
  const env = Math.sin(Math.PI * t) ** 0.8
  const voice = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43))
  return Math.max(0.08, env * voice)
})

/**
 * AICA's voice line, in AICA blue. It breathes while idle, follows the
 * person typing, speeds up while a request runs, and settles flat on an
 * error. With reduced motion it stays as a still snapshot — the state is
 * still readable from the shape and the status text beside it.
 */
export const PulseLine = memo(function PulseLine({ mode = 'idle', className }: { mode?: PulseMode; className?: string }) {
  return (
    <div className={['pulse', `pulse--${mode}`, className].filter(Boolean).join(' ')} aria-hidden="true">
      {SHAPE.map((h, i) => (
        <span key={i} className="pulse__bar" style={{ '--h': h.toFixed(3), '--i': i } as CSSProperties} />
      ))}
    </div>
  )
})
