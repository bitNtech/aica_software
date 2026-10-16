import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Callback, Member } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { pageAccess } from '../../../console/access'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { SegFilter } from '../../../components/console/ListTools'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ChoiceGroup } from '../../../components/ui/Choice'
import { Modal } from '../../../components/ui/Dialog'
import { SelectField, TextAreaField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { shortDate } from '../../../lib/time'
import { since, timeOfDay, useNow } from './shared'
import { useAnnouncer } from './LiveBits'
import './Operate.css'

type Show = 'open' | 'done' | 'unreachable'
type Whose = 'all' | 'mine' | 'nobody'
const SHOW_LABEL: Record<Show, string> = { open: 'To call', done: 'Done', unreachable: 'Couldn’t reach' }
const WHOSE_LABEL: Record<Whose, string> = { all: 'Everyone’s', mine: 'Mine', nobody: 'Nobody’s yet' }

/** /o/:slug/callbacks: missed calls and callers who asked to be called back. */
export default function CallbacksPage() {
  const { org, user, access } = useOrg()
  const client = useConsole()
  // Without “Assign callbacks”: their own, and ones nobody has yet.
  const frontDesk = pageAccess(access, 'callbacks') === 'own'
  const load = useCallback(async () => {
    const [callbacks, members] = await Promise.all([client.listCallbacks(org.orgSlug), client.listMembers(org.orgSlug)])
    // Only people who handle calls can be given one.
    return { callbacks, members: members.filter((m) => m.status === 'active' && m.role !== 'viewer') }
  }, [client, org.orgSlug])
  const [lib, reload, setLib] = useAsync(load)
  const [show, setShow] = useState<Show>('open')
  const [whose, setWhose] = useState<Whose>('all')
  const [logging, setLogging] = useState<Callback | null>(null)
  const [note, say] = useAnnouncer()
  const now = useNow(30000)
  const listHeading = useRef<HTMLHeadingElement>(null)

  const all = lib.state === 'ready' ? lib.data.callbacks : []
  const mine = (c: Callback) => c.assignedTo?.id === user.id
  const inWhose = (c: Callback, w: Whose) => w === 'all' || (w === 'mine' ? mine(c) : !c.assignedTo)
  const shown = all
    .filter((c) => c.status === show && inWhose(c, whose))
    // Overdue first, then soonest due.
    .sort((a, b) => a.dueBy.localeCompare(b.dueBy))

  /** Replace one in the list from the server's copy, and say what happened. */
  const changed = (c: Callback, text: string) => {
    setLib((r) => (r.state === 'ready' ? { ...r, data: { ...r.data, callbacks: r.data.callbacks.map((x) => (x.id === c.id ? c : x)) } } : r))
    say(text)
  }

  return (
    <ConsolePage
      kicker="Operate"
      title="Callbacks"
      docTitle="Callbacks"
      lede={<p>Missed calls and callers who asked to be called back. {frontDesk ? 'You see yours, and ones nobody has taken yet.' : 'Give each to someone on the team.'}</p>}
    >
      <p className="sr-only" role="status">
        {note}
      </p>
      {lib.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading callbacks…</span>
        </div>
      )}
      {lib.state === 'error' && (
        <Alert tone="error" title="Couldn't load callbacks">
          <p>{asAuthError(lib.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {lib.state === 'ready' && (
        <>
          <div className="list-tools">
            <SegFilter<Show>
              legend="Show"
              value={show}
              onChange={setShow}
              options={(Object.keys(SHOW_LABEL) as Show[]).map((s) => ({ value: s, label: SHOW_LABEL[s], count: all.filter((c) => c.status === s && inWhose(c, whose)).length }))}
            />
            <SegFilter<Whose>
              legend="Whose"
              value={whose}
              onChange={setWhose}
              options={(Object.keys(WHOSE_LABEL) as Whose[]).map((w) => ({ value: w, label: WHOSE_LABEL[w], count: all.filter((c) => c.status === show && inWhose(c, w)).length }))}
            />
          </div>
          <h2 className="op-section__title op-list-head" ref={listHeading} tabIndex={-1}>
            {SHOW_LABEL[show]}, {WHOSE_LABEL[whose].toLowerCase()} <span className="op-count">{shown.length}</span>
          </h2>
          {shown.length === 0 ? (
            <p className="empty-note">{show === 'open' ? 'Nobody to call back. Missed calls and requests appear here.' : 'None here.'}</p>
          ) : (
            <ul className="op-cards" aria-label="Callbacks">
              {shown.map((c) => (
                <CallbackCard
                  key={c.id}
                  callback={c}
                  now={now}
                  members={lib.data.members}
                  frontDesk={frontDesk}
                  meId={user.id}
                  onChanged={(next, text) => {
                    changed(next, text)
                    // It may leave this view (done, or taken by someone else).
                    if (next.status !== show || !inWhose(next, whose)) requestAnimationFrame(() => listHeading.current?.focus())
                  }}
                  onLog={() => setLogging(c)}
                />
              ))}
            </ul>
          )}
        </>
      )}
      <LogDialog
        orgSlug={org.orgSlug}
        callback={logging}
        onClose={() => setLogging(null)}
        onLogged={(c, text) => {
          setLogging(null)
          changed(c, text)
          if (c.status !== show) requestAnimationFrame(() => listHeading.current?.focus())
        }}
      />
    </ConsolePage>
  )
}

function CallbackCard({
  callback: c,
  now,
  members,
  frontDesk,
  meId,
  onChanged,
  onLog,
}: {
  callback: Callback
  now: number
  members: Member[]
  frontDesk: boolean
  meId: string
  onChanged(c: Callback, text: string): void
  onLog(): void
}) {
  const client = useConsole()
  const { org } = useOrg()
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Chosen in the list, saved with Assign: arrowing through the list
   * mustn't hand it to each person in turn. */
  const [pick, setPick] = useState(c.assignedTo?.id ?? '')
  const heading = useRef<HTMLHeadingElement>(null)
  const overdue = c.status === 'open' && Date.parse(c.dueBy) < now

  async function update(patch: Parameters<typeof client.updateCallback>[2], text: string) {
    setBusy(true)
    setError(null)
    try {
      onChanged(await client.updateCallback(org.orgSlug, c.id, patch), text)
      // The button that was pressed may be gone ("Take it"): focus the card.
      requestAnimationFrame(() => heading.current?.isConnected && heading.current.focus())
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`op-card${overdue ? ' op-card--flag' : ''}`} aria-labelledby={`${id}-h`}>
      <div className="op-card__head">
        <h3 className="op-card__title" id={`${id}-h`} ref={heading} tabIndex={-1}>
          {c.callerName ?? 'Unknown caller'}{' '}
          <a className="op-card__phone" href={`tel:${c.callerPhone.replace(/\s/g, '')}`}>
            {c.callerPhone}
          </a>
        </h3>
        <span className={`op-card__time${overdue ? ' op-card__time--late' : ''}`}>
          {c.status === 'open' ? (overdue ? `Overdue by ${since(c.dueBy, now)}` : `Due by ${timeOfDay(c.dueBy)}${new Date(c.dueBy).toDateString() === new Date(now).toDateString() ? '' : `, ${shortDate(c.dueBy)}`}`) : null}
        </span>
      </div>
      <p className="op-card__summary">{c.reason}</p>
      <p className="row__meta">
        Asked {since(c.requestedAt, now)} ago
        {c.attempts > 0 && (
          <>
            {' '}
            <i aria-hidden="true">·</i> tried {c.attempts} {c.attempts === 1 ? 'time' : 'times'}
          </>
        )}
      </p>
      {c.notes.length > 0 && (
        <ul className="op-notes" aria-label="Notes">
          {c.notes.map((n) => (
            <li key={n.id}>
              <span className="op-notes__by">
                {n.by}, {timeOfDay(n.at)}:
              </span>{' '}
              {n.text}
            </li>
          ))}
        </ul>
      )}

      <div className="op-card__actions">
        {frontDesk ? (
          c.assignedTo ? (
            <p className="op-card__taken">{c.assignedTo.id === meId ? 'Yours' : `With ${c.assignedTo.name}`}</p>
          ) : (
            <Button variant="line" size="sm" busy={busy} busyLabel="Taking…" onClick={() => void update({ assignedTo: meId }, 'It’s yours now.')}>
              Take it
            </Button>
          )
        ) : (
          <form
            className="op-assign"
            onSubmit={(e) => {
              e.preventDefault()
              if (busy || pick === (c.assignedTo?.id ?? '')) return
              const m = members.find((x) => x.id === pick)
              void update({ assignedTo: pick || null }, m ? `Given to ${m.name}.` : 'Unassigned.')
            }}
          >
            <SelectField
              label="Who calls back"
              value={pick}
              options={[{ value: '', label: 'Nobody yet' }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
              onChange={(e) => setPick(e.target.value)}
            />
            <Button type="submit" variant="line" size="sm" aria-disabled={busy || pick === (c.assignedTo?.id ?? '') || undefined}>
              {busy ? 'Saving…' : 'Assign'}
            </Button>
          </form>
        )}
        {c.status === 'open' ? (
          <Button variant="plum" size="sm" onClick={onLog} aria-label={`Log a call to ${c.callerName ?? c.callerPhone}`}>
            Log a call
          </Button>
        ) : (
          <Button variant="line" size="sm" busy={busy} busyLabel="Opening…" onClick={() => void update({ reopen: true }, 'Back on the list to call.')}>
            Open again
          </Button>
        )}
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

/** Record a try at calling back: reached them, or no answer, with a note. */
function LogDialog({ orgSlug, callback, onClose, onLogged }: { orgSlug: string; callback: Callback | null; onClose(): void; onLogged(c: Callback, text: string): void }) {
  const client = useConsole()
  const [result, setResult] = useState<'reached' | 'no_answer'>('reached')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!callback) return
    setResult('reached')
    setText('')
    setError(null)
  }, [callback])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!callback) return
    setBusy(true)
    setError(null)
    try {
      const c = await client.updateCallback(orgSlug, callback.id, { attempt: result, note: text })
      onLogged(c, result === 'reached' ? 'Marked done.' : c.status === 'unreachable' ? 'Third try with no answer: moved to Couldn’t reach.' : 'No answer logged. It stays on the list.')
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!callback} title={`Call ${callback?.callerName ?? callback?.callerPhone ?? 'the caller'}`} onClose={() => !busy && onClose()}>
      <form className="op-form" onSubmit={save} noValidate>
        <p>
          <a className="link" href={`tel:${callback?.callerPhone.replace(/\s/g, '')}`}>
            {callback?.callerPhone}
          </a>{' '}
          <span className="row__meta">{callback?.reason}</span>
        </p>
        <ChoiceGroup<'reached' | 'no_answer'>
          legend="How did it go?"
          type="radio"
          columns={2}
          options={[
            { value: 'reached', label: 'Reached them', hint: 'Done: it leaves the list.' },
            { value: 'no_answer', label: 'No answer', hint: `Stays on the list. After 3 tries it moves to “Couldn’t reach”.` },
          ]}
          value={[result]}
          onChange={([v]) => setResult(v)}
        />
        <TextAreaField label="Note" hint="Optional. Your team sees it." rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…">
            Save
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
