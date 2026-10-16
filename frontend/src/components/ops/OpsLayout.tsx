import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { ROLE_LABEL } from '../../auth/roles'
import { Wordmark } from '../ui/Wordmark'
import './OpsLayout.css'

interface Props {
  kicker: string
  title: ReactNode
  lede?: ReactNode
  docTitle: string
  /** Shown as a count on the "Sign-up requests" tab. */
  pendingCount?: number
  /** The page runs on sample data (no API yet): says so under the title. */
  demoData?: boolean
  children: ReactNode
}

/**
 * bitNtech's own console. A permanent orange hairline across the top says
 * "you are looking at every client's data" on every page, as the layout spec
 * asks. The bar is the landing page's night; the work sits on paper.
 */
export function OpsLayout({ kicker, title, lede, docTitle, pendingCount, demoData, children }: Props) {
  const { user } = useAuth()

  useEffect(() => {
    document.title = `${docTitle} · AICA Ops`
  }, [docTitle])

  if (!user?.platformRole) return null

  return (
    <div className="ops">
      <a className="skip-link" href="#ops-main">
        Skip to content
      </a>
      <OpsBar pendingCount={pendingCount} />

      <main id="ops-main" className="ops__main" tabIndex={-1}>
        <header className="ops__head">
          <p className="label">
            AICA Ops <i>/</i> {kicker}
          </p>
          <h1 className="display ops__title">{title}</h1>
          {lede && <div className="ops__lede">{lede}</div>}
          {demoData && (
            <p className="ops__demo">
              <span className="demo-chip">Demo data</span>
              <span>Sample data: this page has no live connection yet. Changes stay in this browser tab until you close it.</span>
            </p>
          )}
        </header>
        {children}
      </main>
    </div>
  )
}

/** The hairline and the night bar: Ops' own navigation and who's signed in.
 * Shared by every Ops page, including the organisation frame. */
export function OpsBar({ pendingCount }: { pendingCount?: number }) {
  const { user, signOut, client } = useAuth()
  const [leaving, setLeaving] = useState(false)
  if (!user?.platformRole) return null
  return (
    <>
      <div className="ops__hairline" aria-hidden="true" />
      <header className="ops__bar stage">
        <Link to="/ops" className="ops__brand" aria-label="AICA Ops — overview">
          <Wordmark by={false} />
          <span className="ops__tag">Ops</span>
        </Link>

        <nav className="ops__nav" aria-label="Ops">
          <NavLink to="/ops" end className="ops__link">
            Overview
          </NavLink>
          <NavLink to="/ops/requests" className="ops__link">
            Sign-up requests
            {pendingCount ? (
              <span className="ops__count">
                {pendingCount}
                <span className="sr-only"> waiting</span>
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/ops/changes" className="ops__link">
            Change requests
          </NavLink>
          <NavLink to="/ops/usage" className="ops__link">
            Usage
          </NavLink>
          <NavLink to="/ops/status" className="ops__link">
            Service status
          </NavLink>
          <NavLink to="/ops/templates" className="ops__link">
            Templates
          </NavLink>
          {user.platformRole === 'master_admin' && (
            <>
              <NavLink to="/ops/platform" className="ops__link">
                Platform
              </NavLink>
              <NavLink to="/ops/people" className="ops__link">
                People
              </NavLink>
              <NavLink to="/ops/audit" className="ops__link">
                Audit log
              </NavLink>
            </>
          )}
        </nav>

        <div className="ops__me">
          {client.isDemo && <span className="demo-chip">Demo</span>}
          <span className="ops__who">
            <Link to="/account" className="ops__name">
              {user.name}
              <span className="sr-only">: your account</span>
            </Link>
            <span className={`ops__role ops__role--${user.platformRole}`}>{ROLE_LABEL[user.platformRole]}</span>
          </span>
          <button
            type="button"
            className="ops__out"
            disabled={leaving}
            onClick={() => {
              setLeaving(true)
              void signOut()
            }}
          >
            {leaving ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>
    </>
  )
}
