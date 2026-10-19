import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { LANGUAGE_LABEL } from '../../auth/roles'
import { asAuthError } from '../../auth/types'
import { can } from '../../console/access'
import { useConsole } from '../../console/ConsoleProvider'
import { canSeeFlowPatterns, FLOW_PATTERN_WINDOW } from '../../console/flowPatternConfig'
import { BUILDER_STEPS, type AgentStatus, type AgentSummary } from '../../console/types'
import { STEP_META, stepIndex } from './builder/steps'
import { useOrg } from '../../console/useOrg'
import { ConsolePage } from '../../components/console/ConsolePage'
import { Alert } from '../../components/ui/Alert'
import { EmptyState } from '../../components/ui/EmptyState'
import { TextField } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Spinner'
import { shortDate } from '../../lib/time'
import { useAsync } from '../../lib/useAsync'

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = { live: 'Live', draft: 'Draft', paused: 'Paused' }

/** Live first: what's answering calls now; then work in progress. */
const ORDER: Record<AgentStatus, number> = { live: 0, draft: 1, paused: 2 }
type Filter = 'all' | AgentStatus
const FILTERS: Filter[] = ['all', 'live', 'draft', 'paused']

/** /o/:slug/agents — every voice agent in the organisation. bitNtech's
 * master admin creates them (from Ops, /ops/orgs/:slug/agents, which shows
 * this page too); the organisation asks for one and changes its everyday
 * settings. */
