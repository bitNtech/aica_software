import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { SegFilter } from '../../components/console/ListTools'
import { UpdatedAgo } from '../../components/console/UpdatedAgo'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { asAuthError } from '../../auth/types'
import { useAsync } from '../../lib/useAsync'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { OverviewDays, PlatformOverview } from '../../ops/types'
import { StaleNote } from '../console/operate/LiveBits'
import { useLiveData } from '../console/operate/shared'
import { Activity } from './overview/Activity'
import { Agents } from './overview/Agents'
import { Analytics } from './overview/Analytics'
import { Group, Panel, PanelState } from './overview/bits'
import { Kpis, PERIOD_LABEL } from './overview/Kpis'
import { LiveOperations } from './overview/LiveOperations'
import { OrgList, OrgSummaries } from './overview/Organisations'
import { PendingActions } from './overview/PendingActions'
import { PlatformHealth } from './overview/PlatformHealth'
import '../console/operate/Operate.css'
import './Ops.css'
import './overview/Overview.css'

const LIVE_REFRESH = 15_000
const SECTIONS = [
  ['ov-actions', 'Needs you'],
  ['ov-live', 'Live'],
  ['ov-analytics', 'Analytics'],
  ['ov-orgs', 'Organisations'],
  ['ov-agents', 'Agents'],
  ['ov-activity', 'Activity'],
  ['ov-health', 'Platform health'],
] as const

/**
 * /ops — the whole platform for bitNtech staff: what needs a decision first,
 * then what's happening now, how calls went over a period, and every
 * organisation with the master admin's actions. Organisations come from the
 * sign-in API; calls, agents and health come from the Ops data client
 * (sample data until its API exists, and each such panel says so).
 */
export default function OpsOverviewPage() {
  const { client, user } = useAuth()
  const ops = useOpsData()
  const isMaster = user?.platformRole === 'master_admin'
  const demo = ops.isDemo

  const loadOrgs = useCallback(() => client.listOrgs(), [client])
  const [orgsState, reloadOrgs] = useAsync(loadOrgs)
  const orgs = orgsState.state === 'ready' ? orgsState.data : null
  const orgsError = orgsState.state === 'error' ? orgsState.error : null

  const [days, setDays] = useState<OverviewDays>(7)
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [overviewError, setOverviewError] = useState<unknown>(null)
  const [overviewBusy, setOverviewBusy] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setOverviewBusy(true)
    ops.getOverview(days).then(
      (o) => {
        if (!live) return
        setOverview(o)
        setOverviewError(null)
        setOverviewBusy(false)
      },
      (e) => {
        if (!live) return
        // Keep showing the last figures; the error says they're out of date.
        setOverviewError(e)
        setOverviewBusy(false)
      },
    )
    return () => {
      live = false
    }
  }, [ops, days, tick])
  const reloadOverview = useCallback(() => setTick((t) => t + 1), [])

  const loadLive = useCallback(() => ops.getLiveOps(), [ops])
  const live = useLiveData(loadLive, LIVE_REFRESH)

  const loading = (!orgs && !orgsError) || (!overview && !overviewError) || (!live.data && !live.error)
  const pendingCount = orgs?.filter((o) => o.status === 'pending_review').length

  return (
    <OpsLayout
      kicker="Overview"
      docTitle="Overview"
      pendingCount={pendingCount}
      title={
        <>
          Every client, <em>one place.</em>
        </>
      }
      lede={
        <p>
          {isMaster
            ? 'What needs a decision, what’s happening now, and how calls are going across every organisation. You can approve sign-ups, and suspend or restore any organisation.'
            : 'What needs a decision, what’s happening now, and how calls are going across every organisation. You can review sign-ups; only the master admin can suspend or restore an organisation.'}
        </p>
      }
    >
      <p className="sr-only" role="status">
        {loading ? 'Loading the overview…' : ''}
      </p>

      <div className="ov-toolbar">
        <SegFilter<`${OverviewDays}`>
          legend="Period for calls and agents"
          value={`${days}`}
          onChange={(v) => setDays(Number(v) as OverviewDays)}
          options={([1, 7, 30] as OverviewDays[]).map((d) => ({ value: `${d}`, label: PERIOD_LABEL[d] }))}
        />
        <p className="ov-toolbar__status">
          <UpdatedAgo at={live.checkedAt} label="Live figures updated" />
          <span aria-hidden="true"> · </span>
          <span>every 15 s</span>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              reloadOrgs()
              reloadOverview()
              live.reload()
            }}
          >
            Refresh all
          </button>
        </p>
      </div>

      <nav className="ov-jump" aria-label="On this page">
        <ul>
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      {overview && overviewError ? (
        <Alert tone="error" title="Couldn’t update calls and agents" className="ov-alert">
          <p>
            {asAuthError(overviewError).message} The figures below are from {PERIOD_LABEL[overview.days].toLowerCase()}, as last loaded.
          </p>
          <button type="button" className="btn-text" onClick={reloadOverview}>
            Try again
          </button>
        </Alert>
      ) : null}
      {live.data && live.error ? <StaleNote error={live.error} checkedAt={live.checkedAt} onRetry={live.reload} /> : null}

      <div className={`ov${overviewBusy && overview ? ' is-loading' : ''}`} aria-busy={overviewBusy || undefined}>
        <Kpis orgs={orgs} orgsFailed={!!orgsError} overview={overview} overviewFailed={!overview && !!overviewError} live={live.data} liveFailed={!live.data && !!live.error} />

        <Group id="ov-actions" title="Needs you">
          <PendingActions
            orgs={orgs}
            orgsError={orgsError}
            reloadOrgs={reloadOrgs}
            overview={overview}
            overviewError={overviewError}
            reloadOverview={reloadOverview}
            live={live.data}
            liveError={live.error}
            reloadLive={live.reload}
            demo={demo}
          />
        </Group>

        <Group id="ov-live" title="Live operations" note="Right now, every organisation">
          <LiveOperations live={live.data} error={live.error} reload={live.reload} demo={demo} />
        </Group>

        <Group id="ov-analytics" title="Analytics" note={PERIOD_LABEL[days]}>
          <Analytics overview={overview} error={overviewError} reload={reloadOverview} demo={demo} />
        </Group>

        <Group id="ov-orgs" title="Organisations">
          <OrgSummaries orgs={orgs} orgsError={orgsError} reloadOrgs={reloadOrgs} overview={overview} overviewError={overviewError} reloadOverview={reloadOverview} demo={demo} />
          <Panel title="All organisations" wide className="ov-panel--flush">
            {orgs ? <OrgList orgs={orgs} reload={reloadOrgs} /> : <PanelState error={orgsError} onRetry={reloadOrgs} />}
          </Panel>
        </Group>

        <Group id="ov-agents" title="Agents" note="Every organisation">
          <Agents overview={overview} error={overviewError} reload={reloadOverview} demo={demo} />
        </Group>

        <Group id="ov-activity" title="Recent activity">
          <Activity orgs={orgs} overview={overview} error={overviewError} reload={reloadOverview} isMaster={isMaster} demo={demo} />
        </Group>

        <Group id="ov-health" title="Platform health" note="ASR, LLM, TTS and telephony">
          <PlatformHealth live={live.data} error={live.error} reload={live.reload} demo={demo} />
        </Group>
      </div>
    </OpsLayout>
  )
}
