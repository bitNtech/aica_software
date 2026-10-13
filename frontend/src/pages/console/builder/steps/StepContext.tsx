import { useCallback, useId, useRef, useState } from 'react'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { AgentContext, AgentTool, GlobalFlow, KnowledgeSource } from '../../../../console/types'
import { Alert } from '../../../../components/ui/Alert'
import { Checkbox, SelectField } from '../../../../components/ui/Field'
import { Spinner } from '../../../../components/ui/Spinner'
import { Switch } from '../../../../components/ui/Switch'
import { shortDate } from '../../../../lib/time'
import { useAsync } from '../../../../lib/useAsync'
import { ErrorSummary, type StepErrors, type StepProps } from '../StepShared'

export const KNOWLEDGE_KIND_LABEL: Record<KnowledgeSource['kind'], string> = { document: 'Document', web: 'Web page', faq: 'FAQ', table: 'Table' }

const MATCH = [
  { value: '0.45', label: 'Loose: answer from anything related' },
  { value: '0.6', label: 'Balanced' },
  { value: '0.75', label: 'Strict: only close matches' },
]

export const isExpired = (k: KnowledgeSource) => k.expiresAt !== null && k.expiresAt < new Date().toISOString()

export function checkContext(c: AgentContext, globals: GlobalFlow[], tools: AgentTool[] | null): StepErrors {
  const e: StepErrors = {}
  if (c.answerOnlyFromKnowledge && c.knowledgeSourceIds.length === 0)
    e.knowledge = 'Choose at least one knowledge source, or let the agent answer beyond them.'
  // Handing over and emergencies both put the caller through to a person.
  const needed = globals.some((g) => (g.kind === 'handoff' || g.kind === 'emergency') && g.enabled)
  const transfer = tools?.find((t) => t.builtin === 'transfer')
  if (needed && transfer && !transfer.enabled)
    e.tools = `“${transfer.name}” is switched off for your organisation, but handing over and emergencies need it. Ask an owner to switch it on.`
  else if (needed && transfer && !c.toolIds.includes(transfer.id))
    e.tools = `“${transfer.name}” is needed: handing over to a person and emergencies use it.`
  return e
}

