import { useCallback, useId, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError, type OrgSummary } from '../../auth/types'
import { SegFilter } from '../../components/console/ListTools'
import { StatusPill, type Tone } from '../../components/console/StatusPill'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { TextField } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Spinner'
import type { CallOutcome, CallQuery, ConsoleClient } from '../../console/types'
import { duration, OUTCOME_LABEL } from '../console/operate/shared'
import { OrgFailures, OrgSelect, useAcrossOrgs } from './acrossOrgs'
import { num, when } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'

type Days = CallQuery['days']
const DAYS_LABEL: Record<1 | 7 | 30, string> = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days' }
const PER_ORG = 200
export const OUTCOME_TONE: Record<CallOutcome, Tone> = { resolved: 'ok', booked: 'ok', callback: 'info', handed_over: 'info', emergency: 'danger', dropped: 'warn' }

/** /ops/calls: every organisation's calls in one list. Callers' details and
 * opening a call (its transcript) are the master admin's only. */
export default function OpsCallsPage() {
  const { user } = useAuth()
  const isMaster = user?.platformRole === 'master_admin'
  const id = useId()
  const [days, setDays] = useState<1 | 7 | 30>(7)
  const [org, setOrg] = useState('')
  const [outcome, setOutcome] = useState<CallOutcome | ''>('')
  const [query, setQuery] = useState('')
  const load = useCallback((c: ConsoleClient, o: OrgSummary) => c.listCallLog(o.slug, { days: days as Days, limit: PER_ORG }), [days])
  const across = useAcrossOrgs(load)

  const q = query.trim().toLowerCase()
  const calls = (across.results ?? [])
    .filter((r) => !org || r.org.slug === org)
    .flatMap((r) => (r.data?.calls ?? []).map((c) => ({ ...c, org: r.org })))
    .filter((c) => !outcome || c.outcome === outcome)
    .filter((c) => !q || [c.agentName, c.intent, c.org.name, ...(isMaster ? [c.callerName ?? '', c.callerPhone] : [])].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const capped = (across.results ?? []).filter((r) => (r.data?.total ?? 0) > PER_ORG)

  return (
    <OpsLayout
      kicker="Calls"
      docTitle="Call history"
      title="Call history"
      lede={<p>Calls across every organisation, newest first. {isMaster ? 'Open one for its transcript, path and notes.' : 'Callers’ names, numbers and transcripts are shown to the master admin only.'}</p>}
    >
      <div className="list-tools">
        <SegFilter<`${1 | 7 | 30}`> legend="Period" value={`${days}`} onChange={(v) => setDays(Number(v) as 1 | 7 | 30)} options={([1, 7, 30] as const).map((d) => ({ value: `${d}`, label: DAYS_LABEL[d] }))} />
        {across.results && <OrgSelect id={`${id}-org`} orgs={across.results.map((r) => r.org)} value={org} onChange={setOrg} />}
        <div className="field">
          <label className="field__label" htmlFor={`${id}-out`}>
            Outcome
          </label>
          <select id={`${id}-out`} className="field__input" value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome | '')}>
            <option value="">Any</option>
            {(Object.keys(OUTCOME_LABEL) as CallOutcome[]).map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
        </div>
        <TextField label="Search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isMaster ? 'Agent, topic, caller' : 'Agent or topic'} autoComplete="off" className="list-tools__search" />
      </div>

      {across.error ? (
        <Alert tone="error" title="Couldn't load organisations">
          <p>{asAuthError(across.error).message}</p>
          <button type="button" className="btn-text" onClick={across.reload}>
            Try again
          </button>
        </Alert>
      ) : !across.results ? (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading calls…</span>
        </div>
      ) : (
        <div className={across.loading ? 'op-report is-loading' : undefined} aria-busy={across.loading || undefined}>
          <OrgFailures results={across.results} onRetry={across.reload} />
          <p className="row__meta" role="status">
            {num(calls.length)} {calls.length === 1 ? 'call' : 'calls'}
            {capped.length > 0 && ` (the newest ${PER_ORG} for ${capped.map((r) => r.org.name).join(', ')}; narrow the period to see the rest)`}
          </p>
          {calls.length === 0 ? (
            <p className="empty-note">No calls match.</p>
          ) : (
            <div className="ops-table" role="region" aria-label="Calls" tabIndex={0}>
              <table className="op-table ops-left">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Organisation</th>
                    <th scope="col">Agent</th>
                    <th scope="col">Caller</th>
                    <th scope="col">What about</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Length</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.slice(0, 500).map((c) => (
                    <tr key={`${c.org.slug}/${c.id}`}>
                      <th scope="row">
                        {isMaster ? (
                          <Link className="row__link" to={`/ops/orgs/${c.org.slug}/calls/${c.id}`}>
                            {when(c.startedAt)}
                          </Link>
                        ) : (
                          when(c.startedAt)
                        )}
                      </th>
                      <td>{c.org.name}</td>
                      <td>{c.agentName}</td>
                      <td>{isMaster ? (c.callerName ? `${c.callerName} · ${c.callerPhone}` : c.callerPhone) : <span className="ops-muted">Hidden</span>}</td>
                      <td>{c.intent}</td>
                      <td>
                        <StatusPill tone={OUTCOME_TONE[c.outcome]}>{OUTCOME_LABEL[c.outcome]}</StatusPill>
                        {c.handledBy && <span className="ops-cell-sub">by {c.handledBy}</span>}
                      </td>
                      <td className="num">{duration(c.durationSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {calls.length > 500 && <p className="row__meta">Showing the newest 500. Choose an organisation or a shorter period to see the rest.</p>}
        </div>
      )}
    </OpsLayout>
  )
}

/** /ops/calls/:callId?org=slug: a call opens in its organisation's frame. Master admin only. */
export function OpsCallRedirect() {
  const { callId = '' } = useParams()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const org = params.get('org')
  if (user?.platformRole !== 'master_admin') return <Navigate to="/ops/calls" replace />
  return <Navigate to={org ? `/ops/orgs/${org}/calls/${encodeURIComponent(callId)}` : '/ops/calls'} replace />
}
