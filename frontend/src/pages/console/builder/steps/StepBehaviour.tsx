import { useCallback, useId } from 'react'
import { LANGUAGE_LABEL } from '../../../../auth/roles'
import type { Language } from '../../../../auth/types'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { BotBehaviour, SpeakingRate, Tone, Voice } from '../../../../console/types'
import { Alert } from '../../../../components/ui/Alert'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import { Switch } from '../../../../components/ui/Switch'
import { VoicePreview } from '../../../../components/voice/VoicePreview'
import { useAsync, type Async } from '../../../../lib/useAsync'
import { ListEditor } from '../ListEditor'
import { ErrorSummary, type StepErrors, type StepProps } from '../StepShared'
import { checkPipeline, PipelineEditor } from '../PipelineEditor'
import { SpeechEditor } from '../../agent/tabs/BehaviourTab'
import { defaultSpeech } from '../../../../console/specDefaults'

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

/** Step 2: how the agent speaks, pronounces and listens, and its voice pipeline. */
export function StepBehaviour({ draft, update, showErrors, attempt, validator }: StepProps) {
  const client = useConsole()
  const load = useCallback(() => client.listVoices(), [client])
  const [voices, reload] = useAsync(load)
  const loadModels = useCallback(() => client.listModels(), [client])
  const [models] = useAsync(loadModels)
  const b = draft.behaviour
  const pipeline = draft.pipeline
  const pipeId = useId()

  const voice = voices.state === 'ready' ? voices.data.find((v) => v.id === b.voiceId) : undefined
  const check = () => {
    const e = { ...checkBehaviour(b, voice), ...checkPipeline(pipeline) }
    if (voices.state !== 'ready') e.voice = voices.state === 'error' ? 'Voices didn’t load. Try again before going on.' : 'Wait for the voices to load.'
    return e
  }
  validator.current = check
  const errors = showErrors ? check() : {}

  return (
    <div className="step">
      <ErrorSummary errors={errors} attempt={attempt} />
      <BehaviourEditor behaviour={b} onChange={(behaviour) => update((d) => ({ ...d, behaviour }))} errors={errors} voices={voices} onReloadVoices={reload} />
      <SpeechEditor speech={draft.speech ?? defaultSpeech()} onChange={(speech) => update((d) => ({ ...d, speech }))} />
      <details className="pipe__more" open={Object.keys(checkPipeline(pipeline)).length > 0 && showErrors ? true : undefined}>
        <summary id={pipeId}>Voice pipeline: models, turn-taking and interruptions</summary>
        <p className="step__sub step__sub--flat">Starts from settings that suit a busy hospital line. Change them only if test calls show a reason to.</p>
        <PipelineEditor pipeline={pipeline} onChange={(p) => update((d) => ({ ...d, pipeline: p }))} errors={errors} models={models.state === 'ready' ? models.data : null} />
      </details>
    </div>
  )
}

/** Persona, tone, languages, greeting, voice and rules; shared with the
 * agent workspace. The caller loads the voices, since its checks need them. */
export function BehaviourEditor({
  behaviour: b,
  onChange,
  errors,
  voices,
  onReloadVoices,
}: {
  behaviour: BotBehaviour
  onChange(next: BotBehaviour): void
  errors: StepErrors
  voices: Async<Voice[]>
  onReloadVoices(): void
}) {
  const set = (patch: Partial<BotBehaviour>) => onChange({ ...b, ...patch })
  const id = useId()
  const client = useConsole()
  return (
    <>
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
            <button type="button" className="btn-text" onClick={onReloadVoices}>
              Try again
            </button>
          </Alert>
        ) : (
          <ChoiceGroup
            legend="Voice"
            hint={client.previewVoice ? 'Hear the chosen voice with the button below the list.' : 'Voice previews arrive once AICA is connected to its voice servers.'}
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
        {voices.state === 'ready' && voices.data.some((v) => v.id === b.voiceId) && (
          <VoicePreview voiceId={b.voiceId} voiceName={voices.data.find((v) => v.id === b.voiceId)!.name} text={b.greeting} />
        )}
        <div className="step__narrow step__after">
          <SelectField label="Speaking speed" value={b.rate} options={RATES} onChange={(e) => set({ rate: e.target.value as SpeakingRate })} />
        </div>
      </section>

      <section className="step__section" aria-labelledby={`${id}-rules`}>
        <h2 id={`${id}-rules`} className="step__heading">
          Rules it must always follow
        </h2>
        <p className="step__sub">AICA checks every reply against these. Write each as one plain sentence.</p>
        <ListEditor
          items={b.rules}
          onChange={(rules) => set({ rules })}
          noun="rule"
          label="Add a rule"
          placeholder="e.g. Never quote a price that isn’t in the price list."
          empty="No rules yet. Add the things it must never do, and the things it must always do."
          max={MAX_RULES}
          minLength={8}
          tooShort="Write the rule as a short sentence."
        />
      </section>
    </>
  )
}
