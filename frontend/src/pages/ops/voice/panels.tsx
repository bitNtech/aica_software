import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { SelectField, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { timeAgo } from '../../../lib/time'
import type { AdminSession, CatalogueItem, ModelCatalogue, RuntimeConfig, VoiceAdmin, VoiceStatus } from '../../../ops/voiceAdmin'

const KIND_LABEL: Record<string, string> = {
  llm: 'Language models',
  tts_voice: 'Voices',
  asr: 'Speech recognition',
  vad: 'Voice detection',
  denoise: 'Noise removal',
  turn: 'End-of-turn detection',
  lid: 'Language identification',
  diarization: 'Speaker separation',
  correction: 'Transcript correction',
}

function Loading({ what }: { what: string }) {
  return (
    <div className="loading-row" role="status">
      <Spinner />
      <span>Loading {what}…</span>
    </div>
  )
}

function Ok({ ok, yes = 'Working', no = 'Down' }: { ok: boolean | undefined; yes?: string; no?: string }) {
  return <span className={`flag ${ok ? 'flag--ok' : 'flag--warn'}`}>{ok ? yes : no}</span>
}

// ---------------------------------------------------------------- status

/** Health of every part of the voice server, polled every 5 seconds. */
export function StatusPanel({ admin, isMaster, say }: { admin: VoiceAdmin; isMaster: boolean; say(t: string): void }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await admin.status())
      setError(null)
      setCheckedAt(Date.now())
    } catch (err) {
      setError(asAuthError(err).message)
    }
  }, [admin])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), 5000)
    return () => window.clearInterval(t)
  }, [load])

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key)
    setActionError(null)
    try {
      await fn()
      say(done)
      await load()
    } catch (err) {
      setActionError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  if (!status && !error) return <Loading what="the voice server’s status" />
  if (!status) return <Alert tone="error" title="Couldn't reach the voice server">{error}</Alert>
  const c = status.components
  const s = status.sessions
  return (
    <div className="vops">
      {error && <Alert tone="warn">Couldn’t refresh: {error} Showing the last status.</Alert>}
      {status.config?.boot_error && (
        <Alert tone="error" title="Running on its start-up settings">
          <p>The saved overrides weren’t valid after an upgrade. {status.config.boot_error}</p>
        </Alert>
      )}
      <div className="vops__kpis">
        <div className="vops__kpi">
          <span className="vops__kpi-label">Calls now</span>
          <strong>
            {s.live} of {s.max}
          </strong>
        </div>
        <div className="vops__kpi">
          <span className="vops__kpi-label">New calls</span>
          <strong>{s.accepting ? 'Accepted' : 'Refused (maintenance)'}</strong>
        </div>
        <div className="vops__kpi">
          <span className="vops__kpi-label">Ready for calls</span>
          <strong>{status.ready?.ok ? 'Yes' : 'No'}</strong>
        </div>
        <div className="vops__kpi">
          <span className="vops__kpi-label">Voice speed</span>
          <strong>{c.tts?.rtf_estimate ? `${c.tts.rtf_estimate.toFixed(2)}× real time` : '—'}</strong>
          <span className="row__meta">{c.tts?.rtf_estimate && c.tts.rtf_estimate > 1 ? 'Slower than speech: pauses between phrases.' : 'Fast enough to speak smoothly.'}</span>
        </div>
      </div>
      <p className="row__meta" aria-live="off">
        {status.baseUrl}
        {status.instance_id ? ` · ${status.instance_id}` : ''}
        {status.uptime_s ? ` · up ${Math.round(status.uptime_s / 3600)} h` : ''}
        {checkedAt ? ` · checked ${timeAgo(new Date(checkedAt).toISOString())}` : ''}
      </p>

      <table className="vops__table">
        <caption className="sr-only">Parts of the voice server</caption>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">State</th>
            <th scope="col">Detail</th>
            {isMaster && <th scope="col"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {([
            ['llm', 'Language model server', c.llm?.ok, `${c.llm?.url ?? ''} ${(c.llm?.detail?.model as string) ?? ''}`.trim()],
            ['tts', 'Voice (TTS) server', c.tts?.ok, c.tts?.url ?? ''],
            ['asr', 'Speech recognition', Object.values(c.asr?.providers ?? {}).some((p) => p.ready), `Default ${c.asr?.default ?? '—'}: ${Object.entries(c.asr?.providers ?? {}).map(([n, p]) => `${n} ${p.loading ? 'loading' : p.ready ? 'ready' : p.error ? `failed (${p.error})` : 'not loaded'}`).join(', ')}`],
            ['prepipe', 'Before the language model', c.prepipe?.ok, Object.entries(c.prepipe?.stages ?? {}).map(([n, st]) => `${n}: ${st.impl}${st.ready ? '' : st.error ? ` (failed: ${st.error})` : ' (not ready)'}`).join(' · ')],
            ['store', 'Call store', c.store?.ok, ''],
          ] as const).map(([key, name, ok, detail]) => (
            <tr key={key}>
              <th scope="row">{name}</th>
              <td>
                <Ok ok={ok} />
              </td>
              <td className="vops__detail">{detail || '—'}</td>
              {isMaster && (
                <td>
                  {key !== 'store' && (
                    <Button variant="line" size="sm" busy={busy === key} busyLabel="Reloading…" onClick={() => void act(key, () => admin.reload(key as 'asr' | 'prepipe' | 'llm' | 'tts'), `Reloading the ${name.toLowerCase()}.`)}>
                      Reload
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {status.reloads && Object.keys(status.reloads).length > 0 && <Alert tone="info">Reloading now: {Object.keys(status.reloads).join(', ')}. Live calls finish on what they started with.</Alert>}
      {actionError && <Alert tone="error">{actionError}</Alert>}

      {isMaster && (
        <section className="step__section">
          <h3 className="step__heading">Maintenance</h3>
          <p className="step__sub">{s.accepting ? 'Stop new calls before restarting or upgrading. Calls already going carry on.' : 'New calls are refused. Turn calls back on when the work is done.'}</p>
          <Button variant={s.accepting ? 'danger' : 'orange'} size="sm" onClick={() => setConfirm(!s.accepting)}>
            {s.accepting ? 'Stop taking new calls' : 'Take new calls again'}
          </Button>
        </section>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? 'Take new calls again?' : 'Stop taking new calls?'}
        confirmLabel={confirm ? 'Take calls' : 'Stop new calls'}
        busyLabel="Saving…"
        busy={busy === 'admission'}
        danger={!confirm}
        error={actionError}
        onConfirm={() =>
          void act('admission', () => admin.admission(!!confirm), confirm ? 'The voice server takes new calls again.' : 'New calls are refused; live calls carry on.').then(() => setConfirm(null))
        }
        onCancel={() => setConfirm(null)}
      >
        <p>{confirm ? 'Every organisation’s agents answer calls again.' : 'Callers to every organisation get a busy answer until calls are turned back on.'}</p>
      </ConfirmDialog>
    </div>
  )
}

// ---------------------------------------------------------------- models

/** Every model and voice the server offers, switched on or off. Something
 * in use can't be switched off until the setting using it changes. */
export function ModelsPanel({ admin, isMaster, say }: { admin: VoiceAdmin; isMaster: boolean; say(t: string): void }) {
  const load = useCallback(() => admin.models(), [admin])
  const [cat, reload, setCat] = useAsync<ModelCatalogue>(load)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(kind: string, item: CatalogueItem) {
    const key = `${kind}/${item.id}`
    setBusy(key)
    setError(null)
    try {
      await admin.switchModel(kind, item.id, !item.enabled, cat.state === 'ready' ? cat.data.version : undefined)
      setCat((r) => (r.state === 'ready' ? { ...r, data: { ...r.data, kinds: { ...r.data.kinds, [kind]: { ...r.data.kinds[kind], items: r.data.kinds[kind].items.map((i) => (i.id === item.id ? { ...i, enabled: !i.enabled } : i)) } } } } : r))
      say(`${item.id} is switched ${item.enabled ? 'off' : 'on'}.`)
      reload()
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  async function asr(item: CatalogueItem, action: 'load' | 'unload') {
    setBusy(`asr/${item.id}/${action}`)
    setError(null)
    try {
      await admin.asr(item.id, action)
      say(action === 'load' ? `Loading ${item.id} in the background.` : `Unloaded ${item.id}.`)
      reload()
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  if (cat.state === 'loading') return <Loading what="the models" />
  if (cat.state === 'error')
    return (
      <Alert tone="error" title="Couldn't load the models">
        <p>{asAuthError(cat.error).message}</p>
        <button type="button" className="btn-text" onClick={reload}>
          Try again
        </button>
      </Alert>
    )
  return (
    <div className="vops">
      <p className="step__sub">A model or voice that’s off can’t be chosen by any agent, and calls set to use it are refused. Organisations only see what’s on.</p>
      {error && <Alert tone="error">{error}</Alert>}
      {Object.entries(cat.data.kinds).map(([kind, { items }]) => (
        <section key={kind} className="step__section">
          <h3 className="step__heading">{KIND_LABEL[kind] ?? kind}</h3>
          {items.length === 0 ? (
            <p className="empty-note">{kind === 'tts_voice' ? 'The voice server has no named voices yet: agents speak with its active voice.' : 'None on this server.'}</p>
          ) : (
            <table className="vops__table">
              <caption className="sr-only">{KIND_LABEL[kind] ?? kind}</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">State</th>
                  <th scope="col">Used by</th>
                  {isMaster && <th scope="col"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const inUse = i.in_use.length > 0
                  return (
                    <tr key={i.id}>
                      <th scope="row">
                        <code className="vsync__code">{i.id}</code>
                        {i.default && <span className="flag flag--quiet"> Default</span>}
                        {i.description && <div className="row__meta">{i.description}</div>}
                      </th>
                      <td>
                        <Ok ok={i.enabled} yes="On" no="Off" />
                        {kind === 'asr' && <div className="row__meta">{i.loading ? 'Loading…' : i.loaded ? 'Loaded' : i.load_error ? `Failed to load: ${i.load_error}` : 'Not loaded'}</div>}
                      </td>
                      <td>{inUse ? i.in_use.join(', ') : '—'}</td>
                      {isMaster && (
                        <td className="vops__actions">
                          <Button
                            variant="line"
                            size="sm"
                            busy={busy === `${kind}/${i.id}`}
                            busyLabel="Saving…"
                            disabled={i.enabled && inUse}
                            aria-describedby={i.enabled && inUse ? `use-${kind}-${i.id}` : undefined}
                            onClick={() => void toggle(kind, i)}
                          >
                            {i.enabled ? 'Switch off' : 'Switch on'}
                          </Button>
                          {i.enabled && inUse && (
                            <span className="field__hint" id={`use-${kind}-${i.id}`}>
                              In use: change {i.in_use.join(', ')} first.
                            </span>
                          )}
                          {kind === 'asr' && i.enabled && !i.loaded && !i.loading && (
                            <Button variant="line" size="sm" busy={busy === `asr/${i.id}/load`} busyLabel="Starting…" onClick={() => void asr(i, 'load')}>
                              Load now
                            </Button>
                          )}
                          {kind === 'asr' && i.loaded && !inUse && (
                            <Button variant="line" size="sm" busy={busy === `asr/${i.id}/unload`} busyLabel="Unloading…" onClick={() => void asr(i, 'unload')}>
                              Unload
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- servers and presets

/** Pointing the voice server at another LLM or TTS server: test first, then switch. */
export function UpstreamPanel({ admin, config, onSaved }: { admin: VoiceAdmin; config: RuntimeConfig; onSaved(c: RuntimeConfig, said: string): void }) {
  const id = useId()
  const [which, setWhich] = useState<'llm' | 'tts'>('tts')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = (config.effective[which] as { base_url?: string } | undefined)?.base_url

  async function test(e: FormEvent) {
    e.preventDefault()
    setBusy('test')
    setError(null)
    setResult(null)
    try {
      const r = await admin.testUpstream(which, url.trim(), key.trim() || undefined)
      const ok = r.ok !== false && r.ready !== false
      setResult({ ok, text: ok ? 'It answered and accepted the key.' : `It answered, but: ${JSON.stringify(r)}` })
    } catch (err) {
      setResult({ ok: false, text: asAuthError(err).message })
    } finally {
      setBusy(null)
    }
  }

  async function use() {
    setBusy('save')
    setError(null)
    try {
      const keyField = which === 'llm' ? 'service_api_key' : 'api_key'
      const set = { [which]: { base_url: url.trim(), ...(key.trim() ? { [keyField]: key.trim() } : {}) } }
      await admin.patch({ set, reset: [], version: config.version, dryRun: true })
      const out = await admin.patch({ set, reset: [], version: config.version, dryRun: false })
      onSaved(out, `The voice server now uses ${url.trim()} for ${which === 'llm' ? 'the language model' : 'voices'}.`)
      setResult(null)
      setUrl('')
      setKey('')
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="step__section" aria-labelledby={`${id}-up`}>
      <h3 className="step__heading" id={`${id}-up`}>
        Another LLM or voice server
      </h3>
      <p className="step__sub">Live calls keep the server they started with; new calls use the new one. Test it first: the switch is only offered once it answers.</p>
      <form className="op-form" onSubmit={test} noValidate>
        <SelectField label="Which" value={which} options={[{ value: 'tts', label: `Voice (TTS) server, now ${(config.effective.tts as { base_url?: string })?.base_url ?? '—'}` }, { value: 'llm', label: `Language model server, now ${(config.effective.llm as { base_url?: string })?.base_url ?? '—'}` }]} onChange={(e) => { setWhich(e.target.value as 'llm' | 'tts'); setResult(null) }} />
        <TextField label="Address" placeholder="https://…" value={url} onChange={(e) => { setUrl(e.target.value); setResult(null) }} hint={current ? `Now: ${current}` : undefined} />
        <TextField label="Key" type="password" autoComplete="off" hint="Optional. Leave empty to keep the current key." value={key} onChange={(e) => { setKey(e.target.value); setResult(null) }} />
        <div className="op-card__actions">
          <Button type="submit" variant="line" size="sm" disabled={!url.trim()} busy={busy === 'test'} busyLabel="Testing…">
            Test it
          </Button>
          {result?.ok && (
            <Button variant="orange" size="sm" busy={busy === 'save'} busyLabel="Switching…" onClick={() => void use()}>
              Use this server
            </Button>
          )}
        </div>
      </form>
      {result && <Alert tone={result.ok ? 'ok' : 'error'}>{result.text}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </section>
  )
}

export function PresetsPanel({ admin, config, onSaved }: { admin: VoiceAdmin; config: RuntimeConfig; onSaved(c: RuntimeConfig, said: string): void }) {
  const load = useCallback(() => admin.presets(), [admin])
  const [presets] = useAsync(load)
  const [checked, setChecked] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function apply(name: string, dryRun: boolean) {
    setBusy(name)
    setError(null)
    try {
      const out = await admin.applyPreset(name, config.version, dryRun)
      if (dryRun) setChecked(name)
      else {
        setChecked(null)
        onSaved(out, `Applied the ${name.replace(/_/g, ' ')} preset.`)
      }
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="step__section">
      <h3 className="step__heading">Presets</h3>
      <p className="step__sub">Tested combinations of voice detection, recognition and noise settings, merged into the current settings. Each one is checked before it’s applied.</p>
      {presets.state === 'loading' && <Loading what="the presets" />}
      {presets.state === 'error' && <Alert tone="error">{asAuthError(presets.error).message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {presets.state === 'ready' && (
        <ul className="vops__presets">
          {presets.data.data.map((p) => (
            <li key={p.name}>
              <strong>{p.name.replace(/_/g, ' ')}</strong>
              <span className="row__meta">{Object.keys(p.settings).join(', ')}</span>
              {checked === p.name ? (
                <Button variant="orange" size="sm" busy={busy === p.name} busyLabel="Applying…" onClick={() => void apply(p.name, false)}>
                  Accepted: apply it
                </Button>
              ) : (
                <Button variant="line" size="sm" busy={busy === p.name} busyLabel="Checking…" onClick={() => void apply(p.name, true)}>
                  Check it
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- live calls and history

/** Every organisation's calls in progress; the master admin can end one. */
export function SessionsPanel({ admin, isMaster, say }: { admin: VoiceAdmin; isMaster: boolean; say(t: string): void }) {
  const [rows, setRows] = useState<AdminSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ending, setEnding] = useState<AdminSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows((await admin.sessions()).data)
      setError(null)
    } catch (err) {
      setError(asAuthError(err).message)
    }
  }, [admin])
  useEffect(() => {
    void load()
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), 4000)
    return () => window.clearInterval(t)
  }, [load])

  async function end() {
    if (!ending) return
    setBusy(true)
    setEndError(null)
    try {
      await admin.endSession(ending.id, 'ended_by_master_admin')
      say(`Ended ${ending.id}.`)
      setEnding(null)
      await load()
    } catch (err) {
      setEndError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  if (!rows && !error) return <Loading what="live calls" />
  return (
    <div className="vops">
      {error && <Alert tone="error">{error}</Alert>}
      {rows && rows.length === 0 && <p className="empty-note">No calls on the voice server right now.</p>}
      {rows && rows.length > 0 && (
        <table className="vops__table">
          <caption className="sr-only">Calls in progress on the voice server</caption>
          <thead>
            <tr>
              <th scope="col">Call</th>
              <th scope="col">Organisation</th>
              <th scope="col">Started</th>
              <th scope="col">Now</th>
              {isMaster && <th scope="col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <code className="vsync__code">{r.id}</code>
                  <div className="row__meta">{r.channel ?? ''} {r.voice_agent_id ? `· ${r.voice_agent_id}` : ''}</div>
                </th>
                <td>{r.org ? r.org.name : <span className="row__meta">{r.tenant_id ?? 'Unknown'} (not linked)</span>}</td>
                <td>{r.started_at ? timeAgo(r.started_at) : '—'}</td>
                <td>{r.mode === 'human' ? 'With a person' : r.mode === 'handoff_pending' ? 'Waiting for a person' : (r.state ?? 'With the agent')}</td>
                {isMaster && (
                  <td>
                    <Button variant="danger" size="sm" onClick={() => { setEndError(null); setEnding(r) }}>
                      End
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ConfirmDialog open={!!ending} title="End this call?" confirmLabel="End the call" busyLabel="Ending…" busy={busy} danger error={endError} onConfirm={() => void end()} onCancel={() => setEnding(null)}>
        <p>The caller is disconnected at once{ending?.org ? `, and ${ending.org.name} sees the call end` : ''}.</p>
      </ConfirmDialog>
    </div>
  )
}

/** Every change made to the voice server (settings, models, reloads, calls ended). */
export function HistoryPanel({ admin }: { admin: VoiceAdmin }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [next, setNext] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const more = useCallback(
    async (before?: string) => {
      setBusy(true)
      try {
        const page = await admin.history(before)
        setRows((r) => (before ? [...r, ...page.data] : page.data))
        setNext(page.next_before ?? null)
        setError(null)
      } catch (err) {
        setError(asAuthError(err).message)
      } finally {
        setBusy(false)
      }
    },
    [admin],
  )
  useEffect(() => {
    void more()
  }, [more])

  const when = (r: Record<string, unknown>) => (r.at ?? r.ts ?? r.created_at) as string | undefined
  return (
    <div className="vops">
      {error && <Alert tone="error">{error}</Alert>}
      {!busy && rows.length === 0 && !error && <p className="empty-note">No changes recorded yet.</p>}
      {rows.length > 0 && (
        <ol className="vops__history">
          {rows.map((r, i) => {
            const { at, ts, created_at, action, kind, actor, by, ...rest } = r as Record<string, unknown>
            void at
            void ts
            void created_at
            return (
              <li key={(r.id as string) ?? i}>
                <strong>{String(action ?? kind ?? 'change')}</strong>
                <span className="row__meta">
                  {when(r) ? timeAgo(when(r)!) : ''} {actor || by ? `by ${String(actor ?? by)}` : ''}
                </span>
                <code className="vsync__code vops__json">{JSON.stringify(rest)}</code>
              </li>
            )
          })}
        </ol>
      )}
      {busy && <Loading what="the history" />}
      {next && !busy && (
        <Button variant="line" size="sm" onClick={() => void more(next)}>
          Show older
        </Button>
      )}
    </div>
  )
}
