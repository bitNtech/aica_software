import { useCallback, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { can, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { useShortcuts } from '../../../components/console/KeyboardHelp'
import { Skeleton } from '../../../components/console/Skeleton'
import { Alert } from '../../../components/ui/Alert'
import { useAsync } from '../../../lib/useAsync'
import { seconds } from '../calls/TranscriptDialog'
import { FlagAnswerButton } from './FlagAnswer'
import { useAnnouncer } from './LiveBits'
import { Notes, Recording, Section } from './calls/detail/parts'
import { turnForStep } from './calls/detail/logic'
import { PathPanel, type PathPanelHandle } from './calls/detail/PathPanel'
import { ToolTimeline } from './calls/detail/ToolTimeline'
import { TranscriptPanel, type TranscriptPanelHandle, type TurnTarget } from './calls/detail/TranscriptPanel'
import { OutcomePill, SentimentTag, SuccessTag } from './calls/parts'
import { useDesignedFlow } from './calls/useDesignedFlow'
import { clock, duration, languageName, timeOfDay } from './shared'
import './Operate.css'
import './calls/Calls.css'

/**
 * /o/:slug/calls/:callId: one call, in full. The conversation is the main
 * column, with a search; beside it the call's path drawn on the agent's
 * designed flow (a step jumps to that moment of the conversation), what was
 * collected and how the call ended, the tools used on a timeline, response
 * times, the recording, notes and a way to flag a wrong answer. One column
 * on a phone, with the path before the conversation.
 */
export default function CallDetailPage() {
  const { callId = '' } = useParams()
  const { org, access, base } = useOrg()
  const client = useConsole()
  const load = useCallback(() => client.getCallRecord(org.orgSlug, callId), [client, org.orgSlug, callId])
  const [call, reload, setCall] = useAsync(load)
  const c = call.state === 'ready' ? call.data : null
  const designed = useDesignedFlow(c ? c.agentId : null)

  const [target, setTarget] = useState<TurnTarget | null>(null)
  const [activeStep, setActiveStep] = useState<number | null>(null)
  const [said, say] = useAnnouncer(10_000)
  const seq = useRef(0)
  const path = useRef<PathPanelHandle>(null)
  const transcript = useRef<TranscriptPanelHandle>(null)

  useShortcuts({
    '/': { description: 'Search the conversation', run: () => transcript.current?.focusSearch() },
    f: { description: 'Move to the path diagram', run: () => path.current?.focusFlow() },
  })

  const back = (
    <Link className="op-crumb" to={`${base}/calls`}>
      {pageAccess(access, 'calls') === 'own' ? 'Calls you handled' : 'Call history'}
    </Link>
  )

  if (call.state !== 'ready') {
    return (
      <ConsolePage section="calls" kicker={back} title="Call" docTitle="Call">
        {call.state === 'loading' ? (
          <div className="cd-loading" role="status" aria-busy="true">
            <span className="sr-only">Loading the call…</span>
            <Skeleton lines={3} />
            <Skeleton block height="12rem" />
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

  const rec = call.data
  // Viewers read the call without the caller's personal details.
  const redact = !can(access, 'call.personal')
  const started = new Date(rec.startedAt)

  /** A step of the path was picked: show the moment it belongs to. */
  function jumpToStep(index: number) {
    const turn = turnForStep(index, rec.path.length, rec.transcript)
    setActiveStep(index)
    if (turn === null) {
      say('There’s no agent turn to match this step to.')
      return
    }
    const label = `Near step: ${rec.path[index]}`
    seq.current += 1
    setTarget({ turn, seq: seq.current, label })
    say(`Jumped to the agent’s turn at ${clock(rec.transcript[turn].at)}, near the step “${rec.path[index]}”. The match is approximate: steps are placed along the conversation by order.`)
  }

  return (
    <ConsolePage
      section="calls"
      kicker={back}
      title={redact ? 'A caller' : (rec.callerName ?? rec.callerPhone)}
      docTitle={`Call at ${timeOfDay(rec.startedAt)}`}
      actions={<OutcomePill outcome={rec.outcome} />}
      lede={
        <p>
          {started.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} <i aria-hidden="true">·</i> {duration(rec.durationSec)} long{' '}
          <i aria-hidden="true">·</i> {rec.agentName} on {rec.line} <i aria-hidden="true">·</i> {languageName(rec.language)}
          {rec.handledBy && (
            <>
              {' '}
              <i aria-hidden="true">·</i> taken by {rec.handledBy}
            </>
          )}
        </p>
      }
    >
      <p className="sr-only" role="status">
        {said}
      </p>
      <div className="cd">
        <div className="cd__main">
          <Section title="What happened" className="cd-o1">
            <p className="op-card__summary">{redact && rec.callerName ? rec.summary.split(rec.callerName).join('A caller') : rec.summary}</p>
          </Section>

          <Section title="The conversation" className="cd-o3">
            {redact && <p className="transcript__note">Personal details are hidden.</p>}
            {said && (
              <p className="cd__jump" aria-hidden="true">
                {said}
              </p>
            )}
            <TranscriptPanel ref={transcript} turns={rec.transcript} redact={redact} target={target} />
          </Section>
        </div>

        <div className="cd__side">
          <PathPanel
            ref={path}
            call={rec}
            designed={designed}
            activeStep={activeStep}
            onStep={jumpToStep}
            onOffPath={(label) => say(`“${label}” isn’t on this call’s path.`)}
          />

          <Section title="After the call" className="cd-o4">
            <dl className="op-facts op-facts--stack">
              <div>
                <dt>Outcome</dt>
                <dd>
                  <SuccessTag success={rec.analysis.success} /> <span className="row__meta">{rec.analysis.successReason}</span>
                </dd>
              </div>
              <div>
                <dt>How the caller sounded</dt>
                <dd>
                  <SentimentTag sentiment={rec.analysis.sentiment} />
                </dd>
              </div>
              {rec.analysis.fields.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Details collected" className="cd-o4">
            {rec.details.length === 0 ? (
              <p className="row__meta">None.</p>
            ) : (
              <dl className="op-facts op-facts--stack">
                {rec.details.map((d) => (
                  <div key={d.label}>
                    <dt>{d.label}</dt>
                    <dd>{redact && d.personal ? 'Hidden' : d.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <div className="cd-o4">
            <ToolTimeline calls={rec.toolCalls} startedAt={rec.startedAt} />
          </div>

          <Section title="Response times" className="cd-o4">
            <dl className="op-facts op-facts--stack">
              <div>
                <dt>First words</dt>
                <dd>{seconds(rec.metrics.firstWordMs)} after answering</dd>
              </div>
              <div>
                <dt>Typical reply</dt>
                <dd>
                  {seconds(rec.metrics.replyP50Ms)} <span className="row__meta">(slowest {seconds(rec.metrics.replyP95Ms)})</span>
                </dd>
              </div>
              <div>
                <dt>Where the wait went</dt>
                <dd>
                  Hearing {seconds(rec.metrics.speechMs)} · thinking {seconds(rec.metrics.languageMs)} · speaking {seconds(rec.metrics.voiceMs)}
                </dd>
              </div>
              <div>
                <dt>Caller cut in</dt>
                <dd>{rec.metrics.interruptions === 0 ? 'Never' : rec.metrics.interruptions === 1 ? 'Once' : `${rec.metrics.interruptions} times`}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Knowledge used" className="cd-o4">
            {rec.knowledgeUsed.length === 0 ? <p className="row__meta">None.</p> : <p>{rec.knowledgeUsed.join(', ')}</p>}
          </Section>

          <Recording call={rec} className="cd-o5" />
          <Notes
            call={rec}
            className="cd-o5"
            canAdd={can(access, 'call.notes')}
            onAdded={(n) => setCall((r) => (r.state === 'ready' ? { ...r, data: { ...r.data, notes: [...r.data.notes, n] } } : r))}
          />
          {access.role !== 'viewer' && (
            <Section title="Something wrong?" className="cd-o5">
              <p className="row__meta">If the agent said something wrong, flag it. Whoever looks after the agent sees it on the Bot desk.</p>
              <FlagAnswerButton callId={rec.id} agentName={rec.agentName} />
            </Section>
          )}
        </div>
      </div>
    </ConsolePage>
  )
}
