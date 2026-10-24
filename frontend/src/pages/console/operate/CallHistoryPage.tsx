import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { can, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AgentSummary, CallLogPage, CallOutcome, CallRecord } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { useShortcuts } from '../../../components/console/KeyboardHelp'
import { SegFilter } from '../../../components/console/ListTools'
import { SplitView } from '../../../components/console/SplitView'
import { Toolbar, type FilterChip } from '../../../components/console/Toolbar'
import { useToast } from '../../../components/console/Toast'
import { UpdatedAgo } from '../../../components/console/UpdatedAgo'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { SelectField, TextField } from '../../../components/ui/Field'
import { useMediaQuery } from '../../../lib/useMediaQuery'
import { CallPreview } from './calls/CallPreview'
import { CallsTable } from './calls/CallsTable'
import {
  applyClientFilters,
  countWording,
  DAYS,
  DEFAULT_DAYS,
  LANGUAGES,
  NO_FILTERS,
  readParams,
  SENTIMENTS,
  summarise,
  writeParams,
  type Analysed,
  type CallFilters,
  type Days,
} from './calls/logic'
import { PatternSection } from './calls/patterns/PatternSection'
import { useAnnouncer } from './LiveBits'
import { languageName, OUTCOME_LABEL, SENTIMENT_LABEL } from './shared'
import './Operate.css'
import './calls/Calls.css'

const DAYS_LABEL: Record<Days, string> = { 1: 'Today', 7: '7 days', 30: '30 days', 90: '90 days' }
const PAGE = 50
const WIDE = '(min-width: 1100px)'
const SUCCESS_LABEL = { yes: 'Successful', no: 'Not successful' } as const

/**
 * /o/:slug/calls: every call, in a table beside a preview of the one that is
 * open (a drawer on a phone). The period, agent, outcome and search go to
 * the server; language, how the caller sounded and success are applied to
 * the calls loaded, and say so. The filters and the open call are in the
 * address, so a link or Back lands where you were. Front desk see the calls
 * they handled. Patterns the agents followed outside their designed flow
 * sit above the table.
 */
