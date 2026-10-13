import { useCallback, useRef, useState, type FormEvent } from 'react'
import { LANGUAGE_LABEL } from '../../../../auth/roles'
import type { Language } from '../../../../auth/types'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { BotBehaviour, SpeakingRate, Tone, Voice } from '../../../../console/types'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import { Switch } from '../../../../components/ui/Switch'
import { useAsync } from '../../../../lib/useAsync'
import { ErrorSummary, type StepErrors, type StepProps } from '../StepShared'

const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: 'warm', label: 'Warm', hint: '“Of course! Let me find a slot for you.”' },
  { value: 'formal', label: 'Formal', hint: '“Certainly. I will check the available times.”' },
  { value: 'brisk', label: 'Brisk', hint: '“Sure. Thursday 10:30 or Friday 4?”' },
]

const RATES: { value: SpeakingRate; label: string }[] = [
  { value: 'slower', label: 'Slower' },
  { value: 'normal', label: 'Normal' },
  { value: 'faster', label: 'Faster' },
]

const LANGS: Language[] = ['tamil', 'english', 'tanglish']
export const MAX_RULES = 12

/** Checks a behaviour; shared with the agent workspace. */
/** `voice` is the chosen voice, if it's one AICA has. */
export function checkBehaviour(b: BotBehaviour, voice: Voice | undefined): StepErrors {
  const e: StepErrors = {}
  const persona = b.persona.trim()
  if (persona.length < 2 || persona.length > 30) e.persona = 'Give the agent a spoken name of 2 to 30 characters.'
  if (b.languages.length === 0) e.languages = 'Choose at least one language.'
  else if (!b.languages.includes(b.startLanguage)) e.startLanguage = 'Choose a starting language from the ones it speaks.'
  if (!b.greeting.trim()) e.greeting = 'Write the greeting callers hear first.'
  else if (b.greeting.length > 300) e.greeting = 'Keep the greeting under 300 characters: callers hear all of it before they can speak.'
  if (b.closing.length > 200) e.closing = 'Keep the closing under 200 characters.'
  if (!voice) e.voice = 'Choose a voice.'
  else {
    const missing = b.languages.filter((l) => !voice.languages.includes(l))
    if (missing.length) e.voice = `This voice doesn't speak ${missing.map((l) => LANGUAGE_LABEL[l]).join(' or ')}. Choose another voice, or remove the language.`
  }
  return e
}

