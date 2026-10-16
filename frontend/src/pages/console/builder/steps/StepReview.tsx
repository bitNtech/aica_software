import { useCallback, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { LANGUAGE_LABEL } from '../../../../auth/roles'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import { type AgentDraft, type AgentTool, type BuilderStep, type FlowNode, type KnowledgeSource, type PhoneNumber, type SourceCall, type Voice } from '../../../../console/types'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { ConfirmDialog } from '../../../../components/ui/Dialog'
import { SelectField } from '../../../../components/ui/Field'
import { Spinner } from '../../../../components/ui/Spinner'
import { useAsync } from '../../../../lib/useAsync'
import { countNodes, lowConfidence } from '../flowTree'
import { STEP_META } from '../steps'
import type { StepErrors, StepProps } from '../StepShared'
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

/** Step 7: check everything, try it, then publish. */
export function StepReview({ draft, org, base: orgBase, validator, save, done }: StepProps) {
  const id = useId()
  const client = useConsole()
  const navigate = useNavigate()
  const load = useCallback(async () => {
    const [calls, voices, tools, knowledge, numbers, types] = await Promise.all([
      client.listCalls(org.orgSlug),
      client.listVoices(),
      client.listTools(org.orgSlug),
      client.listKnowledge(org.orgSlug),
      client.listNumbers(org.orgSlug),
      client.listAgentTypes(),
    ])
    return { calls, voices, tools, knowledge, numbers, types }
  }, [client, org.orgSlug])
  const [lib, reload] = useAsync(load)
  /** Unset until chosen: defaults to a number when one is free. */
  const [choice, setChoice] = useState<'number' | 'paused' | null>(null)
  /** Numbers re-read after a failed publish (one may have been taken). */
  const [freshNumbers, setFreshNumbers] = useState<PhoneNumber[] | null>(null)
  const [numberId, setNumberId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
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
  const blocking = blockers(draft, data)
  const notes = warnings(draft, data)
  const numbers = freshNumbers ?? data.numbers
  const free = numbers.filter((n) => !n.agentId)
  const where = choice ?? (free.length ? 'number' : 'paused')
  const chosenNumber = free.find((n) => n.id === numberId)?.id ?? free[0]?.id ?? ''
  const blocked = blocking.length > 0 || (where === 'number' && !free.length)
  const base = `${orgBase}/agents/drafts/${draft.id}`
  const voice = data.voices.find((v) => v.id === draft.behaviour.voiceId)
  const steps = countNodes(draft.flow) - draft.flow.length
  const reason = blocking.length
    ? `Fix the ${blocking.length === 1 ? 'step' : 'steps'} listed at the top first.`
    : where === 'number' && !free.length
      ? 'No free numbers: publish it paused, or add a number in Phone numbers first.'
      : null
  const type = data.types.find((t) => t.id === draft.typeId)
  const sub = type?.subTypes.find((x) => x.id === draft.subTypeId)

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
      const target = where === 'number' ? chosenNumber : null
      const agent = await client.publishDraft(org.orgSlug, draft.id, target)
      // The draft is now an agent: nothing more to save to it.
      done()
      navigate(`${orgBase}/agents`, {
        replace: true,
        state: { notice: agent.phoneNumber ? `${agent.name} is live on ${agent.phoneNumber}.` : `${agent.name} is published and paused. Give it a number to go live.` },
      })
    } catch (err) {
      setPublishError(asAuthError(err).message)
      setPublishing(false)
      // A number may have been taken meanwhile: offer only free ones.
      client.listNumbers(org.orgSlug).then(setFreshNumbers, () => {})
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
    { step: 'flow', text: `${draft.flow.length} intents, ${steps} steps and branches.` },
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

  return (
    <div className="step">
      {blocking.length > 0 ? (
        <Alert tone="error" title="Fix these before publishing">
          <ul className="review__fix">
            {blocking.map((b) => (
              <li key={b.step}>
                <Link className="link" to={`${base}/${b.step}`}>
                  {STEP_META[b.step].label}
                </Link>
                : {Object.values(b.errors).join(' ')}
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="ok" title="Ready to publish">
          Everything needed is in place.
        </Alert>
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
                <Link className="link" to={`${base}/${s.step}`} aria-label={`Edit ${STEP_META[s.step].label}`}>
                  Edit
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="step__section" aria-labelledby={`${id}-test`}>
        <h2 id={`${id}-test`} className="step__heading">
          Try it
        </h2>
        <TestChat draft={draft} tools={data.tools} knowledge={data.knowledge} />
      </section>

      <section className="step__section" aria-labelledby={`${id}-pub`}>
        <h2 id={`${id}-pub`} className="step__heading">
          Publish
        </h2>
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
            Publish agent
          </Button>
          {reason && (
            <p className="field__hint" id={`${id}-why`}>
              {reason}
            </p>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={confirm}
        title={`Publish ${draft.name.trim()}?`}
        confirmLabel="Publish"
        busyLabel="Publishing…"
        busy={publishing}
        error={publishError}
        onConfirm={() => void publish()}
        onCancel={() => setConfirm(false)}
      >
        <p>
          {where === 'number'
            ? `It starts answering ${numbers.find((n) => n.id === chosenNumber)?.number ?? 'the number'} straight away.`
            : 'It’s saved as version 1, paused. It won’t answer calls until you give it a number.'}
        </p>
      </ConfirmDialog>
    </div>
  )
}
