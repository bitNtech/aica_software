import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { LANGUAGE_LABEL } from '../../../../auth/roles'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import { type AgentDraft, type AgentTool, type BuilderStep, type DraftSubmission, type FlowNode, type KnowledgeSource, type PhoneNumber, type SourceCall, type Voice } from '../../../../console/types'
import { defaultAnalysisSettings, specOfDraft } from '../../../../console/specDefaults'
import { AnalysisEditor, checkAnalysis } from '../../agent/tabs/AnalysisTab'
import { ChangeList } from '../../agent/ChangeList'
import { diffSpecs, type NameLookup } from '../../agent/diff'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { ConfirmDialog } from '../../../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import { Spinner } from '../../../../components/ui/Spinner'
import { useAsync } from '../../../../lib/useAsync'
import { countForks, countPaths, lowConfidence } from '../flowTree'
import { STEP_META } from '../steps'
import type { StepErrors, StepProps } from '../StepShared'
import { VoiceCallPanel } from '../../../../components/voice/VoiceCallPanel'
import { TestChat } from '../TestChat'
import { checkAttributes } from './StepAttributes'
import { checkBehaviour } from './StepBehaviour'
import { checkCalls } from './StepCalls'
import { checkContext, isExpired } from './StepContext'
import { checkFlowStep } from './StepFlow'
import { checkGlobalFlows, GLOBAL_META } from './StepGlobal'
import { checkType } from './StepType'

interface Library {
  calls: SourceCall[]
  voices: Voice[]
  tools: AgentTool[]
  knowledge: KnowledgeSource[]
}

/** Everything that blocks publishing, step by step. */
export function blockers(d: AgentDraft, lib: Library): { step: BuilderStep; errors: StepErrors }[] {
  const voice = lib.voices.find((v) => v.id === d.behaviour.voiceId)
  const all: [BuilderStep, StepErrors][] = [
    ['calls', checkCalls(d, lib.calls)],
    ['type', checkType(d)],
    ['behaviour', checkBehaviour(d.behaviour, voice)],
    ['flow', checkFlowStep(d.flow)],
    ['attributes', checkAttributes(d.attributes)],
    ['global', checkGlobalFlows(d.globalFlows)],
    ['context', checkContext(d.context, d.globalFlows, lib.tools)],
  ]
  return all.filter(([, e]) => Object.keys(e).length > 0).map(([step, errors]) => ({ step, errors }))
}

/** Worth a look, but not blocking. */
export function warnings(d: AgentDraft, lib: Library): string[] {
  const w: string[] = []
  // An intent counts if it, or any step or branch in it, is low.
  const low = d.flow.filter((n) => lowConfidence([n]).length > 0)
  if (low.length)
    w.push(
      `${low.length} ${low.length === 1 ? 'intent has' : 'intents have'} low confidence: ${low.map((n) => `“${n.label}”`).join(', ')}. Check ${low.length === 1 ? 'it' : 'them'} against the calls.`,
    )
  const collected = new Set(d.attributes.map((a) => slug(a.label)))
  const missing = [...new Set(placeholders(d.flow).filter((p) => !collected.has(slug(p)) && !BUILT_IN_SLOTS.has(slug(p).replace(/\d+$/, ''))))]
  if (missing.length)
    w.push(`The flow uses ${missing.map((p) => `{${p}}`).join(', ')}, but ${missing.length === 1 ? 'it isn’t a detail' : 'they aren’t details'} the agent collects. Add ${missing.length === 1 ? 'it' : 'them'} in Details, or reword the step.`)
  for (const k of lib.knowledge.filter((k) => d.context.knowledgeSourceIds.includes(k.id) && isExpired(k))) w.push(`The knowledge source “${k.name}” has expired. Check it’s still right.`)
  for (const t of lib.tools.filter((t) => d.context.toolIds.includes(t.id) && t.kind === 'http' && !t.lastTestedAt)) w.push(`The tool “${t.name}” hasn’t been tested yet.`)
  if (!d.globalFlows.find((g) => g.kind === 'handoff')?.enabled) w.push('Handing over to a person is off: callers can’t reach your team through this agent.')
  if (!d.redact && d.attributes.some((a) => a.personal)) w.push('Personal details show in transcripts. Turn on hiding them in step 1 unless your team needs them.')
  return w
}

