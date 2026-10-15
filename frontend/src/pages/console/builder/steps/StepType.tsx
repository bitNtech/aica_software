import { useCallback } from 'react'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { AgentDraft } from '../../../../console/types'
import { Alert } from '../../../../components/ui/Alert'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { TextField } from '../../../../components/ui/Field'
import { Spinner } from '../../../../components/ui/Spinner'
import { useAsync } from '../../../../lib/useAsync'
import { ErrorSummary, type StepErrors, type StepProps } from '../StepShared'

export function checkType(draft: AgentDraft): StepErrors {
  const e: StepErrors = {}
  if (!draft.typeId) e.type = 'Choose the kind of business.'
  else if (!draft.subTypeId) e.subType = 'Choose what this agent does.'
  const name = draft.name.trim()
  if (name.length < 3) e.name = 'Give the agent a name of at least 3 characters, e.g. “OPD appointments”.'
  else if (name.length > 60) e.name = 'Keep the name under 60 characters.'
  return e
}

/** Step 1: the kind of business, the job this agent does, and its name. */
export function StepType({ draft, update, showErrors, attempt, validator }: StepProps) {
  const client = useConsole()
  const load = useCallback(() => client.listAgentTypes(), [client])
  const [types, reload] = useAsync(load)

  const type = types.state === 'ready' ? types.data.find((t) => t.id === draft.typeId) : undefined
  const sub = type?.subTypes.find((s) => s.id === draft.subTypeId)

  const check = () => checkType(draft)
  validator.current = check
  const errors = showErrors ? check() : {}

  if (types.state === 'loading') {
    return (
      <div className="loading-row" role="status">
        <Spinner />
        <span>Loading agent types…</span>
      </div>
    )
  }
  if (types.state === 'error') {
    return (
      <Alert tone="error" title="Couldn't load agent types">
        <p>{asAuthError(types.error).message}</p>
        <button type="button" className="btn-text" onClick={reload}>
          Try again
        </button>
      </Alert>
    )
  }

  return (
    <div className="step">
      <ErrorSummary errors={errors} attempt={attempt} />

      <section className="step__section">
        <ChoiceGroup
          legend="Kind of business"
          type="radio"
          columns={4}
          error={errors.type}
          options={types.data.map((t) => ({ value: t.id, label: t.label }))}
          value={draft.typeId ? [draft.typeId] : []}
          onChange={([v]) => update((d) => ({ ...d, typeId: v, subTypeId: v === d.typeId ? d.subTypeId : null }))}
        />
      </section>

      {type && (
        <section className="step__section">
          <ChoiceGroup
            legend="What this agent does"
            hint="One agent does one job on one phone line. Make another agent for another job."
            type="radio"
            columns={2}
            error={errors.subType}
            options={type.subTypes.map((s) => ({ value: s.id, label: s.label, hint: s.description }))}
            value={draft.subTypeId ? [draft.subTypeId] : []}
            onChange={([v]) =>
              update((d) => {
                const picked = type.subTypes.find((s) => s.id === v)
                // Suggest a name from the job until the person types their own.
                const suggested = type.subTypes.some((s) => s.label === d.name)
                return { ...d, subTypeId: v, name: !d.name.trim() || suggested ? (picked?.label ?? d.name) : d.name }
              })
            }
          />
          {sub && (
            <div className="covers" aria-live="polite">
              <p className="covers__title">AICA will look for these in your calls:</p>
              <ul className="covers__list">
                {sub.covers.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="covers__more">and anything else your calls are about.</p>
            </div>
          )}
        </section>
      )}

      <section className="step__section step__narrow">
        <TextField
          label="Agent name"
          hint="Only your team sees this. Callers hear the persona name you set in the next step."
          value={draft.name}
          maxLength={80}
          error={errors.name}
          onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
        />
      </section>
    </div>
  )
}