/** Knowledge and tools for one agent; shared with the agent workspace. */
export function ContextEditor({
  orgSlug,
  context,
  onChange,
  errors = {},
  readOnly,
  onTools,
  part,
  library,
}: {
  orgSlug: string
  context: AgentContext
  onChange(next: AgentContext): void
  errors?: StepErrors
  readOnly?: boolean
  /** Reports the organisation's tools once loaded, for checks. */
  onTools?(tools: AgentTool[]): void
  /** Only one half, for the workspace's Knowledge and Tools tabs. */
  part?: 'knowledge' | 'tools'
  /** The library, when the page already has it: not loaded again. */
  library?: { knowledge: KnowledgeSource[]; tools: AgentTool[] }
}) {
  const client = useConsole()
  // A report, not an input: held in a ref so a new callback each render
  // doesn't reload the library.
  const report = useRef(onTools)
  report.current = onTools
  const given = useRef(library)
  given.current = library
  const load = useCallback(async () => {
    if (given.current) return given.current
    const [knowledge, tools] = await Promise.all([client.listKnowledge(orgSlug), client.listTools(orgSlug)])
    report.current?.(tools)
    return { knowledge, tools }
  }, [client, orgSlug])
  const [lib, reload] = useAsync(load)
  const id = useId()
  const set = (patch: Partial<AgentContext>) => onChange({ ...context, ...patch })
  const toggle = (key: 'knowledgeSourceIds' | 'toolIds', id: string, on: boolean) =>
    set({ [key]: on ? [...context[key], id] : context[key].filter((x) => x !== id) })

  if (!library && lib.state === 'loading') {
    return (
      <div className="loading-row" role="status">
        <Spinner />
        <span>Loading your knowledge and tools…</span>
      </div>
    )
  }
  if (!library && lib.state === 'error') {
    return (
      <Alert tone="error" title="Couldn't load your knowledge and tools">
        <p>{asAuthError(lib.error).message}</p>
        <button type="button" className="btn-text" onClick={reload}>
          Try again
        </button>
      </Alert>
    )
  }

  const { knowledge, tools } = library ?? (lib.state === 'ready' ? lib.data : { knowledge: [], tools: [] })
  return (
    <>
      {part !== 'tools' && (
        <section className="step__section" aria-labelledby={`${id}-kb`}>
          <h2 id={`${id}-kb`} className="step__heading">
            Knowledge it answers from
          </h2>
          {knowledge.length === 0 ? (
            <p className="empty-note">Your knowledge library is empty. Add documents, web pages or FAQs to it, then choose them here.</p>
          ) : (
            <fieldset className="pick-list" aria-labelledby={`${id}-kb`} aria-describedby={errors.knowledge ? `${id}-kb-err` : undefined}>
              {knowledge.map((k) => (
                <div key={k.id} className="pick-list__row">
                  <Checkbox
                    label={k.name}
                    hint={
                      <>
                        {KNOWLEDGE_KIND_LABEL[k.kind]} <i aria-hidden="true">·</i> {k.passages} sections <i aria-hidden="true">·</i> updated {shortDate(k.refreshedAt)}
                        {isExpired(k) && <strong className="pick-list__warn"> · Expired {shortDate(k.expiresAt!)}: check it’s still right</strong>}
                      </>
                    }
                    checked={context.knowledgeSourceIds.includes(k.id)}
                    disabled={readOnly || k.status !== 'ready'}
                    onChange={(e) => toggle('knowledgeSourceIds', k.id, e.target.checked)}
                  />
                </div>
              ))}
            </fieldset>
          )}
          {errors.knowledge && (
            <p className="field__error" id={`${id}-kb-err`}>
              {errors.knowledge}
            </p>
          )}
          <div className="step__stack">
            <Switch
              label="Answer only from this knowledge"
              hint="If the answer isn’t in these sources, the agent says it doesn’t know and offers to hand over, rather than guessing."
              checked={context.answerOnlyFromKnowledge}
              disabled={readOnly}
              onChange={(v) => set({ answerOnlyFromKnowledge: v })}
            />
          </div>
          <div className="step__grid">
            <SelectField
              label="Passages per answer"
              hint="How many pieces of your knowledge the agent reads before answering. More gives fuller answers, but slower replies."
              value={String(context.topK)}
              disabled={readOnly}
              options={[2, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(e) => set({ topK: Number(e.target.value) })}
            />
            <SelectField
              label="How close a match must be"
              hint="How closely a piece of knowledge must match the question before the agent uses it."
              value={String(context.minScore)}
              disabled={readOnly}
              options={MATCH}
              onChange={(e) => set({ minScore: Number(e.target.value) })}
            />
          </div>
        </section>
      )}

      {part !== 'knowledge' && (
        <section className="step__section" aria-labelledby={`${id}-tools`}>
          <h2 id={`${id}-tools`} className="step__heading">
            Tools it can use
          </h2>
          <fieldset className="pick-list" aria-labelledby={`${id}-tools`} aria-describedby={errors.tools ? `${id}-tools-err` : undefined}>
            {tools.map((t) => (
              <div key={t.id} className="pick-list__row">
                <Checkbox
                  label={t.name}
                  hint={
                    <>
                      {t.description}{' '}
                      {t.acts && <span className="flag flag--warn pick-list__flag">Changes things</span>}
                      {t.kind === 'http' && !t.lastTestedAt && <span className="flag pick-list__flag">Not tested yet</span>}
                      {!t.enabled && <span className="flag flag--quiet pick-list__flag">Switched off for your organisation</span>}
                    </>
                  }
                  checked={context.toolIds.includes(t.id)}
                  disabled={readOnly || !t.enabled}
                  onChange={(e) => toggle('toolIds', t.id, e.target.checked)}
                />
              </div>
            ))}
          </fieldset>
          {errors.tools && (
            <p className="field__error" id={`${id}-tools-err`}>
              {errors.tools}
            </p>
          )}
          <div className="step__stack">
            <Switch
              label="Ask the caller before acting"
              hint="Before a tool that changes something (booking, sending a message), the agent reads back what it’s about to do and waits for a yes."
              checked={context.confirmBeforeActions}
              disabled={readOnly}
              onChange={(v) => set({ confirmBeforeActions: v })}
            />
          </div>
        </section>
      )}
    </>
  )
}

/** Step 6: what the agent knows and can do. */
export function StepContext({ draft, org, update, showErrors, attempt, validator }: StepProps) {
  // The tools arrive with the editor; until then the check waits for them.
  const [tools, setTools] = useState<AgentTool[] | null>(null)
  const check = (): StepErrors =>
    tools === null ? { tools: 'Wait for your knowledge and tools to load.' } : checkContext(draft.context, draft.globalFlows, tools)
  validator.current = check
  const errors = showErrors ? check() : {}
  return (
    <div className="step">
      <ErrorSummary errors={errors} attempt={attempt} />
      <ContextEditor
        orgSlug={org.orgSlug}
        context={draft.context}
        errors={errors}
        onTools={setTools}
        onChange={(context) => update((d) => ({ ...d, context }))}
      />
    </div>
  )
}
