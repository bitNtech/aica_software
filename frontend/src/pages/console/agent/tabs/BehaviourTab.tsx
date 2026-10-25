import { useId, useRef, useState, type FormEvent } from 'react'
import { LANGUAGE_LABEL } from '../../../../auth/roles'
import type { SpeechSettings } from '../../../../console/types'
import { Button } from '../../../../components/ui/Button'
import { SelectField, TextField } from '../../../../components/ui/Field'
import { Switch } from '../../../../components/ui/Switch'
import { ListEditor } from '../../builder/ListEditor'
import { BehaviourEditor } from '../../builder/steps/StepBehaviour'
import type { TabProps } from '../shared'

const SILENCE = [5, 8, 12, 20].map((n) => ({ value: String(n), label: `${n} seconds` }))
const TONE_LABEL = { warm: 'Warm', formal: 'Formal', brisk: 'Brisk' } as const
const RATE_LABEL = { slower: 'Slower', normal: 'Normal', faster: 'Faster' } as const

/** Builder step 2, plus how it pronounces and listens. */
export function BehaviourTab({ spec, update, readOnly, errors, lib }: TabProps) {
  const b = spec.behaviour
  const sp = spec.speech

  if (readOnly) {
    const voice = lib.voices.find((v) => v.id === b.voiceId)
    return (
      <div className="ws__sections">
        <dl className="review__list">
          {[
            ['Spoken name', b.persona],
            ['Tone', TONE_LABEL[b.tone]],
            ['Languages', `${b.languages.map((l) => LANGUAGE_LABEL[l]).join(', ')}; greets in ${LANGUAGE_LABEL[b.startLanguage]}${b.followCaller ? ', follows the caller' : ''}`],
            ['Greeting', b.greeting],
            ['Closing', b.closing || 'None'],
            ['Voice', `${voice?.name ?? b.voiceId}, ${RATE_LABEL[b.rate].toLowerCase()} speed`],
            ['Rules', b.rules.length ? b.rules.join(' · ') : 'None'],
            ['Pronunciations', sp.pronunciations.length ? sp.pronunciations.map((p) => `${p.word} → ${p.sayAs}`).join(' · ') : 'None'],
            ['Words to listen for', sp.hints.length ? sp.hints.join(', ') : 'None'],
            ['Interruptions', sp.allowInterruptions ? 'Callers can talk over it' : 'Callers can’t talk over it'],
            ['If the caller goes quiet', `It checks in after ${sp.silenceSec} seconds`],
          ].map(([k, v]) => (
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
      <BehaviourEditor
        behaviour={b}
        onChange={(behaviour) => update((s) => ({ ...s, behaviour }))}
        errors={errors}
        voices={{ state: 'ready', data: lib.voices }}
        onReloadVoices={() => {}}
      />

      <SpeechEditor speech={sp} onChange={(speech) => update((s) => ({ ...s, speech }))} />
    </div>
  )
}

/** How it pronounces and listens: shared by this tab and the builder. */
export function SpeechEditor({ speech: sp, onChange }: { speech: SpeechSettings; onChange(next: SpeechSettings): void }) {
  const id = useId()
  const setSpeech = (patch: Partial<SpeechSettings>) => onChange({ ...sp, ...patch })
  return (
    <>
      <section className="step__section" aria-labelledby={`${id}-say`}>
        <h2 id={`${id}-say`} className="step__heading">
          Pronunciations
        </h2>
        <p className="step__sub">Names and words it should say a particular way. Write them as they sound.</p>
        <PronunciationsEditor items={sp.pronunciations} onChange={(pronunciations) => setSpeech({ pronunciations })} />
      </section>

      <section className="step__section" aria-labelledby={`${id}-hear`}>
        <h2 id={`${id}-hear`} className="step__heading">
          Words to listen for
        </h2>
        <p className="step__sub">Doctor names, departments and local places callers say, so it hears them right.</p>
        <ListEditor
          items={sp.hints}
          onChange={(hints) => setSpeech({ hints })}
          noun="word"
          label="Add a word or name"
          placeholder="e.g. Ramachandran"
          empty="None yet."
          max={50}
          maxLength={40}
        />
      </section>

      <section className="step__section" aria-labelledby={`${id}-turns`}>
        <h2 id={`${id}-turns`} className="step__heading">
          Taking turns
        </h2>
        <div className="step__stack">
          <Switch
            label="Let callers interrupt"
            hint="The agent stops talking when the caller starts, as a person would."
            checked={sp.allowInterruptions}
            onChange={(allowInterruptions) => setSpeech({ allowInterruptions })}
          />
        </div>
        <div className="step__narrow">
          <SelectField
            label="When the caller goes quiet, check after"
            value={String(sp.silenceSec)}
            options={SILENCE}
            onChange={(e) => setSpeech({ silenceSec: Number(e.target.value) })}
          />
        </div>
      </section>
    </>
  )
}

function PronunciationsEditor({ items, onChange }: { items: SpeechSettings['pronunciations']; onChange(next: SpeechSettings['pronunciations']): void }) {
  const [word, setWord] = useState('')
  const [sayAs, setSayAs] = useState('')
  const [error, setError] = useState<{ word?: string; sayAs?: string }>({})
  const [note, setNote] = useState('')
  const wordRef = useRef<HTMLInputElement>(null)
  const sayRef = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  function add(e: FormEvent) {
    e.preventDefault()
    const w = word.trim()
    const s = sayAs.trim()
    const next = {
      word: !w ? 'Write the word or name.' : items.some((p) => p.word.toLowerCase() === w.toLowerCase()) ? 'That word is already in the list.' : undefined,
      sayAs: !s ? 'Write how it sounds.' : undefined,
    }
    setError(next)
    if (next.word || next.sayAs) {
      ;(next.word ? wordRef : sayRef).current?.focus()
      return
    }
    onChange([...items, { word: w, sayAs: s }])
    setWord('')
    setSayAs('')
    setNote(`Pronunciation added for ${w}.`)
    wordRef.current?.focus()
  }

  function remove(i: number) {
    const gone = items[i]
    onChange(items.filter((_, j) => j !== i))
    setNote(`Removed ${gone.word}.`)
    requestAnimationFrame(() => {
      const buttons = list.current?.querySelectorAll('button')
      ;(buttons?.[Math.min(i, (buttons?.length ?? 1) - 1)] ?? wordRef.current)?.focus()
    })
  }

  return (
    <div className="rules">
      {items.length > 0 ? (
        <ul className="rules__list" ref={list}>
          {items.map((p, i) => (
            <li key={p.word} className="rules__item">
              <span>
                <strong>{p.word}</strong> <span aria-hidden="true">→</span>
                <span className="sr-only"> said as </span> {p.sayAs}
              </span>
              <button type="button" className="btn-text" aria-label={`Remove pronunciation: ${p.word}`} onClick={() => remove(i)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-note">None yet.</p>
      )}
      <p className="sr-only" role="status">
        {note}
      </p>
      <form onSubmit={add} noValidate className="ws__pron-form">
        <TextField ref={wordRef} label="Word or name" value={word} maxLength={60} error={error.word} onChange={(e) => setWord(e.target.value)} />
        <TextField ref={sayRef} label="Say it as" placeholder="e.g. Raa-ma-chan-dran" value={sayAs} maxLength={80} error={error.sayAs} onChange={(e) => setSayAs(e.target.value)} />
        <Button type="submit" variant="line" className="rules__button">
          Add
        </Button>
      </form>
    </div>
  )
}