export default function CallHistoryPage() {
  const { org, access, base } = useOrg()
  const client = useConsole()
  const toast = useToast()
  const navigate = useNavigate()
  const own = pageAccess(access, 'calls') === 'own'
  const personal = can(access, 'call.personal')
  const [searchParams, setSearchParams] = useSearchParams()
  const { filters, callId } = useMemo(() => readParams(searchParams), [searchParams])
  const wide = useMediaQuery(WIDE, true)
  const [said, say] = useAnnouncer()

  // ---- the address is the state: change it and the page follows
  const update = useCallback(
    (patch: Partial<CallFilters>) => setSearchParams((sp) => writeParams(sp, { ...readParams(sp).filters, ...patch }, readParams(sp).callId), { replace: true }),
    [setSearchParams],
  )
  /** Opens a call's preview: a new history entry the first time (Back closes it), then replaces it. */
  const open = useCallback(
    (id: string | null) => setSearchParams((sp) => writeParams(sp, readParams(sp).filters, id), { replace: id === null || callId !== null }),
    [setSearchParams, callId],
  )

  // ---- search: typed text goes to the address once typing pauses
  const [query, setQuery] = useState(filters.q)
  const committed = useRef(filters.q)
  useEffect(() => {
    // The address changed from outside (Back, a link): the box follows it.
    if (filters.q !== committed.current) {
      committed.current = filters.q
      setQuery(filters.q)
    }
  }, [filters.q])
  useEffect(() => {
    const t = window.setTimeout(() => {
      const q = query.trim()
      if (q === committed.current) return
      committed.current = q
      update({ q })
    }, 300)
    return () => window.clearTimeout(t)
  }, [query, update])
  const search = useRef<HTMLInputElement>(null)
  const clearSearch = () => {
    committed.current = ''
    setQuery('')
    update({ q: '' })
  }

  // ---- the calls
  const [agents, setAgents] = useState<AgentSummary[]>([])
  useEffect(() => {
    if (own) return
    client.listAgents(org.orgSlug).then((a) => setAgents(a.filter((x) => !x.setupStep)), () => setAgents([]))
  }, [client, org.orgSlug, own])

  // "Show more" grows the page for the current search only: a new search
  // starts from the newest again, in the same render (no second request).
  const filterKey = `${filters.days}|${filters.agentId}|${filters.outcome}|${filters.q}`
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE })
  const limit = paging.key === filterKey ? paging.limit : PAGE
  const [page, setPage] = useState<CallLogPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    client.listCallLog(org.orgSlug, { days: filters.days, agentId: filters.agentId || undefined, outcome: filters.outcome || undefined, q: filters.q || undefined, limit }).then(
      (p) => {
        if (!live) return
        setPage(p)
        setCheckedAt(Date.now())
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
  }, [client, org.orgSlug, filters.days, filters.agentId, filters.outcome, filters.q, limit, tick])
  const retry = useCallback(() => setTick((t) => t + 1), [])

  // ---- what the list can't say: sentiment and success, once a call has been opened
  const [analysed, setAnalysed] = useState<ReadonlyMap<string, Analysed>>(new Map())
  const learn = useCallback((r: CallRecord) => {
    setAnalysed((m) => {
      const have = m.get(r.id)
      if (have && have.sentiment === r.analysis.sentiment && have.success === r.analysis.success) return m
      return new Map(m).set(r.id, { sentiment: r.analysis.sentiment, success: r.analysis.success })
    })
  }, [])

  const loaded = useMemo(() => page?.calls ?? [], [page])
  const clientFiltered = !!(filters.language || filters.sentiment || filters.success)
  const { shown, unknown } = useMemo(() => applyClientFilters(loaded, filters, analysed), [loaded, filters, analysed])
  const stats = useMemo(() => summarise(shown), [shown])
  const serverFiltered = !!(filters.agentId || filters.outcome || filters.q)
  const total = page?.total ?? 0

  // ---- filters as chips
  const agentName = agents.find((a) => a.id === filters.agentId)?.name ?? 'This agent'
  const chips: FilterChip[] = [
    ...(filters.days !== DEFAULT_DAYS ? [{ id: 'days', label: `When: ${DAYS_LABEL[filters.days]}`, onRemove: () => update({ days: DEFAULT_DAYS }) }] : []),
    ...(filters.q ? [{ id: 'q', label: `Search: ${filters.q}`, onRemove: clearSearch }] : []),
    ...(filters.agentId && !own ? [{ id: 'agent', label: `Agent: ${agentName}`, onRemove: () => update({ agentId: '' }) }] : []),
    ...(filters.outcome ? [{ id: 'outcome', label: `Outcome: ${OUTCOME_LABEL[filters.outcome]}`, onRemove: () => update({ outcome: '' }) }] : []),
    ...(filters.language ? [{ id: 'lang', label: `Language: ${languageName(filters.language)}`, onRemove: () => update({ language: '' }) }] : []),
    ...(filters.sentiment ? [{ id: 'sentiment', label: `Sounded: ${SENTIMENT_LABEL[filters.sentiment]}`, onRemove: () => update({ sentiment: '' }) }] : []),
    ...(filters.success ? [{ id: 'success', label: SUCCESS_LABEL[filters.success], onRemove: () => update({ success: '' }) }] : []),
  ]
  function clearAll() {
    setQuery('')
    committed.current = ''
    setSearchParams((sp) => writeParams(sp, NO_FILTERS, readParams(sp).callId), { replace: true })
  }

  // ---- the summary line, for the calls shown
  const summary = !page
    ? undefined
    : `${countWording(shown.length, loaded.length, total, clientFiltered)} · ${stats.answeredPct}% answered by the agents · ${stats.handedPct}% handed over${clientFiltered || loaded.length < total ? ` (of the ${loaded.length.toLocaleString('en-IN')} loaded)` : ''}`

  // ---- export, as before
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  async function exportCsv() {
    if (!client.exportCallLog) return
    setExporting(true)
    setExportError(null)
    try {
      const blob = await client.exportCallLog(org.orgSlug, { days: filters.days, agentId: filters.agentId || undefined })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `aica-calls-${filters.days}d.csv`
      document.body.append(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
      say('Call list downloaded.')
    } catch (err) {
      setExportError(asAuthError(err).message)
    } finally {
      setExporting(false)
    }
  }

  // ---- keyboard: / to search, j and k into the table, o for the whole call, Esc to close
  const focusRows = (last = false) => {
    const rows = document.querySelectorAll<HTMLElement>('.cl-list .dt__row[tabindex]')
    const active = document.querySelector<HTMLElement>('.cl-list .dt__row[tabindex="0"]')
    ;(last ? rows[rows.length - 1] : active ?? rows[0])?.focus()
  }
  const closePreview = () => {
    open(null)
    requestAnimationFrame(() => focusRows())
  }
  useShortcuts({
    '/': { description: 'Search the calls', run: () => search.current?.focus() },
    j: { description: 'Move down the table (then Enter opens the preview)', run: () => focusRows() },
    k: { description: 'Move up the table', run: () => focusRows(true) },
    // Only while a preview is open, so Escape stays free for everything else (a toast, say).
    ...(callId
      ? {
          o: { description: 'Open the full call', run: () => navigate(`${base}/calls/${callId}`) },
          Escape: { description: 'Close the preview', run: closePreview },
        }
      : {}),
  })

  // ---- showing more
  const more = useRef(false)
  useEffect(() => {
    if (!more.current || loading) return
    more.current = false
    say(`${loaded.length.toLocaleString('en-IN')} calls loaded.`)
  }, [loading, loaded.length, say])

  const empty = (
    <p className="empty-note cl-empty">
      {serverFiltered || clientFiltered ? (
        <>
          {clientFiltered && loaded.length > 0 ? `None of the ${loaded.length.toLocaleString('en-IN')} loaded calls match.` : 'No calls match.'}{' '}
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              setQuery('')
              committed.current = ''
              setSearchParams((sp) => writeParams(sp, { ...NO_FILTERS, days: readParams(sp).filters.days }, readParams(sp).callId), { replace: true })
              search.current?.focus()
            }}
          >
            Clear the filters
          </button>
        </>
      ) : own ? (
        'No calls handed to you in this period.'
      ) : (
        'No calls in this period.'
      )}
    </p>
  )

  const initialLoad = !page && !error
  const rowsBusy = loading && !!page

  const list = (
    <div className={`cl-list${rowsBusy ? ' is-loading' : ''}`} aria-busy={loading || undefined}>
      {error !== null && page && (
        <p className="op-stale" role="status">
          <strong>Couldn’t refresh.</strong> {asAuthError(error).message} Showing the calls loaded {checkedAt ? 'earlier' : 'before'}.{' '}
          <button type="button" className="btn-text" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {!page && error ? (
        <Alert tone="error" title="Couldn't load calls">
          <p>{asAuthError(error).message}</p>
          <button type="button" className="btn-text" onClick={retry}>
            Try again
          </button>
        </Alert>
      ) : (
        <>
          {initialLoad && <p className="sr-only" role="status">Loading calls…</p>}
          <CallsTable calls={shown} analysed={analysed} personal={personal} selectedId={callId} onOpen={(id) => open(id)} loading={initialLoad} empty={empty} />
          {page && (
            <p className="cl-more">
              {clientFiltered ? (
                <>
                  Showing {shown.length.toLocaleString('en-IN')} of the {loaded.length.toLocaleString('en-IN')} calls loaded{total > loaded.length ? ` (${total.toLocaleString('en-IN')} in the period)` : ''}.{' '}
                </>
              ) : (
                <>
                  Showing {loaded.length.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}, newest first by default.{' '}
                </>
              )}
              {total > loaded.length && (
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    more.current = true
                    setPaging({ key: filterKey, limit: limit + PAGE })
                  }}
                >
                  Show {Math.min(PAGE, total - loaded.length)} more
                </button>
              )}
            </p>
          )}
          {(filters.sentiment || filters.success) && page && (
            <p className="cl-more">
              How the caller sounded and whether the call succeeded come from the call itself, so they are only known for calls opened in this view.
              {unknown > 0 ? ` ${unknown.toLocaleString('en-IN')} of the loaded calls haven’t been opened, so they can’t be matched.` : ''}
            </p>
          )}
        </>
      )}
    </div>
  )

  return (
    <ConsolePage
      section="calls"
      kicker="Operate"
      title={own ? 'Calls you handled' : 'Call history'}
      docTitle="Call history"
      status={page ? <UpdatedAgo at={checkedAt} /> : undefined}
      actions={
        <>
          <Button variant="line" size="sm" busy={loading && !!page} busyLabel="Refreshing…" onClick={retry}>
            Refresh
          </Button>
          {client.exportCallLog && can(access, 'export') && (
            <Button variant="line" busy={exporting} busyLabel="Preparing…" onClick={() => void exportCsv()}>
              Download call list
            </Button>
          )}
        </>
      }
      lede={<p>{own ? 'Calls the agents handed to you. Open one for its transcript, what was collected and its notes.' : 'Every call the agents took. Open one to see the conversation, what was collected, and what happened.'}</p>}
    >
      <p className="sr-only" role="status">
        {said}
      </p>
      {exportError && (
        <Alert tone="error" title="We couldn't make the call list">
          <p>{exportError}</p>
        </Alert>
      )}

      <PatternSection
        agentId={own ? '' : filters.agentId}
        loaded={loaded}
        onFilterAgent={(id) => update({ agentId: id })}
        onRequested={(p) => {
          say(`Asked bitNtech to build this flow for ${p.agentName}.`)
          toast.show({ message: `Asked bitNtech to build this flow for ${p.agentName}.`, tone: 'ok' })
        }}
      />

      <Toolbar
        label="Filter the calls"
        sticky={false}
        search={
          <TextField
            ref={search}
            label="Search"
            type="search"
            value={query}
            placeholder={!personal ? 'Number or what they asked' : 'Number, name or what they asked'}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        filters={
          <>
            <SegFilter<`${Days}`> legend="When" value={`${filters.days}`} onChange={(v) => update({ days: Number(v) as Days })} options={DAYS.map((d) => ({ value: `${d}`, label: DAYS_LABEL[d] }))} />
            {!own && (
              <SelectField label="Agent" value={filters.agentId} options={[{ value: '', label: 'All agents' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => update({ agentId: e.target.value })} />
            )}
            <SelectField
              label="What happened"
              value={filters.outcome}
              options={[{ value: '', label: 'Anything' }, ...(Object.keys(OUTCOME_LABEL) as CallOutcome[]).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))]}
              onChange={(e) => update({ outcome: e.target.value as CallOutcome | '' })}
            />
            <SelectField
              label="Language"
              hint="Of the calls loaded."
              value={filters.language}
              options={[{ value: '', label: 'Any' }, ...LANGUAGES.map((l) => ({ value: l, label: languageName(l) }))]}
              onChange={(e) => update({ language: e.target.value as CallFilters['language'] })}
            />
            <SelectField
              label="How the caller sounded"
              hint="Of the calls opened here."
              value={filters.sentiment}
              options={[{ value: '', label: 'Any' }, ...SENTIMENTS.map((s) => ({ value: s, label: SENTIMENT_LABEL[s] }))]}
              onChange={(e) => update({ sentiment: e.target.value as CallFilters['sentiment'] })}
            />
            <SelectField
              label="Success"
              hint="Of the calls opened here."
              value={filters.success}
              options={[
                { value: '', label: 'Any' },
                { value: 'yes', label: SUCCESS_LABEL.yes },
                { value: 'no', label: SUCCESS_LABEL.no },
              ]}
              onChange={(e) => update({ success: e.target.value as CallFilters['success'] })}
            />
          </>
        }
        summary={summary}
        chips={chips}
        onClearAll={clearAll}
      />

      <SplitView
        storageKey="aica.split.calls"
        defaultWidth={760}
        minWidth={380}
        maxWidth={980}
        listLabel="Calls"
        detailLabel="Call preview"
        detailOpen={callId !== null}
        onCloseDetail={closePreview}
        detailEmpty={<p className="split__empty">Pick a call to see what happened, how it ended and the start of the conversation. Use the arrow keys, or J and K, then Enter. Press O to open the whole call.</p>}
        list={list}
        detail={
          callId && (
            <CallPreview
              key={callId}
              callId={callId}
              summary={loaded.find((c) => c.id === callId)}
              redact={!personal}
              onClose={wide ? closePreview : undefined}
              onRecord={learn}
            />
          )
        }
      />
    </ConsolePage>
  )
}
