import type { ReactNode, Ref } from 'react'

type Tone = 'error' | 'warn' | 'ok' | 'info'

interface Props {
  tone: Tone
  title?: string
  children?: ReactNode
  /** Pass a ref to move focus here, e.g. when a submit fails. */
  ref?: Ref<HTMLDivElement>
  className?: string
  /** False for an alert that takes focus instead (e.g. an error summary):
   * focus already reads it, and a live region would read it again. */
  live?: boolean
}

const ICON: Record<Tone, ReactNode> = {
  error: <path d="M10 6v5M10 14v.3" />,
  warn: <path d="M10 6v5M10 14v.3" />,
  ok: <path d="m6.5 10.2 2.4 2.4 4.6-5" />,
  info: <path d="M10 9v5M10 6v.3" />,
}

/** Errors interrupt (role=alert); everything else is announced politely. */
export function Alert({ tone, title, children, ref, className, live = true }: Props) {
  return (
    <div
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}
      className={['alert', `alert--${tone}`, className].filter(Boolean).join(' ')}
    >
      <svg className="alert__icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.14" />
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          {ICON[tone]}
        </g>
      </svg>
      <div className="alert__body">
        {title && <p className="alert__title">{title}</p>}
        {children && <div className="alert__text">{children}</div>}
      </div>
    </div>
  )
}
