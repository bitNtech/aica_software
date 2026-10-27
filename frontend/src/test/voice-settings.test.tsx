import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { VoiceCallPanel } from '../components/voice/VoiceCallPanel'
import type { ConfigSchema, RuntimeConfig, VoiceAdmin } from '../ops/voiceAdmin'
import { SettingsEditor } from '../pages/ops/voice/SettingsEditor'

const schema: ConfigSchema = {
  json_schema: {
    type: 'object',
    properties: {
      log_level: { type: 'string', title: 'Log Level', default: 'INFO' },
      env: { type: 'string', title: 'Env' },
      vad: { $ref: '#/$defs/VAD' },
      tts: { $ref: '#/$defs/TTS' },
    },
    $defs: {
      VAD: { type: 'object', title: 'VADSettings', properties: { end_silence_ms: { type: 'integer', title: 'End Silence Ms', minimum: 100, maximum: 5000, default: 640 }, provider: { type: 'string', enum: ['ten_vad', 'silero'], title: 'Provider' }, semantic_turn: { type: 'boolean', title: 'Semantic Turn' } } },
      TTS: { type: 'object', title: 'TTSSettings', properties: { base_url: { type: 'string', title: 'Base Url' }, api_key: { type: 'string', title: 'Api Key', format: 'password' }, chunk: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Chunk' } } },
    },
  },
  locked: ['env'],
  secrets: ['tts.api_key'],
  apply: { vad: 'next call / request', tts: 'new TTS client at once' },
  presets: [],
}

const config = (version = 3, overrides = { vad: { end_silence_ms: 800 } }): RuntimeConfig => ({
  version,
  overrides,
  overridden_paths: ['vad.end_silence_ms'],
  boot: {},
  boot_error: null,
  effective: { log_level: 'INFO', env: 'prod', vad: { end_silence_ms: 800, provider: 'ten_vad', semantic_turn: true }, tts: { base_url: 'http://127.0.0.1:8080', api_key: '***', chunk: null } },
})

function admin(over: Partial<VoiceAdmin> = {}): VoiceAdmin {
  return { patch: vi.fn(async (i) => ({ ...config(i.dryRun ? 3 : 4), effective: { ...config().effective, vad: { ...(config().effective.vad as object), ...((i.set.vad as object) ?? {}) } } })), ...over } as unknown as VoiceAdmin
}

describe('the voice server settings editor', () => {
  it('is generated from the schema: locked, secret, overridden and when it applies', async () => {
    render(<SettingsEditor admin={admin()} schema={schema} config={config()} onSaved={vi.fn()} onReload={vi.fn()} />)
    expect(screen.getByText('Takes effect: next call / request')).toBeInTheDocument()
    const env = screen.getByLabelText('Env')
    expect(env).toBeDisabled()
    expect(screen.getAllByText('Set in the server environment').length).toBeGreaterThan(0)
    expect(screen.getByText('Set (hidden)')).toBeInTheDocument()
    expect(screen.getByLabelText('End Silence Ms')).toHaveValue(800)
    expect(screen.getByRole('button', { name: 'Reset vad.end_silence_ms to the start-up configuration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check the changes' })).toBeDisabled()
  })

  it('checks with a dry run, then saves with the loaded version', async () => {
    const user = userEvent.setup()
    const a = admin()
    const saved = vi.fn()
    render(<SettingsEditor admin={a} schema={schema} config={config()} onSaved={saved} onReload={vi.fn()} />)
    const field = screen.getByLabelText('End Silence Ms')
    await user.clear(field)
    await user.type(field, '700')
    await user.selectOptions(screen.getByLabelText('Provider'), 'silero')
    await user.click(screen.getByRole('button', { name: 'Check the changes' }))
    expect(a.patch).toHaveBeenLastCalledWith({ set: { vad: { end_silence_ms: 700, provider: 'silero' } }, reset: [], version: 3, dryRun: true })
    expect(await screen.findByText(/accepts these changes/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save to the voice server' }))
    expect(a.patch).toHaveBeenLastCalledWith({ set: { vad: { end_silence_ms: 700, provider: 'silero' } }, reset: [], version: 3, dryRun: false })
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ version: 4 }), 'Saved 2 changes to the voice server.'))
  })

  it('resets one setting, and keeps edits when someone else saved first', async () => {
    const user = userEvent.setup()
    const reload = vi.fn(async () => config(5))
    const a = admin({ patch: vi.fn().mockRejectedValue(new AuthError('conflict', 'stale')) })
    render(<SettingsEditor admin={a} schema={schema} config={config()} onSaved={vi.fn()} onReload={reload} />)
    await user.click(screen.getByRole('button', { name: 'Reset vad.end_silence_ms to the start-up configuration' }))
    expect(screen.getByText('Resets on save')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check the changes' }))
    expect(a.patch).toHaveBeenLastCalledWith({ set: {}, reset: ['vad.end_silence_ms'], version: 3, dryRun: true })
    expect(await screen.findByText('Someone else saved first')).toBeInTheDocument()
    expect(reload).toHaveBeenCalled()
    expect(screen.getByText('Resets on save')).toBeInTheDocument()
  })

  it('finds settings by name or path', async () => {
    const user = userEvent.setup()
    render(<SettingsEditor admin={admin()} schema={schema} config={config()} onSaved={vi.fn()} onReload={vi.fn()} />)
    await user.type(screen.getByLabelText('Find a setting'), 'base_url')
    expect(screen.getByLabelText('Base Url')).toBeInTheDocument()
    expect(screen.queryByLabelText('End Silence Ms')).not.toBeInTheDocument()
  })
})

describe('the test call panel', () => {
  it('says why a call couldn’t start', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    vi.stubGlobal('AudioWorkletNode', class {})
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
    const getTicket = vi.fn().mockRejectedValue(new AuthError('invalid_input', 'The live version isn’t on the voice server yet.'))
    render(<VoiceCallPanel<'test' | 'live'> targets={[{ value: 'test', label: 'Your saved changes' }, { value: 'live', label: 'Version 2' }]} getTicket={getTicket} />)
    await user.click(screen.getByRole('radio', { name: /Version 2/ }))
    await user.click(screen.getByRole('button', { name: 'Start a test call' }))
    expect(getTicket).toHaveBeenCalledWith('live')
    expect(await screen.findByRole('alert')).toHaveTextContent('The live version isn’t on the voice server yet.')
    expect(within(screen.getByRole('status')).getByText(/couldn’t continue/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Call again' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('explains what it needs without a microphone', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    render(<VoiceCallPanel getTicket={vi.fn()} />)
    expect(screen.getByText(/need a microphone and a secure \(https\) page/)).toBeInTheDocument()
  })
})
