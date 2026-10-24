import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../../auth/types'
import { Skeleton } from '../../../../components/console/Skeleton'
import { Button } from '../../../../components/ui/Button'
import { ConfirmDialog } from '../../../../components/ui/Dialog'
import { canOpen } from '../../../../console/access'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Appointment, AppointmentPatch, CallRecord } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { timeAgo } from '../../../../lib/time'
import { duration, OUTCOME_LABEL } from '../shared'
import { ChangeDialog } from './ChangeDialog'
import { addDays, byStart, dayName, doctorNote, isOpen, longDay, mergeById, needsCheck, patientIdentity, shortDay, SOURCE_LABEL, sourceOf, time12, TYPE_LABEL } from './model'
import { nowKey } from '../../../../console/appointmentRecords'
import { TextAreaField } from '../../../../components/ui/Field'
import { History } from './History'
import { ApptStatus, NotePill, PriorityPill, ProblemList, type ActionKind, type Shared } from './parts'
import { PatientUpdates } from './PatientUpdates'
import { useRequestActions } from './RequestActions'
import { rivalsOf } from './model'

export type { ActionKind }

interface Props {
  appt: Appointment
  shared: Shared
  /** Every booking the page has loaded, and the days they cover (for clashes and "other appointments"). */
  rows: Appointment[]
  loaded: { from: string; to: string }
  /** The person may confirm, change and cancel (Manage appointments). Without it there are no buttons at all. */
  canEdit: boolean
  /** Makes the change (and the Undo toast); throws with the API's words if refused. */
  onAct(a: Appointment, kind: ActionKind, patch: AppointmentPatch): Promise<void>
  onOpenOther(a: Appointment): void
}

/**
 * One booking in full, in the drawer: who and when, the doctor (and any
 * change the Bot desk has for them that day), how it was booked, the call it
 * was booked on, the patient's other appointments, and what to do about it.
 * People who may only look see no buttons. Cancel asks first, and reminds
 * the person to tell the patient; every change offers Undo where the
 * reverse is allowed.
 */
