import { useId, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Desk, DeskLine } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { StatusPill, type Tone } from '../../../../components/console/StatusPill'
import { useToast } from '../../../../components/console/Toast'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { ConfirmDialog, Modal } from '../../../../components/ui/Dialog'
import { TextField } from '../../../../components/ui/Field'
import { boardSummary, lineState, remaining, todayFigures, toGiveBack, toSend, until, untilFor, type HowLong, type LineState } from './logic'

export type Say = (text: string) => void

/** What a line's agent has done today, read from the report (absent: the person can't read reports, or it didn't load). */
export type LineFigures = NonNullable<ReturnType<typeof todayFigures>>

const STATE_TONE: Record<LineState, Tone> = { answering: 'ok', staff: 'warn', paused: 'neutral', none: 'neutral' }

interface Failure {
  line: string
  message: string
}
interface BoardReport {
  /** What was tried, for the heading: "Sent to your team" / "Given back". */
  what: string
  total: number
  done: number
  failed: Failure[]
}

/**
 * The lines across the top of the desk: each phone line with its agent, who
 * is answering (and for how long, when it's the team), calls now and today's
 * figures. Whoever may switch lines sends one, or every line, to staff and
 * back; each change can be undone from its toast, and a bulk change that
 * only partly worked names the lines it couldn't change.
 */
