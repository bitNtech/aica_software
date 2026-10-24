import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { can, canOpen, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Appointment, AppointmentPatch, Desk, OrgSettings } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { useShortcuts } from '../../../components/console/KeyboardHelp'
import { Skeleton } from '../../../components/console/Skeleton'
import { Drawer } from '../../../components/console/Drawer'
import { Toolbar, type FilterChip } from '../../../components/console/Toolbar'
import { useToast } from '../../../components/console/Toast'
import { UpdatedAgo } from '../../../components/console/UpdatedAgo'
import { useSettled } from '../../../components/console/ListTools'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Checkbox, SelectField, TextField } from '../../../components/ui/Field'
import { localDay } from '../../../lib/time'
import { useAsync } from '../../../lib/useAsync'
import { useNow } from '../../../lib/useNow'
import { StaleNote, useAnnouncer } from './LiveBits'
import { useLiveData } from './shared'
import { Detail, type ActionKind } from './appointments/Detail'
import { DayView } from './appointments/DayView'
import { ListView } from './appointments/ListView'
import { CheckPanel, Summary } from './appointments/Summary'
import { WeekView } from './appointments/WeekView'
import {
  addDays,
  APPT_STATUS_LABEL,
  applyFilters,
  byStart,
  countStatuses,
  dayMonth,
  daySheet,
  dayName,
  doctorLoads,
  findProblems,
  inferSlotLength,
  isActive,
  isFiltering,
  knownDoctors,
  loadWindow,
  longDay,
  NO_FILTERS,
  patientIdentity,
  patientLabel,
  readView,
  saveView,
  stepDays,
  time12,
  undoPatches,
  viewDates,
  type Ctx,
  type Filters,
  type ListScope,
  type Sees,
  type View,
} from './appointments/model'
import type { Shared } from './appointments/parts'
import './Operate.css'
import './appointments/Appointments.css'

/** How often the bookings are read again (it pauses while the tab is hidden). */
const POLL_MS = 20_000

const VIEW_LABEL: Record<View, string> = { day: 'Day by doctor', week: 'Week', list: 'List' }
const SCOPE_LABEL: Record<ListScope, string> = { day: 'This day', week: 'This week', all: 'A week back to a month ahead' }

interface Feed {
  from: string
  to: string
  rows: Appointment[]
  desk: Desk | null
}

/**
 * /o/:slug/appointments: bookings made on calls, to confirm or correct.
 * Three views of the same days (the day by doctor, the week, a sortable
 * list) with one set of filters, a side panel of what needs a check, and the
 * booking in a drawer. People with `appointments.manage` confirm, change and
 * cancel (each with Undo where the API allows it); people who may only look
 * see no buttons. Phone numbers are for people who manage appointments,
 * names for people who may see callers' details.
 *
 * The API is read a week back to a month ahead of today (the days looked at
 * move that window if they fall outside it, never beyond the API's 62 days).
 */
