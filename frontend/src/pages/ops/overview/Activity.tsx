import { useState } from 'react'
import { Link } from 'react-router'
import { BUSINESS_LABEL } from '../../../auth/roles'
import type { OrgSummary } from '../../../auth/types'
import { SegFilter } from '../../../components/console/ListTools'
import { Timeline, type TimelineItem } from '../../../components/console/Timeline'
import type { PlatformOverview } from '../../../ops/types'
import { Panel, PanelState } from './bits'

type Filter = 'all' | 'signups' | 'agents' | 'admin'
const PAGE = 12

interface Entry {
  at: string
  kind: Exclude<Filter, 'all'>
  item: TimelineItem
}

/**
 * Sign-ups (from the organisation list), agents started and published, and
 * the master admin's decisions, newest first in one timeline.
 */
export function Activity({
  orgs,
  overview,
  error,
  reload,
  isMaster,
  demo,
}: {
  orgs: OrgSummary[] | null
  overview: PlatformOverview | null
  error: unknown
  reload(): void
  isMaster: boolean
  demo: boolean
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(PAGE)

  const entries: Entry[] = [
    ...(orgs ?? []).map(
      (o): Entry => ({
        at: o.createdAt,
        kind: 'signups',
        item: { id: `signup_${o.slug}`, at: o.createdAt, kind: 'person', title: `${o.name} signed up`, body: `${BUSINESS_LABEL[o.businessType]} in ${o.city}` },
      }),
    ),
    ...(overview?.activity ?? []).map(
      (a): Entry => ({
        at: a.at,
        kind: a.kind === 'admin' ? 'admin' : 'agents',
        item: { id: a.id, at: a.at, kind: a.kind === 'admin' ? 'system' : 'agent', who: a.who, title: a.what },
      }),
    ),
  ].sort((a, b) => b.at.localeCompare(a.at))

  const visible = entries.filter((e) => filter === 'all' || e.kind === filter)
  const count = (k: Filter) => (k === 'all' ? entries.length : entries.filter((e) => e.kind === k).length)
  const options: { value: Filter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: count('all') },
    { value: 'signups', label: 'Sign-ups', count: count('signups') },
    { value: 'agents', label: 'Agents', count: count('agents') },
    ...(isMaster ? [{ value: 'admin' as const, label: 'Admin actions', count: count('admin') }] : []),
  ]

  return (
    <Panel
      title={isMaster ? 'Sign-ups, agents and admin actions' : 'Sign-ups and agents'}
      wide
      demo={demo}
      note={isMaster ? 'Newest first' : 'Newest first. Admin actions are shown to the master admin only.'}
      action={isMaster ? <Link to="/ops/audit">Every admin action</Link> : undefined}
    >
      {!overview && !orgs ? (
        <PanelState error={error} onRetry={reload} height="10rem" />
      ) : (
        <>
          <div className="list-tools">
            <SegFilter<Filter>
              legend="Show"
              value={filter}
              onChange={(f) => {
                setFilter(f)
                setShown(PAGE)
              }}
              options={options}
            />
          </div>
          {!overview && error ? <PanelState error={error} onRetry={reload} height="3rem" /> : null}
          {visible.length === 0 ? (
            <p className="ov-empty">Nothing here yet.</p>
          ) : (
            <Timeline label="Recent activity" items={visible.slice(0, shown).map((e) => e.item)} />
          )}
          {visible.length > shown && (
            <button type="button" className="btn-text ov-more" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more
            </button>
          )}
        </>
      )}
    </Panel>
  )
}
