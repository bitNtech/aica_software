import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError } from '../../auth/types'
import './ActingAsBanner.css'

/**
 * Pinned to the top of every page while a master admin acts as a client
 * user: whose account this is, how long is left, and the way back. Acting
 * ends on its own when the time runs out; the backend enforces that too.
 */
export function ActingAsBanner() {
  const { user, impersonator, endActing } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Re-renders every 15 seconds so the minutes left stay current.
  const [, setTick] = useState(0)

  const end = useCallback(
    async (ranOut: boolean) => {
      setBusy(true)
      setError(null)
      try {
        await endActing(() =>
          navigate('/ops/people', {
            replace: true,
            state: { notice: ranOut ? 'Your acting session ran out. You’re back as yourself.' : 'You’re back as yourself.' },
          }),
        )
      } catch (err) {
        setError(asAuthError(err).message)
      } finally {
        setBusy(false)
      }
    },
    [endActing, navigate],
  )

  const expiresAt = impersonator?.expiresAt
  useEffect(() => {
    if (!expiresAt) return
    const tick = window.setInterval(() => setTick((t) => t + 1), 15_000)
    const stop = window.setTimeout(() => void end(true), Math.max(0, Date.parse(expiresAt) - Date.now()))
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(stop)
    }
  }, [expiresAt, end])

  if (!impersonator || !user) return null
  const mins = Math.max(1, Math.ceil((Date.parse(impersonator.expiresAt) - Date.now()) / 60_000))

  return (
    <section className="acting" aria-label="Acting as another user">
      <p className="acting__text">
        <span className="acting__tag">Acting as</span>
        <strong className="acting__name">{user.name}</strong>
        <span className="acting__email">{user.email}</span>
        <span className="acting__left">
          {mins} min left <span className="sr-only">. Started by {impersonator.email}.</span>
        </span>
      </p>
      {error && (
        <p className="acting__error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="acting__end" onClick={() => void end(false)} disabled={busy}>
        {busy ? 'Ending…' : 'End and return to Ops'}
      </button>
    </section>
  )
}
