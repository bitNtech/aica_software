import { useId, useState } from 'react'
import { isMaster } from '../../../../console/access'
import type { AnalysisField, AnalysisSettings } from '../../../../console/types'
import { Button } from '../../../../components/ui/Button'
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import { Switch } from '../../../../components/ui/Switch'
import type { StepErrors } from '../../builder/StepShared'
import type { TabProps } from '../shared'

const TYPE_LABEL: Record<AnalysisField['type'], string> = { text: 'Words', yes_no: 'Yes or no', number: 'A number', choice: 'One of a list' }

export function checkAnalysis(a: AnalysisSettings): StepErrors {
  const e: StepErrors = {}
  if (!a.successCriteria.trim()) e.successCriteria = 'Say what counts as a successful call, so reports can count them.'
  else if (a.successCriteria.length > 300) e.successCriteria = 'Keep it under 300 characters.'
  const labels = new Set<string>()
  a.fields.forEach((f, i) => {
    const label = f.label.trim().toLowerCase()
    if (label.length < 2) e[`field-${i}`] = `Name field ${i + 1}.`
    else if (labels.has(label)) e[`field-${i}`] = `Two fields are called “${f.label.trim()}”.`
    else if (f.type === 'choice' && (f.options ?? []).filter((o) => o.trim()).length < 2) e[`field-${i}`] = `Give “${f.label.trim()}” at least two choices.`
    labels.add(label)
  })
  return e
}

/**
 * What AICA notes about each call once it ends: a summary, how the caller
 * sounded, whether it succeeded, and fields of its own (as post-call
 * analysis works in Retell and Vapi). A hospital words what success means;
 * the fields are set up by bitNtech, since reports and integrations use them.
 */
export function AnalysisTab({ access, spec, update, readOnly, errors }: TabProps) {
  const id = useId()
  const a = spec.analysis
  const set = (patch: Partial<AnalysisSettings>) => update((s) => ({ ...s, analysis: { ...s.analysis, ...patch } }))
  const canFields = !readOnly && isMaster(access)
  const setField = (i: number, patch: Partial<AnalysisField>) => set({ fields: a.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const [added, setAdded] = useState('')

  if (readOnly) {
    return (
      <div className="ws__sections">
        <dl className="review__list">
          <div className="review__row review__row--two">
            <dt>A successful call</dt>
            <dd>{a.successCriteria}</dd>
          </div>
          <div className="review__row review__row--two">
            <dt>Also notes</dt>
            <dd>{[a.summary && 'a summary', a.sentiment && 'how the caller sounded', ...a.fields.map((f) => f.label.toLowerCase())].filter(Boolean).join(', ') || 'Nothing else'}</dd>
          </div>
        </dl>
      </div>
    )
  }

  return (
    <div className="step ws__sections">
      <section className="step__section" aria-labelledby={`${id}-ok`}>
        <h2 id={`${id}-ok`} className="step__heading">
          What counts as a successful call
        </h2>
        <p className="step__sub">In your own words. Each call is checked against it, and Reports count the calls that met it.</p>
        <TextAreaField label="A call succeeded when" rows={2} maxLength={300} value={a.successCriteria} error={errors.successCriteria} onChange={(e) => set({ successCriteria: e.target.value })} />
        <Switch label="Write a summary" hint="A few lines on what the caller wanted and what happened." checked={a.summary} onChange={(summary) => set({ summary })} />
        <Switch label="Note how the caller sounded" hint="Pleased, neutral or unhappy." checked={a.sentiment} onChange={(sentiment) => set({ sentiment })} />
      </section>

      <section className="step__section" aria-labelledby={`${id}-fields`}>
        <h2 id={`${id}-fields`} className="step__heading">
          Fields to note
        </h2>
        <p className="step__sub">{canFields ? 'Facts to pull out of each call, for reports and your systems.' : 'Facts pulled out of each call. bitNtech sets these up; send a request to change them.'}</p>
        <p className="sr-only" role="status">
          {added}
        </p>
        {a.fields.length === 0 ? (
          <p className="empty-note">None.</p>
        ) : (
          <ul className="analysis__fields">
            {a.fields.map((f, i) =>
              canFields ? (
                <li key={f.id} className="analysis__field">
                  <TextField label="Field name" value={f.label} maxLength={40} error={errors[`field-${i}`]} onChange={(e) => setField(i, { label: e.target.value })} />
                  <SelectField
                    label="Kind"
                    value={f.type}
                    options={(Object.keys(TYPE_LABEL) as AnalysisField['type'][]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
                    onChange={(e) => setField(i, { type: e.target.value as AnalysisField['type'] })}
                  />
                  <TextField label="What to look for" value={f.description} maxLength={160} onChange={(e) => setField(i, { description: e.target.value })} />
                  {f.type === 'choice' && (
                    <TextField
                      label="Choices"
                      hint="Separated by commas."
                      value={(f.options ?? []).join(', ')}
                      onChange={(e) => setField(i, { options: e.target.value.split(',').map((o) => o.trimStart()) })}
                    />
                  )}
                  <div>
                    <Button
                      variant="line"
                      size="sm"
                      onClick={() => {
                        set({ fields: a.fields.filter((_, j) => j !== i) })
                        setAdded(`Removed “${f.label}”.`)
                      }}
                    >
                      Remove “{f.label || 'this field'}”
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={f.id} className="analysis__field analysis__field--ro">
                  <strong>{f.label}</strong> <span className="row__meta">{TYPE_LABEL[f.type]}{f.options?.length ? `: ${f.options.join(', ')}` : ''}</span>
                  <p className="row__meta">{f.description}</p>
                </li>
              ),
            )}
          </ul>
        )}
        {canFields && a.fields.length < 8 && (
          <div>
            <Button
              variant="line"
              size="sm"
              onClick={() => {
                set({ fields: [...a.fields, { id: `fld_${Date.now().toString(36)}`, label: '', type: 'text', description: '' }] })
                setAdded('Field added at the end of the list.')
              }}
            >
              Add a field
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
