import { useState, type ReactNode } from 'react'
import { asAuthError } from '../../../../auth/types'
import { ToneIcon } from '../../../../components/console/StatusPill'
import { Button } from '../../../../components/ui/Button'
import { timeAgo } from '../../../../lib/time'
import type { Appointment } from '../../../../console/types'
import { autoPreview, dayName, needsCheck, patientLabel, requestGroups, time12, TYPE_LABEL, type RequestGroup } from './model'
import { ApptStatus, PriorityPill, type Shared } from './parts'
import { useRequestActions } from './RequestActions'

interface Props {
  shared: Shared
  /** The requests that pass the filters. */
  appts: Appointment[]
  empty: ReactNode
  /** Opens Booking settings. */
  onSettings(): void
  /** Runs the automatic confirmation now; absent when the person can't. */
  onRunAuto?: () => Promise<void>
}

/**
 * The agent's requests waiting for a decision, grouped by doctor and time,
 * the most pressing first. Where several patients asked for one time, the
 * LLM's ranking orders them and the first is recommended; confirming one
 * settles the rest. With automatic confirmation on, a banner says what the
 * evening's run will do.
 */
export function RequestsView({ shared, appts, empty, onSettings, onRunAuto }: Props) {
  const req = useRequestActions(shared)
  const groups = requestGroups(appts, shared.rows, shared.slot)
  const b = shared.booking

  return (
    <div className="ap-requests">
      <AutoBanner shared={shared} onSettings={onSettings} onRunAuto={onRunAuto} />
      {groups.length === 0 ? (
        <p className="empty-note">{empty}</p>
      ) : (
        <ol className="ap-reqgroups" aria-label="Requests by time, most pressing first">
          {groups.map((g) => (
            <Group key={g.key} g={g} shared={shared} confirm={req.confirm} decline={req.decline} />
          ))}
        </ol>
      )}
      {b && !b.callback && !b.whatsapp && <p className="ap-hint">Patient updates are off in Booking settings: after confirming or declining, let the patient know yourself.</p>}
      {req.dialogs}
    </div>
  )
}

function Group({ g, shared, confirm, decline }: { g: RequestGroup; shared: Shared; confirm(a: Appointment): Promise<void>; decline(a: Appointment): void }) {
  const several = g.requests.length > 1
  const id = `ap-g-${g.key.replace(/[^a-z0-9]/gi, '')}`
  return (
    <li className={`ap-reqgroup${several ? ' is-contested' : ''}`} aria-labelledby={id}>
      <h3 className="ap-reqgroup__title" id={id}>
        <span className="num">
          {dayName(g.date, shared.today)}, {time12(g.time)}
        </span>
        <span>
          {g.doctor}, {g.department}
        </span>
        {several && <span className="ap-reqs">{g.requests.length} requests for this time</span>}
      </h3>
      {g.taken && (
        <p className="ap-problems__item ap-problems__item--danger">
          <ToneIcon tone="danger" size={14} />
          <span>
            This time is already given to {shared.ctx.who(g.taken)} ({g.taken.status === 'confirmed' ? 'confirmed' : 'offered'}). Confirming another request double-books the doctor.
          </span>
        </p>
      )}
      <ol className="ap-reqlist">
        {g.requests.map((a, i) => (
          <Request key={a.id} a={a} top={several && i === 0} shared={shared} confirm={confirm} decline={decline} />
        ))}
      </ol>
    </li>
  )
}

function Request({ a, top, shared, confirm, decline }: { a: Appointment; top: boolean; shared: Shared; confirm(a: Appointment): Promise<void>; decline(a: Appointment): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const who = patientLabel(a, shared.sees)
  return (
    <li className={`ap-req${top ? ' is-top' : ''}${shared.selectedId === a.id ? ' is-selected' : ''}`}>
      <div className="ap-req__head">
        {a.rank && a.rank.of > 1 && (
          <span className="ap-req__pos num" aria-label={`Ranked ${a.rank.position} of ${a.rank.of}`}>
            {a.rank.position}
          </span>
        )}
        <button type="button" className="ap-req__who" aria-haspopup="dialog" onClick={() => shared.onOpen(a)}>
          {who}
        </button>
        {a.rank && <PriorityPill level={a.rank.level} />}
        {top && <span className="ap-reqs">Recommended</span>}
        {needsCheck(a) && <ApptStatus appt={a} />}
      </div>
      <p className="ap-req__visit">
        {a.type ? `${TYPE_LABEL[a.type]}: ` : ''}
        {a.visitReason ?? <span className="ap-muted">No reason given</span>}
      </p>
      {a.rank && a.rank.of > 1 && <p className="ap-req__why">{a.rank.reasons}</p>}
      {needsCheck(a) && <p className="ap-req__why ap-req__why--warn">Needs a check: {a.checkReason}</p>}
      <p className="ap-req__meta">
        Asked {timeAgo(a.createdAt)}
        {a.agentName ? ` on a call with ${a.agentName}` : ''}
      </p>
      {shared.canEdit && (
        <div className="ap-req__actions">
          <Button
            variant={top || !a.rank ? 'plum' : 'line'}
            size="sm"
            busy={busy}
            busyLabel="Confirming…"
            aria-label={`Confirm ${who}`}
            onClick={() => {
              setBusy(true)
              setError(null)
              confirm(a).then(
                () => setBusy(false),
                (err) => {
                  setBusy(false)
                  setError(asAuthError(err).message)
                },
              )
            }}
          >
            Confirm
          </Button>
          <Button variant="line" size="sm" disabled={busy} aria-label={`Decline ${who}`} onClick={() => decline(a)}>
            Decline
          </Button>
        </div>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

/** How requests are confirmed here, and, with the automatic run on, what it will do tonight. */
function AutoBanner({ shared, onSettings, onRunAuto }: { shared: Shared; onSettings(): void; onRunAuto?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const b = shared.booking
  if (!b) {
    return (
      <p className="ap-banner">
        <span>Requests are confirmed by staff. Ranking, automatic confirmation and patient updates need the AICA server to be updated first.</span>
      </p>
    )
  }
  const settingsLink = (
    <button type="button" className="btn-text" onClick={onSettings}>
      Booking settings
    </button>
  )
  if (b.confirm === 'staff') {
    return (
      <p className="ap-banner">
        <span>Requests wait for staff to confirm them. {settingsLink}</span>
      </p>
    )
  }
  const p = autoPreview(shared.rows, b, shared.now)
  const parts = [`${p.confirm} confirmed`, ...(p.others ? [`${p.others} ${b.others === 'offer' ? 'offered another time' : 'declined'}`] : []), ...(p.left ? [`${p.left} left for a person`] : [])]
  return (
    <div className="ap-banner ap-banner--auto" role="status">
      <span>
        <strong>Automatic confirmation at {time12(b.autoAt)}:</strong> {p.confirm + p.others + p.left === 0 ? 'no requests waiting.' : `${parts.join(', ')}.`} You can still decide any of them before then. {settingsLink}
      </span>
      {onRunAuto && p.confirm > 0 && (
        <Button
          variant="line"
          size="sm"
          busy={busy}
          busyLabel="Running…"
          onClick={() => {
            setBusy(true)
            setError(null)
            onRunAuto().then(
              () => setBusy(false),
              (err) => {
                setBusy(false)
                setError(asAuthError(err).message)
              },
            )
          }}
        >
          Run now
        </Button>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
