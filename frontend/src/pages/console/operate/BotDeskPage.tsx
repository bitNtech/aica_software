import { useCallback, useMemo, useRef, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { can, canOpen, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { ActivityEntry, Appointment, Desk } from '../../../console/types'
import { useAttention } from '../../../console/useAttention'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { useShortcuts } from '../../../components/console/KeyboardHelp'
import { Skeleton } from '../../../components/console/Skeleton'
import { UpdatedAgo } from '../../../components/console/UpdatedAgo'
import { Alert } from '../../../components/ui/Alert'
import { localDay } from '../../../lib/time'
import { useNow } from '../../../lib/useNow'
import { calendarRange, deskEntries, todayFigures } from './desk/logic'
import { DeskActivity } from './desk/DeskActivity'
import { DoctorCalendar, type ApptState } from './desk/DoctorCalendar'
import { FlagsTriage, type FlagPowers } from './desk/FlagsTriage'
import { LineBoard, type LineFigures } from './desk/LineBoard'
import { Notices } from './desk/Notices'
import { StaleNote, useAnnouncer } from './LiveBits'
import { useLiveData } from './shared'
import './Operate.css'
import './Desk.css'

/** How often the desk is read again (it pauses while the tab is hidden). */
const POLL_MS = 10_000
/** Today's figures and the appointments move more slowly than the desk. */
const SLOW_MS = 60_000
const ACTIVITY_MS = 30_000

const NO_FIGURES: ReadonlyMap<string, LineFigures> = new Map()

/**
 * /o/:slug/desk: the front desk's controls over the agents, in one working
 * screen. The lines across the top (who is answering each, today's calls,
 * send a line or every line to staff and back); beside them the flagged
 * answers to triage, the notices showing and scheduled, and the desk's own
 * activity; and below, a fortnight of doctor availability. These apply at
 * once and aren't agent versions: nothing here changes the flow, which is
 * bitNtech's. Each person sees only the controls their permissions allow.
 */
export default function BotDeskPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const attention = useAttention()
  const [said, say] = useAnnouncer()
  const now = useNow(30_000)
  const today = localDay(0, now)
  const canBot = can(access, 'desk.bot')
  const canNotices = can(access, 'desk.notices')
  const powers: FlagPowers = {
    resolve: can(access, 'desk.resolveFlags'),
    faq: pageAccess(access, 'knowledge') === 'edit',
    ask: can(access, 'request.create') && canOpen(access, 'requests'),
    calls: canOpen(access, 'calls'),
  }
  const mayReports = canOpen(access, 'reports')
  const mayAppointments = canOpen(access, 'appointments')
  const mayActivity = canOpen(access, 'activity')

  // ---- the desk itself
  const load = useCallback(() => client.getDesk(org.orgSlug), [client, org.orgSlug])
  const feed = useLiveData(load, POLL_MS)
  const desk = feed.data

  // ---- today's calls and hand-over rate per agent: only for those who may read reports; otherwise quietly left out
  const agentKey = useMemo(() => [...new Set((desk?.lines ?? []).map((l) => l.agentId).filter((a): a is string => !!a))].sort().join(','), [desk])
  const loadFigures = useCallback(async (): Promise<ReadonlyMap<string, LineFigures>> => {
    if (!mayReports || !agentKey) return NO_FIGURES
    const ids = agentKey.split(',')
    const reads = await Promise.allSettled(ids.map((agentId) => client.getReport(org.orgSlug, { days: 1, agentId })))
    const out = new Map<string, LineFigures>()
    reads.forEach((r, i) => {
      const f = r.status === 'fulfilled' ? todayFigures(r.value) : null
      if (f) out.set(ids[i], f)
    })
    return out
  }, [client, org.orgSlug, mayReports, agentKey])
  const figures = useLiveData(loadFigures, SLOW_MS)

  // ---- appointments in the next fortnight, to say how many each doctor change touches
  const loadAppointments = useCallback(async (): Promise<Appointment[]> => {
    if (!mayAppointments) return []
    const { from, to } = calendarRange(today)
    return client.listAppointments(org.orgSlug, from, to)
  }, [client, org.orgSlug, mayAppointments, today])
  const appointments = useLiveData(loadAppointments, SLOW_MS)
  const apptState: ApptState = !mayAppointments ? 'off' : appointments.data ? 'ready' : appointments.error ? 'error' : 'loading'

  // ---- the desk's part of the organisation's activity log
  const loadActivity = useCallback(async (): Promise<ActivityEntry[]> => {
    if (!mayActivity) return []
    const found: ActivityEntry[] = []
    let before: string | undefined
    // The log holds everything; read back until there is enough of the desk's own.
    for (let page = 0; page < 4 && found.length < 8; page++) {
      const p = await client.listActivity(org.orgSlug, { area: 'agents', before })
      found.push(...deskEntries(p.entries))
      if (!p.nextBefore) break
      before = p.nextBefore
    }
    return found
  }, [client, org.orgSlug, mayActivity])
  const activity = useLiveData(loadActivity, ACTIVITY_MS)

  // ---- changes made here show at once; the activity log and sidebar count follow
  const adopt = useCallback(
    (d: Desk) => {
      feed.setData(d)
      activity.reload()
      attention?.refresh()
    },
    [feed.setData, activity.reload, attention],
  )
  const flagged = () => {
    feed.reload()
    attention?.refresh()
  }

  const [creating, setCreating] = useState(false)
  const [marking, setMarking] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  useShortcuts({
    ...(canNotices ? { n: { description: 'Post a notice', run: () => setCreating(true) } } : {}),
    '/': { description: 'Search the flagged answers', run: () => search.current?.focus() },
  })

  return (
    <ConsolePage
      kicker="Operate"
      title="Bot desk"
      docTitle="Bot desk"
      status={<UpdatedAgo at={feed.checkedAt} />}
      lede={<p>Run the agents day to day: send a line to your team for a while, tell callers what’s different today, and flag answers that were wrong.</p>}
    >
      <p className="sr-only" role="status">
        {said}
      </p>
      {!desk && !feed.error && (
        <div className="desk-loading" aria-busy="true">
          <p className="sr-only" role="status">
            Loading the desk…
          </p>
          <Skeleton block height="7rem" />
          <Skeleton block height="14rem" />
        </div>
      )}
      {!desk && feed.error ? (
        <Alert tone="error" title="Couldn't load the desk">
          <p>{asAuthError(feed.error).message}</p>
          <button type="button" className="btn-text" onClick={feed.reload}>
            Try again
          </button>
        </Alert>
      ) : null}
      {desk && feed.error ? <StaleNote error={feed.error} checkedAt={feed.checkedAt} onRetry={feed.reload} /> : null}
      {desk && (
        <>
          <LineBoard lines={desk.lines} canBot={canBot} figures={figures.data ?? NO_FIGURES} now={now} onDesk={adopt} say={say} />
          <div className="desk-main">
            <FlagsTriage desk={desk} powers={powers} searchRef={search} onDesk={adopt} onFlagged={flagged} say={say} />
            <div className="desk-side">
              <Notices desk={desk} canEdit={canNotices} now={now} creating={creating} onCreating={setCreating} onDesk={adopt} say={say} />
              {mayActivity && <DeskActivity entries={activity.data} error={activity.error} onRetry={activity.reload} seeAll={`/o/${org.orgSlug}/activity`} />}
            </div>
          </div>
          <DoctorCalendar desk={desk} canEdit={canNotices} today={today} appointments={appointments.data ?? []} apptState={apptState} onDesk={adopt} say={say} adding={marking} onAdding={setMarking} />
        </>
      )}
    </ConsolePage>
  )
}