/** Step 2: how the agent speaks. */
export function StepBehaviour({ draft, update, showErrors, attempt, validator }: StepProps) {
  const client = useConsole()
  const load = useCallback(() => client.listVoices(), [client])
  const [voices, reload] = useAsync(load)
  const b = draft.behaviour
  const set = (patch: Partial<BotBehaviour>) => update((d) => ({ ...d, behaviour: { ...d.behaviour, ...patch } }))

  const voice = voices.state === 'ready' ? voices.data.find((v) => v.id === b.voiceId) : undefined
  const check = () => {
    const e = checkBehaviour(b, voice)
    if (voices.state !== 'ready') e.voice = voices.state === 'error' ? 'Voices didn’t load. Try again before going on.' : 'Wait for the voices to load.'
    return e
  }
  validator.current = check
  const errors = showErrors ? check() : {}

  return (
    <div className="step">
      <ErrorSummary errors={errors} attempt={attempt} />

      <section className="step__section step__narrow">
        <TextField
          label="Spoken name"
          hint="What it calls itself on the phone, e.g. “This is Kavya from…”."
          value={b.persona}
          maxLength={40}
          error={errors.persona}
          onChange={(e) => set({ persona: e.target.value })}
        />
      </section>

      <section className="step__section">
        <ChoiceGroup legend="Tone" type="radio" columns={3} options={TONES} value={[b.tone]} onChange={([v]) => set({ tone: v })} />
      </section>

      <section className="step__section step__grid">
        <ChoiceGroup
          legend="Languages it speaks"
          type="checkbox"
          columns={3}
          error={errors.languages}
          options={LANGS.map((l) => ({ value: l, label: LANGUAGE_LABEL[l], lang: l === 'tamil' ? 'ta' : undefined }))}
          value={b.languages}
          onChange={(next) => set({ languages: LANGS.filter((l) => next.includes(l)), startLanguage: next.includes(b.startLanguage) ? b.startLanguage : (next[0] ?? b.startLanguage) })}
        />
        <SelectField
          label="Greets callers in"
          error={errors.startLanguage}
          value={b.startLanguage}
          options={(b.languages.length ? b.languages : LANGS).map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
          onChange={(e) => set({ startLanguage: e.target.value as Language })}
        />
        {b.languages.length > 1 && (
          <Switch
            label="Follow the caller’s language"
            hint="Switches when the caller does, even mid-sentence."
            checked={b.followCaller}
            onChange={(v) => set({ followCaller: v })}
          />
        )}
      </section>

      <section className="step__section step__grid">
        <TextAreaField
          label="Greeting"
          hint={`${b.greeting.length}/300. The first thing callers hear.`}
          rows={3}
          value={b.greeting}
          error={errors.greeting}
          onChange={(e) => set({ greeting: e.target.value })}
        />
        <TextAreaField
          label="Closing"
          hint="Said at the end of a call. Optional."
          rows={3}
          value={b.closing}
          error={errors.closing}
          onChange={(e) => set({ closing: e.target.value })}
        />
      </section>

      <section className="step__section">
        {voices.state === 'error' ? (
          <Alert tone="error" title="Couldn't load voices">
            <p>{asAuthError(voices.error).message}</p>
            <button type="button" className="btn-text" onClick={reload}>
              Try again
            </button>
          </Alert>
        ) : (
          <ChoiceGroup
            legend="Voice"
            hint="Voice previews arrive once AICA is connected to its voice servers."
            type="radio"
            columns={2}
            error={errors.voice}
            options={
              voices.state === 'ready'
                ? voices.data.map((v) => ({ value: v.id, label: v.name, hint: `${v.description} ${v.languages.map((l) => LANGUAGE_LABEL[l]).join(', ')}.` }))
                : []
            }
            value={[b.voiceId]}
            onChange={([v]) => set({ voiceId: v })}
          />
        )}
        <div className="step__narrow step__after">
          <SelectField label="Speaking speed" value={b.rate} options={RATES} onChange={(e) => set({ rate: e.target.value as SpeakingRate })} />
        </div>
      </section>

      <section className="step__section" aria-labelledby="rules-h">
        <h2 id="rules-h" className="step__heading">
          Rules it must always follow
        </h2>
        <p className="step__sub">AICA checks every reply against these. Write each as one plain sentence.</p>
        <RulesEditor rules={b.rules} onChange={(rules) => set({ rules })} />
      </section>
    </div>
  )
}

function RulesEditor({ rules, onChange }: { rules: string[]; onChange(rules: string[]): void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Announced politely after adding or removing. */
  const [note, setNote] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  function add(e: FormEvent) {
    e.preventDefault()
    const rule = text.trim()
    if (rule.length < 8) setError('Write the rule as a short sentence.')
    else if (rule.length > 160) setError('Keep each rule under 160 characters.')
    else if (rules.some((r) => r.toLowerCase() === rule.toLowerCase())) setError('That rule is already in the list.')
    else if (rules.length >= MAX_RULES) setError(`Up to ${MAX_RULES} rules. Remove one first.`)
    else {
      onChange([...rules, rule])
      setText('')
      setError(null)
      setNote(`Rule added. ${rules.length + 1} rules.`)
      return
    }
    input.current?.focus()
  }

  function remove(i: number) {
    onChange(rules.filter((_, j) => j !== i))
    setNote(`Rule removed. ${rules.length - 1} ${rules.length - 1 === 1 ? 'rule' : 'rules'} left.`)
    // Focus stays in the list: the next rule's button, else the input.
    requestAnimationFrame(() => {
      const buttons = list.current?.querySelectorAll('button')
      ;(buttons?.[Math.min(i, (buttons?.length ?? 1) - 1)] ?? input.current)?.focus()
    })
  }

  return (
    <div className="rules">
      {rules.length > 0 ? (
        <ul className="rules__list" ref={list}>
          {rules.map((r, i) => (
            <li key={r} className="rules__item">
              <span>{r}</span>
              <button type="button" className="btn-text" onClick={() => remove(i)} aria-label={`Remove rule: ${r}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-note">No rules yet. Add the things it must never do, and the things it must always do.</p>
      )}
      <p className="sr-only" role="status">
        {note}
      </p>
      {/* Its own small form: Enter adds the rule. */}
      <form onSubmit={add} noValidate className="rules__form">
          <TextField
            ref={input}
            label="Add a rule"
            value={text}
            placeholder="e.g. Never quote a price that isn’t in the price list."
            error={error}
            onChange={(e) => {
              setText(e.target.value)
              if (error) setError(null)
            }}
          />
          <Button type="submit" variant="line" className="rules__button">
            Add rule
          </Button>
      </form>
    </div>
  )
}
