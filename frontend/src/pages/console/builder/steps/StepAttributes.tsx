import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Attribute, AttributeType } from '../../../../console/types'
import { Button } from '../../../../components/ui/Button'
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import { Switch } from '../../../../components/ui/Switch'
import { ErrorSummary, type StepErrors, type StepProps } from '../StepShared'

export const ATTRIBUTE_TYPE_LABEL: Record<AttributeType, string> = {
  text: 'Text',
  name: 'Name',
  phone: 'Phone number',
  date: 'Date',
  time: 'Time',
  number: 'Number',
  choice: 'One of a list',
  patient_id: 'Patient ID',
}

/** Problems keyed by attribute id; shared with the agent workspace. */
export function checkAttributes(list: Attribute[]): StepErrors {
  const e: StepErrors = {}
  const seen = new Set<string>()
  for (const a of list) {
    const key = a.label.trim().toLowerCase()
    if (!key) e[a.id] = 'A detail has no name.'
    else if (seen.has(key)) e[a.id] = `“${a.label}” is listed twice.`
    else if (!a.ask.trim()) e[a.id] = `Write how the agent asks for “${a.label}”.`
    else if (a.type === 'choice' && (a.options ?? []).length < 2) e[a.id] = `Give “${a.label}” at least two options.`
    seen.add(key)
  }
  return e
}

let seq = 0
const blank = (): Attribute => ({
  id: `attr_new_${Date.now().toString(36)}_${seq++}`,
  label: '',
  type: 'text',
  required: false,
  personal: false,
  confirm: false,
  ask: '',
})

interface EditorProps {
  attributes: Attribute[]
  onChange(next: Attribute[]): void
  errors?: StepErrors
  readOnly?: boolean
}

