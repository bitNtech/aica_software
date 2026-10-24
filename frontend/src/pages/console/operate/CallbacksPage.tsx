import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Callback, OrgSettings } from '../../../console/types'
import { useAttention } from '../../../console/useAttention'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { useShortcuts } from '../../../components/console/KeyboardHelp'
import { useSettled } from '../../../components/console/ListTools'
import { SplitView } from '../../../components/console/SplitView'
import { Toolbar, type FilterChip } from '../../../components/console/Toolbar'
import { useToast } from '../../../components/console/Toast'
import { UpdatedAgo } from '../../../components/console/UpdatedAgo'
import { Alert } from '../../../components/ui/Alert'
import { SelectField, TextField } from '../../../components/ui/Field'
import { useAsync } from '../../../lib/useAsync'
import { useMediaQuery } from '../../../lib/useMediaQuery'
import { useNow } from '../../../lib/useNow'
import { BulkBar, type BulkReport } from './callbacks/BulkBar'
import { CallbackDetail } from './callbacks/CallbackDetail'
import { CallbackQueue } from './callbacks/CallbackQueue'
import { buildQueue, nameOf, nextCallback, NO_FILTER, summarize, type QueueFilter, type Sort } from './callbacks/queue'
import { StaleNote, useAnnouncer } from './LiveBits'
import { useLiveData } from './shared'
import './Operate.css'
import './callbacks/Callbacks.css'

/** How often the list is read again (it pauses while the tab is hidden). */
const POLL_MS = 10_000
const WIDE = '(min-width: 1100px)'

const SORT_LABEL: Record<Sort, string> = { urgency: 'Most urgent first', newest: 'Newest request first', oldest: 'Oldest request first' }
const TRIES_LABEL = { untried: 'Not tried yet', tried: 'Tried at least once' } as const
const STATUS_LABEL = { open: 'To call', done: 'Done', unreachable: 'Couldn’t reach' } as const

/**
 * /o/:slug/callbacks: missed calls and callers who asked to be called back,
 * as one queue by urgency beside the callback that is open (in a drawer on a
 * phone). Whoever has "Assign callbacks" sees every callback and gives them
 * to anyone, one at a time or ticked in bulk; whoever only takes calls sees
 * their own and the ones nobody has yet, and takes, rings and logs those.
 * The list is read again every few seconds; a change made here shows at once.
 */
