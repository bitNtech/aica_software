import { useId, useMemo, useState, type ReactNode } from 'react'
import { asAuthError } from '../../../auth/types'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Field'
import { deref, getPath, leafPaths, nest, under, unwrapNullable, type ConfigSchema, type JsonSchema, type RuntimeConfig, type VoiceAdmin } from '../../../ops/voiceAdmin'

const SECRET = '***'
const GENERAL = '_general'

type Pending = Record<string, unknown>

interface Props {
  admin: VoiceAdmin
  schema: ConfigSchema
  config: RuntimeConfig
  onSaved(next: RuntimeConfig, said: string): void
  /** Reload from the server (after a conflict). */
  onReload(): Promise<RuntimeConfig | null>
}

const label = (key: string, s: JsonSchema) => s.title || key.replace(/_/g, ' ')
const isObject = (s: JsonSchema) => s.type === 'object' || !!s.properties
const show = (v: unknown) => (v === null || v === undefined ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/**
 * Every setting of the voice server, generated from its JSON Schema, so new
 * settings appear without a console release. One group per section, with
 * when a change takes effect; locked settings read-only; secrets as
 * "change" fields; overridden ones marked, each with its own Reset. Saving
 * is always checked first (a dry run), then sent with the version loaded.
 */
export function SettingsEditor({ admin, schema, config, onSaved, onReload }: Props) {
  const id = useId()
  const root = schema.json_schema
  const [pending, setPending] = useState<Pending>({})
  const [resets, setResets] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<{ changes: { path: string; from: unknown; to: unknown }[]; resets: string[] } | null>(null)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const overridden = useMemo(() => new Set(config.overridden_paths ?? leafPaths(config.overrides)), [config])
  const isOverridden = (path: string) => [...overridden].some((p) => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`))
  const dirty = Object.keys(pending).length > 0 || resets.size > 0

  const sections = useMemo(() => {
    const props = root.properties ?? {}
    const general: string[] = []
    const groups: { key: string; schema: JsonSchema }[] = []
    for (const [key, s] of Object.entries(props)) {
      const d = deref(s, root)
      if (isObject(d) && d.properties) groups.push({ key, schema: d })
      else general.push(key)
    }
    return [{ key: GENERAL, schema: { title: 'General', type: 'object', properties: Object.fromEntries(general.map((k) => [k, props[k]])) } as JsonSchema }, ...groups]
  }, [root])

  function set(path: string, value: unknown) {
    setPreview(null)
    setPending((p) => ({ ...p, [path]: value }))
    setResets((r) => {
      if (!r.has(path)) return r
      const n = new Set(r)
      n.delete(path)
      return n
    })
  }

  function reset(path: string) {
    setPreview(null)
    setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== path && !k.startsWith(`${path}.`))))
    setResets((r) => new Set(r).add(path))
  }

  function undoAll() {
    setPending({})
    setResets(new Set())
    setPreview(null)
    setError(null)
  }

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'save')
    setError(null)
    setConflict(false)
    try {
      const out = await admin.patch({ set: nest(pending), reset: [...resets], version: config.version, dryRun })
      if (dryRun) {
        setPreview({
          changes: Object.entries(pending).map(([path, to]) => ({ path, from: getPath(config.effective, path), to: getPath(out.effective, path) ?? to })),
          resets: [...resets],
        })
      } else {
        const n = Object.keys(pending).length + resets.size
        undoAll()
        onSaved(out, `Saved ${n} change${n === 1 ? '' : 's'} to the voice server.`)
      }
    } catch (err) {
      const e = asAuthError(err)
      if (e.code === 'conflict') {
        setConflict(true)
        await onReload()
      } else setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const q = query.trim().toLowerCase()
  const match = (path: string, s: JsonSchema) => !q || path.toLowerCase().includes(q) || label(path.split('.').pop()!, s).toLowerCase().includes(q)

  function field(path: string, raw: JsonSchema, depth: number): ReactNode {
    const key = path.split('.').pop()!
    const { schema: s, nullable } = unwrapNullable(raw, root)
    if (isObject(s) && s.properties) {
      const kids = Object.entries(s.properties).map(([k, v]) => field(`${path}.${k}`, v, depth + 1)).filter(Boolean)
      if (!kids.length) return null
      return (
        <fieldset key={path} className="vset__group">
          <legend>
            {label(key, s)} <code className="vsync__code">{path}</code>
          </legend>
          {s.description && <p className="field__hint">{s.description.split('\n')[0]}</p>}
          {kids}
        </fieldset>
      )
    }
    if (!match(path, s)) return null
    return (
      <SettingField
        key={path}
        path={path}
        schema={s}
        nullable={nullable}
        value={path in pending ? pending[path] : getPath(config.effective, path)}
        changed={path in pending}
        resetting={resets.has(path)}
        locked={under(path, schema.locked)}
        secret={under(path, schema.secrets)}
        secretsWritable={schema.secrets_writable !== false}
        overridden={isOverridden(path)}
        onChange={(v) => set(path, v)}
        onReset={() => reset(path)}
      />
    )
  }

  return (
    <div className="vset">
      {config.boot_error && (
        <Alert tone="error" title="The voice server ignored its saved settings">
          <p>After an upgrade the stored overrides weren’t valid, so it’s running on its start-up configuration. {config.boot_error}</p>
        </Alert>
      )}
      {conflict && (
        <Alert tone="warn" title="Someone else saved first">
          <p>The settings were reloaded with their change. Your edits are still here: check them against the new values and save again.</p>
        </Alert>
      )}
      <div className="vset__tools">
        <TextField label="Find a setting" hint="By name or path, e.g. end_silence or pipeline.barge_in." value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="row__meta">
          Version {config.version}
          {config.updated_by ? `, last changed by ${config.updated_by}` : ''}. {overridden.size} setting{overridden.size === 1 ? '' : 's'} changed from the start-up configuration.
        </p>
      </div>

      {sections.map(({ key, schema: s }) => {
        const kids = Object.entries(s.properties ?? {}).map(([k, v]) => field(key === GENERAL ? k : `${key}.${k}`, v, 1)).filter(Boolean)
        if (!kids.length) return null
        const applies = key === GENERAL ? null : schema.apply[key]
        const sectionLocked = key !== GENERAL && under(key, schema.locked)
        return (
          <details key={key} className="vset__section" open={!!q || undefined}>
            <summary>
              <span className="vset__title">{key === GENERAL ? 'General' : label(key, s)}</span>
              {key !== GENERAL && <code className="vsync__code">{key}</code>}
              {applies && <span className="vset__apply">Takes effect: {applies}</span>}
              {sectionLocked && <span className="flag flag--quiet">Set in the server environment</span>}
              {key !== GENERAL && isOverridden(key) && <span className="flag flag--warn">Changed</span>}
            </summary>
            {s.description && <p className="field__hint">{s.description.split('\n')[0]}</p>}
            <div className="vset__fields">{kids}</div>
            {key !== GENERAL && isOverridden(key) && !sectionLocked && (
              <button type="button" className="btn-text" onClick={() => reset(key)}>
                Reset the whole {label(key, s)} section to the start-up configuration
              </button>
            )}
          </details>
        )
      })}

      <div className="vset__save" role="region" aria-labelledby={`${id}-save`}>
        <h3 id={`${id}-save`} className="step__heading">
          {dirty ? `${Object.keys(pending).length + resets.size} unsaved change${Object.keys(pending).length + resets.size === 1 ? '' : 's'}` : 'No unsaved changes'}
        </h3>
        {preview && (
          <Alert tone="ok" title="The voice server accepts these changes">
            <ul className="vcall__list">
              {preview.changes.map((c) => (
                <li key={c.path}>
                  <code className="vsync__code">{c.path}</code>: {show(c.from)} → {show(c.to)}
                </li>
              ))}
              {preview.resets.map((r) => (
                <li key={r}>
                  <code className="vsync__code">{r}</code>: back to the start-up configuration
                </li>
              ))}
            </ul>
            <p>Nothing has changed yet. Save to apply it.</p>
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="op-card__actions">
          {!preview ? (
            <Button variant="orange" size="sm" disabled={!dirty} busy={busy === 'preview'} busyLabel="Checking…" onClick={() => void run(true)}>
              Check the changes
            </Button>
          ) : (
            <Button variant="orange" size="sm" busy={busy === 'save'} busyLabel="Saving…" onClick={() => void run(false)}>
              Save to the voice server
            </Button>
          )}
          <Button variant="line" size="sm" disabled={!dirty || !!busy} onClick={undoAll}>
            Undo my changes
          </Button>
        </div>
      </div>
    </div>
  )
}

interface FieldProps {
  path: string
  schema: JsonSchema
  nullable: boolean
  value: unknown
  changed: boolean
  resetting: boolean
  locked: boolean
  secret: boolean
  secretsWritable: boolean
  overridden: boolean
  onChange(v: unknown): void
  onReset(): void
}

function SettingField({ path, schema: s, nullable, value, changed, resetting, locked, secret, secretsWritable, overridden, onChange, onReset }: FieldProps) {
  const id = useId()
  const key = path.split('.').pop()!
  const name = label(key, s)
  const [editingSecret, setEditingSecret] = useState(false)
  const [jsonText, setJsonText] = useState<string | null>(null)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const type = Array.isArray(s.type) ? s.type[0] : s.type
  const hint = [s.description?.split('\n')[0], s.default !== undefined && s.default !== null && typeof s.default !== 'object' ? `Default ${String(s.default)}.` : null, s.minimum !== undefined || s.maximum !== undefined ? `From ${s.minimum ?? '…'} to ${s.maximum ?? '…'}.` : null]
    .filter(Boolean)
    .join(' ')
  const readOnly = locked || (secret && !secretsWritable)

  const marks = (
    <span className="vset__marks">
      <code className="vsync__code">{path}</code>
      {locked && <span className="flag flag--quiet">Set in the server environment</span>}
      {overridden && !resetting && <span className="flag flag--warn">Changed</span>}
      {changed && <span className="flag flag--ok">Unsaved</span>}
      {resetting && <span className="flag flag--ok">Resets on save</span>}
    </span>
  )

  let control: ReactNode
  if (secret) {
    control = editingSecret ? (
      <input id={id} className="field__input" type="password" autoComplete="new-password" placeholder="New value" onChange={(e) => onChange(e.target.value || SECRET)} />
    ) : (
      <p className="vset__secret">
        {value === SECRET || value ? 'Set (hidden)' : 'Not set'}{' '}
        {!readOnly && (
          <button type="button" className="btn-text" onClick={() => setEditingSecret(true)}>
            Change
          </button>
        )}
      </p>
    )
  } else if (type === 'boolean') {
    control = (
      <label className="vset__check" htmlFor={id}>
        <input id={id} type="checkbox" checked={!!value} disabled={readOnly} onChange={(e) => onChange(e.target.checked)} /> {value ? 'On' : 'Off'}
      </label>
    )
  } else if (s.enum) {
    control = (
      <select id={id} className="field__input" value={value === null || value === undefined ? '' : String(value)} disabled={readOnly} onChange={(e) => onChange(e.target.value === '' && nullable ? null : e.target.value)}>
        {nullable && <option value="">None</option>}
        {s.enum.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    )
  } else if (type === 'integer' || type === 'number') {
    control = (
      <input
        id={id}
        className="field__input vset__num"
        type="number"
        inputMode="decimal"
        step={type === 'integer' ? 1 : 'any'}
        min={s.minimum}
        max={s.maximum}
        value={value === null || value === undefined ? '' : String(value)}
        disabled={readOnly}
        onChange={(e) => {
          const t = e.target.value
          if (t === '') return onChange(nullable ? null : t)
          const n = type === 'integer' ? parseInt(t, 10) : parseFloat(t)
          onChange(Number.isNaN(n) ? t : n)
        }}
      />
    )
  } else if (type === 'array' && (!s.items || s.items.type === 'string')) {
    control = (
      <textarea
        id={id}
        className="field__input"
        rows={Math.min(6, Math.max(2, Array.isArray(value) ? value.length + 1 : 2))}
        value={Array.isArray(value) ? value.join('\n') : ''}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))}
      />
    )
  } else if (type === 'array' || type === 'object' || s.additionalProperties) {
    const text = jsonText ?? JSON.stringify(value ?? (type === 'array' ? [] : {}), null, 2)
    control = (
      <textarea
        id={id}
        className="field__input vsync__code"
        rows={Math.min(10, text.split('\n').length + 1)}
        value={text}
        disabled={readOnly}
        aria-invalid={jsonError ? true : undefined}
        onChange={(e) => {
          setJsonText(e.target.value)
          try {
            onChange(JSON.parse(e.target.value))
            setJsonError(null)
          } catch {
            setJsonError('Not valid JSON yet.')
          }
        }}
      />
    )
  } else {
    control = (
      <input id={id} className="field__input" type="text" value={value === null || value === undefined ? '' : String(value)} disabled={readOnly} onChange={(e) => onChange(e.target.value === '' && nullable ? null : e.target.value)} />
    )
  }

  return (
    <div className={`vset__field${changed ? ' is-changed' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {name}
      </label>
      {marks}
      {control}
      {hint && <p className="field__hint">{hint}</p>}
      {(jsonError || (typeof value === 'string' && (type === 'integer' || type === 'number'))) && <p className="field__error">{jsonError ?? 'Enter a number.'}</p>}
      {overridden && !locked && !resetting && (
        <button type="button" className="btn-text" onClick={onReset} aria-label={`Reset ${path} to the start-up configuration`}>
          Reset
        </button>
      )}
    </div>
  )
}
