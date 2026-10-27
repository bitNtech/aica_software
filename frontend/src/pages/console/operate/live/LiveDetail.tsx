import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { asAuthError } from '../../../../auth/types'
import { canOpen } from '../../../../console/access'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Handoff, LiveCall, Member } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { useShortcuts } from '../../../../components/console/KeyboardHelp'
import { ToneIcon } from '../../../../components/console/StatusPill'
import { useToast } from '../../../../components/console/Toast'
import { WaitTimer } from '../../../../components/console/WaitTimer'
import { Button } from '../../../../components/ui/Button'
import { ConfirmDialog, Modal } from '../../../../components/ui/Dialog'
import { OperatorPanel } from '../../../../components/voice/OperatorPanel'
import { languageName, timeOfDay } from '../shared'
import { GuideForm, TransferForm } from './Forms'
import { CallClock, RowPills } from './parts'
import { callerName, factsOf, type QueueItem } from './queue'
import { LiveTranscript } from './LiveTranscript'

interface Props {
  item: QueueItem
  /** The person may act on calls (`calls.take`); a viewer sees none of the buttons. */
  canAct: boolean
  /** The person may see callers' names and details (`calls.personal`). */
  mayShowPersonal: boolean
  /** Colleagues a call can be handed to. */
  team: Member[]
  /** A handover changed on the server: show it at once (a fresh read follows). */
  onHandoff(h: Handoff): void
  /** The live call changed on the server. */
  onCall(c: LiveCall): void
  onRefresh(): void
}

