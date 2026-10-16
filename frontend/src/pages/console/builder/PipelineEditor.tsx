import { useId } from 'react'
import type { ModelCatalogue, PipelineSettings } from '../../../console/types'
import { ChoiceGroup } from '../../../components/ui/Choice'
import { SelectField, TextField } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import { ListEditor } from './ListEditor'
import type { StepErrors } from './StepShared'

/**
 * How an agent listens and replies, the way voice-agent frameworks such as
 * LiveKit Agents and Pipecat expose it: which speech, language and voice
 * models run, when it decides the caller has finished, what counts as an
 * interruption, and what it does while it thinks. The master admin's;
 * hospitals see it read-only.
 */

const TURN = [
  { value: 'semantic' as const, label: 'Listens for a finished thought', hint: 'Waits through “umm…” and pauses mid-sentence. Best for most calls.' },
  { value: 'vad' as const, label: 'Replies after a pause', hint: 'Simpler and a little quicker, but may cut in on slow speakers.' },
]
const NOISE = [
  { value: 'off' as const, label: 'Off' },
  { value: 'standard' as const, label: 'Standard' },
  { value: 'strong' as const, label: 'Strong', hint: 'For callers on busy roads or wards.' },
]
const AMBIENCE = [
  { value: 'none' as const, label: 'None' },
  { value: 'office' as const, label: 'Quiet office' },
  { value: 'reception' as const, label: 'Hospital reception' },
]

export const TURN_LABEL: Record<PipelineSettings['turnDetection'], string> = { semantic: 'Listens for a finished thought', vad: 'Replies after a pause' }
export const NOISE_LABEL: Record<PipelineSettings['noiseCancellation'], string> = { off: 'Off', standard: 'Standard', strong: 'Strong' }
export const AMBIENCE_LABEL: Record<PipelineSettings['ambience'], string> = { none: 'None', office: 'Quiet office', reception: 'Hospital reception' }

export function checkPipeline(p: PipelineSettings): StepErrors {
  const e: StepErrors = {}
  const whole = (n: number) => Number.isFinite(n) && Math.round(n) === n
  if (!whole(p.minEndpointMs) || p.minEndpointMs < 200 || p.minEndpointMs > 2000) e.minEndpointMs = 'Wait at least 200 and at most 2,000 ms after the caller stops.'
  if (!whole(p.maxEndpointMs) || p.maxEndpointMs < p.minEndpointMs || p.maxEndpointMs > 6000) e.maxEndpointMs = 'The longest wait must be at least the shortest, and at most 6,000 ms.'
  if (!whole(p.interruptMinWords) || p.interruptMinWords < 0 || p.interruptMinWords > 5) e.interruptMinWords = 'Use 0 to 5 words.'
  if (!whole(p.interruptMinMs) || p.interruptMinMs < 200 || p.interruptMinMs > 2000) e.interruptMinMs = 'Use 200 to 2,000 ms.'
  if (!whole(p.silenceReprompts) || p.silenceReprompts < 0 || p.silenceReprompts > 5) e.silenceReprompts = 'Use 0 to 5 times.'
  if (!Number.isFinite(p.temperature) || p.temperature < 0 || p.temperature > 1) e.temperature = 'Use a number from 0 to 1.'
  return e
}

/** "default" shown as the platform's current choice, by name. */
export function modelName(models: ModelCatalogue | null, kind: 'speech' | 'language' | 'voice', id: string): string {
  if (!models) return id === 'default' ? 'Platform default' : id
  const real = id === 'default' ? models.defaults[kind] : id
  const label = models[kind].find((m) => m.id === real)?.label ?? real
  return id === 'default' ? `Platform default (${label})` : label
}

interface Props {
  pipeline: PipelineSettings
  onChange(p: PipelineSettings): void
  errors: StepErrors
  models: ModelCatalogue | null
}

