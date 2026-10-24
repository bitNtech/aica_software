import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { AnswerFlag, Desk } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { StatusPill } from '../../../../components/console/StatusPill'
import { useToast } from '../../../../components/console/Toast'
import { Toolbar, type FilterChip } from '../../../../components/console/Toolbar'
import { Button } from '../../../../components/ui/Button'
import { SelectField, TextField } from '../../../../components/ui/Field'
import { Spinner } from '../../../../components/ui/Spinner'
import { Tabs } from '../../../../components/ui/Tabs'
import { timeAgo } from '../../../../lib/time'
import { useAsync } from '../../../../lib/useAsync'
import { FlagAnswerButton } from '../FlagAnswer'
import type { Say } from './LineBoard'
import { agentIdFor, excerptFor, faqDraft, filterFlags, flagAgents, flagCounts, NO_FLAG_FILTER, type FlagFilter, type FlagTab } from './logic'

const SPEAKER = { caller: 'Caller', agent: 'Agent', staff: 'Staff' } as const

/** What each person on this page may do with a flag, from their access. */
export interface FlagPowers {
  /** Mark fixed, dismiss, reopen. */
  resolve: boolean
  /** Add the question to the FAQ: they can edit Knowledge. */
  faq: boolean
  /** Ask bitNtech for a flow change: they can make requests. */
  ask: boolean
  /** Open the call a flag came from. */
  calls: boolean
}

/**
 * Answers an agent got wrong, to triage: Open, Fixed and Dismissed with
 * counts, a search and an agent filter. Each flag says what went wrong, who
 * flagged it and when, and shows the part of the call it came from. Whoever
 * looks after the agents marks it fixed (with what they changed) or
 * dismisses it, and can bring one back; those changes can be undone from the
 * toast. "Add to FAQ" and "Ask bitNtech" go to the page where it's fixed.
 */
export function FlagsTriage({
  desk,
  powers,
  searchRef,
  onDesk,
  onFlagged,
  say,
}: {
  desk: Desk
  powers: FlagPowers
  searchRef: RefObject<HTMLInputElement | null>
  onDesk(d: Desk): void
  onFlagged(): void
  say: Say
}) {
  const id = useId()
  const [tab, setTab] = useState<FlagTab>('open')
  const [filter, setFilter] = useState<FlagFilter>(NO_FLAG_FILTER)
  const counts = useMemo(() => flagCounts(desk.flags), [desk.flags])
  const agents = useMemo(() => flagAgents(desk.flags, desk.lines), [desk.flags, desk.lines])
  const shown = useMemo(() => filterFlags(desk.flags, tab, filter), [desk.flags, tab, filter])
  const filtering = filter.text.trim() !== '' || filter.agent !== ''
  const chips: FilterChip[] = [
    ...(filter.text.trim() ? [{ id: 'text', label: `Search: ${filter.text.trim()}`, onRemove: () => setFilter((f) => ({ ...f, text: '' })) }] : []),
    ...(filter.agent ? [{ id: 'agent', label: `Agent: ${agents.find((a) => a.value === filter.agent)?.label ?? filter.agent}`, onRemove: () => setFilter((f) => ({ ...f, agent: '' })) }] : []),
  ]
  const label: Record<FlagTab, string> = { open: 'Open', fixed: 'Fixed', dismissed: 'Dismissed' }

  return (
    <section className="desk-panel desk-flags" aria-labelledby={`${id}-f`}>
      <div className="op-section__head">
        <h2 id={`${id}-f`} className="op-section__title">
          Flagged answers
        </h2>
        <FlagAnswerButton callId={null} agentName={null} onFlagged={onFlagged} />
      </div>
      <p className="row__meta">Answers an agent got wrong. {powers.resolve ? 'Fix the knowledge (or ask bitNtech to change the flow), then mark it fixed.' : 'Whoever looks after the agents fixes them.'}</p>
      <Toolbar
        label="Filter the flagged answers"
        sticky={false}
        search={<TextField ref={searchRef} label="Search flagged answers" type="search" value={filter.text} placeholder="What it said, who flagged it" onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))} />}
        filters={<SelectField label="Agent" value={filter.agent} options={agents} onChange={(e) => setFilter((f) => ({ ...f, agent: e.target.value }))} />}
        summary={filtering ? `${shown.length} of ${counts[tab]} shown` : undefined}
        chips={chips}
        onClearAll={() => setFilter(NO_FLAG_FILTER)}
      />
      <Tabs<FlagTab>
        label="Flagged answers by state"
        value={tab}
        onChange={setTab}
        tabs={(Object.keys(label) as FlagTab[]).map((k) => ({
          key: k,
          label: (
            <>
              {label[k]} <span className="num desk-flags__count">{counts[k]}</span>
            </>
          ),
        }))}
      >
        {shown.length === 0 ? (
          <p className="empty-note">
            {filtering && counts[tab] > 0 ? (
              <>
                No {label[tab].toLowerCase()} answers match.{' '}
                <button type="button" className="btn-text" onClick={() => setFilter(NO_FLAG_FILTER)}>
                  Clear the filters
                </button>
              </>
            ) : tab === 'open' ? (
              'Nothing flagged.'
            ) : (
              `Nothing ${tab} lately. The desk keeps the last few that were dealt with.`
            )}
          </p>
        ) : (
          <ul className="desk-flaglist" aria-label={`${label[tab]} flagged answers`}>
            {shown.map((f) => (
              <FlagCard key={f.id} flag={f} desk={desk} powers={powers} onDesk={onDesk} say={say} />
            ))}
          </ul>
        )}
      </Tabs>
    </section>
  )
}

