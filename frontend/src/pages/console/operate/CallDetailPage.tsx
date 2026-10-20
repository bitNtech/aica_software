import { useCallback, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { can, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { CallNote, CallRecord } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { TextAreaField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { seconds, TranscriptView } from '../calls/TranscriptDialog'
import { FlagAnswerButton } from './FlagAnswer'
import { clock, duration, languageName, OUTCOME_LABEL, SENTIMENT_LABEL, timeOfDay } from './shared'
import { useAnnouncer } from './LiveBits'
import './Operate.css'

/** /o/:slug/calls/:callId: one call, in full. */
export default function CallDetailPage() {
  const { callId = '' } = useParams()
  const { org, access, base } = useOrg()
  const client = useConsole()
  const load = useCallback(() => client.getCallRecord(org.orgSlug, callId), [client, org.orgSlug, callId])
  const [call, reload, setCall] = useAsync(load)
  const back = (
    <Link className="op-crumb" to={`${base}/calls`}>
      {pageAccess(access, 'calls') === 'own' ? 'Calls you handled' : 'Call history'}
    </Link>
  )

  if (call.state !== 'ready') {
    return (
      <ConsolePage section="calls" kicker={back} title="Call" docTitle="Call">
        {call.state === 'loading' ? (
          <div className="loading-row" role="status">
            <Spinner />
            <span>Loading the call…</span>
          </div>
        ) : (
          <Alert tone="error" title="Couldn't open this call">
            <p>{asAuthError(call.error).message}</p>
            <p className="builder__alert-actions">
              <button type="button" className="btn-text" onClick={reload}>
                Try again
              </button>
              <Link className="link" to={`${base}/calls`}>
                Back to the calls
              </Link>
            </p>
          </Alert>
        )}
      </ConsolePage>
    )
  }

  const c = call.data
  // Viewers read the call without the caller's personal details.
  const redact = !can(access, 'call.personal')
  const started = new Date(c.startedAt)

  return (
    <ConsolePage
      section="calls"
      kicker={back}
      title={redact ? 'A caller' : (c.callerName ?? c.callerPhone)}
      docTitle={`Call at ${timeOfDay(c.startedAt)}`}
      actions={<span className={`status-chip status-chip--out-${c.outcome}`}>{OUTCOME_LABEL[c.outcome]}</span>}
      lede={
        <p>
          {started.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} <i aria-hidden="true">·</i> {duration(c.durationSec)} long{' '}
          <i aria-hidden="true">·</i> {c.agentName} on {c.line} <i aria-hidden="true">·</i> {languageName(c.language)}
          {c.handledBy && (
            <>
              {' '}
              <i aria-hidden="true">·</i> taken by {c.handledBy}
            </>
          )}
        </p>
      }
    >
      <div className="op-detail">
        <div className="op-detail__main">
          <Section title="What happened">
            <p className="op-card__summary">{redact && c.callerName ? c.summary.split(c.callerName).join('A caller') : c.summary}</p>
          </Section>

          <Section title="After the call">
            <dl className="op-facts">
              <div>
                <dt>Outcome</dt>
                <dd>
                  <span className={`flag${c.analysis.success ? ' flag--ok' : ' flag--warn'}`}>{c.analysis.success ? 'Successful' : 'Not successful'}</span>{' '}
                  <span className="row__meta">{c.analysis.successReason}</span>
                </dd>
              </div>
              <div>
                <dt>How the caller sounded</dt>
                <dd>{SENTIMENT_LABEL[c.analysis.sentiment]}</dd>
              </div>
              {c.analysis.fields.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="The conversation">
            {redact && <p className="transcript__note">Personal details are hidden.</p>}
            <TranscriptView transcript={{ callId: c.id, turns: c.transcript }} redact={redact} />
          </Section>

          <Recording call={c} />
          <Notes
            call={c}
            canAdd={can(access, 'call.notes')}
            onAdded={(n) => setCall((r) => (r.state === 'ready' ? { ...r, data: { ...r.data, notes: [...r.data.notes, n] } } : r))}
          />
          {access.role !== 'viewer' && (
            <Section title="Something wrong?">
              <p className="row__meta">If the agent said something wrong, flag it. Whoever looks after the agent sees it on the Bot desk.</p>
              <FlagAnswerButton callId={c.id} agentName={c.agentName} />
            </Section>
          )}
        </div>

        <aside className="op-detail__side" aria-label="Call details">
          <Section title="Path through the flow">
            <ol className="op-path">
              {c.path.map((step, i) => (
                <li key={step + i}>{step}</li>
              ))}
            </ol>
          </Section>

          <Section title="Details collected">
            {c.details.length === 0 ? (
              <p className="row__meta">None.</p>
            ) : (
              <dl className="op-facts op-facts--stack">
                {c.details.map((d) => (
                  <div key={d.label}>
                    <dt>{d.label}</dt>
                    <dd>{redact && d.personal ? 'Hidden' : d.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section title="Tools used">
            {c.toolCalls.length === 0 ? (
              <p className="row__meta">None.</p>
            ) : (
              <ul className="op-tools">
                {c.toolCalls.map((t) => (
                  <li key={t.name + t.at}>
                    <span className={`flag${t.ok ? '' : ' flag--warn'}`}>{t.ok ? 'Worked' : 'Failed'}</span> <strong>{t.name}</strong> <span className="row__meta">at {clock(t.at)}</span>
                    <p className="row__meta">{t.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Response times">
            <dl className="op-facts op-facts--stack">
              <div>
                <dt>First words</dt>
                <dd>{seconds(c.metrics.firstWordMs)} after answering</dd>
              </div>
              <div>
                <dt>Typical reply</dt>
                <dd>
                  {seconds(c.metrics.replyP50Ms)} <span className="row__meta">(slowest {seconds(c.metrics.replyP95Ms)})</span>
                </dd>
              </div>
              <div>
                <dt>Where the wait went</dt>
                <dd>
                  Hearing {seconds(c.metrics.speechMs)} · thinking {seconds(c.metrics.languageMs)} · speaking {seconds(c.metrics.voiceMs)}
                </dd>
              </div>
              <div>
                <dt>Caller cut in</dt>
                <dd>{c.metrics.interruptions === 0 ? 'Never' : c.metrics.interruptions === 1 ? 'Once' : `${c.metrics.interruptions} times`}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Knowledge used">{c.knowledgeUsed.length === 0 ? <p className="row__meta">None.</p> : <p>{c.knowledgeUsed.join(', ')}</p>}</Section>
        </aside>
      </div>
    </ConsolePage>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="op-detail__section" aria-labelledby={id}>
      <h2 id={id} className="op-detail__title">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Recording({ call }: { call: CallRecord }) {
  const { access, user } = useOrg()
  const client = useConsole()
  // Front desk only for calls they handled: the server checks that; here
  // they can only open those anyway.
  const allowed = can(access, 'call.playRecording') && (access.perms.has('calls.recordings') || call.handledById === user.id)
  return (
    <Section title="Recording">
      {!allowed ? (
        <p className="row__meta">You can play recordings of the calls you handled. Ask an owner or admin for more.</p>
      ) : (client.isDemo && !client.isLive?.('calls')) || !call.hasRecording ? (
        <div className="op-unavailable">
          <p>{client.isDemo && !client.isLive?.('calls') ? 'The demo has no recordings: real calls play here.' : call.hasRecording ? 'Playing recordings isn’t available yet.' : 'There’s no recording of this call.'}</p>
        </div>
      ) : null}
    </Section>
  )
}

function Notes({ call, canAdd, onAdded }: { call: CallRecord; canAdd: boolean; onAdded(n: CallNote): void }) {
  const { org } = useOrg()
  const client = useConsole()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [said, say] = useAnnouncer()
  const field = useRef<HTMLTextAreaElement>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) {
      setError('Write the note first.')
      field.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      onAdded(await client.addCallNote(org.orgSlug, call.id, text))
      setText('')
      say('Note added.')
    } catch (err) {
      setError(asAuthError(err).message)
      field.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Notes">
      <p className="sr-only" role="status">
        {said}
      </p>
      {call.notes.length === 0 ? (
        <p className="row__meta">No notes yet.</p>
      ) : (
        <ul className="op-notes">
          {call.notes.map((n) => (
            <li key={n.id}>
              <span className="op-notes__by">
                {n.by}, {new Date(n.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}:
              </span>{' '}
              {n.text}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form className="op-form" onSubmit={add} noValidate>
          <TextAreaField ref={field} label="Add a note" hint="For your team, e.g. what you told the caller." rows={3} maxLength={1000} value={text} error={error} onChange={(e) => setText(e.target.value)} />
          <div>
            <Button type="submit" variant="line" size="sm" busy={busy} busyLabel="Adding…">
              Add note
            </Button>
          </div>
        </form>
      )}
    </Section>
  )
}
