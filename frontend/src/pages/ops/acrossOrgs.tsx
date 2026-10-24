import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError, type OrgStatus, type OrgSummary } from '../../auth/types'
import { useConsole } from '../../console/ConsoleProvider'
import type { ConsoleClient } from '../../console/types'

export interface OrgResult<T> {
  org: OrgSummary
  data: T | null
  error: unknown
}

export interface AcrossOrgs<T> {
  /** Null until the organisation list has loaded. */
  results: OrgResult<T>[] | null
  /** The organisation list itself couldn't be read. */
  error: unknown
  loading: boolean
  checkedAt: number | null
  reload(): void
}

/**
 * Reads the same thing from each organisation, through the console's own
 * per-organisation endpoints, for the Ops pages that show every
 * organisation at once. One organisation failing doesn't hide the others:
 * its row says so. Polls every `refreshMs` when given (paused while the tab
 * is hidden).
 *
 * This asks once per organisation, which is fine for a few dozen. Past that
 * the backend should answer these across organisations in one request.
 */
export function useAcrossOrgs<T>(
  load: (client: ConsoleClient, org: OrgSummary) => Promise<T>,
  { statuses = ['active', 'suspended'], refreshMs }: { statuses?: OrgStatus[]; refreshMs?: number } = {},
): AcrossOrgs<T> {
  const { client: auth } = useAuth()
  const consoleClient = useConsole()
  const [results, setResults] = useState<OrgResult<T>[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const key = statuses.join(',')

  useEffect(() => {
    let live = true
    setLoading(true)
    auth
      .listOrgs()
      .then(async (orgs) => {
        const wanted = orgs.filter((o) => key.split(',').includes(o.status)).sort((a, b) => a.name.localeCompare(b.name))
        const settled = await Promise.allSettled(wanted.map((o) => load(consoleClient, o)))
        if (!live) return
        setResults(wanted.map((org, i) => {
          const s = settled[i]
          return s.status === 'fulfilled' ? { org, data: s.value, error: null } : { org, data: null, error: s.reason }
        }))
        setError(null)
        setCheckedAt(Date.now())
      })
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [auth, consoleClient, load, key, tick])

  useEffect(() => {
    if (!refreshMs || loading) return
    const t = window.setTimeout(() => {
      if (!document.hidden) setTick((n) => n + 1)
      else document.addEventListener('visibilitychange', () => setTick((n) => n + 1), { once: true })
    }, refreshMs)
    return () => window.clearTimeout(t)
  }, [refreshMs, loading])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { results, error, loading, checkedAt, reload }
}

/** Organisations whose data couldn't be read, said once above the list. */
export function OrgFailures<T>({ results, onRetry }: { results: OrgResult<T>[]; onRetry(): void }) {
  const failed = results.filter((r) => r.error)
  if (failed.length === 0) return null
  return (
    <p className="op-stale" role="status">
      <strong>Some organisations are missing.</strong> {failed.map((r) => `${r.org.name}: ${asAuthError(r.error).message}`).join(' ')}{' '}
      <button type="button" className="btn-text" onClick={onRetry}>
        Try again
      </button>
    </p>
  )
}

/** A select for one organisation or all of them. */
export function OrgSelect({ orgs, value, onChange, id }: { orgs: OrgSummary[]; value: string; onChange(slug: string): void; id: string }): ReactNode {
  return (
    <div className="field ops-orgselect">
      <label className="field__label" htmlFor={id}>
        Organisation
      </label>
      <select id={id} className="field__input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Every organisation</option>
        {orgs.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  )
}
