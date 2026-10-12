import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { ROLE_LABEL } from '../../auth/roles'
import { navFor, type PageKey } from '../../console/access'
import { useOrg } from '../../console/useOrg'
import { initials } from '../../pages/ChooseOrgPage'
import { Wordmark } from '../ui/Wordmark'
import './ConsoleShell.css'

/** Below this width the sidebar becomes a menu panel. Matches the CSS. */
const NARROW = '(max-width: 899px)'

/**
 * The frame around every organisation page (a layout route: pages render
 * into the <Outlet>): a sidebar with the pages this role may open
 * (console/access.ts), the organisation, and who's signed in. On a narrow
 * screen the sidebar is a panel behind a Menu button; while it's open the
 * page underneath is inert, and Escape closes it. Each page draws its own
 * header with <ConsolePage>.
 */
export function ConsoleShell() {
  const { user, org } = useOrg()
  const { signOut } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const topBar = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  // A new page closes the menu.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Escape closes the menu from anywhere, including the Menu button itself.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        menuButton.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // Widening the window past the breakpoint closes it too, so the page
  // never stays inert behind a sidebar that is no longer a panel.
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW)
    if (!mq) return
    const onChange = () => {
      if (!mq.matches) setMenuOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // The menu panel opens just below the top bar, whatever its height.
  useEffect(() => {
    const bar = topBar.current
    const el = root.current
    if (!bar || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => el.style.setProperty('--console-top-h', `${bar.offsetHeight}px`))
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  const base = `/o/${org.orgSlug}`
  const sections = navFor(org.role)
  const switchable = user.memberships.filter((m) => m.orgStatus === 'active').length > 1

  return (
    <div className="console" ref={root}>
      <a className="skip-link" href="#console-main">
        Skip to content
      </a>

      <header className="console__top" ref={topBar}>
        <Link to={base} className="console__brand" aria-label={`AICA — ${org.orgName} home`}>
          <Wordmark by={false} />
        </Link>
        <span className="console__top-org">{org.orgName}</span>
        <button
          ref={menuButton}
          type="button"
          className="console__menu-btn"
          aria-expanded={menuOpen}
          aria-controls="console-nav"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <MenuIcon open={menuOpen} />
          <span>{menuOpen ? 'Close' : 'Menu'}</span>
        </button>
      </header>

      <aside id="console-nav" className={`console__side${menuOpen ? ' is-open' : ''}`} aria-label="Organisation and account">
        <Link to={base} className="console__brand console__brand--side" aria-label={`AICA — ${org.orgName} home`}>
          <Wordmark by={false} />
        </Link>

        <div className="console__org">
          <span className="org__mark" aria-hidden="true">
            {initials(org.orgName)}
          </span>
          <span className="console__org-text">
            <span className="console__org-name">{org.orgName}</span>
            <span className="console__org-meta">{org.city}</span>
          </span>
        </div>
        {switchable && (
          <Link to="/choose" className="console__switch">
            Switch organisation
          </Link>
        )}

        <nav className="console__nav" aria-label="Organisation">
          {sections.map((s, i) => (
            <div key={s.heading ?? i} className="console__group">
              {s.heading && (
                <p className="console__heading" id={`nav-${s.heading}`}>
                  {s.heading}
                </p>
              )}
              <ul aria-labelledby={s.heading ? `nav-${s.heading}` : undefined}>
                {s.items.map((item) => (
                  <li key={item.page}>
                    <NavLink to={item.path ? `${base}/${item.path}` : base} end={!item.path} className="console__link">
                      <NavIcon page={item.page} />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="console__me">
          <span className="console__me-text">
            <span className="console__me-name">{user.name}</span>
            <span className="console__me-role">{ROLE_LABEL[org.role]}</span>
          </span>
          <button
            type="button"
            className="console__out"
            disabled={leaving}
            onClick={() => {
              setLeaving(true)
              void signOut()
            }}
          >
            {leaving ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>

      <main id="console-main" className="console__main" tabIndex={-1} inert={menuOpen || undefined}>
        <Outlet />
      </main>
    </div>
  )
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      {open ? <path d="m5 5 10 10M15 5 5 15" /> : <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />}
    </svg>
  )
}

/** One small line icon per page, so the sidebar scans at a glance. */
function NavIcon({ page }: { page: PageKey }) {
  const paths: Partial<Record<PageKey, ReactNode>> = {
    home: <path d="M3.5 9.2 10 4l6.5 5.2V16a.5.5 0 0 1-.5.5h-3.8v-4.2H7.8v4.2H4a.5.5 0 0 1-.5-.5z" />,
    // A voice line: the agent.
    agents: <path d="M3 10h1.6M6.2 7v6M9.4 4.5v11M12.6 7v6M15.8 9v2M17 10h0" />,
  }
  return (
    <svg
      className="console__icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[page]}
    </svg>
  )
}
