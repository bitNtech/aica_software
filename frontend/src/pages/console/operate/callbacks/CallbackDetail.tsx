import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../../auth/types'
import { can } from '../../../../console/access'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Callback, CallbackPatch, Member, OrgSettings } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { useShortcuts } from '../../../../components/console/KeyboardHelp'
import { ToneIcon } from '../../../../components/console/StatusPill'
import { Timeline, type TimelineItem } from '../../../../components/console/Timeline'
import { useToast } from '../../../../components/console/Toast'
import { Button } from '../../../../components/ui/Button'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { SelectField, TextAreaField } from '../../../../components/ui/Field'
import { CallerHistory, SourceCall, useCallerCalls } from './CallerContext'
import { Avatar, StatePill } from './parts'
import { assigneeGone, describeChange, dayTime, howLong, nameOf, otherOpenFor, outsideHours, rangBack, triesText, UNREACHABLE_AFTER } from './queue'

interface Props {
  callback: Callback
  /** Every callback loaded: for the other ones from the same number. */
  all: Callback[]
  /** People it can be given to (active, and able to take calls). */
  team: Member[]
  /** The team list loaded; without it nobody can be told "no longer on the team". */
  teamKnown: boolean
  /** May give callbacks to anyone (Assign callbacks); otherwise only take or give back their own. */
  manage: boolean
  me: { id: string; name: string }
  /** The organisation's hours, when this person may read them. */
  settings: OrgSettings | null
  /** It has left the list (taken by someone else, or removed): the last copy is shown. */
  gone: boolean
  /** The callback N would open from here. */
  next: Callback | null
  /** Move focus to the heading when it opens (it was opened with Next). */
  focus: boolean
  now: number
  /** The server's copy after a change made here. */
  onChanged(c: Callback): void
  onOpen(id: string): void
  onNext(): void
  onRefresh(): void
}

/**
 * One callback in full: who and why, what is due, anything that needs care
 * (a removed assignee, a caller who has rung back, other callbacks for the
 * same number, the last try before "Couldn't reach", a due time outside
 * hours), then what to do (log the call, give it to someone), then the
 * context (the caller's other callbacks and past calls, the call it came
 * from) and what has happened so far. Anyone may read it; the buttons are
 * for those who may act on this one.
 */