export default function AgentsPage() {
  const { org, access, base } = useOrg()
  const client = useConsole()
  const load = useCallback(() => client.listAgents(org.orgSlug), [client, org.orgSlug])
  const [agents, reload] = useAsync(load)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const filterName = useId()
  const search = useRef<HTMLInputElement>(null)
  const canCreate = can(access, 'agent.create')
  const canRequest = can(access, 'request.create')
  const [patternAgentIds, setPatternAgentIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!canSeeFlowPatterns(access)) return
    let live = true
    client.listNewFlowPatterns(org.orgSlug, { windowSize: FLOW_PATTERN_WINDOW }).then(
      (found) => {
        if (live) setPatternAgentIds(new Set(found.map((p) => p.agentId)))
      },
      () => {
        if (live) setPatternAgentIds(new Set())
      },
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, access])
  // Set by the builder after publishing. Shown once: it's cleared from the
  // history entry so a reload or Back doesn't show it again.
  const location = useLocation()
  const [notice] = useState(() => (location.state as { notice?: string } | null)?.notice)
  const [said, setSaid] = useState('')
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setSaid(notice), 400)
    // Without a navigation, which would move focus again.
    const entry = window.history.state as { usr?: unknown } | null
    if (entry?.usr) window.history.replaceState({ ...entry, usr: null }, '')
    return () => window.clearTimeout(t)
  }, [notice])

  const all = agents.state === 'ready' ? [...agents.data].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)) : []
  const q = query.trim().toLowerCase()
  // Numbers match whatever the spacing: "01210" finds "+91 00000 01210".
  const qDigits = q.replace(/\D/g, '')
  const shown = all.filter(
    (a) =>
      (filter === 'all' || a.status === filter) &&
      (!q ||
        [a.name, a.useCase].some((v) => v.toLowerCase().includes(q)) ||
        (qDigits.length >= 3 && (a.phoneNumber ?? '').replace(/\D/g, '').includes(qDigits))),
  )
  const count = (f: Filter) => (f === 'all' ? all.length : all.filter((a) => a.status === f).length)

  // Announce the result count once typing pauses, not on every keystroke.
  const summary = shown.length === all.length ? `${all.length} agents` : `${shown.length} of ${all.length} agents shown`
  const [announced, setAnnounced] = useState('')
  useEffect(() => {
    if (agents.state !== 'ready') return
    const t = window.setTimeout(() => setAnnounced(summary), 600)
    return () => window.clearTimeout(t)
  }, [summary, agents.state])

  return (
    <ConsolePage
      kicker="Agents"
      docTitle="Agents"
      title="Agents"
      lede={
        canCreate ? (
          <p>Each agent answers one phone line. Build it from recordings of {org.orgName}’s past calls, test it, then publish it for them.</p>
        ) : (
          <p>Each agent answers one phone line. bitNtech builds it from recordings of your past calls; you keep its greeting, knowledge and hours up to date.</p>
        )
      }
      actions={
        canCreate ? (
          <Link className="btn btn--orange" to={`${base}/agents/new`}>
            <span>New agent</span>
          </Link>
        ) : (
          canRequest && (
            <Link className="btn btn--line" to={`${base}/requests?new=new_agent`}>
              <span>Ask for a new agent</span>
            </Link>
          )
        )
      }
    >
      {/* Present and empty first, then filled: a region that arrives with
          its text, as focus moves to the title, often isn't read. */}
      <p className="sr-only" role="status">
        {said}
      </p>
      {notice && (
        <Alert tone="ok" live={false} className="ops-section__notice">
          {notice}
        </Alert>
      )}

      {agents.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading agents…</span>
        </div>
      )}

      {agents.state === 'error' && (
        <Alert tone="error" title="Couldn't load agents">
          <p>{asAuthError(agents.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}

      {agents.state === 'ready' && all.length === 0 && (
        <EmptyState
          title="No agents yet"
          action={
            canCreate ? (
              <Link className="btn btn--plum btn--sm" to={`${base}/agents/new`}>
                <span>Build the first agent</span>
              </Link>
            ) : (
              canRequest && (
                <Link className="btn btn--plum btn--sm" to={`${base}/requests?new=new_agent`}>
                  <span>Ask bitNtech for your first agent</span>
                </Link>
              )
            )
          }
        >
          <p>
            {canCreate
              ? 'An agent answers one of their phone lines. Build it from recordings of their past calls.'
              : canRequest
                ? 'An agent answers one of your phone lines. bitNtech builds it from recordings of your past calls: upload some, then ask for it.'
                : 'When bitNtech sets up an agent for you, it appears here.'}
          </p>
        </EmptyState>
      )}

      {agents.state === 'ready' && all.length > 0 && (
        <>
          <div className="list-tools">
            <TextField
              ref={search}
              label="Search agents"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, use case or number"
              autoComplete="off"
              className="list-tools__search"
            />
            <fieldset className="seg">
              <legend className="field__label">Status</legend>
              <div className="seg__opts">
                {FILTERS.map((f) => (
                  <label key={f} className="seg__opt">
                    <input type="radio" name={filterName} value={f} checked={filter === f} onChange={() => setFilter(f)} />
                    <span>
                      {f === 'all' ? 'All' : AGENT_STATUS_LABEL[f]} <span className="seg__n">{count(f)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <p className="sr-only" aria-live="polite">
            {announced}
          </p>

          {shown.length === 0 ? (
            <p className="empty-note">
              No agents match{q ? ` “${query.trim()}”` : ''}
              {filter !== 'all' ? ` with status ${AGENT_STATUS_LABEL[filter].toLowerCase()}` : ''}.{' '}
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                  // This button disappears; carry on from the search field.
                  search.current?.focus()
                }}
              >
                Clear search and filter
              </button>
            </p>
          ) : (
            <ul className="rows" aria-label="Agents">
              {shown.map((a) => (
                <AgentRow key={a.id} agent={a} base={`${base}/agents`} canBuild={canCreate} newPattern={patternAgentIds.has(a.id)} callsHref={`${base}/calls?agent=${a.id}`} />
              ))}
            </ul>
          )}
        </>
      )}
    </ConsolePage>
  )
}

function AgentRow({ agent: a, base, canBuild, newPattern, callsHref }: { agent: AgentSummary; base: string; canBuild: boolean; newPattern: boolean; callsHref: string }) {
  return (
    <li className="agent-row">
      <div className="agent-row__main">
        <h2 className="agent-row__name">
          {a.setupStep ? (
            a.name
          ) : (
            <Link className="agent-row__link" to={`${base}/${a.id}`}>
              {a.name}
            </Link>
          )}
        </h2>
        <span className="row__meta">
          {a.useCase} <i aria-hidden="true">·</i> {a.languages.map((l) => LANGUAGE_LABEL[l]).join(', ')}
        </span>
        {newPattern && (
          <Link className="agent-row__pattern" to={callsHref} aria-label={`New call flow pattern detected for ${a.name}. View in call history.`}>
            <span className="agent-row__pattern-dot" aria-hidden="true" />
            New pattern detected
          </Link>
        )}
        {a.hasChanges && <span className="agent-row__setup">Unpublished changes</span>}
        {a.setupStep && (
          <span className="agent-row__setup">
            {canBuild ? `Setup: step ${stepIndex(a.setupStep) + 1} of ${BUILDER_STEPS.length}, ${STEP_META[a.setupStep].label.toLowerCase()}` : 'Being set up by bitNtech'}
            {canBuild && (
              <>
                {' '}
                <Link className="link" to={`${base}/drafts/${a.id}/${a.setupStep}`} aria-label={`Continue setup of ${a.name}`}>
                  Continue setup
                </Link>
              </>
            )}
          </span>
        )}
      </div>
      <dl className="agent-row__facts">
        <div>
          <dt>Number</dt>
          <dd>{a.phoneNumber ?? <span className="agent-row__none">Not assigned</span>}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>
            {a.version !== null && a.lastPublishedAt ? (
              <>
                v{a.version} <i aria-hidden="true">·</i> {shortDate(a.lastPublishedAt)}
              </>
            ) : (
              <span className="agent-row__none">Never</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Calls this week</dt>
          <dd className="agent-row__num">{a.callsThisWeek.toLocaleString('en-IN')}</dd>
        </div>
      </dl>
      <span className={`status-chip status-chip--${a.status}`}>{AGENT_STATUS_LABEL[a.status]}</span>
    </li>
  )
}
