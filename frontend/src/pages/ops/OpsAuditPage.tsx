import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError, type AuditEntry, type AuditQuery } from '../../auth/types'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'

/** Every action the backend writes to the audit collection, in words. */
export const ACTION_LABEL: Record<string, string> = {
  signup: 'Signed up a business',
  signup_approved: 'Approved a sign-up',
  signup_declined: 'Declined a sign-up',
  org_suspended: 'Suspended an organisation',
  org_restored: 'Restored an organisation',
  staff_invited: 'Invited to bitNtech',
  invite_accepted: 'Accepted an invitation',
  login: 'Signed in',
  password_reset: 'Reset their password',
  master_admin_set: 'Made master admin (script)',
  role_changed: 'Changed a bitNtech role',
  user_disabled: 'Disabled an account',
  user_enabled: 'Enabled an account',
  sessions_revoked: 'Signed someone out everywhere',
  act_as_started: 'Started acting as',
  act_as_ended: 'Stopped acting as',
}

type Field = 'action' | 'actor' | 'target'
const FIELD_LABEL: Record<Field, string> = { action: 'What happened', actor: 'Who did it', target: 'Who or what it was about' }

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

type State =
  | { state: 'loading' }
  | { state: 'error'; error: unknown }
  | { state: 'ready'; entries: AuditEntry[]; next: string | null; more: 'idle' | 'loading' | 'error' }

/** /ops/audit — master admins only. What happened, newest first. */
export default function OpsAuditPage() {
  const { client, user } = useAuth()
  const fieldId = useId()
  const valueId = useId()
  const [field, setField] = useState<Field | ''>('')
  const [value, setValue] = useState('')
  const [applied, setApplied] = useState<AuditQuery>({})
  const [data, setData] = useState<State>({ state: 'loading' })
  const [tick, setTick] = useState(0)
  const firstNew = useRef<HTMLTableRowElement>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    setData({ state: 'loading' })
    client.listAudit(applied).then(
      (page) => live && setData({ state: 'ready', entries: page.entries, next: page.nextBefore ?? null, more: 'idle' }),
      (error) => live && setData({ state: 'error', error }),
    )
    return () => {
      live = false
    }
  }, [client, applied, tick])

  useEffect(() => {
    if (focusIndex !== null) firstNew.current?.focus()
  }, [focusIndex])

  const loadMore = useCallback(async () => {
    if (data.state !== 'ready' || !data.next) return
    const before = data.next
    const count = data.entries.length
    setData({ ...data, more: 'loading' })
    try {
      const page = await client.listAudit({ ...applied, before })
      setData({ state: 'ready', entries: [...data.entries, ...page.entries], next: page.nextBefore ?? null, more: 'idle' })
      setFocusIndex(count)
    } catch {
      setData({ ...data, more: 'error' })
    }
  }, [client, applied, data])

  function apply(e: FormEvent) {
    e.preventDefault()
    setFocusIndex(null)
    setApplied(field && value.trim() ? { [field]: value.trim() } : {})
  }

  function clear() {
    setField('')
    setValue('')
    setFocusIndex(null)
    setApplied({})
  }

  if (user?.platformRole !== 'master_admin') {
    return (
      <OpsLayout kicker="Audit log" docTitle="Audit log" title="Audit log">
        <Alert tone="info">Only master admins can read the audit log.</Alert>
      </OpsLayout>
    )
  }

  const filtered = Object.keys(applied).length > 0

  return (
    <OpsLayout
      kicker="Audit log"
      docTitle="Audit log"
      title={
        <>
          What happened, <em>and why.</em>
        </>
      }
      lede={<p>Every decision made in Ops, every role change and every acting session, newest first.</p>}
    >
      <form className="audit-filter" onSubmit={apply} aria-label="Filter the audit log">
        <div className="field">
          <label className="field__label" htmlFor={fieldId}>
            Filter by
          </label>
          <select
            id={fieldId}
            className="field__input"
            value={field}
            onChange={(e) => {
              setField(e.target.value as Field | '')
              setValue('')
            }}
          >
            <option value="">Nothing (show everything)</option>
            {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
              <option key={f} value={f}>
                {FIELD_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
        {field === 'action' && (
          <div className="field audit-filter__value">
            <label className="field__label" htmlFor={valueId}>
              Action
            </label>
            <select id={valueId} className="field__input" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose an action</option>
              {Object.entries(ACTION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}
        {(field === 'actor' || field === 'target') && (
          <div className="field audit-filter__value">
            <label className="field__label" htmlFor={valueId}>
              {field === 'actor' ? 'Their email' : 'Email or organisation ID'}
            </label>
            <input
              id={valueId}
              className="field__input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        <div className="audit-filter__go">
          <Button type="submit" variant="plum" size="sm" disabled={!!field && !value.trim()}>
            Apply
          </Button>
          {filtered && (
            <Button variant="line" size="sm" onClick={clear}>
              Clear filter
            </Button>
          )}
        </div>
      </form>

      {data.state === 'loading' && (
        <div className="loading-row">
          <Spinner label="Loading the audit log" />
          <span>Loading the audit log…</span>
        </div>
      )}

      {data.state === 'error' && (
        <Alert tone="error" title="Couldn't load the audit log">
          <p>{asAuthError(data.error).message}</p>
          <button type="button" className="btn-text" onClick={() => setTick((t) => t + 1)}>
            Try again
          </button>
        </Alert>
      )}

      {data.state === 'ready' && data.entries.length === 0 && (
        <p className="empty-note">{filtered ? 'Nothing matches this filter.' : 'Nothing recorded yet.'}</p>
      )}

      {data.state === 'ready' && data.entries.length > 0 && (
        <>
          <div className="audit-wrap">
            <table className="audit-table">
              <caption className="sr-only">Audit log, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">What</th>
                  <th scope="col">About</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e, i) => (
                  <tr key={`${e.at}-${i}`} ref={i === focusIndex ? firstNew : undefined} tabIndex={i === focusIndex ? -1 : undefined}>
                    <td data-label="When">
                      <time dateTime={e.at}>{when(e.at)}</time>
                    </td>
                    <td data-label="Who">{e.actorLabel}</td>
                    <td data-label="What">{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td data-label="About">{e.targetLabel}</td>
                    <td data-label="Detail" className="audit-table__detail">
                      {e.detail || <span aria-label="none">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="audit-more">
            {data.next ? (
              <Button variant="line" size="sm" busy={data.more === 'loading'} busyLabel="Loading…" onClick={() => void loadMore()}>
                Load older entries
              </Button>
            ) : (
              <p className="empty-note">That's everything{filtered ? ' for this filter' : ''}.</p>
            )}
            {data.more === 'error' && <Alert tone="error">Couldn't load older entries. Try again.</Alert>}
          </div>
        </>
      )}
    </OpsLayout>
  )
}
