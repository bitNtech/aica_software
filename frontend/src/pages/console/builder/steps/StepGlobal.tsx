import { useId } from 'react'
import type { GlobalFlow, GlobalFlowKind } from '../../../../console/types'
import { TextAreaField } from '../../../../components/ui/Field'
import { Switch } from '../../../../components/ui/Switch'
import { ErrorSummary, type StepErrors, type StepProps } from '../StepShared'

export const GLOBAL_META: Record<GlobalFlowKind, { label: string; hint: string }> = {
  handoff: { label: 'Hand over to a person', hint: 'Puts the caller through to your team, with a summary.' },
  emergency: { label: 'Emergency', hint: 'Always on for healthcare: callers in danger are sent to help at once.' },
  repeat: { label: 'Repeat or slow down', hint: 'When the caller didn’t catch something.' },
  out_of_scope: { label: 'Something it doesn’t handle', hint: 'Questions outside this agent’s job.' },
  silence: { label: 'Caller goes quiet', hint: 'Long pauses, or a dropped line.' },
  end_call: { label: 'End of the call', hint: 'How it says goodbye and hangs up.' },
}

/** Emergency handling can't be switched off. */
export const LOCKED: GlobalFlowKind[] = ['emergency']

export function checkGlobalFlows(list: GlobalFlow[]): StepErrors {
  const e: StepErrors = {}
  for (const g of list) {
    if (!g.enabled) continue
    if (!g.trigger.trim()) e[`${g.kind}-trigger`] = `${GLOBAL_META[g.kind].label}: say when it happens.`
    if (!g.response.trim()) e[`${g.kind}-response`] = `${GLOBAL_META[g.kind].label}: say what the agent does.`
  }
  return e
}

export function GlobalFlowsEditor({
  flows,
  onChange,
  errors = {},
  readOnly,
}: {
  flows: GlobalFlow[]
  onChange(next: GlobalFlow[]): void
  errors?: StepErrors
  readOnly?: boolean
}) {
  const set = (kind: GlobalFlowKind, patch: Partial<GlobalFlow>) => onChange(flows.map((g) => (g.kind === kind ? { ...g, ...patch } : g)))
  const id = useId()
  // Look only: plain text, not controls that can't be used.
  if (readOnly) {
    return (
      <ul className="globals">
        {flows.map((g) => (
          <li key={g.kind} className={`globals__item${g.enabled ? '' : ' is-off'}`}>
            <p className="globals__ro-title">
              <strong>{GLOBAL_META[g.kind].label}</strong> <span className={`flag${g.enabled ? '' : ' flag--quiet'}`}>{g.enabled ? 'On' : 'Off'}</span>
            </p>
            {g.enabled && (
              <dl className="globals__ro">
                <div>
                  <dt>When</dt>
                  <dd>{g.trigger}</dd>
                </div>
                <div>
                  <dt>What the agent says or does</dt>
                  <dd>{g.response}</dd>
                </div>
              </dl>
            )}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <ul className="globals">
      {flows.map((g) => {
        const meta = GLOBAL_META[g.kind]
        const locked = LOCKED.includes(g.kind)
        return (
          <li key={g.kind} className={`globals__item${g.enabled ? '' : ' is-off'}`}>
            <Switch
              label={meta.label}
              labelId={`${id}-${g.kind}`}
              hint={meta.hint}
              checked={g.enabled}
              locked={locked ? 'Always on' : undefined}
              onChange={(v) => set(g.kind, { enabled: v })}
            />
            {g.enabled && (
              // A group named after the switch, so each "When" says which flow it's for.
              <div className="step__grid globals__fields" role="group" aria-labelledby={`${id}-${g.kind}`}>
                <TextAreaField
                  label="When"
                  rows={3}
                  value={g.trigger}
                  error={errors[`${g.kind}-trigger`]}
                  onChange={(e) => set(g.kind, { trigger: e.target.value })}
                />
                <TextAreaField
                  label="What the agent says or does"
                  rows={3}
                  value={g.response}
                  error={errors[`${g.kind}-response`]}
                  onChange={(e) => set(g.kind, { response: e.target.value })}
                />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Step 5: behaviour that applies anywhere in a call. */
export function StepGlobal({ draft, update, showErrors, attempt, validator }: StepProps) {
  const check = () => checkGlobalFlows(draft.globalFlows)
  validator.current = check
  const errors = showErrors ? check() : {}
  return (
    <div className="step">
      <ErrorSummary errors={errors} attempt={attempt} />
      <GlobalFlowsEditor flows={draft.globalFlows} errors={errors} onChange={(globalFlows) => update((d) => ({ ...d, globalFlows }))} />
    </div>
  )
}
