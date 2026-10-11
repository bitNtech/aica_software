/** "01 Your account — 02 Your business": where you are in a multi-step card.
 * The current step is announced; completed ones are marked done. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper" aria-label={`Step ${current + 1} of ${steps.length}`}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={s} className={`stepper__step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="stepper__num" aria-hidden="true">
              {state === 'done' ? '✓' : String(i + 1).padStart(2, '0')}
            </span>
            <span className="stepper__label">
              {s}
              {state === 'done' && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
