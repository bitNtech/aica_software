import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { BUILDER_STEPS, type BuilderStep } from '../../../console/types'
import { STEP_META, stepIndex } from './steps'

/** Where you are in the builder. Steps already reached are links back;
 * later ones aren't reachable until the steps before them are done. */
export function BuilderSteps({ base, current, reached }: { base: string; current: BuilderStep; reached: BuilderStep }) {
  const at = stepIndex(current)
  const furthest = stepIndex(reached)
  const list = useRef<HTMLOListElement>(null)

  // On narrow screens the steps scroll sideways: show the current one.
  useEffect(() => {
    const el = list.current?.querySelector('[aria-current="step"]')
    if (el && 'scrollIntoView' in el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  return (
    <nav className="builder-steps" aria-label="Builder steps">
      <div className="builder-steps__bar" aria-hidden="true">
        <span style={{ width: `${((at + 1) / BUILDER_STEPS.length) * 100}%` }} />
      </div>
      <ol ref={list}>
        {BUILDER_STEPS.map((s, i) => {
          const state = i === at ? 'current' : i <= furthest ? 'done' : 'todo'
          const content = (
            <>
              <span className="builder-steps__num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>{STEP_META[s].label}</span>
            </>
          )
          return (
            <li key={s} className={`builder-steps__item is-${state}`}>
              {state === 'current' ? (
                <span className="builder-steps__link" aria-current="step">
                  {content}
                </span>
              ) : state === 'done' ? (
                <Link className="builder-steps__link" to={`${base}/${s}`}>
                  {content}
                </Link>
              ) : (
                <span className="builder-steps__link">
                  {content}
                  <span className="sr-only"> (not reached yet)</span>
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
