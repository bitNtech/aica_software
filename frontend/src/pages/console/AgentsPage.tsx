import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { LANGUAGE_LABEL } from '../../auth/roles'
import { asAuthError } from '../../auth/types'
import { can } from '../../console/access'
import { useConsole } from '../../console/ConsoleProvider'
import type { AgentStatus, AgentSummary } from '../../console/types'
import { useOrg } from '../../console/useOrg'
import { ConsoleLayout } from '../../components/console/ConsoleLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Spinner'
import { shortDate } from '../../lib/time'
import { useAsync } from '../../lib/useAsync'

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = { live: 'Live', draft: 'Draft', paused: 'Paused' }

/** Live first: what's answering calls now; then work in progress. */
const ORDER: Record<AgentStatus, number> = { live: 0, draft: 1, paused: 2 }
type Filter = 'all' | AgentStatus
const FILTERS: Filter[] = ['all', 'live', 'draft', 'paused']

/** /o/:slug/agents — every voice agent in the organisation. Owners and
 * admins create agents; supervisors and viewers read. */
export default function AgentsPage() {
  const { org } = useOrg()
  const client = useConsole()
  const load = useCallback(() => client.listAgents(org.orgSlug), [client, org.orgSlug])
  const [agents, reload] = useAsync(load)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const soonId = useId()
  const filterName = useId()
  const search = useRef<HTMLInputElement>(null)
  const canCreate = can(org.role, 'agent.create')

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
    <ConsoleLayout
      kicker="Build"
      docTitle="Agents"
      title="Agents"
      lede={<p>Each agent answers one phone line. It's built from recordings of your past calls, then tested and published.</p>}
      actions={
        canCreate && (
          <>
            {/* Not `disabled`: it stays focusable, so its explanation is read. */}
            <Button variant="line" className="btn--inactive" aria-disabled="true" aria-describedby={soonId} onClick={(e) => e.preventDefault()}>
              New agent
            </Button>
            <span className="console__soon" id={soonId}>
              The agent builder is coming soon.
            </span>
          </>
        )
      }
    >
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
        <section className="empty-card" aria-labelledby="no-agents-h">
          <h2 id="no-agents-h" className="empty-card__title">
            No agents yet
          </h2>
          <p>
            {canCreate
              ? 'An agent answers one of your phone lines. You’ll build the first one from recordings of your past calls, once the agent builder arrives.'
              : 'When an owner or admin creates an agent, it appears here.'}
          </p>
        </section>
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
                <AgentRow key={a.id} agent={a} />
              ))}
            </ul>
          )}
        </>
      )}
    </ConsoleLayout>
  )
}

function AgentRow({ agent: a }: { agent: AgentSummary }) {
  return (
    <li className="agent-row">
      <div className="agent-row__main">
        <h2 className="agent-row__name">{a.name}</h2>
        <span className="row__meta">
          {a.useCase} <i aria-hidden="true">·</i> {a.languages.map((l) => LANGUAGE_LABEL[l]).join(', ')}
        </span>
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