function FlagCard({ flag: f, desk, powers, onDesk, say }: { flag: AnswerFlag; desk: Desk; powers: FlagPowers; onDesk(d: Desk): void; say: Say }) {
  const { org } = useOrg()
  const client = useConsole()
  const toast = useToast()
  const [mode, setMode] = useState<'fixed' | 'dismissed' | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const open = f.status === 'open'
  const agentId = agentIdFor(f, desk.lines)

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
      onDesk(await client.resolveFlag(org.orgSlug, f.id, { status: mode, note }))
      const words = mode === 'fixed' ? 'Marked fixed.' : 'Dismissed.'
      say(words)
      toast.show({
        message: words,
        tone: 'ok',
        action: {
          label: 'Undo',
          onClick: () =>
            void client.resolveFlag(org.orgSlug, f.id, { status: 'open', note: '' }).then(
              (back) => {
                onDesk(back)
                toast.show({ message: 'Back in Open.', tone: 'ok' })
              },
              (err) => toast.show({ message: asAuthError(err).message, tone: 'danger' }),
            ),
        },
      })
    } catch (err) {
      setError(asAuthError(err).message)
      setBusy(false)
    }
  }

  async function reopen() {
    setBusy(true)
    setError(null)
    try {
      onDesk(await client.resolveFlag(org.orgSlug, f.id, { status: 'open', note: '' }))
      say('Reopened.')
    } catch (err) {
      setError(asAuthError(err).message)
      setBusy(false)
    }
  }

  async function copyFaq() {
    const text = faqDraft(f, question)
    try {
      await navigator.clipboard.writeText(text)
      toast.show({ message: 'Copied the question and answer. Paste them into a new FAQ in Knowledge.', tone: 'ok' })
    } catch {
      toast.show({ message: 'Couldn’t copy it. Add the FAQ in Knowledge by hand.', tone: 'warn' })
    }
  }

  return (
    <li className={`desk-flag desk-flag--${f.status}`}>
      <div className="desk-flag__head">
        <strong>{f.agentName ?? 'An agent'}</strong>
        <StatusPill tone={open ? 'warn' : f.status === 'fixed' ? 'ok' : 'neutral'}>{open ? 'Open' : f.status === 'fixed' ? 'Fixed' : 'Dismissed'}</StatusPill>
        <span className="row__meta">
          Flagged by {f.by}, {timeAgo(f.at)}
        </span>
      </div>
      <p className="desk-flag__said">
        <span className="desk-flag__label">What it got wrong</span> {f.text}
      </p>
      {f.correction && (
        <p className="desk-flag__should">
          <span className="desk-flag__label">Should be</span> {f.correction}
        </p>
      )}
      {!open && f.resolution && (
        <p className="row__meta">
          {f.status === 'fixed' ? 'Fixed' : 'Dismissed'} by {f.resolution.by}, {timeAgo(f.resolution.at)}
          {f.resolution.note && `: ${f.resolution.note}`}
        </p>
      )}
      {f.callId ? powers.calls ? <CallExcerpt callId={f.callId} flagText={f.text} auto={open} onQuestion={setQuestion} /> : <p className="row__meta">Flagged on a call you can’t open.</p> : <p className="row__meta">Flagged from the desk: no call is attached.</p>}

      {open && (powers.faq || powers.ask) && !mode && (
        <div className="desk-flag__links">
          {powers.faq && (
            <Link to={`/o/${org.orgSlug}/knowledge`} className="btn-text" onClick={() => void copyFaq()}>
              Add to FAQ
            </Link>
          )}
          {powers.ask && (
            <Link to={`/o/${org.orgSlug}/requests?new=flow_change${agentId ? `&agent=${encodeURIComponent(agentId)}` : ''}`} className="btn-text">
              Ask bitNtech
            </Link>
          )}
        </div>
      )}
      {error && !mode && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {powers.resolve &&
        (open ? (
          mode ? (
            <form className="op-form desk__resolve" onSubmit={(e) => void submit(e)} noValidate>
              <TextField ref={field} label={mode === 'fixed' ? 'What you changed' : 'Why it’s not a problem (optional)'} maxLength={300} value={note} error={error} autoFocus onChange={(e) => setNote(e.target.value)} />
              <div className="desk-flag__actions">
                <Button type="submit" variant="line" size="sm" busy={busy} busyLabel="Saving…">
                  {mode === 'fixed' ? 'Mark fixed' : 'Dismiss'}
                </Button>
                <button type="button" className="btn-text" onClick={() => (setMode(null), setError(null))}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="desk-flag__actions">
              <Button variant="line" size="sm" onClick={() => setMode('fixed')}>
                Mark fixed
              </Button>
              <button type="button" className="btn-text" onClick={() => setMode('dismissed')}>
                Dismiss
              </button>
            </div>
          )
        ) : (
          <div className="desk-flag__actions">
            <Button variant="line" size="sm" busy={busy} busyLabel="Reopening…" onClick={() => void reopen()}>
              Reopen
            </Button>
          </div>
        ))}
    </li>
  )
}