export function CallbackDetail({ callback: c, all, team, teamKnown, manage, me, settings, gone, next, focus, now, onChanged, onOpen, onNext, onRefresh }: Props) {
  const client = useConsole()
  const { org, base, access } = useOrg()
  const toast = useToast()
  const uid = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const firstChoice = useRef<HTMLInputElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** What was said after logging a call, with the way on to the next one. */
  const [after, setAfter] = useState<string | null>(null)
  /** The copy this person last saw or made: later differences are someone else's doing. */
  const [baseline, setBaseline] = useState(c)
  const [calls, reloadCalls] = useCallerCalls(c)

  const mine = c.assignedTo?.id === me.id
  const open = c.status === 'open'
  const mayAct = !gone && (manage || !c.assignedTo || mine)
  const redact = !can(access, 'call.personal')
  const name = nameOf(c)
  const due = Date.parse(c.dueBy)
  const overdue = open && due < now

  const removed = teamKnown && assigneeGone(c, team)
  const rang = calls.state === 'ready' ? rangBack(c, calls.data.calls) : null
  const others = otherOpenFor(c, all)
  const lateHours = settings && open ? outsideHours(c.dueBy, settings) : null
  const lastTry = open && c.attempts === UNREACHABLE_AFTER - 1
  const changes = describeChange(baseline, c, me.id)

  useEffect(() => {
    if (focus) heading.current?.focus()
  }, [focus])
  // After a call is logged: on to the next one, or back to the heading.
  useEffect(() => {
    if (after) (nextButton.current ?? heading.current)?.focus()
  }, [after])

  /** Sends one change; says what went wrong, and reads the list again, when it can't be made. */
  async function send(key: string, patch: CallbackPatch): Promise<Callback | null> {
    setBusy(key)
    setError(null)
    try {
      const done = await client.updateCallback(org.orgSlug, c.id, patch)
      onChanged(done)
      setBaseline(done)
      return done
    } catch (err) {
      // Most often someone else got there first: say so, and show who has it.
      setError(asAuthError(err).message)
      return null
    } finally {
      setBusy(null)
      onRefresh()
    }
  }

  /** The reverse of a change, from a toast's Undo. */
  function undoWith(patch: CallbackPatch) {
    return () => {
      setAfter(null)
      client.updateCallback(org.orgSlug, c.id, patch).then(
        (done) => {
          onChanged(done)
          setBaseline(done)
          onRefresh()
          toast.show({ message: 'Undone.', tone: 'ok' })
        },
        (err) => toast.show({ message: `Couldn’t undo: ${asAuthError(err).message}`, tone: 'danger' }),
      )
    }
  }

  /** Back to focus on the heading: the button that was pressed has gone. */
  const settle = () => requestAnimationFrame(() => heading.current?.isConnected && heading.current.focus())

  async function logCall(result: 'reached' | 'no_answer', note: string): Promise<boolean> {
    const text = note.trim()
    const done = await send('log', { attempt: result, ...(text ? { note: text } : {}) })
    if (!done) return false
    if (result === 'reached') {
      const said = `Marked done${c.callerName ? `: ${c.callerName}` : ''}.`
      setAfter(said)
      toast.show({ message: said, tone: 'ok', action: { label: 'Undo', onClick: undoWith({ reopen: true }) } })
    } else if (done.status === 'unreachable') {
      const said = `That was try ${done.attempts} with no answer: moved to Couldn’t reach.`
      setAfter(said)
      toast.show({ message: said, tone: 'warn' })
    } else {
      const said = `No answer logged. ${triesText(done.attempts)}; it stays on the list.`
      setAfter(said)
      toast.show({ message: said, tone: 'ok' })
    }
    return true
  }

  async function assign(id: string | null, said: string) {
    const before = c.assignedTo
    const done = await send('assign', { assignedTo: id })
    if (!done) return
    // The reverse is valid unless the old assignee has since left the team.
    const canReverse = before === null || team.some((m) => m.id === before.id)
    toast.show({ message: said, tone: 'ok', action: canReverse ? { label: 'Undo', onClick: undoWith({ assignedTo: before?.id ?? null }) } : undefined })
    settle()
  }

  async function reopen() {
    const done = await send('reopen', { reopen: true })
    if (!done) return
    setAfter(null)
    toast.show({ message: 'Back on the list to call.', tone: 'ok' })
    settle()
  }

  useShortcuts({
    ...(open && mayAct ? { l: { description: 'Log the call: go to the form', run: () => firstChoice.current?.focus() } } : {}),
  })

  const timeline: TimelineItem[] = [
    { id: 'asked', at: c.requestedAt, kind: 'call', title: c.callId ? 'Asked to be called back, on a call' : 'Asked to be called back' },
    ...[...c.notes]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((n): TimelineItem => ({ id: n.id, at: n.at, kind: 'note', who: n.by, title: 'Note', body: n.text })),
  ]

  const section = (id: string, title: string, body: ReactNode) => (
    <section className="cb-sec" aria-labelledby={`${uid}-${id}`}>
      <h3 className="cb-sec__title" id={`${uid}-${id}`}>
        {title}
      </h3>
      {body}
    </section>
  )

  const banner = (tone: 'warn' | 'info', body: ReactNode, key: string) => (
    <div key={key} className={`cb-banner cb-banner--${tone}`}>
      <ToneIcon tone={tone} size={18} />
      <div>{body}</div>
    </div>
  )

  return (
    <article className="cb-detail" aria-labelledby={`${uid}-name`}>
      <header className="cb-head">
        <div className="cb-head__row">
          <h2 className={`cb-head__name${c.callerName ? '' : ' cb-head__name--unnamed'}`} id={`${uid}-name`} ref={heading} tabIndex={-1}>
            {name}
          </h2>
          <StatePill callback={c} overdue={overdue} />
        </div>
        <p className="cb-head__phone num">
          <a className="cb-phone" href={`tel:${c.callerPhone.replace(/\s/g, '')}`} aria-label={`Call ${c.callerName ?? 'the caller'} on ${c.callerPhone}`}>
            {c.callerPhone}
          </a>
        </p>
        {!c.callerName && <p className="cb-quiet cb-quiet--tight">The caller isn’t named. Ask who they are on the call, and put it in the note.</p>}
        <p className="cb-reason">{c.reason}</p>
        <dl className="cb-facts">
          <div>
            <dt>Asked</dt>
            <dd>
              {dayTime(c.requestedAt, now)} <span className="cb-facts__sub">{howLong(now - Date.parse(c.requestedAt))} ago</span>
            </dd>
          </div>
          <div>
            <dt>Call back by</dt>
            <dd>
              {dayTime(c.dueBy, now)}
              {open && (
                <span className={`cb-facts__sub${overdue ? ' cb-facts__sub--late' : ''}`}>
                  {' '}
                  {overdue ? `overdue by ${howLong(now - due)}` : `in ${howLong(due - now)}`}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Given to</dt>
            <dd className="cb-facts__who">
              <Avatar name={c.assignedTo?.name ?? null} />
              {c.assignedTo ? (mine ? `${c.assignedTo.name} (you)` : c.assignedTo.name) : 'Not given to anyone'}
            </dd>
          </div>
          <div>
            <dt>Tries</dt>
            <dd>
              {triesText(c.attempts)}
              {open && <span className="cb-facts__sub"> of {UNREACHABLE_AFTER} before it moves to Couldn’t reach</span>}
            </dd>
          </div>
        </dl>
      </header>

      {after && (
        <div className="cb-after" role="status">
          <ToneIcon tone="ok" size={18} />
          <p>{after}</p>
          {next ? (
            <Button ref={nextButton} variant="plum" size="sm" aria-keyshortcuts="n" onClick={onNext}>
              Next callback <kbd className="kbd" aria-hidden="true">N</kbd>
            </Button>
          ) : (
            <span className="cb-quiet">That is everything waiting for you.</span>
          )}
        </div>
      )}

      <div className="cb-banners">
        {gone &&
          banner(
            'warn',
            <p>
              <strong>This isn’t on your list any more.</strong> Someone else may have taken it, or it was removed. This is how it was when you last saw it; nothing here can be changed.
            </p>,
            'gone',
          )}
        {!gone &&
          changes.length > 0 &&
          banner(
            'warn',
            <p>
              <strong>This changed while you were looking.</strong> {changes.join(' ')}{' '}
              <button type="button" className="btn-text" onClick={() => setBaseline(c)}>
                Got it
              </button>
            </p>,
            'changed',
          )}
        {removed &&
          c.assignedTo &&
          banner(
            'warn',
            <p>
              <strong>Given to someone who is no longer on the team.</strong> {c.assignedTo.name} can’t ring this back. Give it to someone else.
            </p>,
            'removed',
          )}
        {rang &&
          banner(
            'info',
            <p>
              <strong>They may have called back at {new Date(rang.startedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.</strong> A call from this number came in after they asked.{' '}
              <Link className="link" to={`${base}/calls/${rang.id}`}>
                See the call
              </Link>
            </p>,
            'rang',
          )}
        {others.length > 0 &&
          banner(
            'info',
            <>
              <p>
                <strong>
                  {others.length} other open {others.length === 1 ? 'callback' : 'callbacks'} for this number.
                </strong>{' '}
                You can deal with them all in one call.
              </p>
              <ul className="cb-plain">
                {others.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="btn-text" onClick={() => onOpen(o.id)}>
                      {nameOf(o)}
                    </button>
                    <span className="cb-plain__reason">
                      {o.reason} (call back by {dayTime(o.dueBy, now)})
                    </span>
                  </li>
                ))}
              </ul>
            </>,
            'others',
          )}
        {lateHours && open && banner('warn', <p>It is due {dayTime(c.dueBy, now)}, but {lateHours}. Someone may not be in to ring then.</p>, 'hours')}
        {lastTry &&
          mayAct &&
          banner('warn', <p><strong>This is the last try.</strong> With no answer it moves to Couldn’t reach and leaves the list. Try a different time of day if you can.</p>, 'last')}
      </div>

      {mayAct && (
        <div className="cb-actions" role="group" aria-label="What to do with this callback">
          {open ? (
            <Button variant="plum" size="sm" aria-keyshortcuts="l" onClick={() => firstChoice.current?.focus()}>
              Log the call <kbd className="kbd" aria-hidden="true">L</kbd>
            </Button>
          ) : (
            <Button variant="line" size="sm" busy={busy === 'reopen'} busyLabel="Opening…" disabled={!!busy} onClick={() => void reopen()}>
              Open again
            </Button>
          )}
          {next && !after && (
            <Button ref={nextButton} variant="line" size="sm" aria-keyshortcuts="n" onClick={onNext}>
              Next callback <kbd className="kbd" aria-hidden="true">N</kbd>
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      {open && mayAct && section('log', 'Log the call', <LogCall key={`${c.id}-${c.attempts}`} lastTry={lastTry} busy={busy === 'log'} choiceRef={firstChoice} onSave={logCall} />)}

      {section(
        'who',
        'Who rings back',
        <AssignControls callback={c} team={team} teamKnown={teamKnown} manage={manage} meId={me.id} mayAct={mayAct && open} busy={busy === 'assign'} onAssign={(id, said) => void assign(id, said)} />,
      )}

      {section('history', 'Caller history', <CallerHistory callback={c} all={all} calls={calls} reloadCalls={reloadCalls} ownOnly={!manage} now={now} onOpen={onOpen} />)}
      {section('source', 'Where it came from', <SourceCall callback={c} redact={redact} />)}
      {section(
        'happened',
        'What has happened',
        <>
          <p className="cb-quiet cb-quiet--tight">{c.attempts === 0 ? 'Not tried yet.' : `${triesText(c.attempts)}, without reaching them.`} Tries are counted but not timed; notes carry the time.</p>
          <Timeline items={timeline} label="What has happened, oldest first" />
        </>,
      )}
    </article>
  )
}

/** Reached them, or no answer, with an optional note: exactly what the server takes. */
function LogCall({ lastTry, busy, choiceRef, onSave }: { lastTry: boolean; busy: boolean; choiceRef: Ref<HTMLInputElement>; onSave(result: 'reached' | 'no_answer', note: string): Promise<boolean> }) {
  const [result, setResult] = useState<'reached' | 'no_answer'>('reached')
  const [note, setNote] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (await onSave(result, note)) {
      setNote('')
      setResult('reached')
    }
  }

  return (
    <form className="cb-log" onSubmit={submit} noValidate>
      <ChoiceGroup<'reached' | 'no_answer'>
        legend="How did it go?"
        type="radio"
        columns={2}
        firstRef={choiceRef}
        options={[
          { value: 'reached', label: 'Reached them', hint: 'Done: it leaves the list.' },
          {
            value: 'no_answer',
            label: 'No answer',
            hint: lastTry ? `Try ${UNREACHABLE_AFTER}: it moves to “Couldn’t reach”.` : `Counts as a try. After ${UNREACHABLE_AFTER} it moves to “Couldn’t reach”.`,
          },
        ]}
        value={[result]}
        onChange={([v]) => setResult(v)}
      />
      <TextAreaField label="Note" hint="Optional. Your team sees it." rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <div>
        <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…">
          Save
        </Button>
      </div>
    </form>
  )
}

/** Who has it, and, for those who may, giving it, taking it or letting it go. */
function AssignControls({
  callback: c,
  team,
  teamKnown,
  manage,
  meId,
  mayAct,
  busy,
  onAssign,
}: {
  callback: Callback
  team: Member[]
  teamKnown: boolean
  manage: boolean
  meId: string
  mayAct: boolean
  busy: boolean
  onAssign(id: string | null, said: string): void
}) {
  const current = c.assignedTo?.id ?? ''
  const inTeam = team.some((m) => m.id === current)
  const [pick, setPick] = useState(inTeam ? current : '')
  useEffect(() => setPick(inTeam ? current : ''), [current, inTeam])
  const mine = current === meId
  const iCanTake = team.some((m) => m.id === meId)

  const status = c.assignedTo ? (mine ? 'It’s yours.' : `${c.assignedTo.name} has it.`) : 'Not given to anyone yet.'
  if (!mayAct) return <p className="cb-quiet">{status}</p>

  // Without “Assign callbacks”: take it, or give it back.
  if (!manage) {
    return (
      <div className="cb-assign">
        <p className="cb-assign__status">{status}</p>
        {mine ? (
          <Button variant="line" size="sm" busy={busy} busyLabel="Saving…" onClick={() => onAssign(null, 'Given back: nobody has it now.')}>
            Give it back
          </Button>
        ) : (
          <Button variant="line" size="sm" busy={busy} busyLabel="Taking…" onClick={() => onAssign(meId, 'It’s yours now.')}>
            Take it
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="cb-assign">
      <p className="cb-assign__status">{status}</p>
      {!teamKnown ? (
        <p className="cb-quiet">The team list didn’t load, so it can’t be given to someone else right now. Reload the page to try again.</p>
      ) : (
        <form
          className="cb-assign__form"
          onSubmit={(e) => {
            e.preventDefault()
            if (busy || pick === current) return
            const m = team.find((x) => x.id === pick)
            onAssign(pick || null, m ? `Given to ${m.name}.` : 'Not given to anyone now.')
          }}
        >
          <SelectField
            label="Give it to"
            value={pick}
            options={[{ value: '', label: 'Not given to anyone' }, ...team.map((m) => ({ value: m.id, label: m.id === meId ? `${m.name} (you)` : m.name }))]}
            onChange={(e) => setPick(e.target.value)}
          />
          <Button type="submit" variant="line" size="sm" busy={busy} busyLabel="Saving…" aria-disabled={pick === current || undefined}>
            Give
          </Button>
          {!mine && iCanTake && (
            <Button variant="line" size="sm" disabled={busy} onClick={() => onAssign(meId, 'It’s yours now.')}>
              Take it myself
            </Button>
          )}
          {c.assignedTo && (
            <Button variant="line" size="sm" disabled={busy} onClick={() => onAssign(null, 'Not given to anyone now.')}>
              Unassign
            </Button>
          )}
        </form>
      )}
    </div>
  )
}
