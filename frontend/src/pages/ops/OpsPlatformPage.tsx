import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { LANGUAGE_LABEL } from '../../auth/roles'
import { asAuthError } from '../../auth/types'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ChoiceGroup } from '../../components/ui/Choice'
import { Checkbox, TextField } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Spinner'
import type { Plan } from '../../console/types'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { ModelChoice, PlatformSettings, PlatformSettingsInput } from '../../ops/types'
import { useAsync } from '../../lib/useAsync'
import { timeAgo } from '../../lib/time'
import { useAnnouncer } from '../console/operate/LiveBits'
import '../console/manage/Manage.css'
import './Ops.css'

const SERVICE_LABEL: Record<keyof ModelChoice, { name: string; hint: string }> = {
  speech: { name: 'Speech recognition', hint: 'Turns callers’ speech into text.' },
  voice: { name: 'Voice', hint: 'Speaks the agents’ replies.' },
  language: { name: 'Language model', hint: 'Decides what the agent says.' },
}
const PLAN_FIELDS: { key: keyof Pick<Plan, 'price' | 'minutes' | 'agents' | 'numbers' | 'extraMinute'>; label: string; hint?: string }[] = [
  { key: 'price', label: 'Price a month (₹)', hint: 'Before GST.' },
  { key: 'minutes', label: 'Call minutes' },
  { key: 'agents', label: 'Agents' },
  { key: 'numbers', label: 'Phone numbers' },
  { key: 'extraMinute', label: 'Each extra minute (₹)' },
]

/** Plan numbers as typed: kept as text so a half-typed value isn't lost. */
type PlanText = Plan & { text: Record<string, string> }

const toForm = (s: PlatformSettings) => ({
  models: { ...s.models },
  voices: Object.fromEntries(s.voices.map((v) => [v.id, v.enabled])),
  plans: s.plans.map((p): PlanText => ({ ...p, text: Object.fromEntries(PLAN_FIELDS.map((f) => [f.key, String(p[f.key])])) })),
})
type Form = ReturnType<typeof toForm>
const toInput = (f: Form): PlatformSettingsInput => ({
  models: f.models,
  voices: f.voices,
  plans: f.plans.map(({ text, ...p }) => ({ ...p, ...Object.fromEntries(PLAN_FIELDS.map((x) => [x.key, text[x.key].trim() === '' ? NaN : Number(text[x.key])])) })),
})