export default function AppointmentsPage() {
  const { org, access, user } = useOrg()
  const client = useConsole()
  const toast = useToast()
  const canEdit = pageAccess(access, 'appointments') === 'edit'
  const sees = useMemo<Sees>(() => ({ phone: canEdit, name: can(access, 'call.personal') }), [canEdit, access])
  const canExport = can(access, 'export')
  // The doctors' changes (Bot desk) and the organisation's hours are read when this role may, quietly skipped when not.
  const mayDesk = canOpen(access, 'desk')
  const maySettings = canOpen(access, 'settings')

  const now = useNow(30_000)
  const today = localDay(0, now)
  const [said, say] = useAnnouncer()

  // ---- what is being looked at
  const [view, setViewState] = useState<View>(() => readView(user.id) ?? 'day')
  const setView = (v: View) => {
    setViewState(v)
    saveView(user.id, v)
  }
  const [anchor, setAnchor] = useState(() => localDay(0))
  const [scope, setScope] = useState<ListScope>('week')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const dates = useMemo(() => viewDates(view, anchor, scope, today), [view, anchor, scope, today])
  const win = useMemo(() => loadWindow(today, dates), [today, dates])

  // ---- the bookings, kept fresh
  const lastDesk = useRef<Desk | null>(null)
  useEffect(() => {
    lastDesk.current = null
  }, [org.orgSlug])
  const load = useCallback(async (): Promise<Feed> => {
    const [rows, desk] = await Promise.all([
      client.listAppointments(org.orgSlug, win.from, win.to),
      mayDesk
        ? client.getDesk(org.orgSlug).then(
            (d) => (lastDesk.current = d),
            // Keep what was known: a failed read of the desk shouldn't make a doctor's day look normal.
            () => lastDesk.current,
          )
        : Promise.resolve(null),
    ])
    return { from: win.from, to: win.to, rows: [...rows].sort(byStart), desk }
  }, [client, org.orgSlug, win.from, win.to, mayDesk])
  const feed = useLiveData(load, POLL_MS)
  const loadSettings = useCallback((): Promise<OrgSettings | null> => (maySettings ? client.getOrgSettings(org.orgSlug).catch(() => null) : Promise.resolve(null)), [client, org.orgSlug, maySettings])
  const [settingsResult] = useAsync(loadSettings)
  const settings = settingsResult.state === 'ready' ? settingsResult.data : null

  const ready = !!feed.data && feed.data.from === win.from && feed.data.to === win.to
  const rows = useMemo(() => feed.data?.rows ?? [], [feed.data])
  const desk = feed.data?.desk ?? null
  const changes = useMemo(() => desk?.doctorChanges ?? [], [desk])
  const library = desk?.doctors ?? null

  const slot = useMemo(() => inferSlotLength(rows), [rows])
  const ctx = useMemo<Ctx>(() => ({ settings, changes, library, now, slot, who: (a) => patientLabel(a, sees), identity: (a) => patientIdentity(a, sees) }), [settings, changes, library, now, slot, sees])
  const problems = useMemo(() => findProblems(rows, ctx), [rows, ctx])
  const known = useMemo(() => knownDoctors(rows, library, changes), [rows, library, changes])

  // ---- what passes the filters, in the days shown
  const span = useMemo(() => new Set(dates), [dates])
  const spanAll = useMemo(() => rows.filter((a) => span.has(a.date)), [rows, span])
  const matching = useMemo(() => applyFilters(rows, filters, problems, sees), [rows, filters, problems, sees])
  const spanShown = useMemo(() => matching.filter((a) => span.has(a.date)), [matching, span])
  const filtering = isFiltering(filters)
  const dayAll = useMemo(() => rows.filter((a) => a.date === anchor), [rows, anchor])
  const dayShown = useMemo(() => matching.filter((a) => a.date === anchor), [matching, anchor])
  const needCheck = useMemo(() => rows.filter((a) => isActive(a) && (a.status === 'needs_check' || problems.has(a.id))), [rows, problems])

  // ---- the one open
  const [openId, setOpenId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Appointment | null>(null)
  const found = rows.find((a) => a.id === openId) ?? null
  useEffect(() => {
    if (found) setSnapshot(found)
  }, [found])
  const opened = found ?? (snapshot && snapshot.id === openId ? snapshot : null)
  const open = (a: Appointment) => {
    setSnapshot(a)
    setOpenId(a.id)
  }

  const shared: Shared = { today, now, known, ctx, settings, changes, problems, sees, slot, selectedId: openId, onOpen: open }

  // ---- changes made here show at once; a fresh read follows
  const replace = (updated: Appointment) =>
    feed.setData((d) => (d ? { ...d, rows: [...(d.rows.some((x) => x.id === updated.id) ? d.rows.map((x) => (x.id === updated.id ? updated : x)) : [...d.rows, updated])].sort(byStart) } : d))

  async function undo(before: Appointment, after: Appointment, patches: AppointmentPatch[]) {
    try {
      let last = after
      for (const p of patches) last = await client.updateAppointment(org.orgSlug, after.id, p)
      replace(last)
      toast.show({ message: before.status === 'needs_check' ? 'Undone. It is booked, but no longer flagged for a check.' : 'Undone.', tone: 'ok' })
    } catch (err) {
      toast.show({ message: `Couldn't undo: ${asAuthError(err).message}`, tone: 'danger' })
    } finally {
      feed.reload()
    }
  }

  async function act(before: Appointment, kind: ActionKind, patch: AppointmentPatch) {
    const after = await client.updateAppointment(org.orgSlug, before.id, patch)
    replace(after)
    const name = patientLabel(after, sees) === 'A patient' ? 'That' : `${patientLabel(after, sees)}'s`
    const message =
      kind === 'confirm'
        ? `${name} appointment is confirmed.`
        : kind === 'cancel'
          ? `${name} appointment is cancelled.`
          : kind === 'rebook'
            ? `${name} appointment is booked again.`
            : `${name} appointment is now ${dayName(after.date, today).toLowerCase()} at ${time12(after.time)}.`
    const back = undoPatches(before, after)
    toast.show({ message, tone: 'ok', action: back ? { label: 'Undo', onClick: () => void undo(before, after, back) } : undefined })
    feed.reload()
  }

  // ---- moving about
  const step = stepDays(view, scope)
  const go = (n: number) => setAnchor((d) => addDays(d, n))
  const search = useRef<HTMLInputElement>(null)
  useShortcuts({
    '/': { description: 'Search the appointments', run: () => search.current?.focus() },
    t: { description: 'Go to today', run: () => setAnchor(localDay(0)) },
    '[': { description: 'Previous day or week', run: () => go(-step) },
    ']': { description: 'Next day or week', run: () => go(step) },
    d: { description: 'Show the day by doctor', run: () => setView('day') },
    w: { description: 'Show the week', run: () => setView('week') },
    l: { description: 'Show the list', run: () => setView('list') },
  })

  // ---- the day sheet
  function exportCsv() {
    const list = view === 'day' ? dayShown : spanShown
    const blob = new Blob([daySheet(list, sees)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = view === 'day' ? `aica-appointments-${anchor}.csv` : `aica-appointments-${dates[0]}-to-${dates[dates.length - 1]}.csv`
    document.body.append(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    say(view === 'day' ? 'Day sheet downloaded.' : 'List downloaded.')
  }

  // ---- filter controls
  const departments = useMemo(() => [...new Set(known.map((d) => d.department).filter(Boolean))].sort(), [known])
  const doctorOptions = [{ value: '', label: 'All doctors' }, ...known.map((d) => ({ value: d.doctor, label: d.doctor }))]
  const chips: FilterChip[] = [
    ...(filters.text.trim() ? [{ id: 'text', label: `Search: ${filters.text.trim()}`, onRemove: () => setFilters((f) => ({ ...f, text: '' })) }] : []),
    ...(filters.doctor ? [{ id: 'doctor', label: `Doctor: ${filters.doctor}`, onRemove: () => setFilters((f) => ({ ...f, doctor: '' })) }] : []),
    ...(filters.department ? [{ id: 'department', label: `Department: ${filters.department}`, onRemove: () => setFilters((f) => ({ ...f, department: '' })) }] : []),
    ...(filters.status ? [{ id: 'status', label: `Status: ${APPT_STATUS_LABEL[filters.status]}`, onRemove: () => setFilters((f) => ({ ...f, status: '' as const })) }] : []),
    ...(filters.by ? [{ id: 'by', label: filters.by === 'agent' ? 'Booked by the agents' : 'Booked by staff', onRemove: () => setFilters((f) => ({ ...f, by: '' as const })) }] : []),
    ...(filters.problemsOnly ? [{ id: 'problems', label: 'Only with a problem', onRemove: () => setFilters((f) => ({ ...f, problemsOnly: false })) }] : []),
  ]
  const filterSaid = useSettled(`${spanShown.length} of ${spanAll.length} appointments shown`, filtering && ready)

  const title = view === 'day' || (view === 'list' && scope === 'day') ? `${longDay(anchor)}${anchor === today ? ' (today)' : ''}` : `${dayMonth(dates[0])} to ${dayMonth(dates[dates.length - 1])}`
  const summaryLabel = view === 'day' || (view === 'list' && scope === 'day') ? `How full ${anchor === today ? 'today' : longDay(anchor)} is` : view === 'week' || scope === 'week' ? `How full the week of ${dayMonth(dates[0])} is` : 'How full the days loaded are'
  const stepWord = step === 7 ? 'week' : 'day'
  const loading = !ready && !feed.error
  const failed = !ready && !!feed.error

  const emptyList = filtering ? (
    <>
      No appointments match these filters.{' '}
      <button type="button" className="btn-text" onClick={() => setFilters(NO_FILTERS)}>
        Clear the filters
      </button>
    </>
  ) : (
    'No appointments in these days.'
  )

  return (
    <ConsolePage
      section="appointments"
      kicker="Operate"
      title="Appointments"
      docTitle="Appointments"
      status={<UpdatedAgo at={feed.checkedAt} />}
      actions={
        canExport && ready ? (
          <Button variant="line" size="sm" onClick={exportCsv}>
            {view === 'day' ? 'Day sheet (CSV)' : 'Download list (CSV)'}
          </Button>
        ) : null
      }
      lede={<p>Bookings made on calls. Check the ones flagged, and confirm or correct them. {canEdit ? '' : 'You can look; the front desk and above make changes.'}</p>}
    >
      <p className="sr-only" role="status">
        {said}
      </p>
      {filtering && (
        <p className="sr-only" role="status">
          {filterSaid}
        </p>
      )}
      {ready && feed.error ? <StaleNote error={feed.error} checkedAt={feed.checkedAt} onRetry={feed.reload} /> : null}
      {failed && (
        <Alert tone="error" title="Couldn't load appointments">
          <p>{asAuthError(feed.error).message}</p>
          <button type="button" className="btn-text" onClick={feed.reload}>
            Try again
          </button>
        </Alert>
      )}

      {!failed && (
        <>
          <div className="ap-nav" role="group" aria-label="Choose the day">
            <div className="ap-nav__steps">
              <Button variant="line" size="sm" aria-label={`Previous ${stepWord}`} disabled={view === 'list' && scope === 'all'} onClick={() => go(-step)}>
                ‹ Previous
              </Button>
              <Button variant="line" size="sm" aria-pressed={anchor === today} onClick={() => setAnchor(today)}>
                Today
              </Button>
              <Button variant="line" size="sm" aria-pressed={anchor === addDays(today, 1)} onClick={() => setAnchor(addDays(today, 1))}>
                Tomorrow
              </Button>
              <Button variant="line" size="sm" aria-label={`Next ${stepWord}`} disabled={view === 'list' && scope === 'all'} onClick={() => go(step)}>
                Next ›
              </Button>
            </div>
            <TextField label="Jump to a date" type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} />
            <h2 className="ap-nav__title">{title}</h2>
          </div>

          <Toolbar
            label="Filter the appointments"
            sticky={false}
            search={<TextField ref={search} label="Search appointments" type="search" value={filters.text} placeholder={sees.name ? 'Patient, phone or doctor' : sees.phone ? 'Phone or doctor' : 'Doctor or department'} onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))} />}
            filters={
              <>
                {known.length > 1 && <SelectField label="Doctor" value={filters.doctor} options={doctorOptions} onChange={(e) => setFilters((f) => ({ ...f, doctor: e.target.value }))} />}
                {departments.length > 1 && (
                  <SelectField label="Department" value={filters.department} options={[{ value: '', label: 'All departments' }, ...departments.map((d) => ({ value: d, label: d }))]} onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))} />
                )}
                <SelectField
                  label="Status"
                  value={filters.status}
                  options={[{ value: '', label: 'Any status' }, ...(Object.keys(APPT_STATUS_LABEL) as (keyof typeof APPT_STATUS_LABEL)[]).map((s) => ({ value: s, label: APPT_STATUS_LABEL[s] }))]}
                  onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as Filters['status'] }))}
                />
                <SelectField
                  label="Booked by"
                  value={filters.by}
                  options={[
                    { value: '', label: 'Anyone' },
                    { value: 'agent', label: 'The agents' },
                    { value: 'staff', label: 'Staff' },
                  ]}
                  onChange={(e) => setFilters((f) => ({ ...f, by: e.target.value as Filters['by'] }))}
                />
                {view === 'list' && <SelectField label="Show" value={scope} options={(Object.keys(SCOPE_LABEL) as ListScope[]).map((s) => ({ value: s, label: SCOPE_LABEL[s] }))} onChange={(e) => setScope(e.target.value as ListScope)} />}
                <Checkbox label="Only with a problem" checked={filters.problemsOnly} onChange={(e) => setFilters((f) => ({ ...f, problemsOnly: e.target.checked }))} />
              </>
            }
            summary={ready ? `${spanShown.length} of ${spanAll.length} shown` : undefined}
            views={
              <div className="ap-views" role="group" aria-label="View">
                {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
                  <button key={v} type="button" className="ap-views__btn" aria-pressed={view === v} onClick={() => setView(v)}>
                    {VIEW_LABEL[v]}
                  </button>
                ))}
              </div>
            }
            chips={chips}
            onClearAll={() => setFilters(NO_FILTERS)}
          />

          {ready && <Summary label={summaryLabel} slot={slot} counts={countStatuses(spanAll)} loads={doctorLoads(dates, spanAll, known, settings, changes, slot)} />}

          <div className="ap-main">
            <section className="ap-main__view" aria-label={`Appointments, ${VIEW_LABEL[view].toLowerCase()}`} aria-busy={loading || undefined}>
              {loading ? (
                <>
                  <p className="sr-only" role="status">
                    Loading appointments…
                  </p>
                  <Skeleton block height="18rem" />
                </>
              ) : view === 'day' ? (
                <DayView shared={shared} date={anchor} appts={dayShown} all={dayAll} filters={filters} filtering={filtering} onClearFilters={() => setFilters(NO_FILTERS)} />
              ) : view === 'week' ? (
                <WeekView shared={shared} anchor={anchor} appts={spanShown} all={spanAll} />
              ) : (
                <ListView shared={shared} appts={spanShown} empty={emptyList} loading={false} />
              )}
            </section>
            {ready && <CheckPanel items={needCheck} shared={shared} />}
          </div>
        </>
      )}

      <Drawer open={!!opened} onClose={() => setOpenId(null)} label="Appointment">
        {opened && <Detail key={opened.id} appt={opened} shared={shared} rows={rows} loaded={{ from: win.from, to: win.to }} canEdit={canEdit} onAct={act} onOpenOther={open} />}
      </Drawer>
    </ConsolePage>
  )
}
