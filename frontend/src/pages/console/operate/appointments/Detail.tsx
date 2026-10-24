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
import { addDays, byStart, dayName, doctorNote, longDay, mergeById, patientIdentity, shortDay, time12 } from './model'
import { ApptStatus, NotePill, ProblemList, type Shared } from './parts'

export type ActionKind = 'confirm' | 'change' | 'cancel' | 'rebook'

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
  const { sees, today, problems, changes } = shared

  const who = sees.name ? a.patientName : 'A patient'
  const mine = problems.get(a.id) ?? []
  const note = doctorNote(a.doctor, a.date, changes)
  const cancelled = a.status === 'cancelled'
  const telHref = sees.phone ? `tel:${a.phone.replace(/[^\d+]/g, '')}` : null

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
    if ((changing || cancelling) && (e.key === 'Escape' || e.key === 'Tab')) e.stopPropagation()
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
          <ApptStatus status={a.status} />
        </div>
        <p className="ap-detail__when num">
          {longDay(a.date)}, {time12(a.time)}
        </p>
      </header>

      {a.status === 'needs_check' && a.checkReason && (
        <p className="ap-callout ap-callout--warn">
          <strong>Needs a check.</strong> {a.checkReason}
        </p>
      )}
      <ProblemList problems={mine} />

      {canEdit && (
        <div className="ap-actions" role="group" aria-label="What to do with this appointment">
          {!cancelled && a.status !== 'confirmed' && (
            <Button variant="plum" size="sm" busy={busy === 'confirm'} busyLabel="Confirming…" disabled={!!busy} onClick={() => void run('confirm', { status: 'confirmed' })}>
              Confirm
            </Button>
          )}
          {!cancelled && (
            <Button variant="line" size="sm" disabled={!!busy} onClick={() => setChanging(true)}>
              Change
            </Button>
          )}
          {!cancelled && (
            <Button variant="line" size="sm" className="ap-actions__cancel" disabled={!!busy} onClick={() => { setError(null); setCancelling(true) }}>
              Cancel
            </Button>
          )}
          {cancelled && (
            <Button variant="line" size="sm" busy={busy === 'rebook'} busyLabel="Booking again…" disabled={!!busy} onClick={() => void run('rebook', { status: 'booked' })}>
              Book it again
            </Button>
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
          <dt>Booked by</dt>
          <dd>
            {a.bookedBy === 'agent' ? `Agent${a.agentName ? `: ${a.agentName}` : ''}` : 'Staff'} <span className="ap-facts__sub">{timeAgo(a.createdAt)}</span>
          </dd>
        </div>
        {a.note && (
          <div className="ap-facts__wide">
            <dt>Note</dt>
            <dd>{a.note}</dd>
          </div>
        )}
      </dl>

      {section('The booking call', 'call', <BookingCall a={a} showLink={canOpen(access, 'calls')} base={base} />)}
      {section('This patient’s other appointments', 'others', <Others a={a} shared={shared} rows={rows} onOpen={onOpenOther} />)}

      {/* Inside the drawer, so the page's inert layer doesn't swallow them. */}
      <div onKeyDown={keepKeys}>
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
          onConfirm={() => void run('cancel', { status: 'cancelled' }).then((ok) => ok && setCancelling(false))}
          onCancel={() => setCancelling(false)}
        >
          <p>
            {dayName(a.date, today)} at {time12(a.time)} with {a.doctor}. Let the patient know: AICA doesn't call them about it.
          </p>
        </ConfirmDialog>
      </div>
    </article>
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
    return a.bookedBy === 'agent' ? (
      <p className="ap-muted">
        Booked by {a.agentName ?? 'an agent'} on a call, {timeAgo(a.createdAt)}. No call is linked to this booking, so there is no summary to show.
      </p>
    ) : (
      <p className="ap-muted">Booked by staff, {timeAgo(a.createdAt)}: not on a call.</p>
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
            <ApptStatus status={o.status} />
          </button>
        </li>
      ))}
    </ul>
  )
}
