import { useId, useState } from 'react'
import { StatusPill, type Tone } from '../../../components/console/StatusPill'
import { useMediaQuery } from '../../../lib/useMediaQuery'
import { SECTION, type Finding } from './findings'

const TONE: Record<Finding['tone'], { tone: Tone; label: string }> = {
  warn: { tone: 'warn', label: 'Worth a look' },
  good: { tone: 'ok', label: 'Better' },
  info: { tone: 'info', label: 'Noted' },
}

/** Scrolls a card into view and moves focus to its heading: a link to evidence that works by keyboard. */
export function goToSection(sectionId: string) {
  const heading = document.getElementById(`${sectionId}-title`)
  const card = document.getElementById(sectionId)
  if (!heading || !card) return
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  card.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  heading.focus({ preventScroll: true })
}

/**
 * "What changed": the report's computed findings against the period before,
 * as one-line sentences, each with a link to the card that is its evidence.
 * It sits beside the charts, never in their place. Open by default on a wide
 * screen and shut on a narrow one; the person's own choice wins after that.
 */
export function WhatChanged({ items, hasCalls }: { items: Finding[]; hasCalls: boolean }) {
  const id = useId()
  const wide = useMediaQuery('(min-width: 1100px)', true)
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? wide
  return (
    <section id={SECTION.changes} className="hd-card hd-s12 hd-changes" aria-labelledby={`${SECTION.changes}-title`}>
      <h3 id={`${SECTION.changes}-title`} tabIndex={-1} className="hd-card__title">
        <button type="button" className="hd-changes__toggle" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setChosen(!open)}>
          <svg className="hd-changes__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 2.5 3.5 3.5L4 9.5" />
          </svg>
          <span>What changed</span>
          <span className="hd-changes__count">{items.length === 0 ? 'nothing stands out' : `${items.length} ${items.length === 1 ? 'thing' : 'things'}`}</span>
        </button>
      </h3>
      <div id={`${id}-list`} hidden={!open}>
        {items.length === 0 ? (
          <p className="hd-note">
            {hasCalls ? 'Nothing stands out against the period before, or there are not enough calls yet to say.' : 'No calls in this period, so there is nothing to compare.'}
          </p>
        ) : (
          <ul className="hd-changes__list">
            {items.map((f) => (
              <li key={f.id} className="hd-changes__item">
                <StatusPill tone={TONE[f.tone].tone}>{TONE[f.tone].label}</StatusPill>
                <span className="hd-changes__text">{f.text}</span>
                <a
                  className="btn-text hd-changes__link"
                  href={`#${f.evidence}`}
                  onClick={(e) => {
                    e.preventDefault()
                    goToSection(f.evidence)
                  }}
                >
                  {f.evidenceLabel}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
