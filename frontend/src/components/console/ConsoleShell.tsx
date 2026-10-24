import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { ROLE_LABEL } from '../../auth/roles'
import { canOpen, navFor, type PageKey } from '../../console/access'
import { useConsole } from '../../console/ConsoleProvider'
import { canSeeFlowPatterns, FLOW_PATTERN_WINDOW } from '../../console/flowPatternConfig'
import { AttentionProvider, useAttention } from '../../console/useAttention'
import { useOrg } from '../../console/useOrg'
import { initials } from '../../pages/ChooseOrgPage'
import { Wordmark } from '../ui/Wordmark'
import { ShortcutsProvider } from './KeyboardHelp'
import { ToastProvider } from './Toast'
import './ConsoleShell.css'

/** Below this width the sidebar becomes a menu panel. Matches the CSS. */
const NARROW = '(max-width: 899px)'

/**
 * The frame around every organisation page (a layout route: pages render
 * into the <Outlet>): a sidebar with the pages this role may open
 * (console/access.ts), the organisation, and who's signed in. On a narrow
 * screen the sidebar is a panel behind a Menu button; while it's open the
 * page underneath is inert, and Escape closes it. Each page draws its own
 * header with <ConsolePage>. It also provides what every page shares: the
 * sidebar's counts (one poll), toasts, and keyboard shortcuts with their
 * "?" help.
 */
export function ConsoleShell() {
  return (
    <AttentionProvider>
      <ToastProvider>
        <ShortcutsProvider>
          <Frame />
        </ShortcutsProvider>
      </ToastProvider>
    </AttentionProvider>
  )
}

function Frame() {
  const { user, org, access } = useOrg()
  const client = useConsole()
  const { signOut } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [hasNewFlowPattern, setHasNewFlowPattern] = useState(false)
  const attention = useAttention()
  const root = useRef<HTMLDivElement>(null)
  const topBar = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!canSeeFlowPatterns(access)) return
    let live = true
    client.listNewFlowPatterns(org.orgSlug, { windowSize: FLOW_PATTERN_WINDOW }).then(
      (found) => {
        if (live) setHasNewFlowPattern(found.length > 0)
      },
      () => {
        if (live) setHasNewFlowPattern(false)
      },
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, access])

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
  const sections = navFor(access)
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
        {/* Identity block — never collapses regardless of sidebar state */}
        <div className="console__identity">
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
        </div>

        <nav className="console__nav" aria-label="Organisation">
          {sections.map((s, i) => (
            <div key={s.heading ?? i} className="console__group">
              {s.heading && (
                <p className="console__heading" id={`nav-${s.heading}`}>
                  {s.heading}
                </p>
              )}
              <ul aria-labelledby={s.heading ? `nav-${s.heading}` : undefined}>
                {s.items.map((item) => {
                  const badge = attention?.badgeFor(item.page)
                  return (
                    <li key={item.page}>
                      <NavLink to={item.path ? `${base}/${item.path}` : base} end={!item.path} className="console__link">
                        <NavIcon page={item.page} />
                        <span>{item.label}</span>
                        {item.page === 'calls' && hasNewFlowPattern && (
                          <span className="console__badge-dot" aria-label="New call flow pattern detected" />
                        )}
                        {badge && (
                          <>
                            {/* A real space, so the name reads "Callbacks 3 overdue". */}
                            {' '}
                            <span className={`console__count console__count--${badge.tone}`}>
                              {/* An exclamation as well as red: an emergency is not told by colour alone. */}
                              <span aria-hidden="true">
                                {badge.tone === 'danger' ? '! ' : ''}
                                {badge.count}
                              </span>
                              <span className="sr-only">{badge.text}</span>
                            </span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="console__me">
          <span className="console__me-text">
            <Link to={canOpen(access, 'profile') ? `${base}/profile` : '/account'} className="console__me-name">
              {user.name}
              <span className="sr-only">: your account</span>
            </Link>
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
    // A desk bell.
    desk: <path d="M3.5 14.5h13M5 14.5a5 5 0 0 1 10 0M10 9.5V7.8M8.6 6.2h2.8" />,
    // A speech bubble with a question.
    requests: <path d="M4 4.5h12v8.5H9.5L6 15.8V13H4zM8.4 7.4a1.6 1.6 0 1 1 2.2 1.5c-.4.2-.6.5-.6.9v.2M10 11.2h0" />,
    // A tray with an arrow going in.
    uploads: <path d="M10 3.5v8M6.8 6.7 10 3.5l3.2 3.2M3.5 12.5v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2.5" />,
    // An open book.
    knowledge: <path d="M10 5.5C8.6 4.4 6.4 4 3.5 4.2v10.6c2.9-.2 5.1.2 6.5 1.3 1.4-1.1 3.6-1.5 6.5-1.3V4.2C13.6 4 11.4 4.4 10 5.5zM10 5.5v10.6" />,
    // A plug.
    integrations: <path d="M7.5 3.5v3.2M12.5 3.5v3.2M5.5 6.7h9v2.6a4.5 4.5 0 0 1-9 0zM10 13.8v2.7" />,
    // A handset.
    numbers: <path d="M6.6 3.8 8.3 7a1 1 0 0 1-.2 1.2l-1 1a8.6 8.6 0 0 0 3.7 3.7l1-1a1 1 0 0 1 1.2-.2l3.2 1.7a1 1 0 0 1 .5 1.1l-.4 1.6a1.6 1.6 0 0 1-1.7 1.2A13 13 0 0 1 2.6 5.7a1.6 1.6 0 0 1 1.2-1.7l1.6-.4a1 1 0 0 1 1.2.2z" />,
    // Waves: a call in progress.
    live: <path d="M10 10h0M7 7.2a4 4 0 0 0 0 5.6M13 7.2a4 4 0 0 1 0 5.6M4.6 4.8a7.4 7.4 0 0 0 0 10.4M15.4 4.8a7.4 7.4 0 0 1 0 10.4" />,
    // Calling back: a curved arrow.
    callbacks: <path d="M15.5 9.5A5.5 5.5 0 1 1 13.9 5.6M15.5 3.8v3.4h-3.4" />,
    appointments: <path d="M4 5.5h12v10.5H4zM4 8.8h12M7.2 3.5v3.4M12.8 3.5v3.4M7.5 12h2" />,
    // A list.
    calls: <path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9M3.8 5.5h0M3.8 10h0M3.8 14.5h0" />,
    reports: <path d="M3.5 16.5h13M5.5 13.5v-3M9 13.5V6.5M12.5 13.5V9M16 13.5V4.5" />,
    team: <path d="M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 16a4.5 4.5 0 0 1 9 0M13.5 8.5a2 2 0 1 0 0-4M14.5 11.6A4 4 0 0 1 17.5 15.5" />,
    activity: <path d="M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM10 6.5V10l2.4 1.6" />,
    settings: <path d="M10 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4" />,
    billing: <path d="M3 5.5h14v9H3zM3 8.5h14M6 12h3" />,
    owners: <path d="M4 15.5h12M4.5 13l-1-7 3.5 3L10 4.5 13 9l3.5-3-1 7z" />,
    usage: <path d="M3.5 13a6.5 6.5 0 0 1 13 0M10 13l3-4M3.5 15.5h13" />,
    notifications: <path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.5 1.5h-12zM8.5 17h3" />,
    profile: <path d="M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17a6 6 0 0 1 12 0" />,
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