export function PipelineEditor({ pipeline: p, onChange, errors, models }: Props) {
  const id = useId()
  const set = (patch: Partial<PipelineSettings>) => onChange({ ...p, ...patch })
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v))
  const modelOptions = (kind: 'speech' | 'language' | 'voice') => [
    { value: 'default', label: modelName(models, kind, 'default') },
    ...(models?.[kind] ?? []).map((m) => ({ value: m.id, label: `${m.label}: ${m.note}` })),
  ]

  return (
    <>
      <section className="step__section" aria-labelledby={`${id}-models`}>
        <h2 id={`${id}-models`} className="step__heading">
          Models
        </h2>
        <p className="step__sub">From the platform catalogue. The platform default changes when bitNtech moves every agent to a newer model.</p>
        <div className="pipe__grid">
          <SelectField label="Speech recognition" value={p.speechModel} options={modelOptions('speech')} onChange={(e) => set({ speechModel: e.target.value })} />
          <SelectField label="Language model" value={p.languageModel} options={modelOptions('language')} onChange={(e) => set({ languageModel: e.target.value })} />
          <SelectField label="Voice" hint="The voice itself is chosen above." value={p.voiceModel} options={modelOptions('voice')} onChange={(e) => set({ voiceModel: e.target.value })} />
          <TextField
            label="Variety (temperature)"
            hint="0 to 1. Lower keeps the wording the same each time."
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            max="1"
            value={Number.isNaN(p.temperature) ? '' : String(p.temperature)}
            error={errors.temperature}
            onChange={(e) => set({ temperature: num(e.target.value) })}
          />
        </div>
      </section>

      <section className="step__section" aria-labelledby={`${id}-turn`}>
        <h2 id={`${id}-turn`} className="step__heading">
          Turn-taking
        </h2>
        <ChoiceGroup legend="When it replies" type="radio" options={TURN} value={[p.turnDetection]} onChange={([v]) => set({ turnDetection: v })} />
        <div className="pipe__grid">
          <TextField
            label="Shortest wait (ms)"
            hint="After the caller stops, before replying."
            type="number"
            inputMode="numeric"
            value={Number.isNaN(p.minEndpointMs) ? '' : String(p.minEndpointMs)}
            error={errors.minEndpointMs}
            onChange={(e) => set({ minEndpointMs: num(e.target.value) })}
          />
          <TextField
            label="Longest wait (ms)"
            hint="When the caller seems unfinished."
            type="number"
            inputMode="numeric"
            value={Number.isNaN(p.maxEndpointMs) ? '' : String(p.maxEndpointMs)}
            error={errors.maxEndpointMs}
            onChange={(e) => set({ maxEndpointMs: num(e.target.value) })}
          />
        </div>
        <Switch label="Start on a reply early" hint="Begins working out the reply before the caller has quite finished, so it answers sooner." checked={p.preemptiveReplies} onChange={(v) => set({ preemptiveReplies: v })} />
        <Switch label="Small acknowledgements" hint="Says “mm” or “sari” while the caller talks, as people do." checked={p.backchannel} onChange={(v) => set({ backchannel: v })} />
      </section>

      <section className="step__section" aria-labelledby={`${id}-cut`}>
        <h2 id={`${id}-cut`} className="step__heading">
          Interruptions
        </h2>
        <p className="step__sub">Whether callers can talk over it at all is under Behaviour; these decide what counts.</p>
        <div className="pipe__grid">
          <TextField
            label="Words before it stops"
            type="number"
            inputMode="numeric"
            value={Number.isNaN(p.interruptMinWords) ? '' : String(p.interruptMinWords)}
            error={errors.interruptMinWords}
            onChange={(e) => set({ interruptMinWords: num(e.target.value) })}
          />
          <TextField
            label="Shortest interruption (ms)"
            hint="A cough or “hm” shorter than this is ignored."
            type="number"
            inputMode="numeric"
            value={Number.isNaN(p.interruptMinMs) ? '' : String(p.interruptMinMs)}
            error={errors.interruptMinMs}
            onChange={(e) => set({ interruptMinMs: num(e.target.value) })}
          />
        </div>
        <Switch label="Carry on after a false interruption" hint="If it stopped for noise, it picks up where it was." checked={p.resumeAfterFalseInterruption} onChange={(v) => set({ resumeAfterFalseInterruption: v })} />
      </section>

      <section className="step__section" aria-labelledby={`${id}-line`}>
        <h2 id={`${id}-line`} className="step__heading">
          On the line
        </h2>
        <ChoiceGroup legend="Noise cancellation" type="radio" columns={3} options={NOISE} value={[p.noiseCancellation]} onChange={([v]) => set({ noiseCancellation: v })} />
        <ChoiceGroup legend="Background sound" hint="Quiet sound behind the agent, so silence doesn’t sound like a dropped call." type="radio" columns={3} options={AMBIENCE} value={[p.ambience]} onChange={([v]) => set({ ambience: v })} />
        <Switch label="Keypad input" hint="Callers can type numbers, such as a patient ID, on their phone’s keypad." checked={p.keypadInput} onChange={(v) => set({ keypadInput: v })} />
        <div className="pipe__grid">
          <TextField
            label="Checks before hanging up on silence"
            type="number"
            inputMode="numeric"
            value={Number.isNaN(p.silenceReprompts) ? '' : String(p.silenceReprompts)}
            error={errors.silenceReprompts}
            onChange={(e) => set({ silenceReprompts: num(e.target.value) })}
          />
        </div>
        <h3 className="step__subhead">While a tool runs</h3>
        <ListEditor
          items={p.fillerPhrases}
          onChange={(fillerPhrases) => set({ fillerPhrases })}
          noun="phrase"
          label="Add a phrase"
          placeholder="e.g. One moment, let me check."
          empty="None: the line is quiet while it looks things up."
          max={6}
          maxLength={80}
        />
      </section>
    </>
  )
}

/** The same settings as a list, for people who can't change them. */
export function PipelineSummary({ pipeline: p, models }: { pipeline: PipelineSettings; models: ModelCatalogue | null }) {
  const rows: [string, string][] = [
    ['Speech recognition', modelName(models, 'speech', p.speechModel)],
    ['Language model', modelName(models, 'language', p.languageModel)],
    ['Voice model', modelName(models, 'voice', p.voiceModel)],
    ['When it replies', `${TURN_LABEL[p.turnDetection]}; waits ${p.minEndpointMs}–${p.maxEndpointMs} ms`],
    ['Interruptions', `${p.interruptMinWords} ${p.interruptMinWords === 1 ? 'word' : 'words'} and ${p.interruptMinMs} ms count${p.resumeAfterFalseInterruption ? '; carries on after noise' : ''}`],
    ['While talking', [p.preemptiveReplies && 'starts replies early', p.backchannel && 'small acknowledgements'].filter(Boolean).join(', ') || 'Nothing extra'],
    ['Noise cancellation', NOISE_LABEL[p.noiseCancellation]],
    ['Background sound', AMBIENCE_LABEL[p.ambience]],
    ['Keypad input', p.keypadInput ? 'On' : 'Off'],
    ['On silence', `Checks ${p.silenceReprompts} ${p.silenceReprompts === 1 ? 'time' : 'times'}, then ends the call`],
    ['While a tool runs', p.fillerPhrases.length ? p.fillerPhrases.join(' · ') : 'Quiet'],
  ]
  return (
    <dl className="review__list">
      {rows.map(([k, v]) => (
        <div key={k} className="review__row review__row--two">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}