export function LineBoard({
  lines,
  canBot,
  figures,
  now,
  onDesk,
  say,
}: {
  lines: DeskLine[]
  canBot: boolean
  figures: ReadonlyMap<string, LineFigures>
  now: number
  onDesk(d: Desk): void
  say: Say
}) {
  const { org } = useOrg()
  const client = useConsole()
  const toast = useToast()
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState<DeskLine[] | null>(null)
  const [givingAll, setGivingAll] = useState(false)
  const [giveError, setGiveError] = useState<string | null>(null)
  const [report, setReport] = useState<BoardReport | null>(null)
  const summary = boardSummary(lines)
  const sendable = toSend(lines)
  const back = toGiveBack(lines)

  /** Sends each of `targets` to staff, one by one (each has its own checks); returns what to tell the person when none went. */
  async function send(targets: DeskLine[], opts: { until: string | null; reason: string }): Promise<string | null> {
    setBusy(true)
    setReport(null)
    const done: DeskLine[] = []
    const failed: Failure[] = []
    let last: Desk | null = null
    for (const t of targets) {
      try {
        last = await client.setLineMode(org.orgSlug, t.numberId, { mode: 'staff', until: opts.until, reason: opts.reason })
        done.push(t)
      } catch (err) {
        failed.push({ line: t.label, message: asAuthError(err).message })
      }
    }
    setBusy(false)
    if (last) onDesk(last)
    if (done.length === 0) return targets.length === 1 ? failed[0].message : failed.map((f) => `${f.line}: ${f.message}`).join(' ')
    if (failed.length) setReport({ what: 'Sent to your team', total: targets.length, done: done.length, failed })
    const words = targets.length === 1 ? `${done[0].label} now rings your team.` : `${done.length} of ${targets.length} lines now ring your team.`
    say(words)
    toast.show({ message: failed.length ? `${words} ${failed.length} couldn’t be changed.` : words, tone: failed.length ? 'warn' : 'ok', action: { label: 'Undo', onClick: () => void undo(done, 'agent') } })
    return null
  }

  /** Gives each of `targets` back to its agent. */
  async function giveBack(targets: DeskLine[]): Promise<string | null> {
    setBusy(true)
    setReport(null)
    const done: DeskLine[] = []
    const failed: Failure[] = []
    let last: Desk | null = null
    for (const t of targets) {
      try {
        last = await client.setLineMode(org.orgSlug, t.numberId, { mode: 'agent' })
        done.push(t)
      } catch (err) {
        failed.push({ line: t.label, message: asAuthError(err).message })
      }
    }
    setBusy(false)
    if (last) onDesk(last)
    if (done.length === 0) return targets.length === 1 ? failed[0].message : failed.map((f) => `${f.line}: ${f.message}`).join(' ')
    if (failed.length) setReport({ what: 'Given back', total: targets.length, done: done.length, failed })
    const words = targets.length === 1 ? `${done[0].agentName} is answering ${done[0].label} again.` : `${done.length} of ${targets.length} lines are back with their agents.`
    say(words)
    toast.show({ message: failed.length ? `${words} ${failed.length} couldn’t be changed.` : words, tone: failed.length ? 'warn' : 'ok', action: { label: 'Undo', onClick: () => void undo(done, 'staff') } })
    return null
  }

  /** Puts lines back as they were: `to` is the mode they go to. A line sent to staff earlier goes back with its old end time, if that hasn't passed. */
  async function undo(changed: DeskLine[], to: 'agent' | 'staff') {
    let put = 0
    let last: Desk | null = null
    for (const l of changed) {
      try {
        if (to === 'agent') last = await client.setLineMode(org.orgSlug, l.numberId, { mode: 'agent' })
        else if (!l.staffUntil || Date.parse(l.staffUntil) > Date.now()) last = await client.setLineMode(org.orgSlug, l.numberId, { mode: 'staff', until: l.staffUntil, reason: l.staffReason ?? '' })
        else continue
        put++
      } catch {
        // Left as it is: the count below says how many went back.
      }
    }
    if (last) onDesk(last)
    toast.show({ message: put === changed.length ? 'Undone.' : `Put ${put} of ${changed.length} back as they were.`, tone: put === changed.length ? 'ok' : 'warn' })
  }

  return (
    <section className="desk-board" aria-labelledby={`${id}-h`}>
      <div className="desk-board__head">
        <div className="desk-board__title">
          <h2 id={`${id}-h`} className="op-section__title">
            Lines
          </h2>
          {lines.length > 0 && (
            <p className="desk-board__summary num">
              {[summary.answering && `${summary.answering} answering`, summary.staff && `${summary.staff} with your team`, summary.paused && `${summary.paused} paused`, summary.none && `${summary.none} without an agent`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {canBot && lines.length > 0 && (
          <div className="desk-board__bulk">
            {sendable.length > 0 && (
              <Button variant="line" size="sm" disabled={busy} onClick={() => setSending(sendable)}>
                Send every line to staff
              </Button>
            )}
            {back.length > 0 && (
              <Button
                variant="line"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setGiveError(null)
                  setGivingAll(true)
                }}
              >
                Give every line back
              </Button>
            )}
          </div>
        )}
      </div>

      {!canBot && lines.length > 0 && <p className="row__meta">You can see the lines. Switching one to staff needs the “Switch lines to staff” permission, which you don’t have.</p>}

      {report && (
        <Alert tone="warn" title={`${report.what}: ${report.done} of ${report.total} lines`}>
          <p>Couldn’t change {report.failed.map((f) => f.line).join(', ')}.</p>
          <ul className="desk-board__failed">
            {report.failed.map((f) => (
              <li key={f.line}>
                <strong>{f.line}:</strong> {f.message}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-text" onClick={() => setReport(null)}>
            Dismiss
          </button>
        </Alert>
      )}

      {lines.length === 0 ? (
        <p className="empty-note">No phone lines yet. When bitNtech sets up a number for your hospital, it shows here.</p>
      ) : (
        <>
          {summary.answering === 0 && summary.staff > 0 && (
            <p className="desk-board__all" role="status">
              <StatusPill tone="warn">Every line is with your team</StatusPill>
              <span className="row__meta">No agent is answering calls right now.</span>
            </p>
          )}
          <ul className="desk-lines" aria-label="Phone lines">
            {lines.map((l) => (
              <LineCard key={l.numberId} line={l} canBot={canBot} figures={figures.get(l.agentId ?? '')} now={now} busy={busy} onSend={() => setSending([l])} onGiveBack={() => void giveBack([l])} />
            ))}
          </ul>
        </>
      )}

      <SendDialog
        lines={sending ?? []}
        open={sending !== null}
        now={now}
        onClose={() => setSending(null)}
        onSend={async (opts) => {
          const failure = await send(sending ?? [], opts)
          if (failure === null) setSending(null)
          return failure
        }}
      />
      <ConfirmDialog
        open={givingAll}
        title="Give every line back to its agent?"
        confirmLabel="Give every line back"
        busyLabel="Switching…"
        busy={busy}
        error={giveError}
        onConfirm={() => {
          void giveBack(back).then((failure) => (failure === null ? setGivingAll(false) : setGiveError(failure)))
        }}
        onCancel={() => setGivingAll(false)}
      >
        <p>These lines go back to their agents:</p>
        <ul className="desk-board__names">
          {back.map((l) => (
            <li key={l.numberId}>
              {l.label} <span className="row__meta">({l.agentName})</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </section>
  )
}

function LineCard({ line: l, canBot, figures, now, busy, onSend, onGiveBack }: { line: DeskLine; canBot: boolean; figures: LineFigures | undefined; now: number; busy: boolean; onSend(): void; onGiveBack(): void }) {
  const state = lineState(l)
  const stats = figures
  const label = state === 'staff' ? 'Your team is answering' : state === 'paused' ? `${l.agentName} is paused` : state === 'answering' ? `${l.agentName} is answering` : 'No agent'

  return (
    <li className={`desk-line desk-line--${state}`}>
      <div className="desk-line__head">
        <h3 className="desk-line__name">{l.label}</h3>
        <span className="desk-line__number num">{l.number}</span>
      </div>
      {state === 'none' ? (
        <p className="row__meta">No agent: calls go straight to your team.</p>
      ) : (
        <>
          <p className="desk-line__state">
            <StatusPill tone={STATE_TONE[state]}>{label}</StatusPill>
          </p>
          {state === 'staff' && (
            <p className="desk-line__detail">
              {l.staffUntil ? (
                <>
                  <strong>Back to {l.agentName} in {remaining(l.staffUntil, now)}</strong> <span className="row__meta">({until(l.staffUntil, now)}).</span>
                </>
              ) : (
                <span>Until someone switches it back.</span>
              )}
              {l.staffReason && <span className="row__meta"> “{l.staffReason}”</span>}
              {l.staffBy && <span className="row__meta"> Switched by {l.staffBy}.</span>}
            </p>
          )}
          {state === 'paused' && <p className="row__meta">Calls go to your team. Someone who can publish turns it back on.</p>}
          <dl className="desk-line__stats">
            <div>
              <dt>Now</dt>
              <dd className="num">{state === 'staff' ? 'With your team' : l.liveCalls === 0 ? 'No calls right now.' : l.liveCalls === 1 ? 'On 1 call now.' : `On ${l.liveCalls} calls now.`}</dd>
            </div>
            {stats && (
              <>
                <div>
                  <dt>Calls today</dt>
                  <dd className="num">{stats.calls}</dd>
                </div>
                <div>
                  <dt>Handed over</dt>
                  <dd className="num">
                    {stats.rate === null ? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">No calls yet</span>
                      </>
                    ) : (
                      `${stats.rate}% (${stats.handedOver})`
                    )}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </>
      )}
      {canBot && (state === 'answering' || state === 'staff') && (
        <div className="desk-line__actions">
          {state === 'staff' ? (
            <Button variant="plum" size="sm" busy={busy} busyLabel="Switching…" onClick={onGiveBack}>
              Give back to {l.agentName}
            </Button>
          ) : (
            <Button variant="line" size="sm" disabled={busy} onClick={onSend}>
              Send to staff <span className="sr-only">for {l.label}</span>
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

/** "Send these lines to your team?": for how long and why. One line or several; the same form is the confirmation. */
function SendDialog({ lines, open, now, onClose, onSend }: { lines: DeskLine[]; open: boolean; now: number; onClose(): void; onSend(opts: { until: string | null; reason: string }): Promise<string | null> }) {
  const [how, setHow] = useState<HowLong>('1')
  const [at, setAt] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const many = lines.length > 1
  const first = lines[0]

  async function submit(e: FormEvent) {
    e.preventDefault()
    const chosen = untilFor(how, Date.now(), at)
    if ('error' in chosen) {
      setError(chosen.error)
      return
    }
    setBusy(true)
    setError(null)
    const failure = await onSend({ until: chosen.until, reason })
    setBusy(false)
    if (failure) setError(failure)
    else setReason('')
  }

  return (
    <Modal open={open} title={many ? 'Send every line to your team?' : `Send ${first?.label ?? 'this line'} to your team?`} onClose={() => !busy && onClose()}>
      <form className="op-form" onSubmit={(e) => void submit(e)} noValidate>
        {many ? (
          <>
            <p>Calls to these lines ring your team instead of their agents. Their setup doesn’t change.</p>
            <ul className="desk-board__names">
              {lines.map((l) => (
                <li key={l.numberId}>
                  {l.label} <span className="row__meta">({l.agentName}, {l.number})</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          first && (
            <p>
              Calls to {first.number} ring your team instead of {first.agentName}. Its setup doesn’t change.
            </p>
          )
        )}
        <ChoiceGroup
          legend="For how long"
          type="radio"
          value={[how]}
          onChange={([v]) => {
            setHow(v)
            setError(null)
          }}
          options={[
            { value: '1', label: '1 hour' },
            { value: '2', label: '2 hours' },
            { value: 'at', label: 'Until a time today' },
            { value: 'day', label: 'Until the end of today' },
            { value: 'open', label: 'Until someone switches it back' },
          ]}
        />
        {how === 'at' && <TextField label="Until" type="time" value={at} onChange={(e) => setAt(e.target.value)} hint={`Back with the agent at that time. It is ${new Date(now).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} now.`} />}
        <TextField label="Why" hint="Optional. Your team sees it, e.g. “Insurance desk is free to take calls”." maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Switching…">
            {many ? `Send ${lines.length} lines to staff` : 'Send to staff'}
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
