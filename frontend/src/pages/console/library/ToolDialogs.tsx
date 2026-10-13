import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AgentTool, Credential, ToolParam, ToolTestResult } from '../../../console/types'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog, Modal } from '../../../components/ui/Dialog'
import { Checkbox, SelectField, TextAreaField, TextField } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import { checkTool } from '../../../console/toolRules'

/** The system's address without the path, e.g. "his.example.com". */
export function host(url?: string): string {
  try {
    return new URL(url ?? '').host
  } catch {
    return url ?? 'your system'
  }
}

const PARAM_TYPE: Record<ToolParam['type'], string> = { string: 'Text', number: 'Number', date: 'Date', boolean: 'Yes or no' }
const TIMEOUTS = [3000, 5000, 8000, 15000].map((ms) => ({ value: String(ms), label: `${ms / 1000} seconds` }))

export const blankTool = (): AgentTool => ({
  id: '',
  name: '',
  kind: 'http',
  description: '',
  acts: false,
  method: 'GET',
  url: 'https://',
  credentialName: null,
  timeoutMs: 5000,
  retries: 1,
  params: [],
  enabled: true,
  lastTestedAt: null,
})

/** Add or change a tool that calls one of your systems over HTTPS. */
export function ToolFormDialog({
  orgSlug,
  tool,
  tools,
  credentials,
  onClose,
  onSaved,
  onDeleted,
}: {
  orgSlug: string
  /** null: closed; blankTool(): a new one. */
  tool: AgentTool | null
  tools: AgentTool[]
  credentials: Credential[]
  onClose(): void
  onSaved(t: AgentTool, isNew: boolean): void
  onDeleted(t: AgentTool): void
}) {
  const client = useConsole()
  const id = useId()
  const [t, setT] = useState<AgentTool>(blankTool())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const isNew = !tool?.id

  useEffect(() => {
    if (!tool) return
    setT(structuredClone(tool))
    setErrors({})
    setError(null)
  }, [tool])

  const set = (patch: Partial<AgentTool>) => setT((x) => ({ ...x, ...patch }))
  const addParamButton = useRef<HTMLButtonElement>(null)
  const [paramNote, setParamNote] = useState('')

  function removeParam(i: number) {
    set({ params: t.params.filter((_, j) => j !== i) })
    // Errors are by row number: they'd point at the wrong rows now.
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('param-'))))
    setParamNote(`Input ${i + 1} removed.`)
    // Focus the row that took its place, or Add when none are left.
    requestAnimationFrame(() => {
      const rows = [...(form.current?.querySelectorAll<HTMLElement>('.lib-param') ?? [])]
      ;(rows[Math.min(i, rows.length - 1)]?.querySelector('input') ?? addParamButton.current)?.focus()
    })
  }
  const setParam = (i: number, patch: Partial<ToolParam>) => set({ params: t.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next = checkTool(t, tools)
    setErrors(next)
    if (Object.keys(next).length) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setBusy('save')
    setError(null)
    try {
      // Retrying something that books or sends could do it twice.
      onSaved(await client.saveTool(orgSlug, { ...t, retries: t.acts ? 0 : t.retries }), isNew)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    setError(null)
    try {
      await client.deleteTool(orgSlug, t.id)
      setConfirmDelete(false)
      onDeleted(t)
    } catch (err) {
      setError(asAuthError(err).message)
      setConfirmDelete(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Modal open={!!tool} title={isNew ? 'Connect a system' : `Change ${tool?.name ?? 'tool'}`} onClose={() => !busy && onClose()} wide>
        <form ref={form} className="lib-form" onSubmit={submit} noValidate>
          <div className="step__grid">
            <TextField label="Name" hint="What the agent does with it, e.g. “Book an appointment”." value={t.name} maxLength={60} error={errors.name} onChange={(e) => set({ name: e.target.value })} />
            <Switch label="Switched on" hint="Off: no agent can use it." checked={t.enabled} onChange={(enabled) => set({ enabled })} />
          </div>
          <TextAreaField
            label="What it does"
            hint="Agents read this to decide when to use it."
            rows={2}
            maxLength={300}
            value={t.description}
            error={errors.description}
            onChange={(e) => set({ description: e.target.value })}
          />
          <div className="lib-form__url">
            <SelectField label="Method" value={t.method ?? 'GET'} options={['GET', 'POST'].map((m) => ({ value: m, label: m }))} onChange={(e) => set({ method: e.target.value as 'GET' | 'POST' })} />
            <TextField label="Address" type="url" value={t.url ?? ''} error={errors.url} onChange={(e) => set({ url: e.target.value })} />
          </div>
          <div className="step__grid">
            <SelectField
              label="Secret it sends"
              hint="The key or token your system expects. Only its name is shown here."
              value={t.credentialName ?? ''}
              options={[{ value: '', label: 'None' }, ...credentials.map((c) => ({ value: c.name, label: c.name }))]}
              onChange={(e) => set({ credentialName: e.target.value || null })}
            />
            <SelectField label="Wait up to" value={String(t.timeoutMs ?? 5000)} options={TIMEOUTS} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
          </div>
          <div className="step__stack">
            <Switch
              label="It books or sends something"
              hint="It books, cancels or sends, rather than only looking something up. Agents can ask the caller first, and it's never retried."
              checked={t.acts}
              onChange={(acts) => set({ acts })}
            />
            {!t.acts && (
              <Switch label="Try once more if it fails" hint="Safe for look-ups." checked={(t.retries ?? 0) > 0} onChange={(on) => set({ retries: on ? 1 : 0 })} />
            )}
          </div>

          <fieldset className="lib-params" aria-describedby={`${id}-params-hint`}>
            <legend className="ws__subhead">Inputs</legend>
            <p className="field__hint" id={`${id}-params-hint`}>
              What the agent collects from the caller and sends. Names are what your system expects.
            </p>
            <p className="sr-only" role="status">
              {paramNote}
            </p>
            {t.params.length === 0 && <p className="empty-note">None: it’s called with nothing from the caller.</p>}
            {t.params.map((p, i) => (
              <div key={i} className="lib-param" role="group" aria-label={`Input ${i + 1}`}>
                <TextField label="Name" value={p.name} maxLength={40} error={errors[`param-${i}`]} onChange={(e) => setParam(i, { name: e.target.value.trim() })} />
                <SelectField
                  label="Type"
                  value={p.type}
                  options={Object.entries(PARAM_TYPE).map(([value, label]) => ({ value, label }))}
                  onChange={(e) => setParam(i, { type: e.target.value as ToolParam['type'] })}
                />
                <TextField label="Description" value={p.description} maxLength={120} onChange={(e) => setParam(i, { description: e.target.value })} />
                <div className="lib-param__end">
                  <Checkbox label="Required" checked={p.required} onChange={(e) => setParam(i, { required: e.target.checked })} />
                  <button type="button" className="btn-text lib-row__remove" aria-label={`Remove input ${p.name || i + 1}`} onClick={() => removeParam(i)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <div>
              <Button
                ref={addParamButton}
                variant="line"
                size="sm"
                disabled={t.params.length >= 12}
                onClick={() => {
                  set({ params: [...t.params, { name: '', type: 'string', required: true, description: '' }] })
                  // The new row's Name field, once it's there.
                  requestAnimationFrame(() => [...(form.current?.querySelectorAll<HTMLElement>('.lib-param') ?? [])].pop()?.querySelector('input')?.focus())
                }}
              >
                Add an input
              </Button>
            </div>
          </fieldset>

          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog__actions lib-form__actions">
            <Button type="submit" variant="plum" size="sm" busy={busy === 'save'} busyLabel="Saving…">
              {isNew ? 'Add tool' : 'Save changes'}
            </Button>
            <Button variant="line" size="sm" disabled={!!busy} onClick={onClose}>
              Cancel
            </Button>
            {!isNew &&
              (t.usedBy?.length ? (
                // Not offered when it would be refused: say why instead.
                <p className="field__hint lib-form__delete">Can’t be deleted while {t.usedBy.join(', ')} {t.usedBy.length === 1 ? 'uses' : 'use'} it.</p>
              ) : (
                <button type="button" className="btn-text lib-row__remove lib-form__delete" onClick={() => setConfirmDelete(true)}>
                  Delete tool
                </button>
              ))}
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${t.name}?`}
        confirmLabel="Delete tool"
        busyLabel="Deleting…"
        busy={busy === 'delete'}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>No agent uses it. This can’t be undone.</p>
      </ConfirmDialog>
    </>
  )
}

/** Run a tool once with sample inputs and see what came back. */
export function ToolTestDialog({ orgSlug, tool, onClose, onTested }: { orgSlug: string; tool: AgentTool | null; onClose(): void; onTested(): void }) {
  const client = useConsole()
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [missing, setMissing] = useState<string[]>([])
  const [result, setResult] = useState<ToolTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    setInputs({})
    setMissing([])
    setResult(null)
    setError(null)
  }, [tool])

  async function run(e: FormEvent) {
    e.preventDefault()
    if (!tool) return
    // Missing inputs are the form's to flag, not a failed test.
    const need = tool.params.filter((p) => p.required && !inputs[p.name]?.trim()).map((p) => p.name)
    setMissing(need)
    if (need.length) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setBusy(true)
    setError(null)
    // Cleared first, so the same result twice is still announced.
    setResult(null)
    try {
      const r = await client.testTool(orgSlug, tool.id, inputs)
      setResult(r)
      if (r.ok) onTested()
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!tool} title={`Test ${tool?.name ?? 'tool'}`} onClose={() => !busy && onClose()}>
      <form ref={form} className="lib-form" onSubmit={run} noValidate>
        <p>
          {tool?.kind === 'http'
            ? `AICA contacts ${host(tool.url)} once, from its servers, with these details.${tool.acts ? ' It books or sends something: use test details, not a real patient’s.' : ''}`
            : 'A built-in tool: a test checks it’s set up, and sends nothing to anyone.'}
        </p>
        {tool?.params.map((p) => (
          <TextField
            key={p.name}
            // The description reads better than a system's field name.
            label={`${p.description.replace(/\.$/, '') || p.name}${p.required ? '' : ' (optional)'}`}
            hint={p.description ? `Sent as ${p.name}.` : undefined}
            error={missing.includes(p.name) ? 'Fill this in to run a test.' : undefined}
            type={p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text'}
            value={inputs[p.name] ?? ''}
            onChange={(e) => setInputs((x) => ({ ...x, [p.name]: e.target.value }))}
          />
        ))}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Running…">
            Run test
          </Button>
        </div>
        <div aria-live="polite">
          {error && <p className="field__error">{error}</p>}
          {result && (
            <div className={`lib-test lib-test--${result.ok ? 'ok' : 'fail'}`}>
              <p className="lib-test__title">
                {result.ok ? 'It worked' : 'It didn’t work'}
                {result.ms > 0 && ` in ${(result.ms / 1000).toFixed(1)} seconds`}.
              </p>
              <p className="lib-test__body">{result.summary}</p>
              {result.status !== undefined && <p className="lib-test__code">Reply code {result.status}, for your IT team.</p>}
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
