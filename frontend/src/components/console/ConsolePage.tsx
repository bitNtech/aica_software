import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useConsole } from '../../console/ConsoleProvider'
import { useOrg } from '../../console/useOrg'

interface Props {
  /** The mono line above the title, e.g. "Build". */
  kicker: ReactNode
  title: ReactNode
  lede?: ReactNode
  /** The browser tab: "<docTitle> · <organisation> · AICA". */
  docTitle: string
  /** Buttons beside the title (below the lede on a phone), e.g. "New agent". */
  actions?: ReactNode
  children: ReactNode
}

/**
 * One organisation page inside <ConsoleShell>: its header (kicker, title,
 * actions, lede, the demo note) and content. Arriving here by navigation
 * moves focus to the title, so keyboard and screen-reader users start at the
 * new page rather than on <body>. Tabs within a page keep the same
 * ConsolePage mounted, so switching tabs doesn't move focus.
 */
export function ConsolePage({ kicker, title, lede, docTitle, actions, children }: Props) {
  const { org } = useOrg()
  const client = useConsole()
  const location = useLocation()
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    document.title = `${docTitle} · ${org.orgName} · AICA`
  }, [docTitle, org.orgName])

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
        {actions && <div className="console__actions">{actions}</div>}
        {lede && <div className="console__lede">{lede}</div>}
        {client.isDemo && (
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
