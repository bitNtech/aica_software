import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { useOnline } from '../../lib/useOnline'
import { Alert } from '../ui/Alert'
import { PulseLine, type PulseMode } from '../ui/PulseLine'
import { Wordmark } from '../ui/Wordmark'
import './AuthLayout.css'

const STATUS: Record<PulseMode, string> = {
  idle: 'Standing by',
  listening: 'Listening',
  busy: 'Checking',
  ok: 'All set',
  error: 'Needs a look',
}

interface Props {
  /** Mono kicker above the heading, e.g. "Sign in". Prefixed with "AICA /". */
  kicker: string
  title: ReactNode
  lede?: ReactNode
  /** Browser tab title; " · AICA" is added. */
  docTitle: string
  /** State of the voice line. Defaults to idle, or listening while a field has focus. */
  voice?: PulseMode
  /** Change this to move focus to the heading, e.g. when a step changes. */
  step?: string | number
  footer?: ReactNode
  children?: ReactNode
}

/**
 * The frame for every page a signed-out (or just signed-in) person sees.
 * Left: the dark stage from aica.bitntech.in — the mark, the line, and
 * AICA's voice line reacting to the form. Right: cream paper with the form.
 * On phones the stage folds into a band above the form.
 */
export function AuthLayout({ kicker, title, lede, docTitle, voice, step, footer, children }: Props) {
  const { client } = useAuth()
  const online = useOnline()
  const [engaged, setEngaged] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstStep = useRef(true)

  useEffect(() => {
    document.title = `${docTitle} · AICA`
  }, [docTitle])

  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false
      return
    }
    headingRef.current?.focus()
  }, [step])

  const mode: PulseMode = voice ?? (engaged ? 'listening' : 'idle')

  return (
    <div className="auth">
      <a className="skip-link" href="#auth-main">
        Skip to form
      </a>

      <aside className="auth__stage stage" aria-label="About AICA">
        <div className="auth__orb" aria-hidden="true" />
        <Link to="/login" className="auth__brand" aria-label="AICA by BitNTech — sign in">
          <Wordmark />
        </Link>

        <div className="auth__pitch">
          <p className="label">
            AICA <i>/</i> Console
          </p>
          <p className="display auth__line">
            The front desk that <em>never</em> misses a call.
          </p>
          <p className="auth__sub">Your AI voice agent answers in Tamil, English and Tanglish — day and night.</p>
        </div>

        <div className="auth__voice">
          <PulseLine mode={mode} />
          <p className="auth__status" aria-live="polite">
            <span className="auth__dot" data-mode={mode} aria-hidden="true" />
            AICA <i>·</i> {STATUS[mode]}
          </p>
        </div>

        <ul className="auth__langs" aria-label="Languages">
          <li lang="ta">தமிழ்</li>
          <li>English</li>
          <li>Tanglish</li>
          <li className="auth__247">24/7</li>
        </ul>
      </aside>

      <main
        id="auth-main"
        className="auth__panel"
        onFocus={(e) => {
          if ((e.target as HTMLElement).matches('input')) setEngaged(true)
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEngaged(false)
        }}
      >
        <div className="auth__top">
          {client.isDemo && (
            <p className="demo-badge" title="This build uses a mock auth client. No request leaves your browser.">
              <span aria-hidden="true" />
              Demo mode <i>·</i> no real accounts
            </p>
          )}
        </div>

        <div className="auth__body">
          {!online && (
            <Alert tone="warn" title="You're offline" className="auth__offline">
              Check the connection on this computer. Your details stay in the form.
            </Alert>
          )}
          <p className="label">
            AICA <i>/</i> {kicker}
          </p>
          <h1 className="display auth__title" ref={headingRef} tabIndex={-1}>
            {title}
          </h1>
          {lede && <div className="auth__lede">{lede}</div>}
          {children}
        </div>

        <footer className="auth__foot">
          {footer ?? (
            <p>
              Trouble signing in? Write to{' '}
              <a className="link" href="mailto:support@bitntech.in">
                support@bitntech.in
              </a>
            </p>
          )}
          <p className="auth__legal">© {new Date().getFullYear()} BitNTech</p>
        </footer>
      </main>
    </div>
  )
}