/** Filled in during the call without being asked for (numbered ones too, e.g. {slot 1}). */
const BUILT_IN_SLOTS = new Set(['answer', 'hours', 'parking', 'doctor', 'department', 'slot', 'slots', 'time', 'date', 'day', 'hospital', 'organisation', 'persona', 'number', 'amount', 'status', 'test'])

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The {placeholders} the agent's lines use. */
function placeholders(nodes: FlowNode[]): string[] {
  return nodes.flatMap((n) => [...[...(n.say ?? '').matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].trim()), ...placeholders(n.children)])
}

/** What has to be there before the organisation can send its draft: the
 * rest bitNtech can finish. */
export function sendBlockers(d: AgentDraft, lib: Pick<Library, 'calls'>): { step: BuilderStep; errors: StepErrors }[] {
  const flow: StepErrors = d.flow.length === 0 ? { flow: 'Add at least one conversation the agent should handle.' } : {}
  const all: [BuilderStep, StepErrors][] = [
    ['calls', checkCalls(d, lib.calls)],
    ['type', checkType(d)],
    ['flow', flow],
  ]
  return all.filter(([, e]) => Object.keys(e).length > 0).map(([step, errors]) => ({ step, errors }))
}

/** Step 7: check everything, try it, then publish (bitNtech) or send to
 * bitNtech as a request (the organisation). */