/** The details an agent collects: a list with an inline form per row. */
export function AttributesEditor({ attributes, onChange, errors = {}, readOnly }: EditorProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [note, setNote] = useState('')

  /** The list before the last delete, so it can be undone. */
  const [undo, setUndo] = useState<{ id: string; label: string; list: Attribute[] } | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!focusId) return
    if (focusId === 'add') addButton.current?.focus()
    else {
      // A move keeps focus on its button, unless the row can't move further.
      const el = document.querySelector<HTMLButtonElement>(`[data-attr-focus="${focusId}"]`)
      const row = focusId.startsWith('move:') ? focusId.split(':')[1] : null
      if (el && !el.disabled) el.focus()
      else if (row) document.querySelector<HTMLElement>(`[data-attr-focus="${row}"]`)?.focus()
    }
    setFocusId(null)
  }, [focusId, attributes])

  const change = (next: Attribute[]) => {
    setUndo(null)
    onChange(next)
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= attributes.length) return
    const next = [...attributes]
    ;[next[i], next[j]] = [next[j], next[i]]
    change(next)
    setNote(`Moved ${dir < 0 ? 'up' : 'down'}${j === 0 ? ', now first' : j === attributes.length - 1 ? ', now last' : ''}.`)
    setFocusId(`move:${attributes[i].id}:${dir}`)
  }

  function add() {
    const a = blank()
    change([...attributes, a])
    setEditing(a.id)
    setFresh(a.id)
  }

  function close(id: string, removed = false) {
    if (removed || fresh === id) {
      const i = attributes.findIndex((a) => a.id === id)
      onChange(attributes.filter((a) => a.id !== id))
      setFocusId(attributes[i - 1]?.id ?? attributes[i + 1]?.id ?? 'add')
      if (removed && fresh !== id) {
        setUndo({ id, label: attributes[i].label || 'unnamed', list: attributes })
        setNote('Detail deleted.')
      } else setUndo(null)
    } else setFocusId(id)
    setEditing(null)
    setFresh(null)
  }

  return (
    <div className="attrs">
      <p className="sr-only" role="status">
        {note}
      </p>
      {undo && !readOnly && (
        <div className="flow__undo">
          <span>Deleted “{undo.label}”.</span>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              onChange(undo.list)
              setUndo(null)
              setNote('Delete undone.')
              setFocusId(undo.id)
            }}
          >
            Undo
          </button>
        </div>
      )}
      {attributes.length === 0 ? (
        <p className="empty-note">No details to collect. Add one if the agent needs to ask the caller for something, like a name or a date.</p>
      ) : (
        <ul className="attrs__list" aria-label="Details to collect">
          {attributes.map((a, i) => (
            <li key={a.id} className={['attrs__item', errors[a.id] && 'attrs__item--error'].filter(Boolean).join(' ')}>
              <div className="attrs__row">
                <div className="attrs__main">
                  <p className="attrs__title">
                    <span className="attrs__name" id={`attr-${a.id}`} tabIndex={-1} data-attr-focus={a.id}>
                      {a.label || <em className="flow__unnamed">Unnamed</em>}
                    </span>
                    <span className="attrs__type">{ATTRIBUTE_TYPE_LABEL[a.type]}</span>
                  </p>
                  {a.ask && <p className="flow__say">“{a.ask}”</p>}
                  <p className="attrs__flags">
                    {a.required ? <span className="flag">Required</span> : <span className="flag flag--quiet">Optional</span>}
                    {a.personal && <span className="flag flag--warn">Personal data</span>}
                    {a.confirm && <span className="flag">Read back</span>}
                    {a.type === 'choice' && a.options?.length ? <span className="attrs__opts">{a.options.join(', ')}</span> : null}
                  </p>
                  {errors[a.id] && <p className="field__error">{errors[a.id]}</p>}
                </div>
                {!readOnly && (
                  <div className="flow__actions">
                    <button
                      type="button"
                      className="flow__act"
                      aria-label={`Edit ${a.label || 'unnamed'}`}
                      aria-expanded={editing === a.id}
                      onClick={() => setEditing(editing === a.id ? null : a.id)}
                    >
                      Edit
                    </button>
                    <button type="button" className="flow__act flow__act--icon" aria-label={`Move ${a.label || 'unnamed'} up`} title="Move up" data-attr-focus={`move:${a.id}:-1`} disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="flow__act flow__act--icon"
                      aria-label={`Move ${a.label || 'unnamed'} down`}
                      title="Move down"
                      data-attr-focus={`move:${a.id}:1`}
                      disabled={i === attributes.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                  </div>
                )}
              </div>
              {editing === a.id && !readOnly && (
                <AttributeForm
                  attribute={a}
                  onSave={(next) => {
                    change(attributes.map((x) => (x.id === a.id ? next : x)))
                    setEditing(null)
                    setFresh(null)
                    setFocusId(a.id)
                  }}
                  onCancel={() => close(a.id)}
                  onDelete={() => close(a.id, true)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div>
          <Button ref={addButton} variant="line" size="sm" onClick={add}>
            Add a detail
          </Button>
        </div>
      )}
    </div>
  )
}

function AttributeForm({ attribute, onSave, onCancel, onDelete }: { attribute: Attribute; onSave(a: Attribute): void; onCancel(): void; onDelete(): void }) {
  const [a, setA] = useState(attribute)
  const [options, setOptions] = useState((attribute.options ?? []).join('\n'))
  const [error, setError] = useState<{ label?: string; ask?: string; options?: string }>({})
  const first = useRef<HTMLInputElement>(null)
  const askRef = useRef<HTMLTextAreaElement>(null)
  const optionsRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    first.current?.focus()
  }, [])

  function save(e: FormEvent) {
    e.preventDefault()
    const opts = options
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean)
    const next = {
      label: a.label.trim() ? undefined : 'Give the detail a name.',
      ask: a.ask.trim() ? undefined : 'Write how the agent asks for it.',
      options: a.type === 'choice' && opts.length < 2 ? 'Give at least two options, one per line.' : undefined,
    }
    setError(next)
    if (next.label || next.ask || next.options) {
      // Focus the first field that needs fixing; its error is read with it.
      ;(next.label ? first : next.ask ? askRef : optionsRef).current?.focus()
      return
    }
    onSave({ ...a, label: a.label.trim(), ask: a.ask.trim(), options: a.type === 'choice' ? opts : undefined })
  }

  return (
    <form
      className="flow__form"
      onSubmit={save}
      noValidate
      aria-label={attribute.label ? `Edit ${attribute.label}` : 'New detail'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className="step__grid">
        <TextField ref={first} label="Name" value={a.label} maxLength={60} error={error.label} onChange={(e) => setA({ ...a, label: e.target.value })} />
        <SelectField
          label="Type"
          value={a.type}
          options={Object.entries(ATTRIBUTE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          onChange={(e) => setA({ ...a, type: e.target.value as AttributeType })}
        />
      </div>
      <TextAreaField ref={askRef} label="How the agent asks" rows={2} value={a.ask} error={error.ask} onChange={(e) => setA({ ...a, ask: e.target.value })} />
      {a.type === 'choice' && (
        <TextAreaField ref={optionsRef} label="Options" hint="One per line." rows={4} value={options} error={error.options} onChange={(e) => setOptions(e.target.value)} />
      )}
      <div className="step__stack">
        <Switch label="Required" hint="The agent won’t go on without it." checked={a.required} onChange={(v) => setA({ ...a, required: v })} />
        <Switch label="Personal data" hint="Hidden in transcripts when personal details are hidden." checked={a.personal} onChange={(v) => setA({ ...a, personal: v })} />
        <Switch label="Read it back" hint="The agent repeats it to the caller to check." checked={a.confirm} onChange={(v) => setA({ ...a, confirm: v })} />
      </div>
      <div className="flow__form-actions">
        <Button type="submit" variant="plum" size="sm">
          Save
        </Button>
        <Button variant="line" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <button type="button" className="btn-text flow__delete" onClick={onDelete}>
          Delete detail
        </button>
      </div>
    </form>
  )
}

/** Step 4: the details the agent collects. */
export function StepAttributes({ draft, update, showErrors, attempt, validator }: StepProps) {
  const check = () => checkAttributes(draft.attributes)
  validator.current = check
  const errors = showErrors ? check() : {}
  return (
    <div className="step">
      <ErrorSummary errors={errors} attempt={attempt} hrefFor={(id) => `#attr-${id}`} />
      <AttributesEditor attributes={draft.attributes} errors={errors} onChange={(attributes) => update((d) => ({ ...d, attributes }))} />
    </div>
  )
}
