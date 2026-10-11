import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

type Variant = 'orange' | 'plum' | 'line'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'sm'
  block?: boolean
  /** Shows a spinner and blocks repeat presses while a request runs. */
  busy?: boolean
  /** What the button says while busy, e.g. "Signing in…". */
  busyLabel?: string
  arrow?: boolean
  children: ReactNode
}

export function Button({
  variant = 'orange',
  size = 'md',
  block,
  busy,
  busyLabel,
  arrow,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: Props) {
  const cls = ['btn', `btn--${variant}`, size === 'sm' && 'btn--sm', block && 'btn--block', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button {...rest} type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? (
        <>
          <Spinner />
          <span>{busyLabel ?? children}</span>
        </>
      ) : (
        <>
          <span>{children}</span>
          {arrow && (
            <span className="arrow" aria-hidden="true">
              →
            </span>
          )}
        </>
      )}
    </button>
  )
}
