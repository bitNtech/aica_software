import { useCallback, useEffect, useRef, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { can } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { ActivityArea, ActivityEntry, ActivityQuery, Member } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { SegFilter, useSettled } from '../../../components/console/ListTools'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { SelectField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import '../operate/Operate.css'
import './Manage.css'

type Area = ActivityArea | 'all'
const AREA_LABEL: Record<Area, string> = {
  all: 'Everything',
  team: 'Team',
  agents: 'Agents',
  library: 'Knowledge and tools',
  settings: 'Settings',
  billing: 'Billing',
  access: 'bitNtech access',
}

type Period = '7' | '30' | '90' | 'all'
const PERIOD_LABEL: Record<Period, string> = { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', all: 'All time' }
const cutoffFor = (p: Period) => (p === 'all' ? null : new Date(Date.now() - Number(p) * 864e5).toISOString())
/** The most a download gathers, page by page. */
const EXPORT_MAX = 2000

const queryFor = (area: Area, actorId: string): ActivityQuery => ({ area: area === 'all' ? undefined : area, actorId: actorId || undefined })

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

type State =
  | { state: 'loading' }
  | { state: 'error'; error: unknown }
  | { state: 'ready'; entries: ActivityEntry[]; next: string | null; more: 'idle' | 'loading' | 'error' }

/** Quotes a CSV cell when it needs it. */
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** /o/:slug/audit (was /activity): the organisation's audit log. Owners and admins. */
export default function ActivityPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const [area, setArea] = useState<Area>('all')
  const [actorId, setActorId] = useState('')
  const [period, setPeriod] = useState<Period>('30')
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'error'>('idle')
  const [people, setPeople] = useState<Member[]>([])
  const [data, setData] = useState<State>({ state: 'loading' })
  const [tick, setTick] = useState(0)
  /** After "Show more": the first entry it added takes focus. */
  const [focusFrom, setFocusFrom] = useState<string | null>(null)
  /** A new filter is loading over the old results. */
  const [refreshing, setRefreshing] = useState(false)
  const owner = can(access, 'billing')
  /** The filter now showing: an older page that arrives after a change is dropped. */
  const shown = useRef('')
  shown.current = `${area}|${actorId}`

  useEffect(() => {
    client.listMembers(org.orgSlug).then(
      (m) => setPeople(m.filter((x) => x.status !== 'invited').sort((a, b) => a.name.localeCompare(b.name))),
      () => setPeople([]),
    )
  }, [client, org.orgSlug])

  useEffect(() => {
    let live = true
    setRefreshing(true)
    client.listActivity(org.orgSlug, queryFor(area, actorId)).then(
      (p) => {
        if (!live) return
        setData({ state: 'ready', entries: p.entries, next: p.nextBefore, more: 'idle' })
        setRefreshing(false)
      },
      (error) => {
        if (!live) return
        setData({ state: 'error', error })
        setRefreshing(false)
      },
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, area, actorId, tick])

  useEffect(() => {
    if (!focusFrom) return
    document.querySelector<HTMLElement>(`[data-entry="${focusFrom}"]`)?.focus()
    setFocusFrom(null)
  }, [focusFrom, data])

  const more = useCallback(async () => {
    if (data.state !== 'ready' || !data.next || data.more === 'loading') return
    const was = data
    const key = shown.current
    setData({ ...was, more: 'loading' })
    try {
      const p = await client.listActivity(org.orgSlug, { ...queryFor(area, actorId), before: was.next! })
      if (shown.current !== key) return
      setData({ state: 'ready', entries: [...was.entries, ...p.entries], next: p.nextBefore, more: 'idle' })
      if (p.entries[0]) setFocusFrom(p.entries[0].id)
    } catch {
      if (shown.current === key) setData({ ...was, more: 'error' })
    }
  }, [client, org.orgSlug, data, area, actorId])

  // A period reaches further back than one page: keep loading until it's covered.
  const cutoff = cutoffFor(period)
  useEffect(() => {
    if (!cutoff || data.state !== 'ready' || !data.next || data.more !== 'idle' || refreshing) return
    const oldest = data.entries.at(-1)
    if (oldest && oldest.at >= cutoff) void more()
  }, [cutoff, data, refreshing, more])

  async function download() {
    setExporting('busy')
    try {
      const rows: ActivityEntry[] = []
      let before: string | undefined
      do {
        const p = await client.listActivity(org.orgSlug, { ...queryFor(area, actorId), ...(before ? { before } : {}) })
        rows.push(...p.entries)
        before = p.nextBefore ?? undefined
        if (cutoff && p.entries.at(-1) && p.entries.at(-1)!.at < cutoff) break
      } while (before && rows.length < EXPORT_MAX)
      const kept = rows.filter((e) => !cutoff || e.at >= cutoff)
      const csv = [['When', 'Who', 'bitNtech', 'Area', 'What', 'Detail'], ...kept.map((e) => [e.at, e.actor, e.actorKind === 'bitntech' ? 'yes' : '', AREA_LABEL[e.area], e.text, e.detail ?? ''])]
      const blob = new Blob([csv.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${org.orgSlug}-audit-log.csv`
      document.body.append(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
      setExporting('idle')
    } catch {
      setExporting('error')
    }
  }

  const said = useSettled(data.state === 'ready' ? (data.entries.length === 0 ? 'Nothing matches.' : `${data.entries.length}${data.next ? '+' : ''} entries.`) : '', data.state === 'ready' && !refreshing, 300)
  const filtered = area !== 'all' || !!actorId || period !== 'all'
  /** Everything in the period is loaded: older pages are outside it. */
  const covered = !!cutoff && data.state === 'ready' && (data.entries.at(-1)?.at ?? '') < cutoff
  const areas = (Object.keys(AREA_LABEL) as Area[]).filter((a) => owner || a !== 'billing')

  // Entries grouped by day, newest first.
  const days: { day: string; entries: ActivityEntry[] }[] = []
  if (data.state === 'ready')
    for (const e of data.entries.filter((x) => !cutoff || x.at >= cutoff)) {
      const d = dayOf(e.at)
      if (days.at(-1)?.day === d) days.at(-1)!.entries.push(e)
      else days.push({ day: d, entries: [e] })
    }

  return (
    <ConsolePage
      section="activity"
      kicker="Manage"
      title="Audit log"
      docTitle="Audit log"
      actions={
        <Button variant="line" size="sm" busy={exporting === 'busy'} busyLabel="Preparing…" onClick={() => void download()}>
          Download CSV
        </Button>
      }
      status={exporting === 'error' ? <span className="field__error" role="alert">Couldn’t prepare the download. Try again.</span> : undefined}
      lede={
        <p>
          What changed in {org.orgName} and who changed it, newest first. Includes every time bitNtech staff signed in as one of your team.
          {!owner && ' Billing changes are for owners.'}
        </p>
      }
    >
      <div className="list-tools op-filters">
        <SegFilter<Area> legend="Show" value={area} onChange={setArea} options={areas.map((a) => ({ value: a, label: AREA_LABEL[a] }))} />
        <div className="op-filters__agent">
          <SelectField label="When" value={period} options={(Object.keys(PERIOD_LABEL) as Period[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} onChange={(e) => setPeriod(e.target.value as Period)} />
        </div>
        <div className="op-filters__agent">
          <SelectField label="Who" value={actorId} options={[{ value: '', label: 'Anyone' }, ...people.map((p) => ({ value: p.id, label: p.name }))]} onChange={(e) => setActorId(e.target.value)} />
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>

      {data.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading activity…</span>
        </div>
      )}
      {data.state === 'error' && (
        <Alert tone="error" title="Couldn't load the activity">
          <p>{asAuthError(data.error).message}</p>
          <button type="button" className="btn-text" onClick={() => setTick((t) => t + 1)}>
            Try again
          </button>
        </Alert>
      )}
      {data.state === 'ready' &&
        (data.entries.filter((x) => !cutoff || x.at >= cutoff).length === 0 && !(data.next && !covered) ? (
          <p className="empty-note">
            {filtered ? 'Nothing matches. ' : 'Nothing has happened yet.'}
            {filtered && (
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setArea('all')
                  setActorId('')
                  setPeriod('all')
                }}
              >
                Show everything
              </button>
            )}
          </p>
        ) : (
          <div className={refreshing ? 'op-report is-loading' : 'op-report'} aria-busy={refreshing || undefined}>
            {days.map((d) => (
              <section key={d.day} className="act-day" aria-label={d.day}>
                <h2 className="act-day__title">{d.day}</h2>
                <ol className="act-list">
                  {d.entries.map((e) => (
                    <li key={e.id} className={`act-entry${e.actorKind === 'bitntech' ? ' act-entry--staff' : ''}`} data-entry={e.id} tabIndex={-1}>
                      <time className="act-entry__time" dateTime={e.at}>
                        {timeOf(e.at)}
                      </time>
                      <div className="act-entry__main">
                        <p className="act-entry__text">
                          <span className="act-entry__who">
                            {e.actor}
                            {e.actorKind === 'bitntech' && <span className="op-badge act-entry__badge">bitNtech</span>}
                          </span>{' '}
                          {e.text}
                        </p>
                        {e.detail && <p className="row__meta">{e.detail}</p>}
                      </div>
                      <span className="act-entry__area">{AREA_LABEL[e.area]}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
            <p className="op-log__more">
              {data.next && !covered ? (
                <button type="button" className="btn-text" aria-disabled={data.more === 'loading' || undefined} onClick={() => void more()}>
                  {data.more === 'loading' ? 'Loading…' : 'Show older'}
                </button>
              ) : (
                covered ? `That’s everything in the ${PERIOD_LABEL[period].toLowerCase()}.` : 'That’s everything.'
              )}
              {data.more === 'error' && (
                <span className="field__error" role="alert">
                  {' '}
                  Couldn’t load more. Try again.
                </span>
              )}
            </p>
          </div>
        ))}
    </ConsolePage>
  )
}
