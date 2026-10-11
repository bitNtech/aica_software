import { passwordChecks, passwordStrength, STRENGTH_LABEL } from '../../auth/validation'

/** Strength bar plus the rules, ticked off live as the person types. */
export function PasswordStrength({ password, email }: { password: string; email?: string }) {
  const score = passwordStrength(password, email)
  const checks = passwordChecks(password, email)
  return (
    <div className="strength" data-score={score}>
      <div className="strength__bar" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= score ? 'is-on' : undefined} />
        ))}
      </div>
      <p className="strength__label" aria-live="polite">
        {score > 0 && (
          <>
            <span className="sr-only">Password strength: </span>
            {STRENGTH_LABEL[score]}
          </>
        )}
      </p>
      <ul className="strength__rules">
        {checks.map((c) => (
          <li key={c.id} className={c.met ? 'is-met' : undefined}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              {c.met ? (
                <path d="m3.5 8.4 2.9 2.9 6-6.3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <circle cx="8" cy="8" r="2.4" fill="currentColor" />
              )}
            </svg>
            {c.label}
            <span className="sr-only">{c.met ? ' — done' : ' — not yet'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
