import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { LANGUAGE_LABEL } from '../../../auth/roles'
import { asAuthError, type Language } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import type { ClosedDay, DayHours, OrgSettings, OrgSettingsInput } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ChoiceGroup } from '../../../components/ui/Choice'
import { Checkbox, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { timeAgo } from '../../../lib/time'
import { useAnnouncer } from '../operate/LiveBits'
import '../library/Library.css'
import '../operate/Operate.css'
import './Manage.css'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const LANGS = Object.keys(LANGUAGE_LABEL) as Language[]

type Errors = Partial<Record<'name' | 'city' | 'languages' | `hours-${number}` | 'closedDate' | 'closedLabel', string>>

function check(f: OrgSettingsInput): Errors {
  const e: Errors = {}
  const name = f.name.trim()
  // The same rules as the server (backend/app/routes/org/settings.py); the name's are sign-up's.
  if (name.length < 3 || name.length > 120) e.name = 'Give the organisation a name of 3 to 120 characters.'
  if (f.city.trim().length < 2 || f.city.trim().length > 80) e.city = 'Give the city, e.g. Coimbatore.'
  if (f.languages.length === 0) e.languages = 'Choose at least one language callers use.'
  f.hours.forEach((h, i) => {
    if (h.open && (!h.from || !h.to || h.from >= h.to)) e[`hours-${i}`] = `${DAYS[i]}: opening time must be before closing time.`
  })
  return e
}

const label12 = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}
const dateLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const toInput = (s: OrgSettings): OrgSettingsInput => ({ name: s.name, city: s.city, languages: s.languages, hours: s.hours, closed: s.closed })

