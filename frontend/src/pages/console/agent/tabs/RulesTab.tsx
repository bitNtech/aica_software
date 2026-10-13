import { useId } from 'react'
import { Link } from 'react-router'
import type { Guardrails } from '../../../../console/types'
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import { Switch } from '../../../../components/ui/Switch'
import { ListEditor } from '../../builder/ListEditor'
import type { TabProps } from '../shared'

const FAILURES = [1, 2, 3].map((n) => ({ value: String(n), label: n === 1 ? 'The first time it can’t help' : `After ${n} tries` }))
const MINUTES = [5, 10, 15, 20, 30].map((n) => ({ value: String(n), label: `${n} minutes` }))

/** When and where it hands over, what it won't discuss, and call limits. */
export function RulesTab({ org, detail, spec, update, readOnly, errors }: TabProps) {
  const id = useId()
  const g = spec.guardrails
  const set = (patch: Partial<Guardrails>) => update((s) => ({ ...s, guardrails: { ...s.guardrails, ...patch } }))
  const flowLink = (
    <Link className="link" to={`/o/${org.orgSlug}/agents/${detail.agent.id}/flow`}>
      Flow
    </Link>
  )

  if (readOnly) {
    return (
      <div className="ws__sections">
        <dl className="review__list">
          {(
            [
              ['Hands over', `${g.handoffAfterFailures === 1 ? 'The first time it can’t help' : `After ${g.handoffAfterFailures} tries`}, to ${g.transferTo}`],
              ['Emergencies go to', g.emergencyTo],
              ['Topics it refuses', g.refuseTopics.length ? g.refuseTopics.join(' · ') : 'None'],
              ['Recording notice', g.recordingNotice ? `“${g.recordingNoticeText}”` : 'Off'],
              ['Longest call', `${g.maxCallMinutes} minutes, then it hands over`],
              ['Personal details', spec.redact ? 'Hidden in transcripts' : 'Shown in transcripts'],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="review__row review__row--two">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }

  return (
    <div className="step ws__sections">
      <section className="step__section" aria-labelledby={`${id}-hand`}>
        <h2 id={`${id}-hand`} className="step__heading">
          Handing over to a person
        </h2>
        <p className="step__sub">What it says when handing over is set under “Anywhere in a call” on the {flowLink} tab.</p>
        <div className="step__grid">
          <SelectField
            label="Hand over when it can’t help"
            value={String(g.handoffAfterFailures)}
            options={FAILURES}
            onChange={(e) => set({ handoffAfterFailures: Number(e.target.value) })}
          />
          <TextField
            label="Put callers through to"
            hint="A desk or extension your team answers."
            value={g.transferTo}
            maxLength={80}
            error={errors.transferTo}
            onChange={(e) => set({ transferTo: e.target.value })}
          />
          <TextField
            label="Send emergencies to"
            hint="Answered at all hours."
            value={g.emergencyTo}
            maxLength={80}
            error={errors.emergencyTo}
            onChange={(e) => set({ emergencyTo: e.target.value })}
          />
        </div>
      </section>

      <section className="step__section" aria-labelledby={`${id}-refuse`}>
        <h2 id={`${id}-refuse`} className="step__heading">
          Topics it refuses
        </h2>
        <p className="step__sub">It politely declines these and offers to hand over.</p>
        <ListEditor
          items={g.refuseTopics}
          onChange={(refuseTopics) => set({ refuseTopics })}
          noun="topic"
          label="Add a topic"
          placeholder="e.g. Second opinions on reports"
          empty="None. It will try to help with anything in its knowledge."
          max={20}
          minLength={3}
          maxLength={80}
        />
      </section>

      <section className="step__section" aria-labelledby={`${id}-calls`}>
        <h2 id={`${id}-calls`} className="step__heading">
          Calls
        </h2>
        <div className="step__stack">
          <Switch
            label="Tell callers the call is recorded"
            hint="Said right after the greeting."
            checked={g.recordingNotice}
            onChange={(recordingNotice) => set({ recordingNotice })}
          />
          <Switch
            label="Hide personal details in transcripts"
            hint="Names, numbers and patient IDs show as [name], [phone] and so on."
            checked={spec.redact}
            onChange={(redact) => update((s) => ({ ...s, redact }))}
          />
        </div>
        {g.recordingNotice && (
          <TextAreaField
            label="Recording notice"
            rows={2}
            maxLength={200}
            value={g.recordingNoticeText}
            error={errors.recordingNoticeText}
            onChange={(e) => set({ recordingNoticeText: e.target.value })}
          />
        )}
        <div className="step__narrow">
          <SelectField
            label="Longest call before it hands over"
            value={String(g.maxCallMinutes)}
            options={MINUTES}
            onChange={(e) => set({ maxCallMinutes: Number(e.target.value) })}
          />
        </div>
      </section>
    </div>
  )
}