/** The part of the call a flag is about. Open flags read it straight away; the others on request. */
function CallExcerpt({ callId, flagText, auto, onQuestion }: { callId: string; flagText: string; auto: boolean; onQuestion(q: string | null): void }) {
  const { org } = useOrg()
  const [shown, setShown] = useState(auto)
  const id = useId()
  return (
    <div className="desk-flag__call">
      {!auto && (
        <button type="button" className="btn-text" aria-expanded={shown} aria-controls={`${id}-x`} onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide what was said' : 'Show what was said'}
        </button>
      )}
      <div id={`${id}-x`}>{shown && <Loaded callId={callId} flagText={flagText} slug={org.orgSlug} onQuestion={onQuestion} />}</div>
    </div>
  )
}

function Loaded({ callId, flagText, slug, onQuestion }: { callId: string; flagText: string; slug: string; onQuestion(q: string | null): void }) {
  const client = useConsole()
  const load = useMemo(() => () => client.getCallRecord(slug, callId), [client, slug, callId])
  const [rec, reload] = useAsync(load)
  const excerpt = useMemo(() => (rec.state === 'ready' ? excerptFor(rec.data.transcript, flagText) : null), [rec, flagText])
  useEffect(() => {
    if (excerpt) onQuestion(excerpt.question)
  }, [excerpt, onQuestion])

  if (rec.state === 'loading')
    return (
      <p className="loading-row row__meta" role="status">
        <Spinner />
        <span>Reading the call…</span>
      </p>
    )
  if (rec.state === 'error')
    return (
      <p className="row__meta" role="status">
        Couldn’t read the call: {asAuthError(rec.error).message}{' '}
        <button type="button" className="btn-text" onClick={reload}>
          Try again
        </button>
      </p>
    )
  if (!excerpt || excerpt.turns.length === 0)
    return (
      <p className="row__meta">
        The call has no transcript. <Link to={`/o/${slug}/calls/${callId}`}>Open the call</Link>
      </p>
    )
  return (
    <figure className="desk-flag__excerpt">
      <figcaption className="row__meta">{excerpt.matched ? 'From the call, around the answer that was flagged:' : 'Couldn’t tell which reply this is about, so this is how the call started:'}</figcaption>
      <ol className="desk-flag__turns" aria-label="Part of the call">
        {excerpt.turns.map((t, i) => (
          <li key={i} className={`desk-flag__turn desk-flag__turn--${t.speaker}`}>
            <strong>{SPEAKER[t.speaker]}</strong> {t.text}
          </li>
        ))}
      </ol>
      <p className="row__meta">
        <Link to={`/o/${slug}/calls/${callId}`}>Open the whole call</Link>
      </p>
    </figure>
  )
}