/** /o/:slug/settings: name, city, languages, business hours. Owners and admins. */
export default function OrgSettingsPage() {
  const { org } = useOrg()
  const client = useConsole()
  const load = useCallback(() => client.getOrgSettings(org.orgSlug), [client, org.orgSlug])
  const [saved, reload, setSaved] = useAsync(load)

  return (
    <ConsolePage
      section="settings"
      kicker="Manage"
      title="Organisation settings"
      docTitle="Organisation settings"
      lede={<p>Your organisation’s name, the languages callers use, and when your team is in to take calls the agents hand over.</p>}
    >
      {saved.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading settings…</span>
        </div>
      )}
      {saved.state === 'error' && (
        <Alert tone="error" title="Couldn't load the settings">
          <p>{asAuthError(saved.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {saved.state === 'ready' && <SettingsForm settings={saved.data} onSaved={(s) => setSaved({ state: 'ready', data: s })} />}
    </ConsolePage>
  )
}

function SettingsForm({ settings, onSaved }: { settings: OrgSettings; onSaved(s: OrgSettings): void }) {
  const { org } = useOrg()
  const client = useConsole()
  const id = useId()
  const [form, setForm] = useState<OrgSettingsInput>(() => toInput(settings))
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, say] = useAnnouncer()
  const [renamed, setRenamed] = useState(false)
  const [newDay, setNewDay] = useState<ClosedDay>({ date: '', label: '' })
  const [dayErrors, setDayErrors] = useState<Errors>({})
  const formRef = useRef<HTMLFormElement>(null)
  const closedHeading = useRef<HTMLHeadingElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(toInput(settings))

  // A page left with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const set = <K extends keyof OrgSettingsInput>(k: K, v: OrgSettingsInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setDay = (i: number, patch: Partial<DayHours>) => set('hours', form.hours.map((h, j) => (j === i ? { ...h, ...patch } : h)))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy || !dirty) return
    const found = check(form)
    setErrors(found)
    setError(null)
    if (Object.keys(found).length) {
      // The first field to fix takes focus; its message is its description.
      window.setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0)
      return
    }
    setBusy(true)
    try {
      const next = await client.updateOrgSettings(org.orgSlug, form)
      setRenamed(next.name !== settings.name)
      onSaved(next)
      setForm(toInput(next))
      say('Settings saved.')
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  function addDay() {
    const e: Errors = {}
    if (!newDay.date) e.closedDate = 'Choose the date.'
    else if (form.closed.some((c) => c.date === newDay.date)) e.closedDate = `${dateLabel(newDay.date)} is already listed.`
    if (!newDay.label.trim()) e.closedLabel = 'Name the day, e.g. Pongal.'
    setDayErrors(e)
    if (Object.keys(e).length) {
      if (e.closedDate) dateRef.current?.focus()
      return
    }
    set('closed', [...form.closed, { date: newDay.date, label: newDay.label.trim() }].sort((a, b) => a.date.localeCompare(b.date)))
    setNewDay({ date: '', label: '' })
    say(`${newDay.label.trim()} added. Save to keep it.`)
    dateRef.current?.focus()
  }

  return (
    <form ref={formRef} className="set-form" onSubmit={save} noValidate>
      <p className="sr-only" role="status">
        {note}
      </p>
      <section className="set-card" aria-labelledby={`${id}-org`}>
        <h2 className="lib__heading" id={`${id}-org`}>
          Organisation
        </h2>
        <p className="lib__sub">Callers hear the name in the agents’ greetings.</p>
        <div className="set-pair">
          <TextField label="Name" value={form.name} maxLength={120} error={errors.name} onChange={(e) => set('name', e.target.value)} />
          <TextField label="City" value={form.city} maxLength={80} error={errors.city} onChange={(e) => set('city', e.target.value)} />
        </div>
        <ChoiceGroup<Language>
          legend="Languages callers use"
          hint="Each agent answers in some of these."
          type="checkbox"
          columns={3}
          options={LANGS.map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
          value={form.languages}
          error={errors.languages}
          onChange={(v) => set('languages', LANGS.filter((l) => v.includes(l)))}
        />
      </section>

      <section className="set-card" aria-labelledby={`${id}-hours`}>
        <h2 className="lib__heading" id={`${id}-hours`}>
          Business hours
        </h2>
        <p className="lib__sub">When people are in to take calls the agents hand over. Outside these hours the agents offer a callback instead. Times are in India time.</p>
        <ul className="set-hours">
          {form.hours.map((h, i) => (
            <li key={DAYS[i]} className="set-hours__day">
              <Checkbox label={`Open on ${DAYS[i]}`} checked={h.open} onChange={(e) => setDay(i, { open: e.target.checked })} />
              {h.open ? (
                <div className="set-hours__times">
                  <TextField label="Opens" aria-label={`${DAYS[i]} opens`} type="time" value={h.from} error={errors[`hours-${i}`]} onChange={(e) => setDay(i, { from: e.target.value })} />
                  <TextField label="Closes" aria-label={`${DAYS[i]} closes`} type="time" value={h.to} onChange={(e) => setDay(i, { to: e.target.value })} />
                </div>
              ) : (
                <p className="set-hours__closed">Closed all day</p>
              )}
            </li>
          ))}
        </ul>
        <div>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              set('hours', form.hours.map((h, i) => (i > 0 && i < 5 ? { ...form.hours[0] } : h)))
              say(`Tuesday to Friday now match Monday: ${form.hours[0].open ? `${label12(form.hours[0].from)} to ${label12(form.hours[0].to)}` : 'closed'}.`)
            }}
          >
            Copy Monday’s hours to Tuesday–Friday
          </button>
        </div>
      </section>

      <section className="set-card" aria-labelledby={`${id}-closed`}>
        <h2 className="lib__heading" id={`${id}-closed`} ref={closedHeading} tabIndex={-1}>
          Closed days
        </h2>
        <p className="lib__sub">Holidays and other days nobody is in. The agents still answer, and offer a callback.</p>
        {form.closed.length === 0 ? (
          <p className="empty-note">No closed days.</p>
        ) : (
          <ul className="lib-rows" aria-labelledby={`${id}-closed`}>
            {form.closed.map((c, i) => (
              <li key={c.date} className="lib-row">
                <div className="lib-row__main">
                  <p className="lib-row__name">{c.label}</p>
                  <p className="row__meta">{dateLabel(c.date)}</p>
                </div>
                <div className="lib-row__actions">
                  <button
                    type="button"
                    className="btn-text lib-row__remove set-closed-remove"
                    aria-label={`Remove ${c.label}`}
                    onClick={() => {
                      const rest = form.closed.filter((x) => x.date !== c.date)
                      set('closed', rest)
                      say(`${c.label} removed. Save to keep the change.`)
                      // Focus the next row's button, or the heading.
                      window.setTimeout(() => {
                        const buttons = formRef.current?.querySelectorAll<HTMLElement>('.set-closed-remove')
                        ;(buttons?.[Math.min(i, rest.length - 1)] ?? closedHeading.current)?.focus()
                      }, 0)
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <fieldset className="set-add">
          <legend className="field__label">Add a closed day</legend>
          <TextField ref={dateRef} label="Date" type="date" value={newDay.date} error={dayErrors.closedDate} onChange={(e) => setNewDay((d) => ({ ...d, date: e.target.value }))} />
          <TextField
            label="What it is"
            value={newDay.label}
            maxLength={40}
            error={dayErrors.closedLabel}
            placeholder="Pongal"
            onChange={(e) => setNewDay((d) => ({ ...d, label: e.target.value }))}
            onKeyDown={(e) => {
              // Enter adds the day rather than saving the whole form.
              if (e.key === 'Enter') {
                e.preventDefault()
                addDay()
              }
            }}
          />
          <Button variant="line" size="sm" onClick={addDay}>
            Add
          </Button>
        </fieldset>
      </section>

      <div className="set-bar">
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        {Object.keys(errors).length > 0 && !error && (
          <p className="field__error" role="alert">
            {Object.keys(errors).length === 1 ? 'One thing to fix before saving.' : `${Object.keys(errors).length} things to fix before saving.`}
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
                  setForm(toInput(settings))
                  setErrors({})
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
        {renamed && !dirty && <p className="row__meta">The new name shows in the sidebar the next time you sign in.</p>}
      </div>
    </form>
  )
}
