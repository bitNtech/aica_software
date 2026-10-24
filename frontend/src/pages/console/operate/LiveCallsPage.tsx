import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { can, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Handoff, LiveCall, Member } from '../../../console/types'
import { useAttention } from '../../../console/useAttention'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { useShortcuts } from '../../../components/console/KeyboardHelp'
import { SplitView } from '../../../components/console/SplitView'
import { Toolbar, type FilterChip } from '../../../components/console/Toolbar'
import { UpdatedAgo } from '../../../components/console/UpdatedAgo'
import { Alert } from '../../../components/ui/Alert'
import { Checkbox, SelectField, TextField } from '../../../components/ui/Field'
import { useAsync } from '../../../lib/useAsync'
import { useMediaQuery } from '../../../lib/useMediaQuery'
import { useNow } from '../../../lib/useNow'
import { useSettled } from '../../../components/console/ListTools'
import { playEmergencyTone, playRequestTone, showNotification } from './live/alerts'
import { AlertsMenu, useAlertPrefs } from './live/AlertsMenu'
import { LiveDetail } from './live/LiveDetail'
import { LiveQueue } from './live/LiveQueue'
import { buildQueue, filterOptions, filterQueue, newArrivals, NO_FILTER, summarize, trackEnded, type GoneCall, type QueueFilter, type QueueItem } from './live/queue'
import { StaleNote, useAnnouncer } from './LiveBits'
import { useLiveData } from './shared'
import './Operate.css'
import './live/Live.css'

/** How often the queue is read again (it pauses while the tab is hidden). */
const POLL_MS = 4000
const WIDE = '(min-width: 1100px)'

/**
 * /o/:slug/live: the one queue of everything happening on the phones: callers
 * waiting for a person (what used to be the Handoff queue) at the top, the
 * calls the agents are on beneath, and what ended or was taken lately in a
 * folded group. Pick one to see it beside the list (in a drawer on a phone).
 * People with `calls.take` can take, guide or hand over a call; anyone who
 * may see calls can watch.
 */