/** Whether the call has a record in Call history (it does once it has been saved), for the "ended" note's link. */
function useHasRecord(callId: string, enabled: boolean): boolean {
  const client = useConsole()
  const { org } = useOrg()
  const [has, setHas] = useState(false)
  useEffect(() => {
    setHas(false)
    if (!enabled || !callId) return
    let live = true
    client.getCallRecord(org.orgSlug, callId).then(
      () => live && setHas(true),
      () => live && setHas(false),
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, callId, enabled])
  return has
}

/**
 * One caller in full: who, why they want a person, what the agent knows,
 * the live transcript, notes to the agent and (for people who take calls)
 * what to do about it. Nothing the old Handoff queue or Live calls pages
 * showed is left out; the actions only appear for people who may use them.
 */
export function LiveDetail({ item, canAct, mayShowPersonal, team, onHandoff, onCall, onRefresh }: Props) {
  const client = useConsole()
  const { org, user, base, access } = useOrg()
  const toast = useToast()
  const navigate = useNavigate()
  const uid = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const guideField = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'take' | 'callback' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [handing, setHanding] = useState(false)
  // The voice server: staff join calls in the browser, and the agent can be stopped or the call ended.
  const voice = !!client.joinLiveCall
  const [joinAs, setJoinAs] = useState<'listen' | 'takeover' | null>(null)
  const [ending, setEnding] = useState<'confirm' | 'busy' | null>(null)
  const [endError, setEndError] = useState<string | null>(null)

  const f = factsOf(item)
  const call = item.call
  const handoff = item.handoff
  const live = !!call && !item.ended
  const name = callerName(item, mayShowPersonal)
  const mine = f.takenBy === user.name
  // What may be done now. A waiting handover can be taken even if its live
  // call isn't on the list (they come from different sources).
  const canTake = canAct && !f.takenBy && !f.missed && (f.waiting || live)
  const canGuide = canAct && live && !f.takenBy
  const canHand = canGuide
  const canCallback = canAct && !!handoff && f.waiting
  const hasRecord = useHasRecord(f.callId, (item.ended || f.missed) && canOpen(access, 'calls'))

  async function take() {
    setBusy('take')
    setError(null)
    try {
      let by: string | null
      if (handoff && f.waiting) {
        const h = await client.takeHandoff(org.orgSlug, handoff.id)
        onHandoff(h)
        by = h.takenBy
      } else {
        const c = await client.takeOverCall(org.orgSlug, call!.id)
        onCall(c)
        by = c.takenBy
      }
      if (by && by !== user.name) toast.show({ message: `${by} has this call.`, tone: 'warn' })
      else if (voice && call) {
        // The agent puts the caller on hold; this browser joins and takes over.
        setJoinAs('takeover')
        toast.show({ message: `Joining the call${name ? ` with ${name}` : ''} in your browser.`, tone: 'ok' })
      } else toast.show({ message: `You took the call${name ? ` from ${name}` : ''}. Your desk phone rings.${client.isDemo ? ' (In the demo nothing rings.)' : ''}`, tone: 'ok' })
      // The button goes: keep focus in this call.
      requestAnimationFrame(() => heading.current?.focus())
    } catch (err) {
      // Most often someone else got there first: say so, and show who has it.
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
      onRefresh()
    }
  }

  async function makeCallback() {
    if (!handoff) return
    setBusy('callback')
    setError(null)
    try {
      const cb = await client.handoffToCallback(org.orgSlug, handoff.id)
      onHandoff({ ...handoff, status: 'missed' })
      const mineNow = cb.assignedTo?.id === user.id
      toast.show({
        message: `A callback was made${name ? ` for ${name}` : ''}${mineNow ? ', assigned to you' : ''}.`,
        tone: 'ok',
        action: canOpen(access, 'callbacks') ? { label: 'Open Callbacks', onClick: () => navigate(`${base}/callbacks`) } : undefined,
      })
      requestAnimationFrame(() => heading.current?.focus())
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
      onRefresh()
    }
  }

  async function endCall() {
    if (!call) return
    setEnding('busy')
    setEndError(null)
    try {
      await client.endLiveCall!(org.orgSlug, call.id)
      setEnding(null)
      toast.show({ message: 'The call has ended.', tone: 'ok' })
      onRefresh()
    } catch (err) {
      setEnding('confirm')
      setEndError(asAuthError(err).message)
    }
  }

  async function stopAgent() {
    if (!call) return
    try {
      onCall(await client.interruptLiveCall!(org.orgSlug, call.id))
    } catch (err) {
      setError(asAuthError(err).message)
    }
  }

  useShortcuts({
    ...(canTake ? { t: { description: 'Take the call', run: () => void take() } } : {}),
    ...(canGuide ? { g: { description: client.sayToCaller ? 'Say something to the caller: go to the box' : 'Guide the agent: go to the note box', run: () => guideField.current?.focus() } } : {}),
    ...(canHand ? { h: { description: 'Hand the call to a colleague', run: () => setHanding(true) } } : {}),
  })

  const demoNote = client.isDemo ? ' (In the demo nothing rings.)' : ''
  const takenText = f.takenBy
    ? call?.transferredTo
      ? `Handed to ${call.transferredTo.name}${call.transferredTo.warm ? ': the agent told them about the call first' : ''}.${demoNote}`
      : mine
        ? `Taken by you: your desk phone rings.${demoNote}`
        : `Taken by ${f.takenBy}.`
    : null

  const section = (title: string, body: ReactNode, id: string) => (
    <section className="live-sec" aria-labelledby={`${uid}-${id}`}>
      <h3 className="live-sec__title" id={`${uid}-${id}`}>
        {title}
      </h3>
      {body}
    </section>
  )

  return (
    <article className="live-detail" aria-labelledby={`${uid}-name`}>
      <header className="live-head">
        <div className="live-head__row">
          <h2 className="live-head__name" id={`${uid}-name`} ref={heading} tabIndex={-1}>
            {name ?? f.callerPhone}
          </h2>
          <RowPills item={item} me={user.name} />
        </div>
        {name && <p className="live-head__phone num">{f.callerPhone}</p>}
        <dl className="live-facts">
          <div>
            <dt>Line</dt>
            <dd>{f.line}</dd>
          </div>
          <div>
            <dt>Agent</dt>
            <dd>{f.agentName}</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{languageName(f.language)}</dd>
          </div>
          {f.waiting && f.waitingSince && (
            <div>
              <dt>Waiting</dt>
              <dd>
                <WaitTimer since={f.waitingSince} /> <span className="live-facts__sub">since {timeOfDay(f.waitingSince)}</span>
              </dd>
            </div>
          )}
          {f.startedAt && (
            <div>
              <dt>{item.ended ? 'Call lasted' : 'On the call for'}</dt>
              <dd>
                <CallClock startedAt={f.startedAt} endedAt={item.endedAt} label={item.ended ? 'call lasted' : 'on the call for'} />
              </dd>
            </div>
          )}
          <div>
            <dt>They want</dt>
            <dd>{f.intent ?? (call ? 'Still finding out' : '—')}</dd>
          </div>
          {f.step && !item.ended && (
            <div>
              <dt>Now</dt>
              <dd>{f.step}</dd>
            </div>
          )}
        </dl>
      </header>

      {f.emergency && f.waiting && (
        <div className="live-banner live-banner--danger">
          <ToneIcon tone="danger" size={18} />
          <p>
            <strong>Emergency.</strong> This caller needs a person now: take this call first.
          </p>
        </div>
      )}
      {f.flagged && !f.waiting && (
        <div className="live-banner live-banner--warn">
          <ToneIcon tone="warn" size={18} />
          <p>The caller sounds upset or stuck: a person may help.</p>
        </div>
      )}
      {(item.ended || f.missed) && (
        <p className="live-note" role="status">
          {f.missed ? 'The caller hung up before anyone answered.' : 'This call has ended.'}{' '}
          {f.missed && canOpen(access, 'callbacks') && (
            <Link className="link" to={`${base}/callbacks`}>
              Callbacks
            </Link>
          )}
          {hasRecord && (
            <>
              {f.missed && canOpen(access, 'callbacks') ? ' · ' : ''}
              <Link className="link" to={`${base}/calls/${f.callId}`}>
                See the call in Call history
              </Link>
            </>
          )}
        </p>
      )}
      {takenText && <p className="live-note live-note--ok">{takenText}</p>}

      {canAct && (canTake || canGuide || canHand || canCallback) && (
        <div className="live-actions" role="group" aria-label="What to do with this call">
          {canTake && (
            <Button variant={f.emergency ? 'orange' : 'plum'} size="sm" busy={busy === 'take'} busyLabel="Taking…" disabled={!!busy} aria-keyshortcuts="t" onClick={() => void take()}>
              Take the call <kbd className="kbd" aria-hidden="true">T</kbd>
            </Button>
          )}
          {canGuide && (
            <Button variant="line" size="sm" disabled={!!busy} aria-keyshortcuts="g" onClick={() => guideField.current?.focus()}>
              {client.sayToCaller ? 'Say something' : 'Guide the agent'} <kbd className="kbd" aria-hidden="true">G</kbd>
            </Button>
          )}
          {canHand && (
            <Button variant="line" size="sm" disabled={!!busy} aria-keyshortcuts="h" onClick={() => setHanding(true)}>
              Hand to a colleague <kbd className="kbd" aria-hidden="true">H</kbd>
            </Button>
          )}
          {canCallback && (
            <Button variant="line" size="sm" busy={busy === 'callback'} busyLabel="Making a callback…" disabled={!!busy} onClick={() => void makeCallback()}>
              Caller hung up: make a callback
            </Button>
          )}
        </div>
      )}
      {canAct && live && voice && call &&
        section(
          'Join the call',
          <>
            <OperatorPanel key={`${call.id}-${joinAs ?? 'idle'}`} autoJoin={joinAs ?? undefined} getTicket={(mode) => client.joinLiveCall!(org.orgSlug, call.id, mode)} onLeft={() => setJoinAs(null)} />
            {client.endLiveCall && (
              <div className="live-actions live-actions--quiet" role="group" aria-label="Without joining">
                <Button variant="line" size="sm" onClick={() => void stopAgent()}>
                  Stop the agent talking
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setEndError(null)
                    setEnding('confirm')
                  }}
                >
                  End the call
                </Button>
              </div>
            )}
          </>,
          'join',
        )}
      {canAct && live && !voice && !f.takenBy && (
        <p className="live-listen">
          <Button variant="line" size="sm" className="btn--inactive" aria-disabled aria-describedby={`${uid}-listen`}>
            Listen in
          </Button>{' '}
          <span className="field__hint" id={`${uid}-listen`}>
            Listening needs AICA’s voice servers: not available in the demo.
          </span>
        </p>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      {handoff &&
        section(
          f.waiting ? 'Why they want a person' : 'Why they asked for a person',
          <p className={`live-why${f.waiting ? ' live-why--now' : ''}`}>{handoff.reason}</p>,
          'why',
        )}
      {handoff && section('Agent’s summary so far', <p className="live-summary">{handoff.summary}</p>, 'summary')}
      {handoff && handoff.details.length > 0 &&
        section(
          'Details collected',
          <dl className="op-facts live-collected">
            {handoff.details.map((d) => (
              <div key={d.label}>
                <dt>{d.label}</dt>
                <dd>{d.personal && !mayShowPersonal ? <span className="live-hidden">Hidden — you can’t see personal details</span> : d.value || '—'}</dd>
              </div>
            ))}
          </dl>,
          'details',
        )}

      {section(
        item.ended ? 'Transcript' : 'Live transcript',
        call && call.turns.length > 0 ? (
          <>
            {!mayShowPersonal && <p className="transcript__note">Personal details are hidden.</p>}
            <LiveTranscript callId={call.id} turns={call.turns} redact={!mayShowPersonal} />
          </>
        ) : (
          <p className="live-quiet">{call ? 'Nothing said yet.' : 'No transcript here: the live call isn’t on the list.'}</p>
        ),
        'transcript',
      )}

      {section(
        client.sayToCaller ? 'Say something to the caller' : 'Notes to the agent',
        <>
          {call && call.whispers.length > 0 ? (
            <ul className="op-whispers" aria-label="Notes to the agent, oldest first">
              {call.whispers.map((w) => (
                <li key={w.at}>
                  <span className="op-whispers__by">{w.by} to the agent:</span> {w.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="live-quiet">No notes yet.</p>
          )}
          {canGuide && call && (
            <GuideForm
              callId={call.id}
              inputRef={guideField}
              aloud={!!client.sayToCaller}
              onSent={(c) => {
                onCall(c)
                toast.show({ message: client.sayToCaller ? 'The agent is saying it to the caller.' : 'Sent to the agent. The caller doesn’t hear it.', tone: 'ok' })
                onRefresh()
              }}
            />
          )}
          {canAct && live && f.takenBy && <p className="live-quiet">{f.takenBy} has taken this call, so the agent is no longer on it.</p>}
        </>,
        'notes',
      )}

      <ConfirmDialog
        open={!!ending}
        title="End this call?"
        confirmLabel="End the call"
        busyLabel="Ending…"
        busy={ending === 'busy'}
        danger
        error={endError}
        onConfirm={() => void endCall()}
        onCancel={() => setEnding(null)}
      >
        <p>The caller is disconnected at once. To speak to them first, join the call instead.</p>
      </ConfirmDialog>

      {call && (
        <Modal open={handing} title="Hand the call to a colleague" onClose={() => setHanding(false)}>
          {handing && (
            <TransferForm
              call={call}
              team={team.filter((m) => m.status === 'active' && m.role !== 'viewer' && m.id !== user.id)}
              onCancel={() => setHanding(false)}
              onDone={(done, out) => {
                setHanding(false)
                onCall(out)
                toast.show({ message: done, tone: 'ok' })
                requestAnimationFrame(() => heading.current?.focus())
                onRefresh()
              }}
            />
          )}
        </Modal>
      )}
    </article>
  )
}
