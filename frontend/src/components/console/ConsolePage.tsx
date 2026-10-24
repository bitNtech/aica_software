import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useConsole } from '../../console/ConsoleProvider'
import type { ConsoleSection } from '../../console/types'
import { useAttention } from '../../console/useAttention'
import { useOrg } from '../../console/useOrg'
import { useKeyboardHelp } from './KeyboardHelp'

interface Props {
  /** The mono line above the title, e.g. "Build". */
  kicker: ReactNode
  title: ReactNode
  lede?: ReactNode
  /** The browser tab: "<docTitle> · <organisation> · AICA". */
  docTitle: string
  /** Buttons beside the title (below the lede on a phone), e.g. "New agent". */
  actions?: ReactNode
  /** A quiet line beside the actions, e.g. <UpdatedAgo at={loadedAt} />. */
  status?: ReactNode
  /** The section the page shows, when it can be served by the API: no demo
   * note once that section is live. */
  section?: ConsoleSection
  children: ReactNode
}

/**
 * One organisation page inside <ConsoleShell>: its header (kicker, title,
 * actions, lede, the demo note) and content. Arriving here by navigation
 * moves focus to the title, so keyboard and screen-reader users start at the
 * new page rather than on <body>. Tabs within a page keep the same
 * ConsolePage mounted, so switching tabs doesn't move focus.
 *
 * The browser tab starts with the number of callers waiting for a person,
 * when this person can see them: "(2) Live calls · Hospital · AICA".
 */
export function ConsolePage({ kicker, title, lede, docTitle, actions, status, section, children }: Props) {
  const { org } = useOrg()
  const client = useConsole()
  const location = useLocation()
  const heading = useRef<HTMLHeadingElement>(null)
  const waiting = useAttention()?.counts.waiting ?? 0
  const shortcuts = useKeyboardHelp()

  useEffect(() => {
    document.title = `${waiting > 0 ? `(${waiting}) ` : ''}${docTitle} · ${org.orgName} · AICA`
  }, [docTitle, org.orgName, waiting])

  const arrivedByNavigation = location.key !== 'default'
  useEffect(() => {
    if (arrivedByNavigation) heading.current?.focus()
    // Only on arrival: later changes within the page keep focus where it is.
  }, [])

  return (
    <>
      <header className="console__head">
        <p className="label console__kicker">{kicker}</p>
        <h1 ref={heading} tabIndex={-1} className="display console__title">
          {title}
        </h1>
        {(actions || status || shortcuts.count > 0) && (
          <div className="console__actions">
            {status && <div className="console__status">{status}</div>}
            {shortcuts.count > 0 && (
              <button type="button" className="console__keys" onClick={shortcuts.open} aria-label="Keyboard shortcuts">
                <kbd className="kbd" aria-hidden="true">
                  ?
                </kbd>
                <span className="console__keys-text" aria-hidden="true">
                  Shortcuts
                </span>
              </button>
            )}
            {actions}
          </div>
        )}
        {lede && <div className="console__lede">{lede}</div>}
        {client.isDemo && !(section && client.isLive?.(section)) && (
          <p className="console__demo">
            <span className="demo-chip">Demo data</span>
            <span>Sample data for trying AICA, not your organisation's real setup. Changes stay in this browser tab until you close it.</span>
          </p>
        )}
      </header>
      {children}
    </>
  )
}