export default function LiveCallsPage() {
  const { org, access, user } = useOrg()
  const client = useConsole()
  const attention = useAttention()
  const canAct = pageAccess(access, 'live') === 'edit'
  const personal = can(access, 'call.personal')
  // Anyone who can see calls may read who is waiting (GET /handoffs); only `calls.take` acts on them.
  const mayHandoffs = can(access, 'call.seeWaiting')

  const load = useCallback(async () => {
    const [calls, handoffs] = await Promise.all([client.listLiveCalls(org.orgSlug), mayHandoffs ? client.listHandoffs(org.orgSlug) : Promise.resolve([] as Handoff[])])
    return { calls, handoffs }
  }, [client, org.orgSlug, mayHandoffs])
  const feed = useLiveData(load, POLL_MS)
  const now = useNow(15_000)
  const [said, say] = useAnnouncer()
  const alerts = useAlertPrefs(user.id)

  // Colleagues a call can be handed to: people who take calls.
  const loadTeam = useCallback(() => (canAct ? client.listMembers(org.orgSlug) : Promise.resolve([] as Member[])), [client, org.orgSlug, canAct])
  const [team] = useAsync(loadTeam)

  // ---- calls that dropped off the list stay in "Recently" for 15 minutes
  const previous = useRef<LiveCall[] | null>(null)
  const [gone, setGone] = useState<GoneCall[]>([])
  useEffect(() => {
    previous.current = null
    setGone([])
  }, [org.orgSlug])
  useEffect(() => {
    if (!feed.data) return
    const calls = feed.data.calls
    // Read before it is replaced: the update below runs later.
    const before = previous.current
    previous.current = calls
    setGone((g) => trackEnded(before, calls, g, Date.now()))
  }, [feed.data])

  const items = useMemo(() => (feed.data ? buildQueue(feed.data.calls, feed.data.handoffs, gone, now) : []), [feed.data, gone, now])
  const summary = summarize(items)

  // ---- filters
  const [filter, setFilter] = useState<QueueFilter>(NO_FILTER)
  const search = useRef<HTMLInputElement>(null)
  const shownItems = useMemo(() => filterQueue(items, filter, personal), [items, filter, personal])
  const options = useMemo(() => filterOptions(items), [items])
  const filtering = filter.text.trim() !== '' || filter.agent !== '' || filter.line !== '' || filter.needsPerson
  const chips: FilterChip[] = [
    ...(filter.text.trim() ? [{ id: 'text', label: `Search: ${filter.text.trim()}`, onRemove: () => setFilter((f) => ({ ...f, text: '' })) }] : []),
    ...(filter.agent ? [{ id: 'agent', label: `Agent: ${filter.agent}`, onRemove: () => setFilter((f) => ({ ...f, agent: '' })) }] : []),
    ...(filter.line ? [{ id: 'line', label: `Line: ${filter.line}`, onRemove: () => setFilter((f) => ({ ...f, line: '' })) }] : []),
    ...(filter.needsPerson ? [{ id: 'needs', label: 'Needs a person only', onRemove: () => setFilter((f) => ({ ...f, needsPerson: false })) }] : []),
  ]
  // How many are shown, said once typing pauses (not on every key).
  const filterSaid = useSettled(`${shownItems.length} of ${items.length} shown`, filtering)

  useShortcuts({
    '/': { description: 'Search the queue', run: () => search.current?.focus() },
    n: { description: 'Show only callers who need a person', run: () => setFilter((f) => ({ ...f, needsPerson: !f.needsPerson })) },
  })

  // ---- which one is open
  const wide = useMediaQuery(WIDE, true)
  // undefined: nobody has chosen yet.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  // Beside the list there is room: start on the most urgent one, once (set
  // while rendering, so the first paint already has it). After that nothing
  // moves the selection: an emergency arriving goes to the top of the list
  // and is announced, but doesn't take over what is being read.
  if (chosen === undefined && wide && items.length > 0) setChosen(items[0].key)
  const picked = chosen ?? null
  const setPicked = (key: string | null) => setChosen(key)
  const found = items.find((i) => i.key === picked) ?? null
  const [snapshot, setSnapshot] = useState<QueueItem | null>(null)
  useEffect(() => {
    if (found) setSnapshot(found)
  }, [found])
  // An open call that has gone from the list altogether (15 minutes after it
  // ended) stays on screen as ended, until something else is picked.
  const shown = useMemo<QueueItem | null>(() => {
    if (!picked) return null
    if (found) return found
    return snapshot && snapshot.key === picked ? { ...snapshot, ended: true, section: 'recent' } : null
  }, [picked, found, snapshot])

  // ---- saying what matters
  const flaggedSeen = useRef<Set<string> | null>(null)
  const arrivals = useRef<ReadonlySet<string> | null>(null)
  const prefs = useRef(alerts.prefs)
  prefs.current = alerts.prefs
  useEffect(() => {
    flaggedSeen.current = null
    arrivals.current = null
  }, [org.orgSlug])
  useEffect(() => {
    if (!feed.data) return
    // A caller newly sounding upset, said once (not on the first look).
    const flagged = feed.data.calls.filter((c) => c.flagged && !c.takenBy)
    if (flaggedSeen.current) {
      const fresh = flagged.filter((c) => !flaggedSeen.current!.has(c.id))
      if (fresh.length) say(`A caller on ${fresh[0].agentName} sounds upset or stuck.`)
    }
    flaggedSeen.current = new Set([...(flaggedSeen.current ?? []), ...flagged.map((c) => c.id)])

    // Opt-in alerts for new callers waiting: nothing on the first look.
    const r = newArrivals(arrivals.current, feed.data.handoffs)
    arrivals.current = r.seen
    if (prefs.current.sound) {
      if (r.emergencies.length) playEmergencyTone()
      else if (r.requests.length) playRequestTone()
    }
    if (prefs.current.desktop) {
      for (const h of r.emergencies) showNotification('Emergency caller waiting', h.agentName, `emergency-${h.id}`)
      for (const h of r.requests) showNotification('Caller waiting for a person', h.agentName, `request-${h.id}`)
    }
  }, [feed.data, say])

  // ---- changes made here show at once; a fresh read follows
  const patchHandoff = (h: Handoff) => feed.setData((d) => (d ? { ...d, handoffs: d.handoffs.map((x) => (x.id === h.id ? h : x)) } : d))
  const patchCall = (c: LiveCall) => feed.setData((d) => (d ? { ...d, calls: d.calls.map((x) => (x.id === c.id ? c : x)) } : d))
  const refresh = () => {
    feed.reload()
    attention?.refresh()
  }

  const agentOptions = [{ value: '', label: 'All agents' }, ...options.agents.map((a) => ({ value: a, label: a }))]
  const lineOptions = [{ value: '', label: 'All lines' }, ...options.lines.map((l) => ({ value: l, label: l }))]
  const loading = !feed.data && !feed.error

  return (
    <ConsolePage
      kicker="Operate"
      title="Live calls"
      docTitle="Live calls"
      status={<UpdatedAgo at={feed.checkedAt} />}
      actions={canAct ? <AlertsMenu alerts={alerts} /> : null}
      lede={
        <p>
          Calls the agents are on now, and callers waiting for a person. Emergencies come first, then whoever has waited longest.
          {canAct ? ' Take a call, guide the agent with a note only it hears, or hand the call to a colleague.' : ''}
        </p>
      }
    >
      <p className="sr-only" role="status">
        {said}
      </p>
      {filtering && (
        <p className="sr-only" role="status">
          {filterSaid}
        </p>
      )}
      {feed.data && feed.error ? <StaleNote error={feed.error} checkedAt={feed.checkedAt} onRetry={feed.reload} /> : null}
      {!feed.data && feed.error ? (
        <Alert tone="error" title="Couldn't load live calls">
          <p>{asAuthError(feed.error).message}</p>
          <button type="button" className="btn-text" onClick={feed.reload}>
            Try again
          </button>
        </Alert>
      ) : (
        <>
          <Toolbar
            label="Filter the queue"
            sticky={false}
            search={<TextField ref={search} label="Search calls" type="search" value={filter.text} placeholder="Number, agent or reason" onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))} />}
            filters={
              <>
                {options.agents.length > 1 && <SelectField label="Agent" value={filter.agent} options={agentOptions} onChange={(e) => setFilter((f) => ({ ...f, agent: e.target.value }))} />}
                {options.lines.length > 1 && <SelectField label="Line" value={filter.line} options={lineOptions} onChange={(e) => setFilter((f) => ({ ...f, line: e.target.value }))} />}
                <Checkbox label="Needs a person only" checked={filter.needsPerson} onChange={(e) => setFilter((f) => ({ ...f, needsPerson: e.target.checked }))} />
              </>
            }
            summary={loading ? undefined : mayHandoffs ? `${summary.waiting} waiting · ${summary.onCalls} on calls` : `${summary.onCalls} on calls`}
            chips={chips}
            onClearAll={() => setFilter(NO_FILTER)}
          />
          <SplitView
            storageKey="aica.split.live"
            listLabel="Calls and callers"
            detailLabel="Call details"
            detailOpen={shown !== null}
            onCloseDetail={() => setPicked(null)}
            detailEmpty={<p className="split__empty">Pick a caller to see why they want a person, what the agent has heard so far, and what you can do.</p>}
            list={<LiveQueue items={shownItems} total={items.length} selectedKey={picked} onSelect={setPicked} mayShowPersonal={personal} seesWaiting={mayHandoffs} me={user.name} loading={loading} onClearFilters={() => setFilter(NO_FILTER)} />}
            detail={
              shown && (
                <LiveDetail
                  key={shown.key}
                  item={shown}
                  canAct={canAct}
                  mayShowPersonal={personal}
                  team={team.state === 'ready' ? team.data : []}
                  onHandoff={patchHandoff}
                  onCall={patchCall}
                  onRefresh={refresh}
                />
              )
            }
          />
        </>
      )}
    </ConsolePage>
  )
}
