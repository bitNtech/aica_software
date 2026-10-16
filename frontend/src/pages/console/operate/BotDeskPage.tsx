import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { can } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AnswerFlag, Desk, DeskLine, DoctorChange, Notice } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ChoiceGroup } from '../../../components/ui/Choice'
import { ConfirmDialog, Modal } from '../../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { localDay, timeAgo } from '../../../lib/time'
import { useAsync } from '../../../lib/useAsync'
import { FlagAnswerButton } from './FlagAnswer'
import { useAnnouncer } from './LiveBits'
import { timeOfDay } from './shared'
import './Operate.css'
import './Desk.css'

/** The end of a local day, `offset` days from today. */
const endOfDay = (offset = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}
const inHours = (h: number) => new Date(Date.now() + h * 36e5).toISOString()

/** "until 2:30 PM", "until tomorrow 11:59 PM", "until 24 Oct". */
function until(iso: string): string {
  const d = new Date(iso)
  const day = localDay(0, d.getTime())
  if (day === localDay(0)) return `until ${timeOfDay(iso)}`
  if (day === localDay(1)) return `until tomorrow, ${timeOfDay(iso)}`
  return `until ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
}
const dayWord = (date: string) => (date === localDay(0) ? 'Today' : date === localDay(1) ? 'Tomorrow' : new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }))

const DOCTOR_KIND: Record<DoctorChange['kind'], string> = { away: 'Away', late: 'Late', moved: 'Another room' }

/**
 * /o/:slug/desk: the front desk's controls over the agents. Send a line's
 * calls to the team for a while, post a notice the agents tell callers,
 * mark a doctor away or late, and flag answers that were wrong. These apply
 * at once and aren't agent versions; nothing here changes the flow, which
 * is bitNtech's.
 */
export default function BotDeskPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const id = useId()
  const load = useCallback(() => client.getDesk(org.orgSlug), [client, org.orgSlug])
  const [desk, reload, setDesk] = useAsync(load)
  const [said, say] = useAnnouncer()
  const canBot = can(access, 'desk.bot')
  const canNotices = can(access, 'desk.notices')
  const canResolve = can(access, 'desk.resolveFlags')
  const adopt = (d: Desk) => setDesk({ state: 'ready', data: d })

  return (
    <ConsolePage
      kicker="Operate"
      title="Bot desk"
      docTitle="Bot desk"
      lede={<p>Run the agents day to day: send a line to your team for a while, tell callers what’s different today, and flag answers that were wrong.</p>}
    >
      <p className="sr-only" role="status">
        {said}
      </p>
      {desk.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading the desk…</span>
        </div>
      )}
      {desk.state === 'error' && (
        <Alert tone="error" title="Couldn't load the desk">
          <p>{asAuthError(desk.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {desk.state === 'ready' && (
        <>
          <section className="op-section" aria-labelledby={`${id}-lines`}>
            <h2 id={`${id}-lines`} className="op-section__title">
              Lines
            </h2>
            <ul className="desk__lines">
              {desk.data.lines.map((l) => (
                <LineCard key={l.numberId} line={l} canBot={canBot} onChanged={adopt} say={say} />
              ))}
            </ul>
          </section>

          <Notices desk={desk.data} canEdit={canNotices} onChanged={adopt} say={say} />
          <Doctors desk={desk.data} canEdit={canNotices} onChanged={adopt} say={say} />
          <Flags desk={desk.data} canResolve={canResolve} onChanged={adopt} onFlagged={reload} say={say} />
        </>
      )}
    </ConsolePage>
  )
}

type Say = (t: string) => void

function LineCard({ line: l, canBot, onChanged, say }: { line: DeskLine; canBot: boolean; onChanged(d: Desk): void; say: Say }) {
  const { org } = useOrg()
  const client = useConsole()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [howLong, setHowLong] = useState<'1' | '2' | 'day' | 'open'>('1')
  const [reason, setReason] = useState('')
  const staff = l.mode === 'staff'

  async function apply(mode: 'agent' | 'staff') {
    setBusy(true)
    setError(null)
    try {
      const untilIso = howLong === 'open' ? null : howLong === 'day' ? endOfDay() : inHours(Number(howLong))
      onChanged(await client.setLineMode(org.orgSlug, l.numberId, mode === 'staff' ? { mode, until: untilIso, reason } : { mode }))
      setOpen(false)
      setReason('')
      say(mode === 'staff' ? `${l.label} now rings your team.` : `${l.agentName} is answering ${l.label} again.`)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`desk__line${staff ? ' desk__line--staff' : ''}`}>
      <div className="desk__line-head">
        <strong>{l.label}</strong>
        <span className="row__meta">{l.number}</span>
      </div>
      {!l.agentName ? (
        <p className="row__meta">No agent: calls go straight to your team.</p>
      ) : staff ? (
        <p>
          <span className="flag flag--warn">Your team is answering</span> {l.staffUntil ? until(l.staffUntil) : 'until someone switches it back'}.
          {l.staffReason && <span className="row__meta"> “{l.staffReason}”</span>}
          {l.staffBy && <span className="row__meta"> Switched by {l.staffBy}.</span>}
        </p>
      ) : l.agentStatus === 'paused' ? (
        <p>
          <span className="flag flag--quiet">{l.agentName} is paused</span> <span className="row__meta">Calls go to your team. Someone who can publish turns it back on.</span>
        </p>
      ) : (
        <p>
          <span className="flag flag--ok">{l.agentName} is answering</span>{' '}
          <span className="row__meta">{l.liveCalls === 0 ? 'No calls right now.' : l.liveCalls === 1 ? 'On 1 call now.' : `On ${l.liveCalls} calls now.`}</span>
        </p>
      )}
      {error && !open && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {canBot && l.agentName && l.agentStatus !== 'paused' && (
        <div>
          {staff ? (
            <Button variant="plum" size="sm" busy={busy} busyLabel="Switching…" onClick={() => void apply('agent')}>
              Give back to {l.agentName}
            </Button>
          ) : (
            <Button
              variant="line"
              size="sm"
              onClick={() => {
                setError(null)
                setOpen(true)
              }}
            >
              Send to staff
            </Button>
          )}
        </div>
      )}
      <Modal open={open} title={`Send ${l.label} to your team?`} onClose={() => !busy && setOpen(false)}>
        <form
          className="op-form"
          onSubmit={(e) => {
            e.preventDefault()
            void apply('staff')
          }}
          noValidate
        >
          <p>Calls to {l.number} ring your team instead of {l.agentName}. Its setup doesn’t change.</p>
          <ChoiceGroup
            legend="For how long"
            type="radio"
            value={[howLong]}
            onChange={([v]) => setHowLong(v)}
            options={[
              { value: '1', label: '1 hour' },
              { value: '2', label: '2 hours' },
              { value: 'day', label: 'Until the end of today' },
              { value: 'open', label: 'Until someone switches it back' },
            ]}
          />
          <TextField label="Why" hint="Optional. Your team sees it, e.g. “Insurance desk is free to take calls”." maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog__actions">
            <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Switching…">
              Send to staff
            </Button>
            <Button variant="line" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </li>
  )
}

function Notices({ desk, canEdit, onChanged, say }: { desk: Desk; canEdit: boolean; onChanged(d: Desk): void; say: Say }) {
  const { org } = useOrg()
  const client = useConsole()
  const id = useId()
  const agents = desk.lines.filter((l) => l.agentId).map((l) => ({ id: l.agentId!, name: l.agentName! }))
  const [editing, setEditing] = useState<Notice | 'new' | null>(null)
  const [removing, setRemoving] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const agentName = (aid: string | null) => (aid ? (agents.find((a) => a.id === aid)?.name ?? 'an agent') : 'Every agent')

  async function remove() {
    if (!removing) return
    setBusy(true)
    setRemoveError(null)
    try {
      onChanged(await client.removeNotice(org.orgSlug, removing.id))
      setRemoving(null)
      say('Notice taken down.')
    } catch (err) {
      setRemoveError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="op-section" aria-labelledby={`${id}-n`}>
      <div className="op-section__head">
        <h2 id={`${id}-n`} className="op-section__title">
          Today’s notices
        </h2>
        {canEdit && (
          <Button variant="line" size="sm" onClick={() => setEditing('new')}>
            Post a notice
          </Button>
        )}
      </div>
      <p className="row__meta">The agents tell callers about these when it’s relevant, until each one ends. For anything lasting, add it to Knowledge instead.</p>
      {desk.notices.length === 0 ? (
        <p className="empty-note">No notices. Post one when something’s different today: a lift out of order, a camp, a closed counter.</p>
      ) : (
        <ul className="desk__items" aria-label="Notices">
          {desk.notices.map((n) => (
            <li key={n.id} className="desk__item">
              <p>{n.text}</p>
              <p className="row__meta">
                {agentName(n.agentId)} · {Date.parse(n.from) > Date.now() ? `from ${timeOfDay(n.from)}, ` : ''}
                {until(n.until)} · posted by {n.createdBy}
              </p>
              {canEdit && (
                <div className="desk__item-actions">
                  <button type="button" className="btn-text" onClick={() => setEditing(n)} aria-label={`Change the notice: ${n.text}`}>
                    Change
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => {
                      setRemoveError(null)
                      setRemoving(n)
                    }}
                    aria-label={`Take down the notice: ${n.text}`}
                  >
                    Take down
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={editing !== null} title={editing === 'new' ? 'Post a notice' : 'Change the notice'} onClose={() => setEditing(null)}>
        {editing !== null && (
          <NoticeForm
            notice={editing === 'new' ? null : editing}
            agents={agents}
            onCancel={() => setEditing(null)}
            onSaved={(d, posted) => {
              onChanged(d)
              setEditing(null)
              say(posted ? 'Notice posted. The agents tell callers about it now.' : 'Notice changed.')
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={!!removing}
        title="Take down this notice?"
        confirmLabel="Take down"
        busyLabel="Taking down…"
        busy={busy}
        error={removeError}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        <p>{removing?.text}</p>
        <p>The agents stop mentioning it straight away.</p>
      </ConfirmDialog>
    </section>
  )
}

function NoticeForm({ notice, agents, onCancel, onSaved }: { notice: Notice | null; agents: { id: string; name: string }[]; onCancel(): void; onSaved(d: Desk, posted: boolean): void }) {
  const { org } = useOrg()
  const client = useConsole()
  const [text, setText] = useState(notice?.text ?? '')
  const [agentId, setAgentId] = useState(notice?.agentId ?? '')
  const [ends, setEnds] = useState<'keep' | '2h' | 'today' | 'tomorrow' | 'week'>(notice ? 'keep' : 'today')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (text.trim().length < 5) {
      setError('Write what callers should know, in a sentence or two.')
      field.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    const untilIso = ends === 'keep' && notice ? notice.until : ends === '2h' ? inHours(2) : ends === 'tomorrow' ? endOfDay(1) : ends === 'week' ? endOfDay(7) : endOfDay(0)
    try {
      const d = await client.saveNotice(org.orgSlug, { id: notice?.id, text, agentId: agentId || null, from: notice?.from ?? new Date().toISOString(), until: untilIso })
      onSaved(d, !notice)
    } catch (err) {
      setError(asAuthError(err).message)
      field.current?.focus()
      setBusy(false)
    }
  }

  return (
    <form className="op-form" onSubmit={submit} noValidate>
      <TextAreaField ref={field} label="What callers should know" hint="Plain words, as you’d say it on the phone." rows={3} maxLength={300} value={text} error={error} onChange={(e) => setText(e.target.value)} />
      <SelectField label="Which agents" value={agentId} options={[{ value: '', label: 'Every agent' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => setAgentId(e.target.value)} />
      <SelectField
        label="Ends"
        value={ends}
        options={[
          ...(notice ? [{ value: 'keep', label: `As now (${until(notice.until)})` }] : []),
          { value: '2h', label: 'In 2 hours' },
          { value: 'today', label: 'At the end of today' },
          { value: 'tomorrow', label: 'At the end of tomorrow' },
          { value: 'week', label: 'In a week' },
        ]}
        onChange={(e) => setEnds(e.target.value as typeof ends)}
      />
      <div className="dialog__actions">
        <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Saving…">
          {notice ? 'Save notice' : 'Post notice'}
        </Button>
        <Button variant="line" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function Doctors({ desk, canEdit, onChanged, say }: { desk: Desk; canEdit: boolean; onChanged(d: Desk): void; say: Say }) {
  const { org } = useOrg()
  const client = useConsole()
  const id = useId()
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function remove(c: DoctorChange) {
    setBusyId(c.id)
    setError(null)
    try {
      onChanged(await client.removeDoctorChange(org.orgSlug, c.id))
      say(`Removed ${c.doctor}’s change.`)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="op-section" aria-labelledby={`${id}-d`}>
      <div className="op-section__head">
        <h2 id={`${id}-d`} className="op-section__title">
          Doctor changes
        </h2>
        {canEdit && (
          <Button variant="line" size="sm" onClick={() => setAdding(true)}>
            Mark a doctor away or late
          </Button>
        )}
      </div>
      <p className="row__meta">The agents won’t offer slots with a doctor who’s away, and tell callers when one is late or in another room.</p>
      {error && <Alert tone="error">{error}</Alert>}
      {desk.doctorChanges.length === 0 ? (
        <p className="empty-note">Every doctor is in as usual.</p>
      ) : (
        <ul className="desk__items" aria-label="Doctor changes">
          {desk.doctorChanges.map((c) => (
            <li key={c.id} className="desk__item">
              <p>
                <strong>{c.doctor}</strong> <span className="row__meta">{c.department}</span> <span className={`flag${c.kind === 'away' ? ' flag--warn' : ''}`}>{DOCTOR_KIND[c.kind]}</span>{' '}
                <span className="row__meta">{dayWord(c.date)}</span>
              </p>
              {c.detail && <p className="row__meta">{c.detail}</p>}
              <p className="row__meta">Added by {c.createdBy}</p>
              {canEdit && (
                <div className="desk__item-actions">
                  <Button variant="line" size="sm" busy={busyId === c.id} busyLabel="Removing…" onClick={() => void remove(c)} aria-label={`Remove ${c.doctor}’s change on ${dayWord(c.date)}`}>
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} title="Mark a doctor away or late" onClose={() => setAdding(false)}>
        {adding && (
          <DoctorForm
            doctors={desk.doctors}
            onCancel={() => setAdding(false)}
            onSaved={(d, name) => {
              onChanged(d)
              setAdding(false)
              say(`Saved. The agents know about ${name}.`)
            }}
          />
        )}
      </Modal>
    </section>
  )
}

function DoctorForm({ doctors, onCancel, onSaved }: { doctors: Desk['doctors']; onCancel(): void; onSaved(d: Desk, doctor: string): void }) {
  const { org } = useOrg()
  const client = useConsole()
  const [doctor, setDoctor] = useState('')
  const [date, setDate] = useState(localDay(0))
  const [kind, setKind] = useState<DoctorChange['kind']>('away')
  const [detail, setDetail] = useState('')
  const [errors, setErrors] = useState<{ doctor?: string; detail?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const docRef = useRef<HTMLSelectElement>(null)
  const detailRef = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!doctor) next.doctor = 'Choose the doctor.'
    if (kind !== 'away' && !detail.trim()) next.detail = kind === 'late' ? 'Say from when they’re seeing patients.' : 'Say where they’re seeing patients.'
    setErrors(next)
    if (next.doctor) return docRef.current?.focus()
    if (next.detail) return detailRef.current?.focus()
    setBusy(true)
    try {
      const d = doctors.find((x) => x.doctor === doctor)!
      onSaved(await client.saveDoctorChange(org.orgSlug, { doctor, department: d.department, date, kind, detail }), doctor)
    } catch (err) {
      setErrors({ form: asAuthError(err).message })
      setBusy(false)
    }
  }

  return (
    <form className="op-form" onSubmit={submit} noValidate>
      <SelectField
        ref={docRef}
        label="Doctor"
        value={doctor}
        error={errors.doctor}
        options={[{ value: '', label: 'Choose a doctor' }, ...doctors.map((d) => ({ value: d.doctor, label: `${d.doctor}, ${d.department}` }))]}
        onChange={(e) => setDoctor(e.target.value)}
      />
      <TextField label="Day" type="date" min={localDay(0)} value={date} onChange={(e) => setDate(e.target.value)} />
      <ChoiceGroup
        legend="What’s different"
        type="radio"
        columns={3}
        value={[kind]}
        onChange={([v]) => setKind(v)}
        options={[
          { value: 'away', label: 'Away all day' },
          { value: 'late', label: 'Starting late' },
          { value: 'moved', label: 'In another room' },
        ]}
      />
      <TextField
        ref={detailRef}
        label={kind === 'away' ? 'Who covers (optional)' : kind === 'late' ? 'From when' : 'Where'}
        placeholder={kind === 'away' ? 'e.g. Dr. Kavitha sees ENT patients in room 12' : kind === 'late' ? 'e.g. From 11 AM, after surgery' : 'e.g. OPD room 4'}
        maxLength={200}
        value={detail}
        error={errors.detail}
        onChange={(e) => setDetail(e.target.value)}
      />
      {errors.form && (
        <p className="field__error" role="alert">
          {errors.form}
        </p>
      )}
      <div className="dialog__actions">
        <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Saving…">
          Save
        </Button>
        <Button variant="line" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function Flags({ desk, canResolve, onChanged, onFlagged, say }: { desk: Desk; canResolve: boolean; onChanged(d: Desk): void; onFlagged(): void; say: Say }) {
  const id = useId()
  const open = desk.flags.filter((f) => f.status === 'open')
  const done = desk.flags.filter((f) => f.status !== 'open')
  return (
    <section className="op-section" aria-labelledby={`${id}-f`}>
      <div className="op-section__head">
        <h2 id={`${id}-f`} className="op-section__title">
          Flagged answers
        </h2>
        <FlagAnswerButton callId={null} agentName={null} onFlagged={onFlagged} />
      </div>
      <p className="row__meta">Answers an agent got wrong. {canResolve ? 'Fix the knowledge (or ask bitNtech to change the flow), then mark it fixed.' : 'Whoever looks after the agents fixes them.'}</p>
      {open.length === 0 ? (
        <p className="empty-note">Nothing flagged.</p>
      ) : (
        <ul className="desk__items" aria-label="Flagged answers">
          {open.map((f) => (
            <FlagItem key={f.id} flag={f} canResolve={canResolve} onChanged={onChanged} say={say} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="desk__done">
          <summary>Recently dealt with ({done.length})</summary>
          <ul className="desk__items">
            {done.map((f) => (
              <li key={f.id} className="desk__item">
                <p>{f.text}</p>
                <p className="row__meta">
                  {f.status === 'fixed' ? 'Fixed' : 'Dismissed'} by {f.resolution?.by}, {f.resolution ? timeAgo(f.resolution.at) : ''}
                  {f.resolution?.note && `: ${f.resolution.note}`}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function FlagItem({ flag: f, canResolve, onChanged, say }: { flag: AnswerFlag; canResolve: boolean; onChanged(d: Desk): void; say: Say }) {
  const { org } = useOrg()
  const client = useConsole()
  const [mode, setMode] = useState<'fixed' | 'dismissed' | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!mode) return
    if (mode === 'fixed' && !note.trim()) {
      setError('Say what you changed, so the desk knows.')
      field.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      onChanged(await client.resolveFlag(org.orgSlug, f.id, { status: mode, note }))
      say(mode === 'fixed' ? 'Marked fixed.' : 'Dismissed.')
    } catch (err) {
      setError(asAuthError(err).message)
      setBusy(false)
    }
  }

  return (
    <li className="desk__item">
      <p>
        <strong>{f.agentName ?? 'An agent'}:</strong> {f.text}
      </p>
      {f.correction && <p className="row__meta">Should be: {f.correction}</p>}
      <p className="row__meta">
        Flagged by {f.by}, {timeAgo(f.at)}
      </p>
      {canResolve &&
        (mode ? (
          <form className="op-form desk__resolve" onSubmit={submit} noValidate>
            <TextField
              ref={field}
              label={mode === 'fixed' ? 'What you changed' : 'Why it’s not a problem (optional)'}
              maxLength={300}
              value={note}
              error={error}
              autoFocus
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="desk__item-actions">
              <Button type="submit" variant="line" size="sm" busy={busy} busyLabel="Saving…">
                {mode === 'fixed' ? 'Mark fixed' : 'Dismiss'}
              </Button>
              <button type="button" className="btn-text" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="desk__item-actions">
            <Button variant="line" size="sm" onClick={() => setMode('fixed')}>
              Mark fixed
            </Button>
            <button type="button" className="btn-text" onClick={() => setMode('dismissed')}>
              Dismiss
            </button>
          </div>
        ))}
    </li>
  )
}
