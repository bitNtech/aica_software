import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import type { TranscriptTurn } from '../../../../../console/types'
import { SPEAKER, clock, renderTurnText, seconds } from '../../../calls/TranscriptDialog'
import { searchTurns, splitMatches } from './logic'

/** A turn the page wants shown: the conversation scrolls to it and marks it. */
export interface TurnTarget {
  turn: number
  /** Changes with every jump, so jumping to the same turn again still moves focus. */
  seq: number
  /** The step it stands for: "Near step: Offer two slots". */
  label?: string
}

export interface TranscriptPanelHandle {
  focusSearch(): void
}

interface Props {
  turns: TranscriptTurn[]
  redact: boolean
  target: TurnTarget | null
  ref?: Ref<TranscriptPanelHandle>
}

/**
 * The conversation, turn by turn, with a search: matches are highlighted
 * (in the text as shown, so hidden personal details can't be found), with a
 * count and next/previous. Enter in the box goes to the next match, Shift+Enter
 * to the one before. A turn the page points at (from a step on the path) is
 * scrolled to, focused and marked in words.
 */
export function TranscriptPanel({ turns, redact, target, ref }: Props) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const box = useRef<HTMLInputElement>(null)
  const items = useRef<(HTMLLIElement | null)[]>([])

  const matches = useMemo(() => searchTurns(turns, query, redact), [turns, query, redact])
  const at = matches.length ? Math.min(current, matches.length - 1) : 0
  const hits = useMemo(() => {
    const byTurn = new Map<number, { start: number; end: number; index: number }[]>()
    matches.forEach((m, index) => byTurn.set(m.turn, [...(byTurn.get(m.turn) ?? []), { start: m.start, end: m.end, index }]))
    return byTurn
  }, [matches])

  useImperativeHandle(ref, () => ({ focusSearch: () => box.current?.focus() }), [])
  const searchId = useId()

  // Bring the current match into view as it changes.
  const currentTurn = matches[at]?.turn
  useEffect(() => {
    if (query.trim() && currentTurn !== undefined) items.current[currentTurn]?.scrollIntoView?.({ block: 'center' })
  }, [currentTurn, at, query])

  // A jump from the path: scroll to the turn and put focus on it.
  useEffect(() => {
    if (!target) return
    const el = items.current[target.turn]
    if (!el) return
    el.scrollIntoView?.({ block: 'center' })
    el.focus({ preventScroll: true })
  }, [target])

  const go = (dir: 1 | -1) => {
    if (matches.length === 0) return
    setCurrent((at + dir + matches.length) % matches.length)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      go(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape' && query) {
      e.stopPropagation()
      setQuery('')
    }
  }

  const status = !query.trim() ? '' : matches.length === 0 ? 'No matches.' : `Match ${at + 1} of ${matches.length}.`

  return (
    <div className="ts">
      <div className="ts__bar" role="search">
        <div className="field ts__field">
          <label className="field__label" htmlFor={searchId}>
            Search the conversation
          </label>
          <input
            ref={box}
            id={searchId}
            type="search"
            className="field__input"
            value={query}
            placeholder="A word or phrase"
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value)
              setCurrent(0)
            }}
            onKeyDown={onKey}
          />
        </div>
        <button type="button" className="btn btn--line btn--sm" onClick={() => go(-1)} disabled={matches.length === 0}>
          <span>Previous match</span>
        </button>
        <button type="button" className="btn btn--line btn--sm" onClick={() => go(1)} disabled={matches.length === 0}>
          <span>Next match</span>
        </button>
        <p className="ts__count num" role="status">
          {status}
        </p>
      </div>

      <ol className="transcript">
        {turns.map((t, i) => {
          const text = renderTurnText(t.text, redact)
          const turnHits = hits.get(i)
          const isTarget = target?.turn === i
          return (
            <li
              key={i}
              ref={(el) => {
                items.current[i] = el
              }}
              tabIndex={-1}
              className={`transcript__turn transcript__turn--${t.speaker}${isTarget ? ' is-target' : ''}`}
              data-turn={i}
            >
              <span className="transcript__who">
                {SPEAKER[t.speaker]} <time className="transcript__at">{clock(t.at)}</time>
                {t.latencyMs !== undefined && (
                  <>
                    {' '}
                    <span className="transcript__at">· replied in {seconds(t.latencyMs)}</span>
                  </>
                )}
                {t.interrupted && (
                  <>
                    {' '}
                    <span className="transcript__cut">· caller cut in</span>
                  </>
                )}
                {isTarget && target?.label && <span className="ts__here"> · {target.label}</span>}
              </span>
              <p className="transcript__text">
                {turnHits
                  ? splitMatches(text, turnHits).map((p, k) =>
                      p.match === undefined ? (
                        p.text
                      ) : (
                        <mark key={k} className={`ts__mark${p.match === at ? ' is-current' : ''}`} aria-current={p.match === at ? 'true' : undefined}>
                          {p.text}
                        </mark>
                      ),
                    )
                  : text}
              </p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