/** /ops/platform: default models, the voice catalogue and plans. Master admin only. */
export default function OpsPlatformPage() {
  const { user } = useAuth()
  const ops = useOpsData()
  const isMaster = user?.platformRole === 'master_admin'
  const load = useCallback(() => ops.getPlatformSettings(), [ops])
  const [saved, reload, setSaved] = useAsync(load)

  if (!isMaster) {
    return (
      <OpsLayout kicker="Platform" docTitle="Platform settings" title="Platform settings">
        <Alert tone="info">Only the master admin can see and change platform settings.</Alert>
      </OpsLayout>
    )
  }

  return (
    <OpsLayout
      kicker="Platform"
      docTitle="Platform settings"
      title="Platform settings"
      demoData
      lede={<p>What every organisation gets: the models behind their agents, the voices they can choose, and what each plan includes.</p>}
    >
      {saved.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading settings…</span>
        </div>
      )}
      {saved.state === 'error' && (
        <Alert tone="error" title="Couldn't load platform settings">
          <p>{asAuthError(saved.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {saved.state === 'ready' && <PlatformForm settings={saved.data} onSaved={(s) => setSaved({ state: 'ready', data: s })} />}
    </OpsLayout>
  )
}

function PlatformForm({ settings, onSaved }: { settings: PlatformSettings; onSaved(s: PlatformSettings): void }) {
  const ops = useOpsData()
  const id = useId()
  const [form, setForm] = useState<Form>(() => toForm(settings))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, say] = useAnnouncer()
  const dirty = JSON.stringify(toInput(form)) !== JSON.stringify(toInput(toForm(settings)))

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy || !dirty) return
    setBusy(true)
    setError(null)
    try {
      const next = await ops.updatePlatformSettings(toInput(form))
      onSaved(next)
      setForm(toForm(next))
      say('Platform settings saved. Organisations see them from their next page load.')
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const setPlan = (i: number, key: string, v: string) => setForm((f) => ({ ...f, plans: f.plans.map((p, j) => (j === i ? { ...p, text: { ...p.text, [key]: v } } : p)) }))

  return (
    <form className="set-form" onSubmit={save} noValidate>
      <p className="sr-only" role="status">
        {note}
      </p>
      <section className="set-card" aria-labelledby={`${id}-models`}>
        <h2 className="lib__heading" id={`${id}-models`}>
          Default models
        </h2>
        <p className="lib__sub">Which model each service runs for new and existing agents. Names only: the services’ addresses and keys live in server configuration, never here.</p>
        {(Object.keys(SERVICE_LABEL) as (keyof ModelChoice)[]).map((k) => (
          <ChoiceGroup<string>
            key={k}
            legend={SERVICE_LABEL[k].name}
            hint={SERVICE_LABEL[k].hint}
            type="radio"
            options={settings.modelOptions[k].map((o) => ({ value: o.id, label: o.label, hint: o.note }))}
            value={[form.models[k]]}
            onChange={([v]) => setForm((f) => ({ ...f, models: { ...f.models, [k]: v } }))}
          />
        ))}
      </section>

      <section className="set-card" aria-labelledby={`${id}-voices`}>
        <h2 className="lib__heading" id={`${id}-voices`}>
          Voices
        </h2>
        <p className="lib__sub">The voices organisations can give their agents. Agents already using a voice you switch off keep it.</p>
        <ul className="ops-voices">
          {settings.voices.map((v) => (
            <li key={v.id}>
              <Checkbox
                label={`Offer ${v.name}`}
                hint={`${v.description} ${v.languages.map((l) => LANGUAGE_LABEL[l]).join(', ')}.${v.id === 'kavya' ? ' New agents start with this voice, so it stays on.' : ''}`}
                checked={form.voices[v.id]}
                disabled={v.id === 'kavya'}
                onChange={(e) => setForm((f) => ({ ...f, voices: { ...f.voices, [v.id]: e.target.checked } }))}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="set-card" aria-labelledby={`${id}-plans`}>
        <h2 className="lib__heading" id={`${id}-plans`}>
          Plans
        </h2>
        <p className="lib__sub">What each plan costs and includes. A change applies to every organisation on it from their next billing period; smaller limits never remove agents or numbers already set up.</p>
        <div className="ops-plans">
          {form.plans.map((p, i) => (
            <fieldset key={p.id} className="ops-plan">
              <legend className="ops-plan__name">{p.name}</legend>
              {PLAN_FIELDS.map((f) => (
                <TextField
                  key={f.key}
                  label={f.label}
                  hint={f.hint}
                  inputMode="numeric"
                  value={p.text[f.key]}
                  onChange={(e) => setPlan(i, f.key, e.target.value.replace(/[^\d]/g, ''))}
                />
              ))}
            </fieldset>
          ))}
        </div>
      </section>

      <div className="set-bar">
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="set-bar__row">
          <Button type="submit" variant="plum" busy={busy} busyLabel="Saving…" aria-disabled={!dirty || undefined}>
            Save changes
          </Button>
          {dirty ? (
            <>
              <span className="set-bar__state">Unsaved changes</span>
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setForm(toForm(settings))
                  setError(null)
                  say('Changes undone.')
                }}
              >
                Undo changes
              </button>
            </>
          ) : (
            <span className="set-bar__state">
              Last changed by {settings.updatedBy} {timeAgo(settings.updatedAt)}.
            </span>
          )}
        </div>
      </div>
    </form>
  )
}