export default function CallbacksPage() {
  const { org, user, access } = useOrg()
  const client = useConsole()
  const toast = useToast()
  const attention = useAttention()
  const manage = pageAccess(access, 'callbacks') === 'edit'
  const mayReadSettings = pageAccess(access, 'settings') === 'edit'

  const load = useCallback(() => client.listCallbacks(org.orgSlug), [client, org.orgSlug])
  const feed = useLiveData(load, POLL_MS)
  const callbacks = useMemo(() => feed.data ?? [], [feed.data])
  const now = useNow(30_000)
  const [said, say] = useAnnouncer()

  // The team: only people who handle calls can be given one.
  const loadTeam = useCallback(() => client.listMembers(org.orgSlug), [client, org.orgSlug])
  const [teamResult] = useAsync(loadTeam)
  const teamKnown = teamResult.state === 'ready'
  const team = useMemo(() => (teamResult.state === 'ready' ? teamResult.data.filter((m) => m.status === 'active' && m.role !== 'viewer') : []), [teamResult])

  // Opening hours, for "due outside hours": only those who may read the settings ask; no access is no warning, not an error.
  const loadSettings = useCallback(async (): Promise<OrgSettings | null> => {
    if (!mayReadSettings) return null
    try {
      return await client.getOrgSettings(org.orgSlug)
    } catch {
      return null
    }
  }, [client, org.orgSlug, mayReadSettings])
  const [settingsResult] = useAsync(loadSettings)
  const settings = settingsResult.state === 'ready' ? settingsResult.data : null

  // ---- filters
  const [filter, setFilter] = useState<QueueFilter>(NO_FILTER)
  const [sort, setSort] = useState<Sort>('urgency')
  const search = useRef<HTMLInputElement>(null)
  const items = useMemo(() => buildQueue(callbacks, filter, sort, now, user.id), [callbacks, filter, sort, now, user.id])
  const summary = summarize(items)
  const filtering = filter.text.trim() !== '' || filter.assignee !== '' || filter.tries !== '' || filter.status !== ''
  const filterSaid = useSettled(`${items.length} of ${callbacks.length} shown`, filtering)

  // Everyone who has one, so a callback given to someone who has since left can still be found.
  const assigneeOptions = useMemo(() => {
    const known = new Set(team.map((m) => m.id))
    const gone = new Map<string, string>()
    for (const c of callbacks) if (c.assignedTo && !known.has(c.assignedTo.id)) gone.set(c.assignedTo.id, c.assignedTo.name)
    return [
      { value: '', label: 'Anyone' },
      { value: 'me', label: 'Me' },
      { value: 'nobody', label: 'Not given to anyone' },
      ...team.filter((m) => m.id !== user.id).map((m) => ({ value: m.id, label: m.name })),
      ...[...gone].map(([id, name]) => ({ value: id, label: `${name} (not on the team)` })),
    ]
  }, [team, callbacks, user.id])
  const assigneeLabel = assigneeOptions.find((o) => o.value === filter.assignee)?.label ?? ''
  const chips: FilterChip[] = [
    ...(filter.text.trim() ? [{ id: 'text', label: `Search: ${filter.text.trim()}`, onRemove: () => setFilter((f) => ({ ...f, text: '' })) }] : []),
    ...(filter.assignee ? [{ id: 'assignee', label: `Given to: ${assigneeLabel}`, onRemove: () => setFilter((f) => ({ ...f, assignee: '' })) }] : []),
    ...(filter.tries ? [{ id: 'tries', label: TRIES_LABEL[filter.tries], onRemove: () => setFilter((f) => ({ ...f, tries: '' })) }] : []),
    ...(filter.status ? [{ id: 'status', label: `Status: ${STATUS_LABEL[filter.status]}`, onRemove: () => setFilter((f) => ({ ...f, status: '' })) }] : []),
  ]

  // ---- which one is open
  const wide = useMediaQuery(WIDE, true)
  // undefined: nobody has chosen yet.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  // Beside the list there is room: start on the most urgent one, once.
  // After that nothing moves the selection: a new callback arriving joins the
  // list but doesn't take over what is being read.
  if (chosen === undefined && wide && items.length > 0) setChosen(items[0].callback.id)
  const picked = chosen ?? null
  const found = callbacks.find((c) => c.id === picked) ?? null
  const [snapshot, setSnapshot] = useState<Callback | null>(null)
  useEffect(() => {
    if (found) setSnapshot(found)
  }, [found])
  // One that has left the list (taken by someone else, or removed) stays
  // on screen as it was, marked as gone, until something else is picked.
  const shown = useMemo(() => {
    if (!picked) return null
    if (found) return { callback: found, gone: false }
    return snapshot && snapshot.id === picked ? { callback: snapshot, gone: true } : null
  }, [picked, found, snapshot])
  const [focusId, setFocusId] = useState<string | null>(null)

  // ---- next callback
  /** The next one for this person to ring after `from`: from what is shown if there is one, else from everything. */
  const nextAfter = useCallback(
    (from: string | null) => nextCallback(items.map((i) => i.callback), from, user.id) ?? nextCallback(callbacks, from, user.id),
    [items, callbacks, user.id],
  )
  function openNext() {
    const n = nextAfter(picked)
    if (!n) {
      toast.show({ message: 'No other callbacks are waiting for you.', tone: 'info' })
      return
    }
    setChosen(n.id)
    setFocusId(n.id)
    say(`Opened ${nameOf(n)}.`)
  }

  useShortcuts({
    '/': { description: 'Search the callbacks', run: () => search.current?.focus() },
    n: { description: 'Open the next callback waiting for you', run: openNext },
  })

  // ---- changes made here show at once; a fresh read follows
  const apply = useCallback((c: Callback) => feed.setData((d) => (d ? d.map((x) => (x.id === c.id ? c : x)) : d)), [feed])
  const refresh = () => {
    feed.reload()
    attention?.refresh()
  }

  // ---- ticking rows to give several at once
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [report, setReport] = useState<BulkReport | null>(null)
  // Ticks for callbacks that have gone from the list go with them.
  useEffect(() => {
    if (!feed.data) return
    setTicked((t) => {
      const present = new Set(feed.data!.map((c) => c.id))
      const kept = [...t].filter((id) => present.has(id))
      return kept.length === t.size ? t : new Set(kept)
    })
  }, [feed.data])
  const tick = (id: string, on: boolean) =>
    setTicked((t) => {
      const n = new Set(t)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  async function giveTicked(memberId: string) {
    const member = team.find((m) => m.id === memberId)
    if (!member) return
    const targets = callbacks.filter((c) => ticked.has(c.id))
    setBulkBusy(true)
    setReport(null)
    const done: { before: Callback }[] = []
    const failed: { id: string; name: string; message: string }[] = []
    // One by one: each has its own checks, and a failure shouldn't stop the rest.
    for (const c of targets) {
      try {
        apply(await client.updateCallback(org.orgSlug, c.id, { assignedTo: memberId }))
        done.push({ before: c })
      } catch (err) {
        failed.push({ id: c.id, name: nameOf(c), message: asAuthError(err).message })
      }
    }
    setBulkBusy(false)
    setTicked(new Set(failed.map((f) => f.id)))
    setReport({ to: member.name, total: targets.length, gave: done.length, failed: failed.map(({ name, message }) => ({ name, message })) })
    refresh()
    if (done.length > 0) {
      toast.show({
        message: `Gave ${done.length} ${done.length === 1 ? 'callback' : 'callbacks'} to ${member.name}${failed.length ? `; ${failed.length} couldn’t be given` : ''}.`,
        tone: failed.length ? 'warn' : 'ok',
        action: { label: 'Undo', onClick: () => void undoBulk(done.map((d) => d.before)) },
      })
    }
  }

  /** Each given callback goes back to who had it, where that person is still on the team. */
  async function undoBulk(before: Callback[]) {
    let back = 0
    for (const c of before) {
      if (c.assignedTo && !team.some((m) => m.id === c.assignedTo!.id)) continue
      try {
        apply(await client.updateCallback(org.orgSlug, c.id, { assignedTo: c.assignedTo?.id ?? null }))
        back++
      } catch {
        // Left as it is: the count below says how many went back.
      }
    }
    setReport(null)
    refresh()
    toast.show({ message: back === before.length ? 'Undone.' : `Put ${back} of ${before.length} back as they were.`, tone: back === before.length ? 'ok' : 'warn' })
  }

  const loading = !feed.data && !feed.error

  return (
    <ConsolePage
      section="callbacks"
      kicker="Operate"
      title="Callbacks"
      docTitle="Callbacks"
      status={<UpdatedAgo at={feed.checkedAt} />}
      lede={<p>Missed calls and callers who asked to be called back. {manage ? 'Give each to someone on the team.' : 'You see yours, and ones nobody has taken yet.'}</p>}
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
        <Alert tone="error" title="Couldn't load callbacks">
          <p>{asAuthError(feed.error).message}</p>
          <button type="button" className="btn-text" onClick={feed.reload}>
            Try again
          </button>
        </Alert>
      ) : (
        <>
          <Toolbar
            label="Filter the callbacks"
            sticky={false}
            search={<TextField ref={search} label="Search callbacks" type="search" value={filter.text} placeholder="Name, number or reason" onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))} />}
            filters={
              <>
                {manage && <SelectField label="Given to" value={filter.assignee} options={assigneeOptions} onChange={(e) => setFilter((f) => ({ ...f, assignee: e.target.value }))} />}
                <SelectField
                  label="Tries"
                  value={filter.tries}
                  options={[
                    { value: '', label: 'Any' },
                    { value: 'untried', label: TRIES_LABEL.untried },
                    { value: 'tried', label: TRIES_LABEL.tried },
                  ]}
                  onChange={(e) => setFilter((f) => ({ ...f, tries: e.target.value as QueueFilter['tries'] }))}
                />
                <SelectField
                  label="Status"
                  value={filter.status}
                  options={[
                    { value: '', label: 'To call, and recent' },
                    { value: 'open', label: STATUS_LABEL.open },
                    { value: 'done', label: STATUS_LABEL.done },
                    { value: 'unreachable', label: STATUS_LABEL.unreachable },
                  ]}
                  onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as QueueFilter['status'] }))}
                />
                <SelectField label="Order" value={sort} options={(Object.keys(SORT_LABEL) as Sort[]).map((s) => ({ value: s, label: SORT_LABEL[s] }))} onChange={(e) => setSort(e.target.value as Sort)} />
              </>
            }
            summary={loading ? undefined : `${summary.open} open · ${summary.overdue} overdue`}
            chips={chips}
            onClearAll={() => setFilter(NO_FILTER)}
          />
          <SplitView
            storageKey="aica.split.callbacks"
            defaultWidth={420}
            listLabel="Callbacks"
            detailLabel="Callback details"
            detailOpen={shown !== null}
            onCloseDetail={() => setChosen(null)}
            detailEmpty={<p className="split__empty">Pick a callback to see who it is, why they asked, who has it and what happened on earlier calls. Press N for the next one waiting for you.</p>}
            list={
              <CallbackQueue
                items={items}
                total={callbacks.length}
                sort={sort}
                selectedId={picked}
                onSelect={setChosen}
                manage={manage}
                ticked={ticked}
                onTick={tick}
                now={now}
                loading={loading}
                openClosed={filter.status === 'done' || filter.status === 'unreachable'}
                onClearFilters={() => setFilter(NO_FILTER)}
                header={
                  manage && callbacks.length > 0 ? (
                    <BulkBar
                      shown={items.length}
                      ticked={ticked.size}
                      team={team}
                      busy={bulkBusy}
                      report={report}
                      onTickAll={() => setTicked(new Set(items.map((i) => i.callback.id)))}
                      onClear={() => setTicked(new Set())}
                      onGive={(id) => void giveTicked(id)}
                      onDismissReport={() => setReport(null)}
                    />
                  ) : null
                }
              />
            }
            detail={
              shown && (
                <CallbackDetail
                  key={shown.callback.id}
                  callback={shown.callback}
                  all={callbacks}
                  team={team}
                  teamKnown={teamKnown}
                  manage={manage}
                  me={{ id: user.id, name: user.name }}
                  settings={settings}
                  gone={shown.gone}
                  next={nextAfter(shown.callback.id)}
                  focus={focusId === shown.callback.id}
                  now={now}
                  onChanged={apply}
                  onOpen={(id) => {
                    setChosen(id)
                    setFocusId(id)
                  }}
                  onNext={openNext}
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
