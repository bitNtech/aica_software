import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AgentSummary, CallLogPage, CallOutcome, CallQuery, DetectedFlowPattern } from '../../../console/types'
import { can, pageAccess } from '../../../console/access'
import { canSeeFlowPatterns, FLOW_PATTERN_WINDOW } from '../../../console/flowPatternConfig'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { SegFilter, useSettled } from '../../../components/console/ListTools'
import { DetectedFlowBanner } from '../../../components/console/DetectedFlowBanner'
import { DetectedFlowChart } from '../../../components/console/DetectedFlowChart'
import { Alert } from '../../../components/ui/Alert'
import { SelectField, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { Modal } from '../../../components/ui/Dialog'
import { useAnnouncer } from './LiveBits'
import { duration, OUTCOME_LABEL } from './shared'
import './Operate.css'

type Days = CallQuery['days']
const DAYS_LABEL: Record<Days, string> = { 1: 'Today', 7: '7 days', 30: '30 days', 90: '90 days' }
const PAGE = 50

const when = (iso: string) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/** /o/:slug/calls: every call, searchable. Front desk see the calls they handled. */
export default function CallHistoryPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const own = pageAccess(access, 'calls') === 'own'
  const personal = can(access, 'call.personal')
  const [searchParams] = useSearchParams()
  const [days, setDays] = useState<Days>(7)
  const [agentId, setAgentId] = useState(() => searchParams.get('agent') ?? '')
  const [outcome, setOutcome] = useState<CallOutcome | ''>('')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  // "Show more" grows the page for the current search only: a new search
  // starts from the newest again, in the same render (no second request).
  const filterKey = `${days}|${agentId}|${outcome}|${q}`
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE })
  const limit = paging.key === filterKey ? paging.limit : PAGE
  /** After "Show more": focus the first call it added. */
  const focusFrom = useRef<number | null>(null)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [page, setPage] = useState<CallLogPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  const canSeePatterns = canSeeFlowPatterns(access)
  const [pattern, setPattern] = useState<DetectedFlowPattern | null>(null)
  const [showFlow, setShowFlow] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [flowSaid, say] = useAnnouncer()

  useEffect(() => {
    if (own) return
    client.listAgents(org.orgSlug).then((a) => setAgents(a.filter((x) => !x.setupStep)), () => setAgents([]))
  }, [client, org.orgSlug, own])

  useEffect(() => {
    setPattern(null)
    if (own || !canSeePatterns || !agentId) return
    let live = true
    client.detectNewFlowPatterns(org.orgSlug, agentId, { windowSize: FLOW_PATTERN_WINDOW }).then(
      (found) => {
        if (live) setPattern(found[0] ?? null)
      },
      () => {
        if (live) setPattern(null)
      },
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, agentId, own, canSeePatterns])

  // Search once typing pauses.
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 300)
    return () => window.clearTimeout(t)
  }, [query])
  useEffect(() => {
    if (focusFrom.current === null || !page || loading) return
    const links = document.querySelectorAll<HTMLElement>('.op-log .op-row__link')
    links[focusFrom.current]?.focus()
    focusFrom.current = null
  }, [page, loading])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    client.listCallLog(org.orgSlug, { days, agentId: agentId || undefined, outcome: outcome || undefined, q: q || undefined, limit }).then(
      (p) => {
        if (!live) return
        setPage(p)
        setLoading(false)
      },
      (err) => {
        if (!live) return
        setError(err)
        setLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, days, agentId, outcome, q, limit, tick])
  const retry = useCallback(() => setTick((t) => t + 1), [])

  const said = useSettled(page ? `${page.total.toLocaleString('en-IN')} ${page.total === 1 ? 'call' : 'calls'} found.` : '', !loading && !!page, 400)
  const filtered = !!(agentId || outcome || q)

  async function requestFlow() {
    if (!pattern) return
    setRequesting(true)
    setRequestError(null)
    try {
      await client.createChangeRequest(org.orgSlug, {
        kind: 'flow_change',
        agentId: pattern.agentId,
        title: 'New call flow pattern detected',
        detail: `${pattern.occurrences} of the last ${pattern.windowSize} calls to ${pattern.agentName} followed this step sequence, which isn't part of its current flow:\n${pattern.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nCalls: ${pattern.callIds.join(', ')}`,
        urgency: 'normal',
      })
      setShowFlow(false)
      say(`Asked bitNtech to build this flow for ${pattern.agentName}.`)
    } catch (err) {
      setRequestError(asAuthError(err).message)
    } finally {
      setRequesting(false)
    }
  }

  return (
    <ConsolePage
      kicker="Operate"
      title={own ? 'Calls you handled' : 'Call history'}
      docTitle="Call history"
      lede={<p>{own ? 'Calls the agents handed to you. Open one for its transcript, what was collected and its notes.' : 'Every call the agents took. Open one to see the conversation, what was collected, and what happened.'}</p>}
    >
      <div className="list-tools op-filters">
        <SegFilter<`${Days}`> legend="When" value={`${days}`} onChange={(v) => setDays(Number(v) as Days)} options={([1, 7, 30, 90] as Days[]).map((d) => ({ value: `${d}`, label: DAYS_LABEL[d] }))} />
        <TextField
          ref={search}
          label="Search"
          type="search"
          value={query}
          placeholder={!personal ? 'Number or what they asked' : 'Number, name or what they asked'}
          autoComplete="off"
          className="list-tools__search"
          onChange={(e) => setQuery(e.target.value)}
        />
        {!own && (
          <div className="op-filters__agent">
            <SelectField label="Agent" value={agentId} options={[{ value: '', label: 'All agents' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => setAgentId(e.target.value)} />
          </div>
        )}
        <div className="op-filters__agent">
          <SelectField
            label="What happened"
            value={outcome}
            options={[{ value: '', label: 'Anything' }, ...(Object.keys(OUTCOME_LABEL) as CallOutcome[]).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))]}
            onChange={(e) => setOutcome(e.target.value as CallOutcome | '')}
          />
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      <p className="sr-only" role="status">
        {flowSaid}
      </p>

      {pattern && <DetectedFlowBanner pattern={pattern} onView={() => setShowFlow(true)} />}
      {pattern && (
        <Modal open={showFlow} title="Detected call flow pattern" onClose={() => setShowFlow(false)} side="right">
          <DetectedFlowChart pattern={pattern} onRequestFlow={() => void requestFlow()} busy={requesting} />
          {requestError && (
            <p className="field__error" role="alert">
              {requestError}
            </p>
          )}
        </Modal>
      )}

      {error ? (
        <Alert tone="error" title="Couldn't load calls">
          <p>{asAuthError(error).message}</p>
          <button type="button" className="btn-text" onClick={retry}>
            Try again
          </button>
        </Alert>
      ) : !page ? (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading calls…</span>
        </div>
      ) : page.calls.length === 0 ? (
        <p className="empty-note">
          {filtered ? 'No calls match.' : own ? 'No calls handed to you in this period.' : 'No calls in this period.'}{' '}
          {filtered && (
            <button
              type="button"
              className="btn-text"
              onClick={() => {
                setQuery('')
                setAgentId('')
                setOutcome('')
                search.current?.focus()
              }}
            >
              Clear the search
            </button>
          )}
        </p>
      ) : (
        <div className={loading ? 'op-report is-loading' : 'op-report'} aria-busy={loading || undefined}>
          <ul className="op-rows op-log" aria-label="Calls, newest first">
            {page.calls.map((c) => (
              <li key={c.id} className="op-row op-row--call">
                <time className="op-row__time" dateTime={c.startedAt}>
                  {when(c.startedAt)}
                </time>
                <div className="op-row__main">
                  <Link className="op-row__link" to={`/o/${org.orgSlug}/calls/${c.id}`}>
                    {/* Viewers don't see callers' names. */}
                    {(personal && c.callerName) || 'A caller'}
                    <span className="op-card__sub">{c.callerPhone}</span>
                  </Link>
                  <p className="row__meta">
                    {c.intent} <i aria-hidden="true">·</i> {c.agentName} <i aria-hidden="true">·</i> {duration(c.durationSec)}
                    {c.handledBy && (
                      <>
                        {' '}
                        <i aria-hidden="true">·</i> taken by {c.handledBy}
                      </>
                    )}
                  </p>
                </div>
                <span className={`status-chip status-chip--out-${c.outcome}`}>{OUTCOME_LABEL[c.outcome]}</span>
              </li>
            ))}
          </ul>
          <p className="op-log__more">
            Showing {page.calls.length.toLocaleString('en-IN')} of {page.total.toLocaleString('en-IN')}, newest first.{' '}
            {page.total > page.calls.length && (
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  focusFrom.current = page.calls.length
                  setPaging({ key: filterKey, limit: limit + PAGE })
                }}
              >
                Show {Math.min(PAGE, page.total - page.calls.length)} more
              </button>
            )}
          </p>
        </div>
      )}
    </ConsolePage>
  )
}