export function StepReview({ draft, org, base: orgBase, update, validator, save, done, mode, locked }: StepProps) {
  const id = useId()
  const client = useConsole()
  const navigate = useNavigate()
  const change = !!draft.baseAgentId
  const load = useCallback(async () => {
    const [calls, voices, tools, knowledge, numbers, types, agent] = await Promise.all([
      client.listCalls(org.orgSlug),
      client.listVoices(),
      client.listTools(org.orgSlug),
      client.listKnowledge(org.orgSlug),
      client.listNumbers(org.orgSlug),
      client.listAgentTypes(),
      // What callers get now, to say what the changes are.
      draft.baseAgentId ? client.getAgent(org.orgSlug, draft.baseAgentId).catch(() => null) : Promise.resolve(null),
    ])
    return { calls, voices, tools, knowledge, numbers, types, agent }
  }, [client, org.orgSlug, draft.baseAgentId])
  const [lib, reload] = useAsync(load)
  /** Unset until chosen: defaults to a number when one is free. */
  const [choice, setChoice] = useState<'number' | 'paused' | null>(null)
  /** Numbers re-read after a failed publish (one may have been taken). */
  const [freshNumbers, setFreshNumbers] = useState<PhoneNumber[] | null>(null)
  const [numberId, setNumberId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [send, setSend] = useState<DraftSubmission>(() => ({
    title: change ? `Changes to ${draft.name.trim()}` : draft.name.trim() ? `New agent: ${draft.name.trim()}` : '',
    note: '',
    urgency: 'normal',
  }))
  const [sendErrors, setSendErrors] = useState<{ title?: string; form?: string }>({})
  const [sending, setSending] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  // There's no Next on the last step.
  validator.current = () => ({})

  if (lib.state === 'loading') {
    return (
      <div className="loading-row" role="status">
        <Spinner />
        <span>Checking everything…</span>
      </div>
    )
  }
  if (lib.state === 'error') {
    return (
      <Alert tone="error" title="Couldn't check the agent">
        <p>{asAuthError(lib.error).message}</p>
        <button type="button" className="btn-text" onClick={reload}>
          Try again
        </button>
      </Alert>
    )
  }

  const data = lib.data
  const analysis = draft.analysis ?? defaultAnalysisSettings()
  const analysisErrors = checkAnalysis(analysis)
  const blocking = [...blockers(draft, data), ...(Object.keys(analysisErrors).length ? [{ step: 'review' as const, errors: analysisErrors }] : [])]
  const mustFix = mode === 'request' ? sendBlockers(draft, data) : blocking
  const later = mode === 'request' ? blocking.filter((b) => !mustFix.some((m) => m.step === b.step)) : []
  const notes = warnings(draft, data)
  const numbers = freshNumbers ?? data.numbers
  const free = numbers.filter((n) => !n.agentId)
  const where = choice ?? (free.length ? 'number' : 'paused')
  const chosenNumber = free.find((n) => n.id === numberId)?.id ?? free[0]?.id ?? ''
  const blocked = blocking.length > 0 || (!change && where === 'number' && !free.length)
  const base = `${orgBase}/agents/drafts/${draft.id}`
  const voice = data.voices.find((v) => v.id === draft.behaviour.voiceId)
  const reason = blocking.length
    ? `Fix the ${blocking.length === 1 ? 'step' : 'steps'} listed at the top first.`
    : !change && where === 'number' && !free.length
      ? 'No free numbers: publish it paused, or add a number in Phone numbers first.'
      : null
  const type = data.types.find((t) => t.id === draft.typeId)
  const sub = type?.subTypes.find((x) => x.id === draft.subTypeId)
  const agent = data.agent?.agent ?? null
  const live = data.agent?.versions[0]
  const names: NameLookup = {
    knowledge: (k) => data.knowledge.find((x) => x.id === k)?.name ?? 'a removed source',
    tool: (t) => data.tools.find((x) => x.id === t)?.name ?? 'a removed tool',
    voice: (v) => data.voices.find((x) => x.id === v)?.name ?? v,
  }
  const changes = live ? diffSpecs(live.spec, specOfDraft(draft), names) : []

  async function publish() {
    setPublishing(true)
    setPublishError(null)
    try {
      // The server publishes its copy: save the last edits first.
      await save()
    } catch {
      setPublishError('Couldn’t save your last changes, so nothing was published. Check your connection and try again.')
      setPublishing(false)
      return
    }
    try {
      const target = !change && where === 'number' ? chosenNumber : null
      const out = await client.publishDraft(org.orgSlug, draft.id, target)
      // The draft is now an agent: nothing more to save to it.
      done()
      navigate(`${orgBase}/agents`, {
        replace: true,
        state: {
          notice: change
            ? `${out.name}: version ${out.version} is published.${draft.requestId ? ' The request is marked done.' : ''}`
            : out.phoneNumber
              ? `${out.name} is live on ${out.phoneNumber}.`
              : `${out.name} is published and paused. Give it a number to go live.`,
        },
      })
    } catch (err) {
      setPublishError(asAuthError(err).message)
      setPublishing(false)
      // A number may have been taken meanwhile: offer only free ones.
      client.listNumbers(org.orgSlug).then(setFreshNumbers, () => {})
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (mustFix.length) return
    const title = send.title.trim()
    if (title.length < 5) {
      setSendErrors({ title: 'Give the request a short title, at least 5 characters.' })
      titleRef.current?.focus()
      return
    }
    if (!client.submitDraft) {
      setSendErrors({ form: 'Sending a draft to bitNtech needs the AICA server to be updated first. Describe it in Requests instead.' })
      return
    }
    setSending(true)
    setSendErrors({})
    try {
      await save()
    } catch {
      setSendErrors({ form: 'Couldn’t save your last changes, so nothing was sent. Check your connection and try again.' })
      setSending(false)
      return
    }
    try {
      const r = await client.submitDraft(org.orgSlug, draft.id, { ...send, title, changes: changes.flatMap((c) => c.changes.map((x) => `${c.area}: ${x}`)) })
      // Sent: it's bitNtech's now, so this page saves nothing more.
      done()
      navigate(`${orgBase}/agents`, { replace: true, state: { notice: `Sent to bitNtech: “${r.title}”. Follow it in Requests.` } })
    } catch (err) {
      setSendErrors({ form: asAuthError(err).message })
      setSending(false)
    }
  }

  const summary: { step: BuilderStep; text: string }[] = [
    { step: 'calls', text: `${draft.sourceCallIds.length} calls; personal details ${draft.redact ? 'hidden' : 'shown'} in transcripts.` },
    {
      step: 'type',
      // "OPD line: appointments at a hospital", or "Appointments, at a hospital" when the name is the job.
      text: !type || !sub ? `${draft.name.trim() || 'Untitled'}.` : draft.name.trim() === sub.label ? `${sub.label}, at a ${type.label.toLowerCase()}.` : `${draft.name.trim()}: ${sub.label.toLowerCase()} at a ${type.label.toLowerCase()}.`,
    },
    {
      step: 'behaviour',
      text: `${draft.behaviour.persona}, ${draft.behaviour.tone}, speaking ${draft.behaviour.languages.map((l) => LANGUAGE_LABEL[l]).join(', ')} in ${voice?.name ?? 'no'} voice. ${draft.behaviour.rules.length} rules.`,
    },
    { step: 'flow', text: `${draft.flow.length} intents, ${countForks(draft.flow)} points where the call can go more than one way, ${countPaths(draft.flow)} ways a call can end.` },
    { step: 'attributes', text: draft.attributes.length ? draft.attributes.map((a) => a.label).join(', ') + '.' : 'Nothing to collect.' },
    {
      step: 'global',
      text: draft.globalFlows.filter((g) => g.enabled).map((g) => GLOBAL_META[g.kind].label).join(', ') + '.',
    },
    {
      step: 'context',
      text: `${draft.context.knowledgeSourceIds.length} knowledge sources${draft.context.answerOnlyFromKnowledge ? ' (answers only from them)' : ''}; ${draft.context.toolIds.length} tools.`,
    },
  ]

  const fixList = (list: { step: BuilderStep; errors: StepErrors }[]) => (
    <ul className="review__fix">
      {list.map((b) => (
        <li key={b.step}>
          <Link className="link" to={`${base}/${b.step}`}>
            {STEP_META[b.step].label}
          </Link>
          : {Object.values(b.errors).join(' ')}
        </li>
      ))}
    </ul>
  )

  return (
    <div className="step">
      {mode === 'build' ? (
        blocking.length > 0 ? (
          <Alert tone="error" title="Fix these before publishing">
            {fixList(blocking)}
          </Alert>
        ) : (
          <Alert tone="ok" title="Ready to publish">
            Everything needed is in place.
          </Alert>
        )
      ) : locked ? null : mustFix.length > 0 ? (
        <Alert tone="error" title="Fix these before sending">
          {fixList(mustFix)}
        </Alert>
      ) : (
        <>
          <Alert tone="ok" title="Ready to send to bitNtech">
            bitNtech builds it from this, tests it and publishes it for you.
          </Alert>
          {later.length > 0 && (
            <Alert tone="warn" title="bitNtech can finish these">
              <p>Fix them here if you can, or leave them for bitNtech.</p>
              {fixList(later)}
            </Alert>
          )}
        </>
      )}
      {notes.length > 0 && (
        <Alert tone="warn" title="Worth a look">
          <ul className="builder__error-list">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}

      {change && (
        <section className="step__section" aria-labelledby={`${id}-chg`}>
          <h2 id={`${id}-chg`} className="step__heading">
            What changes
          </h2>
          <p className="step__sub">{live ? `Compared with version ${live.version}, which callers get now.` : 'The agent’s current version couldn’t be read, so the changes can’t be listed.'}</p>
          {live && <ChangeList changes={changes} empty="Nothing yet: this is the agent as it is." />}
        </section>
      )}

      <section className="step__section" aria-labelledby={`${id}-sum`}>
        <h2 id={`${id}-sum`} className="step__heading">
          Summary
        </h2>
        <dl className="review__list">
          {summary.map((s) => (
            <div key={s.step} className="review__row">
              <dt>{STEP_META[s.step].label}</dt>
              <dd>{s.text}</dd>
              <dd className="review__edit">
                <Link className="link" to={`${base}/${s.step}`} aria-label={`${locked ? 'See' : 'Edit'} ${STEP_META[s.step].label}`}>
                  {locked ? 'See' : 'Edit'}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <AnalysisEditor analysis={analysis} onChange={(a) => update((d) => ({ ...d, analysis: a }))} errors={blocking.length || mustFix.length ? analysisErrors : {}} canFields />

      <section className="step__section" aria-labelledby={`${id}-test`}>
        <h2 id={`${id}-test`} className="step__heading">
          Try it
        </h2>
        <TestChat draft={draft} tools={data.tools} knowledge={data.knowledge} />
        {mode === 'build' && client.startDraftTestCall && (
          <>
            <h3 className="step__heading">Call it in your browser</h3>
            <p className="step__sub">The real agent on the voice server, built from this draft as it’s saved now. Nobody else can call it.</p>
            <VoiceCallPanel<'draft'>
              getTicket={() => client.startDraftTestCall!(org.orgSlug, draft.id)}
              getTranscript={client.getTestCallTranscript ? (callId) => client.getTestCallTranscript!(org.orgSlug, callId) : undefined}
              onBeforeStart={save}
            />
          </>
        )}
      </section>

      {mode === 'build' ? (
        <section className="step__section" aria-labelledby={`${id}-pub`}>
          <h2 id={`${id}-pub`} className="step__heading">
            {change ? `Publish to ${agent?.name ?? draft.name.trim()}` : `Publish for ${org.orgName}`}
          </h2>
          {change ? (
            <p className="step__sub">
              {agent ? `It becomes version ${(agent.version ?? 0) + 1}. ${agent.status === 'live' ? `Callers to ${agent.phoneNumber} get it straight away; version ${agent.version} stays in Versions to go back to.` : 'The agent is paused, so nobody gets it until it’s turned on.'}` : 'It becomes the agent’s next version.'}
            </p>
          ) : (
            <>
              <ChoiceGroup
                legend="When it’s published"
                type="radio"
                columns={2}
                options={[
                  { value: 'number', label: 'Answer a phone number now', hint: free.length ? 'Goes live straight away.' : 'No free numbers: add one in Phone numbers first.' },
                  { value: 'paused', label: 'Publish paused', hint: 'Ready, but not answering. Give it a number later.' },
                ]}
                value={[where]}
                onChange={([v]) => setChoice(v as 'number' | 'paused')}
              />
              {where === 'number' && free.length > 0 && (
                <div className="step__narrow">
                  <SelectField
                    label="Phone number"
                    value={chosenNumber}
                    options={free.map((n) => ({ value: n.id, label: `${n.number} (${n.label})` }))}
                    onChange={(e) => setNumberId(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
          <div>
            {/* aria-disabled keeps it focusable, so the reason below is read. */}
            <Button
              variant="orange"
              arrow
              className={blocked ? 'btn--inactive' : undefined}
              aria-disabled={blocked || undefined}
              aria-describedby={reason ? `${id}-why` : undefined}
              onClick={() => {
                if (blocked) return
                setPublishError(null)
                setConfirm(true)
              }}
            >
              {change ? 'Publish the changes' : 'Publish agent'}
            </Button>
            {reason && (
              <p className="field__hint" id={`${id}-why`}>
                {reason}
              </p>
            )}
          </div>
        </section>
      ) : locked ? (
        <section className="step__section" aria-labelledby={`${id}-sent`}>
          <h2 id={`${id}-sent`} className="step__heading">
            Sent to bitNtech
          </h2>
          <p className="step__sub">
            bitNtech is building it from here.{' '}
            <Link className="link" to={draft.requestId ? `${orgBase}/requests#${draft.requestId}` : `${orgBase}/requests`}>
              Follow the request
            </Link>
          </p>
        </section>
      ) : (
        <section className="step__section" aria-labelledby={`${id}-send`}>
          <h2 id={`${id}-send`} className="step__heading">
            Send to bitNtech
          </h2>
          <p className="step__sub">
            {change
              ? `bitNtech builds these changes, tests them, and publishes them as ${draft.name.trim()}’s next version. Callers keep the current version until then.`
              : 'bitNtech builds the agent from this, tests it, and publishes it for you. You can follow it, and reply, in Requests.'}
          </p>
          <form className="op-form review__send" onSubmit={(e) => void submit(e)} noValidate>
            <TextField
              ref={titleRef}
              label="Title"
              maxLength={120}
              value={send.title}
              error={sendErrors.title}
              onChange={(e) => {
                setSend({ ...send, title: e.target.value })
                if (sendErrors.title) setSendErrors({})
              }}
            />
            <TextAreaField
              label="A note for bitNtech"
              hint="Optional. Anything the steps don’t say: how many calls a week, when it should start, who to ask."
              rows={3}
              maxLength={800}
              value={send.note}
              onChange={(e) => setSend({ ...send, note: e.target.value })}
            />
            <div className="step__narrow">
              <SelectField
                label="How soon"
                value={send.urgency}
                options={[
                  { value: 'normal', label: 'When you can' },
                  { value: 'soon', label: 'This week' },
                  { value: 'urgent', label: 'Urgent' },
                ]}
                onChange={(e) => setSend({ ...send, urgency: e.target.value as DraftSubmission['urgency'] })}
              />
            </div>
            {sendErrors.form && (
              <p className="field__error" role="alert">
                {sendErrors.form}
              </p>
            )}
            <div>
              <Button
                type="submit"
                variant="orange"
                arrow
                busy={sending}
                busyLabel="Sending…"
                className={mustFix.length ? 'btn--inactive' : undefined}
                aria-disabled={mustFix.length > 0 || undefined}
                aria-describedby={mustFix.length ? `${id}-why-send` : undefined}
              >
                Send to bitNtech
              </Button>
              {mustFix.length > 0 && (
                <p className="field__hint" id={`${id}-why-send`}>
                  Fix the {mustFix.length === 1 ? 'step' : 'steps'} listed at the top first.
                </p>
              )}
            </div>
          </form>
        </section>
      )}

      <ConfirmDialog
        open={confirm}
        title={change ? `Publish the changes to ${agent?.name ?? draft.name.trim()}?` : `Publish ${draft.name.trim()}?`}
        confirmLabel="Publish"
        busyLabel="Publishing…"
        busy={publishing}
        error={publishError}
        onConfirm={() => void publish()}
        onCancel={() => setConfirm(false)}
      >
        <p>
          {change
            ? `They become version ${(agent?.version ?? 0) + 1}${agent?.status === 'live' ? `, and callers to ${agent.phoneNumber} get them straight away` : ''}.${draft.requestId ? ' The request is marked done, and the organisation is told.' : ''}`
            : where === 'number'
              ? `It starts answering ${numbers.find((n) => n.id === chosenNumber)?.number ?? 'the number'} straight away.${draft.requestId ? ' The request is marked done, and the organisation is told.' : ''}`
              : `It’s saved as version 1, paused. It won’t answer calls until you give it a number.${draft.requestId ? ' The request is marked done.' : ''}`}
        </p>
      </ConfirmDialog>
    </div>
  )
}