export function Detail({ appt: a, shared, rows, loaded, canEdit, onAct, onOpenOther }: Props) {
  const { access, base } = useOrg()
  const uid = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState<ActionKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const reasonField = useRef<HTMLTextAreaElement>(null)
  const { sees, today, problems, changes, now } = shared

  const who = sees.name ? a.patientName : 'A patient'
  const mine = problems.get(a.id) ?? []
  const note = doctorNote(a.doctor, a.date, changes)
  const cancelled = a.status === 'cancelled'
  const open = isOpen(a)
  /** Its time has come: it can be marked completed or a no-show. */
  const passed = `${a.date} ${a.time}` <= nowKey(now)
  const source = sourceOf(a)
  const telHref = sees.phone ? `tel:${a.phone.replace(/[^\d+]/g, '')}` : null
  const req = useRequestActions(shared)
  const rivals = a.status === 'pending' ? rivalsOf(a, rows) : []

  /** Confirm: a lone request at once, one with rivals through the dialog that settles them. */
  async function confirm() {
    if (a.status !== 'pending') return void run('confirm', { status: 'confirmed' })
    setBusy('confirm')
    setError(null)
    try {
      await req.confirm(a)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  /** A button's action, with its own busy state and error, and focus kept in the detail afterwards. */
  async function run(kind: ActionKind, patch: AppointmentPatch): Promise<boolean> {
    setBusy(kind)
    setError(null)
    try {
      await onAct(a, kind, patch)
      requestAnimationFrame(() => heading.current?.focus())
      return true
    } catch (err) {
      setError(asAuthError(err).message)
      return false
    } finally {
      setBusy(null)
    }
  }

  // While a dialog is open, Escape closes the dialog (not the drawer around it) and Tab stays inside it (the drawer's own trap would send focus to the page behind).
  const keepKeys = (e: KeyboardEvent) => {
    if ((changing || cancelling || req.open) && (e.key === 'Escape' || e.key === 'Tab')) e.stopPropagation()
  }
  // Arriving on another appointment from this one's list: focus its name, since the button pressed has gone.
  useEffect(() => {
    heading.current?.focus()
  }, [])

  const section = (title: string, id: string, body: ReactNode) => (
    <section className="ap-sec" aria-labelledby={`${uid}-${id}`}>
      <h3 className="ap-sec__title" id={`${uid}-${id}`}>
        {title}
      </h3>
      {body}
    </section>
  )

  return (
    <article className="ap-detail" aria-labelledby={`${uid}-name`}>
      <header className="ap-detail__head">
        <div className="ap-detail__row">
          <h2 className="ap-detail__name" id={`${uid}-name`} ref={heading} tabIndex={-1}>
            {who}
          </h2>
          <ApptStatus appt={a} />
        </div>
        <p className="ap-detail__when num">
          {longDay(a.date)}, {time12(a.time)}
        </p>
        <p className="ap-detail__id">
          Appointment <span className="num">{a.id}</span>
        </p>
      </header>

      {needsCheck(a) && (
        <p className="ap-callout ap-callout--warn">
          <strong>Needs a check.</strong> {a.checkReason}
        </p>
      )}
      {a.status === 'declined' && a.declineReason && (
        <p className="ap-callout">
          <strong>Declined.</strong> {a.declineReason}
        </p>
      )}
      {rivals.length > 0 && (
        <p className="ap-callout ap-callout--info">
          <strong>
            {rivals.length + 1} requests for this time.
          </strong>{' '}
          {a.rank?.position === 1 ? 'This one is ranked first.' : `This one is ranked ${a.rank?.position ?? '?'} of ${rivals.length + 1}.`} Confirming it settles the others.
        </p>
      )}
      {cancelled && a.cancelReason && (
        <p className="ap-callout">
          <strong>Cancelled.</strong> {a.cancelReason}
        </p>
      )}
      <ProblemList problems={mine} />

      {(canEdit || (a.callId && canOpen(access, 'calls'))) && (
        <div className="ap-actions" role="group" aria-label="What to do with this appointment">
          {canEdit && (a.status === 'pending' || a.status === 'rescheduled') && (
            <Button variant="plum" size="sm" busy={busy === 'confirm'} busyLabel="Confirming…" disabled={!!busy} onClick={() => void confirm()}>
              Confirm
            </Button>
          )}
          {canEdit && a.status === 'pending' && (
            <Button variant="line" size="sm" disabled={!!busy} onClick={() => req.decline(a)}>
              Decline
            </Button>
          )}
          {canEdit && open && passed && (
            <>
              <Button variant="line" size="sm" busy={busy === 'complete'} busyLabel="Marking…" disabled={!!busy} onClick={() => void run('complete', { status: 'completed' })}>
                Mark completed
              </Button>
              <Button variant="line" size="sm" busy={busy === 'no_show'} busyLabel="Marking…" disabled={!!busy} onClick={() => void run('no_show', { status: 'no_show' })}>
                Mark no-show
              </Button>
            </>
          )}
          {canEdit && (open || a.status === 'no_show') && (
            <Button variant="line" size="sm" disabled={!!busy} onClick={() => setChanging(true)}>
              Reschedule
            </Button>
          )}
          {canEdit && open && (
            <Button
              variant="line"
              size="sm"
              className="ap-actions__cancel"
              disabled={!!busy}
              onClick={() => {
                setError(null)
                setCancelReason('')
                setCancelling(true)
              }}
            >
              Cancel
            </Button>
          )}
          {canEdit && (cancelled || a.status === 'no_show') && (
            <Button variant="line" size="sm" busy={busy === 'rebook'} busyLabel="Booking again…" disabled={!!busy} onClick={() => void run('rebook', { status: 'pending' })}>
              Book it again
            </Button>
          )}
          {a.callId && canOpen(access, 'calls') && (
            <Link className="btn btn--line btn--sm" to={`${base}/calls/${a.callId}`}>
              <span>View call</span>
            </Link>
          )}
          {telHref && (
            <a className="btn btn--line btn--sm" href={telHref}>
              <span>Call {a.phone}</span>
            </a>
          )}
        </div>
      )}
      {error && !cancelling && !changing && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      <dl className="ap-facts">
        {sees.phone && (
          <div>
            <dt>Phone</dt>
            <dd className="num">{telHref ? <a className="link" href={telHref}>{a.phone}</a> : a.phone}</dd>
          </div>
        )}
        <div>
          <dt>Doctor</dt>
          <dd>
            {a.doctor}
            {note && <NotePill note={note} />}
          </dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>{a.department}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{a.type ? TYPE_LABEL[a.type] : <span className="ap-muted">Not given</span>}</dd>
        </div>
        <div className="ap-facts__wide">
          <dt>Reason for visit</dt>
          <dd>{a.visitReason ?? <span className="ap-muted">Not given</span>}</dd>
        </div>
        <div>
          <dt>Booked through</dt>
          <dd>
            {SOURCE_LABEL[source]}
            {source === 'ai_call' && a.agentName ? <span className="ap-facts__sub">{a.agentName}</span> : null}
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            {stamp(a.createdAt)} <span className="ap-facts__sub">{timeAgo(a.createdAt)}</span>
          </dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>
            {stamp(a.updatedAt ?? a.createdAt)}
            {a.updatedBy && <span className="ap-facts__sub"> by {a.updatedBy}</span>}
          </dd>
        </div>
        {a.note && (
          <div className="ap-facts__wide">
            <dt>Note</dt>
            <dd>{a.note}</dd>
          </div>
        )}
      </dl>

      {a.rank && section(a.status === 'pending' ? 'Priority' : 'How it was ranked', 'rank', <Priority a={a} rivals={rivals} shared={shared} onOpen={onOpenOther} />)}
      {sourceOf(a) === 'ai_call' && section('Patient told', 'told', <PatientUpdates appt={a} shared={shared} />)}
      {section('The booking call', 'call', <BookingCall a={a} showLink={canOpen(access, 'calls')} base={base} />)}
      {section('What happened', 'history', <History appt={a} />)}
      {section('This patient’s other appointments', 'others', <Others a={a} shared={shared} rows={rows} onOpen={onOpenOther} />)}

      {/* Inside the drawer, so the page's inert layer doesn't swallow them. */}
      <div onKeyDown={keepKeys}>
        {req.dialogs}
        <ChangeDialog
          appointment={changing ? a : null}
          rows={rows}
          loaded={loaded}
          ctx={shared.ctx}
          today={today}
          known={shared.known}
          onClose={() => setChanging(false)}
          onSave={async (patch) => {
            await onAct(a, 'change', patch)
            setChanging(false)
            requestAnimationFrame(() => heading.current?.focus())
          }}
        />
        <ConfirmDialog
          open={cancelling}
          title={`Cancel ${who === 'A patient' ? 'this' : `${who}'s`} appointment?`}
          confirmLabel="Cancel appointment"
          cancelLabel="Keep it"
          busyLabel="Cancelling…"
          busy={busy === 'cancel'}
          danger
          error={cancelling ? error : null}
          initialFocus={reasonField}
          onConfirm={() => {
            if (cancelReason.trim().length < 3) {
              setError('Say why it’s being cancelled. It goes in the history.')
              reasonField.current?.focus()
              return
            }
            void run('cancel', { status: 'cancelled', changeReason: cancelReason.trim() }).then((ok) => ok && setCancelling(false))
          }}
          onCancel={() => setCancelling(false)}
        >
          <p>
            {dayName(a.date, today)} at {time12(a.time)} with {a.doctor}. Let the patient know: AICA doesn't call them about it.
          </p>
          <TextAreaField ref={reasonField} label="Why it’s cancelled" rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} hint="Kept in the appointment’s history." />
        </ConfirmDialog>
      </div>
    </article>
  )
}

/** Where it was ranked among requests for the same time, the LLM's reasons, and the others. */
function Priority({ a, rivals, shared, onOpen }: { a: Appointment; rivals: Appointment[]; shared: Shared; onOpen(x: Appointment): void }) {
  const r = a.rank!
  return (
    <div className="ap-rank">
      <p className="ap-rank__head">
        <span className="ap-rank__pos num">
          {r.position} of {r.of}
        </span>
        <PriorityPill level={r.level} />
        {r.position === 1 && a.status === 'pending' && <span className="ap-reqs">Recommended</span>}
      </p>
      <p>{r.reasons}</p>
      <p className="ap-muted">Ranked by the LLM from what the agent gathered on each call, {timeAgo(r.rankedAt)}.</p>
      {rivals.length > 0 && (
        <ul className="ap-others">
          {rivals.map((o) => (
            <li key={o.id}>
              <button type="button" className="ap-others__row" onClick={() => onOpen(o)}>
                <span className="num">{o.rank ? `${o.rank.position} of ${o.rank.of}` : '–'}</span>
                <span>{shared.sees.name ? o.patientName : 'A patient'}{o.visitReason ? `: ${o.visitReason}` : ''}</span>
                {o.rank && <PriorityPill level={o.rank.level} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The call the agent booked this on: its summary and a way to open it. Without a linked call, how it was booked instead. */
function BookingCall({ a, showLink, base }: { a: Appointment; showLink: boolean; base: string }) {
  const client = useConsole()
  const { org } = useOrg()
  const [rec, setRec] = useState<{ state: 'loading' } | { state: 'ready'; call: CallRecord } | { state: 'error'; message: string } | null>(null)

  useEffect(() => {
    setRec(null)
    if (!a.callId) return
    let live = true
    setRec({ state: 'loading' })
    client.getCallRecord(org.orgSlug, a.callId).then(
      (call) => live && setRec({ state: 'ready', call }),
      (err) => live && setRec({ state: 'error', message: asAuthError(err).message }),
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, a.callId])

  if (!a.callId) {
    return sourceOf(a) === 'ai_call' ? (
      <p className="ap-muted">
        Booked by {a.agentName ?? 'an agent'} on a call, {timeAgo(a.createdAt)}. No call is linked to this booking, so there is no summary to show.
      </p>
    ) : (
      <p className="ap-muted">
        {sourceOf(a) === 'front_desk' ? 'Booked by the front desk on a phone call' : 'Entered by hand'}, {timeAgo(a.createdAt)}: no recorded call.
      </p>
    )
  }
  if (!rec || rec.state === 'loading') return <span aria-busy="true"><p className="sr-only" role="status">Loading the call…</p><Skeleton lines={3} /></span>
  if (rec.state === 'error') return <p className="ap-muted">Couldn't open the call: {rec.message}</p>
  const c = rec.call
  return (
    <div className="ap-call">
      <p className="ap-call__summary">{c.summary}</p>
      <dl className="ap-facts ap-facts--tight">
        <div>
          <dt>Agent</dt>
          <dd>{c.agentName}</dd>
        </div>
        <div>
          <dt>Call</dt>
          <dd>
            {new Date(c.startedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, {new Date(c.startedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}, {duration(c.durationSec)}
          </dd>
        </div>
        <div>
          <dt>Outcome</dt>
          <dd>{OUTCOME_LABEL[c.outcome]}</dd>
        </div>
      </dl>
      {showLink && (
        <Link className="link" to={`${base}/calls/${c.id}`}>
          Open the call in Call history
        </Link>
      )}
    </div>
  )
}

/** The same patient's other bookings: from what is loaded, and a lookup a month either side of this one. */
function Others({ a, shared, rows, onOpen }: { a: Appointment; shared: Shared; rows: Appointment[]; onOpen(x: Appointment): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const { sees, today } = shared
  const identity = patientIdentity(a, sees)
  const [wider, setWider] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setWider([])
    if (!identity) return
    let live = true
    setLoading(true)
    // The API allows 62 days at a time: a month either side of this booking.
    client.listAppointments(org.orgSlug, addDays(a.date, -30), addDays(a.date, 30)).then(
      (got) => live && (setWider(got), setLoading(false)),
      () => live && setLoading(false),
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, a.id, a.date, identity])

  const others = useMemo(() => (identity ? mergeById(rows, wider).filter((o) => o.id !== a.id && patientIdentity(o, sees) === identity) : []), [identity, rows, wider, a.id, sees])

  if (!identity) return <p className="ap-muted">Your role can't see callers' details, so a patient's other bookings can't be matched.</p>
  if (others.length === 0) return loading ? <Skeleton lines={2} /> : <p className="ap-muted">None within a month either side.</p>
  return (
    <ul className="ap-others">
      {[...others].sort(byStart).map((o) => (
        <li key={o.id}>
          <button type="button" className="ap-others__row" onClick={() => onOpen(o)}>
            <span className="num">
              {o.date === today ? 'Today' : shortDay(o.date)}, {time12(o.time)}
            </span>
            <span>
              {o.doctor}, {o.department}
            </span>
            <ApptStatus appt={o} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** "Thu 23 Oct, 4:12 pm": a moment in full. */
function stamp(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
}
