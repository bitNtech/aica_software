import type { ReactNode } from 'react'
import './Workspace.css'

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'live'

/**
 * A small inline icon per tone, so a status is never told by colour alone:
 * each tone has its own shape (circle, "i", tick, triangle, diamond, waves).
 * Decorative: the text beside it says the same thing.
 */
export function ToneIcon({ tone, size = 14 }: { tone: Tone; size?: number }) {
  const shape: Record<Tone, ReactNode> = {
    neutral: <path d="M5.5 8h5" />,
    info: <path d="M8 7.2v3.6M8 5.2h0" />,
    ok: <path d="m5.2 8.2 2 2 3.6-4" />,
    warn: <path d="M8 6v2.6M8 10.6h0" />,
    danger: <path d="M8 5.2v3.4M8 10.8h0" />,
    live: <path d="M3.5 8h0M5.7 5.8v4.4M8 4.2v7.6M10.3 5.8v4.4M12.5 8h0" />,
  }
  // The outline: a triangle warns, a diamond is an emergency, the rest are circles.
  const outline =
    tone === 'warn' ? (
      <path d="M8 2.2 14.2 13H1.8z" />
    ) : tone === 'danger' ? (
      <path d="M8 1.6 14.4 8 8 14.4 1.6 8z" />
    ) : tone === 'live' ? null : (
      <circle cx="8" cy="8" r="6.2" />
    )
  return (
    <svg
      className={`tone-icon tone-icon--${tone}`}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {outline}
      {shape[tone]}
    </svg>
  )
}

/**
 * A short state, e.g. "Asking for a person" or "Emergency": an icon, then
 * the words, in the tone's tinted colours. Both the icon shape and the words
 * carry the meaning, so it reads in greyscale and in forced-colours mode.
 */
export function StatusPill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`pill pill--${tone}${className ? ` ${className}` : ''}`}>
      <ToneIcon tone={tone} />
      <span className="pill__text">{children}</span>
    </span>
  )
}
