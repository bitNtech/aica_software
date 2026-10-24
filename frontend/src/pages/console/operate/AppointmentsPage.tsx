import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { can, canOpen, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Appointment, AppointmentPatch, BookingSettings, BookingSource, Desk, NewAppointment, OrgSettings } from '../../../console/types'
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
import { ChangesView } from './appointments/ChangesView'
import { CreateDialog } from './appointments/CreateDialog'
import { MonthView } from './appointments/MonthView'
import { TodayView } from './appointments/TodayView'
import { CheckPanel, Summary } from './appointments/Summary'
import { WeekView } from './appointments/WeekView'
import { RequestsView } from './appointments/RequestsView'
import { BookingSettingsDialog } from './appointments/BookingSettings'
import { useNewRequests } from './appointments/useNewRequests'
import {
  addDays,
  addMonths,
  APPT_STATUS_LABEL,
  CALENDAR_VIEWS,
  isRangeView,
  monthName,
  needsCheck,
  SOURCE_LABEL,
  applyFilters,
  byStart,
  countStatuses,
  howTold,
  sourceOf,
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
import type { RivalChoice, Shared } from './appointments/parts'
import './Operate.css'
import './appointments/Appointments.css'

/** How often the bookings are read again (it pauses while the tab is hidden). */
const POLL_MS = 20_000

const VIEW_LABEL: Record<View, string> = {
  day: 'Day by doctor',
  week: 'Week',
  month: 'Month',
  today: 'Today’s appointments',
  list: 'All',
  pending: 'Requests to review',
  changes: 'Cancelled and rescheduled',
}
const LIST_VIEWS: View[] = ['today', 'list', 'pending', 'changes']
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
  const needCheck = useMemo(() => rows.filter((a) => isActive(a) && (needsCheck(a) || problems.has(a.id))), [rows, problems])
  const todayShown = useMemo(() => matching.filter((a) => a.date === today), [matching, today])
  const pendingShown = useMemo(() => spanShown.filter((a) => a.status === 'pending'), [spanShown])

  // ---- how requests are confirmed and patients told
  const [booking, setBooking] = useState<BookingSettings | null>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    let live = true
    setBooking(null)
    setBookingError(null)
    if (!client.getBookingSettings) return setBookingError('Booking settings need the AICA server to be updated first.')
    client.getBookingSettings(org.orgSlug).then(
      (b) => live && setBooking(b),
      (err) => live && setBookingError(asAuthError(err).message),
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug])
  async function saveBooking(next: BookingSettings) {
    if (!client.updateBookingSettings) throw new Error('Booking settings need the AICA server to be updated first.')
    setBooking(await client.updateBookingSettings(org.orgSlug, next))
    setSettingsOpen(false)
    toast.show({ message: next.confirm === 'auto' ? `Saved. Requests are confirmed automatically at ${time12(next.autoAt)}.` : 'Saved. Requests wait for staff to confirm them.', tone: 'ok' })
  }

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

  const shared: Shared = { today, now, known, ctx, settings, changes, problems, sees, slot, selectedId: openId, onOpen: open, rows, booking, canEdit, onAct: act, onResolve: resolve, onReplace: replace }

  // ---- the staff hear of each new request while the page is open
  useNewRequests(ready ? rows : null, (fresh) => {
    const a = fresh[0]
    const more = fresh.length > 1 ? ` and ${fresh.length - 1} more` : ''
    const text = `New request from the agent: ${patientLabel(a, sees)}, ${a.doctor}, ${dayName(a.date, today).toLowerCase()} at ${time12(a.time)}${more}.`
    say(text)
    toast.show({ message: text, tone: 'info', action: { label: 'Open', onClick: () => open(a) } })
  })

  // ---- changes made here show at once; a fresh read follows
  function replace(updated: Appointment) {
    feed.setData((d) => (d ? { ...d, rows: [...(d.rows.some((x) => x.id === updated.id) ? d.rows.map((x) => (x.id === updated.id ? updated : x)) : [...d.rows, updated])].sort(byStart) } : d))
  }

  async function undo(before: Appointment, after: Appointment, patches: AppointmentPatch[]) {
    try {
      let last = after
      for (const p of patches) last = await client.updateAppointment(org.orgSlug, after.id, p)
      replace(last)
      toast.show({ message: needsCheck(before) ? 'Undone. It is back as it was, but no longer flagged for a check.' : 'Undone.', tone: 'ok' })
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
    const told = sourceOf(after) === 'ai_call' && howTold(booking) && (kind === 'confirm' || kind === 'decline' || kind === 'change') ? ' The patient is being told.' : ''
    const message =
      (kind === 'decline'
        ? `${name} request is declined.`
        : kind === 'confirm'
        ? `${name} appointment is confirmed.`
        : kind === 'cancel'
          ? `${name} appointment is cancelled.`
          : kind === 'rebook'
            ? `${name} appointment is booked again, waiting for confirmation.`
            : kind === 'complete'
              ? `${name} appointment is marked completed.`
              : kind === 'no_show'
                ? `${name} appointment is marked as a no-show.`
                : `${name} appointment is now ${dayName(after.date, today).toLowerCase()} at ${time12(after.time)}${after.status === 'confirmed' ? ', confirmed' : ', waiting for confirmation'}.`) + told
    const back = undoPatches(before, after)
    toast.show({ message, tone: 'ok', action: back ? { label: 'Undo', onClick: () => void undo(before, after, back) } : undefined })
    feed.reload()
  }

  /** Confirms the chosen request, then offers the others another time or declines them. Undo puts all of them back. */
  async function resolve(winner: Appointment, others: RivalChoice[]) {
    const done: [Appointment, Appointment][] = []
    try {
      done.push([winner, await client.updateAppointment(org.orgSlug, winner.id, { status: 'confirmed' })])
      for (const c of others) {
        const patch: AppointmentPatch = c.action === 'offer' ? { date: c.date, time: c.time, changeReason: 'The requested time went to a patient who needed it more.' } : { status: 'declined', changeReason: c.reason }
        done.push([c.appt, await client.updateAppointment(org.orgSlug, c.appt.id, patch)])
      }
    } finally {
      for (const [, after] of done) replace(after)
      feed.reload()
    }
    const offered = others.filter((c) => c.action === 'offer').length
    const declined = others.length - offered
    const name = patientLabel(winner, sees) === 'A patient' ? 'The' : `${patientLabel(winner, sees)}'s`
    const rest = [offered ? `${offered} offered another time` : '', declined ? `${declined} declined` : ''].filter(Boolean).join(', ')
    const backs = done.map(([before, after]) => [before, after, undoPatches(before, after)] as const)
    toast.show({
      message: `${name} request is confirmed${rest ? `; ${rest}` : ''}.${howTold(booking) ? ' The patients are being told.' : ''}`,
      tone: 'ok',
      action: {
        label: 'Undo',
        onClick: () =>
          void (async () => {
            for (const [before, after, back] of backs) if (back) await undo(before, after, back)
          })(),
      },
    })
  }

  async function runAuto() {
    if (!client.runAutoConfirm) throw new Error('Automatic confirmation needs the AICA server to be updated first.')
    const r = await client.runAutoConfirm(org.orgSlug)
    feed.reload()
    const parts = [`${r.confirmed} confirmed`, r.offered ? `${r.offered} offered another time` : '', r.declined ? `${r.declined} declined` : '', r.left ? `${r.left} left for a person` : ''].filter(Boolean)
    toast.show({ message: `Automatic confirmation done: ${parts.join(', ')}.`, tone: 'ok' })
  }

  // ---- adding one by hand
  const [creating, setCreating] = useState(false)
  async function create(input: NewAppointment) {
    const made = await client.createAppointment(org.orgSlug, input)
    replace(made)
    setCreating(false)
    toast.show({ message: `${patientLabel(made, sees) === 'A patient' ? 'The' : `${patientLabel(made, sees)}'s`} appointment is added for ${dayName(made.date, today).toLowerCase()} at ${time12(made.time)}.`, tone: 'ok' })
    open(made)
    feed.reload()
  }

  // ---- moving about
  const step = stepDays(view, scope)
  const go = (n: number) => setAnchor((d) => (view === 'month' ? addMonths(d, n) : addDays(d, n * step)))
  const search = useRef<HTMLInputElement>(null)
  useShortcuts({
    '/': { description: 'Search the appointments', run: () => search.current?.focus() },
    t: { description: 'Go to today', run: () => setAnchor(localDay(0)) },
    '[': { description: 'Previous day, week or month', run: () => go(-1) },
    ']': { description: 'Next day, week or month', run: () => go(1) },
    d: { description: 'Show the day by doctor', run: () => setView('day') },
    w: { description: 'Show the week', run: () => setView('week') },
    m: { description: 'Show the month', run: () => setView('month') },
    l: { description: 'Show the list', run: () => setView('list') },
  })

  // ---- the day sheet
  function exportCsv() {
    const list = view === 'day' ? dayShown : view === 'today' ? todayShown : view === 'pending' ? pendingShown : spanShown
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
    ...(filters.by ? [{ id: 'by', label: `Booked through: ${SOURCE_LABEL[filters.by]}`, onRemove: () => setFilters((f) => ({ ...f, by: '' as const })) }] : []),
    ...(filters.problemsOnly ? [{ id: 'problems', label: 'Only with a problem', onRemove: () => setFilters((f) => ({ ...f, problemsOnly: false })) }] : []),
  ]
  const filterSaid = useSettled(`${spanShown.length} of ${spanAll.length} appointments shown`, filtering && ready)

  const title =
    view === 'month'
      ? monthName(anchor)
      : view === 'day' || (view === 'list' && scope === 'day')
        ? `${longDay(anchor)}${anchor === today ? ' (today)' : ''}`
        : `${dayMonth(dates[0])} to ${dayMonth(dates[dates.length - 1])}`
  const ranged = isRangeView(view, scope)
  const summaryLabel = view === 'month' ? `How full ${monthName(anchor)} is` : view === 'today' ? 'How full today is' : view === 'pending' || view === 'changes' ? 'How full the days loaded are' : view === 'day' || (view === 'list' && scope === 'day') ? `How full ${anchor === today ? 'today' : longDay(anchor)} is` : view === 'week' || scope === 'week' ? `How full the week of ${dayMonth(dates[0])} is` : 'How full the days loaded are'
  const stepWord = view === 'month' ? 'month' : step === 7 ? 'week' : 'day'
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
        <>
          {canEdit && (
            <Button size="sm" onClick={() => setCreating(true)}>
              Add appointment
            </Button>
          )}
          <Button variant="line" size="sm" onClick={() => setSettingsOpen(true)}>
            Booking settings
          </Button>
          {canExport && ready && (
            <Button variant="line" size="sm" onClick={exportCsv}>
              {view === 'day' ? 'Day sheet (CSV)' : 'Download list (CSV)'}
            </Button>
          )}
        </>
      }
      lede={
        <p>
          The agent books on calls and its requests arrive here by themselves, ranked when several patients ask for the same time. Confirm or decline them{booking?.confirm === 'auto' ? ` (or leave them for the automatic confirmation at ${time12(booking.autoAt)})` : ''}, and the patient is told. Record each visit afterwards. {canEdit ? '' : 'You can look; the front desk and above make changes.'}
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
          {ranged ? (
            <h2 className="ap-nav__title ap-nav__title--solo">{view === 'today' ? `Today, ${longDay(today)}` : `${VIEW_LABEL[view]}: ${dayMonth(dates[0])} to ${dayMonth(dates[dates.length - 1])}`}</h2>
          ) : (
          <div className="ap-nav" role="group" aria-label={view === 'month' ? 'Choose the month' : 'Choose the day'}>
            <div className="ap-nav__steps">
              <Button variant="line" size="sm" aria-label={`Previous ${stepWord}`} onClick={() => go(-1)}>
                ‹ Previous
              </Button>
              <Button variant="line" size="sm" aria-pressed={anchor === today} onClick={() => setAnchor(today)}>
                Today
              </Button>
              <Button variant="line" size="sm" aria-pressed={anchor === addDays(today, 1)} onClick={() => setAnchor(addDays(today, 1))}>
                Tomorrow
              </Button>
              <Button variant="line" size="sm" aria-label={`Next ${stepWord}`} onClick={() => go(1)}>
                Next ›
              </Button>
            </div>
            <TextField label="Jump to a date" type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} />
            <h2 className="ap-nav__title">{title}</h2>
          </div>
          )}

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
                  label="Booked through"
                  value={filters.by}
                  options={[{ value: '', label: 'Any way' }, ...(Object.keys(SOURCE_LABEL) as BookingSource[]).map((s) => ({ value: s, label: SOURCE_LABEL[s] }))]}
                  onChange={(e) => setFilters((f) => ({ ...f, by: e.target.value as Filters['by'] }))}
                />
                {view === 'list' && <SelectField label="Show" value={scope} options={(Object.keys(SCOPE_LABEL) as ListScope[]).map((s) => ({ value: s, label: SCOPE_LABEL[s] }))} onChange={(e) => setScope(e.target.value as ListScope)} />}
                <Checkbox label="Only with a problem" checked={filters.problemsOnly} onChange={(e) => setFilters((f) => ({ ...f, problemsOnly: e.target.checked }))} />
              </>
            }
            summary={ready ? (view === 'today' ? `${todayShown.length} today` : view === 'pending' ? `${pendingShown.length} waiting for a decision` : `${spanShown.length} of ${spanAll.length} shown`) : undefined}
            views={
              <div className="ap-viewsets">
                <div className="ap-views" role="group" aria-label="Calendar">
                  {CALENDAR_VIEWS.map((v) => (
                    <button key={v} type="button" className="ap-views__btn" aria-pressed={view === v} onClick={() => setView(v)}>
                      {VIEW_LABEL[v]}
                    </button>
                  ))}
                </div>
                <div className="ap-views" role="group" aria-label="Lists">
                  {LIST_VIEWS.map((v) => (
                    <button key={v} type="button" className="ap-views__btn" aria-pressed={view === v} onClick={() => setView(v)}>
                      {VIEW_LABEL[v]}
                    </button>
                  ))}
                </div>
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
              ) : view === 'month' ? (
                <MonthView
                  shared={shared}
                  anchor={anchor}
                  appts={spanShown}
                  onPickDay={(d) => {
                    setAnchor(d)
                    setView('day')
                  }}
                />
              ) : view === 'today' ? (
                <TodayView shared={shared} appts={todayShown} />
              ) : view === 'pending' ? (
                <RequestsView shared={shared} appts={pendingShown} empty={filtering ? emptyList : 'No requests waiting. New ones from the agent appear here by themselves.'} onSettings={() => setSettingsOpen(true)} onRunAuto={canEdit ? runAuto : undefined} />
              ) : view === 'changes' ? (
                <ChangesView shared={shared} appts={spanShown} empty={filtering ? emptyList : 'Nothing cancelled or rescheduled in these days.'} />
              ) : (
                <ListView shared={shared} appts={spanShown} empty={emptyList} loading={false} />
              )}
            </section>
            {ready && <CheckPanel items={needCheck} shared={shared} />}
          </div>
        </>
      )}

      <CreateDialog open={creating} rows={rows} ctx={ctx} today={today} known={known} startDate={view === 'day' ? anchor : today} onClose={() => setCreating(false)} onCreate={create} />

      <BookingSettingsDialog open={settingsOpen} settings={booking} error={bookingError} canChange={maySettings} orgName={org.orgName} onClose={() => setSettingsOpen(false)} onSave={saveBooking} />

      <Drawer open={!!opened} onClose={() => setOpenId(null)} label="Appointment">
        {opened && <Detail key={opened.id} appt={opened} shared={shared} rows={rows} loaded={{ from: win.from, to: win.to }} canEdit={canEdit} onAct={act} onOpenOther={open} />}
      </Drawer>
    </ConsolePage>
  )
}
