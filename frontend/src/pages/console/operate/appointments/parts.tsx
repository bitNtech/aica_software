import type { CSSProperties, ReactNode } from 'react'
import { StatusPill, ToneIcon, type Tone } from '../../../../components/console/StatusPill'
import type { Appointment, AppointmentStatus, DoctorChange, OrgSettings } from '../../../../console/types'
import { APPT_STATUS_LABEL, doctorShort, initials, noteLabel, PROBLEM_SHORT, time12, type Ctx, type DoctorInfo, type DoctorNote, type Problem, type Sees } from './model'

/** What every view of the bookings is given. */
export interface Shared {
  today: string
  now: number
  known: DoctorInfo[]
  ctx: Ctx
  settings: OrgSettings | null
  changes: DoctorChange[]
  problems: Map<string, Problem[]>
  sees: Sees
  slot: number
  selectedId: string | null
  /** Open this booking's detail. */
  onOpen(a: Appointment): void
}

export const STATUS_TONE: Record<AppointmentStatus, Tone> = { needs_check: 'warn', booked: 'info', confirmed: 'ok', cancelled: 'neutral' }

/** The status in words, with the tone's own icon: never colour alone. */
export function ApptStatus({ status }: { status: AppointmentStatus }) {
  return <StatusPill tone={STATUS_TONE[status]}>{APPT_STATUS_LABEL[status]}</StatusPill>
}

/** "Booked by an agent": a small waveform and the word, so it reads without colour. */
export function AgentMark({ appt, compact = false }: { appt: Appointment; compact?: boolean }) {
  if (appt.bookedBy !== 'agent') return null
  return (
    <span className="ap-agent" title={`Booked by ${appt.agentName ?? 'the agent'}`}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M3.5 8h0M5.7 5.8v4.4M8 4.2v7.6M10.3 5.8v4.4M12.5 8h0" />
      </svg>
      <span className={compact ? 'sr-only' : undefined}>Agent</span>
      {compact && <span className="sr-only"> booked</span>}
    </span>
  )
}

/** A doctor's initials in their own hue: the hue helps, the letters say who. */
export function Avatar({ doctor, hue }: { doctor: string; hue: number }) {
  return (
    <span className="ap-avatar" style={{ '--ap-h': hue } as CSSProperties} aria-hidden="true">
      {initials(doctor)}
    </span>
  )
}

/** What is wrong with a booking: the first, in few words, and how many more. */
export function ProblemFlag({ problems }: { problems: Problem[] | undefined }) {
  if (!problems?.length) return null
  const first = problems[0]
  return (
    <span className={`ap-flag ap-flag--${first.tone}`} title={problems.map((p) => p.text).join(' ')}>
      <ToneIcon tone={first.tone === 'danger' ? 'danger' : 'warn'} size={12} />
      <span>{PROBLEM_SHORT[first.kind]}</span>
      {problems.length > 1 && <span> +{problems.length - 1}</span>}
    </span>
  )
}

/** Every problem, one line each, with its icon. */
export function ProblemList({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) return null
  return (
    <ul className="ap-problems">
      {problems.map((p) => (
        <li key={p.kind} className={`ap-problems__item ap-problems__item--${p.tone}`}>
          <ToneIcon tone={p.tone === 'danger' ? 'danger' : 'warn'} size={14} />
          <span>
            <strong>{PROBLEM_SHORT[p.kind]}.</strong> {p.text}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A doctor's change for the day, as a pill: "Away: On leave today." */
export function NotePill({ note }: { note: DoctorNote }) {
  return (
    <StatusPill tone={note.kind === 'away' ? 'danger' : 'warn'} className="ap-notepill">
      {noteLabel(note)}
    </StatusPill>
  )
}

/** A full description of a booking for assistive technology: "9:30 am, Lakshmi N, Dr. R. Ramachandran, Cardiology, Needs a check". */
export function describe(a: Appointment, who: string, problems?: Problem[]): string {
  return [time12(a.time), who, a.doctor, a.department, APPT_STATUS_LABEL[a.status], a.bookedBy === 'agent' ? 'booked by an agent' : null, ...(problems ?? []).map((p) => PROBLEM_SHORT[p.kind])].filter(Boolean).join(', ')
}

/**
 * A short list of bookings grouped under headings (a doctor, a day): the
 * shape the grids take on a phone, where a timetable would scroll sideways.
 * Each booking is one button that opens its detail.
 */
export function Agenda({
  groups,
  shared,
  showDoctor,
  label,
}: {
  groups: { key: string; title: ReactNode; note?: ReactNode; items: Appointment[] }[]
  shared: Shared
  showDoctor: boolean
  label: string
}) {
  return (
    <div className="ap-agenda" role="group" aria-label={label}>
      {groups.map((g) => (
        <section key={g.key} className="ap-agenda__group" aria-labelledby={`ap-ag-${g.key}`}>
          <h3 className="ap-agenda__title" id={`ap-ag-${g.key}`}>
            {g.title}
          </h3>
          {g.note && <div className="ap-agenda__note">{g.note}</div>}
          {g.items.length === 0 ? (
            <p className="ap-agenda__none">Nothing booked.</p>
          ) : (
            <ul className="ap-agenda__list">
              {g.items.map((a) => {
                const who = shared.sees.name ? a.patientName : 'A patient'
                const problems = shared.problems.get(a.id)
                return (
                  <li key={a.id}>
                    <button type="button" className={`ap-agenda__row${a.status === 'cancelled' ? ' is-cancelled' : ''}${shared.selectedId === a.id ? ' is-selected' : ''}`} aria-haspopup="dialog" onClick={() => shared.onOpen(a)}>
                      <span className="ap-agenda__time num">{time12(a.time)}</span>
                      <span className="ap-agenda__main">
                        <span className="ap-agenda__who">{who}</span>
                        <span className="ap-agenda__sub">{showDoctor ? `${doctorShort(a.doctor)}, ${a.department}` : a.department}</span>
                      </span>
                      <span className="ap-agenda__tags">
                        <ApptStatus status={a.status} />
                        <AgentMark appt={a} />
                        <ProblemFlag problems={problems} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
