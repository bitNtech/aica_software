import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError } from '../../auth/types'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import { Tabs } from '../../components/ui/Tabs'
import { useAsync } from '../../lib/useAsync'
import { createVoiceAdmin, voiceAdminAvailable, type ConfigSchema, type RuntimeConfig } from '../../ops/voiceAdmin'
import { useAnnouncer } from '../console/operate/LiveBits'
import { SettingsEditor } from './voice/SettingsEditor'
import { HistoryPanel, ModelsPanel, PresetsPanel, SessionsPanel, StatusPanel, UpstreamPanel } from './voice/panels'
import '../../components/voice/Voice.css'
import './voice/VoiceOps.css'
import './Ops.css'

type Tab = 'status' | 'settings' | 'models' | 'servers' | 'calls' | 'history'

/**
 * /ops/voice: the voice server itself (the orchestrator in front of the
 * LLM and TTS servers), for bitNtech. Staff see its health, models and
 * live calls; the master admin changes settings, switches models, points
 * it at other servers, reloads parts, stops new calls, and ends calls.
 */
export default function OpsVoicePage() {
  const { user } = useAuth()
  const isMaster = user?.platformRole === 'master_admin'
  const admin = useMemo(() => createVoiceAdmin(), [])
  const [tab, setTab] = useState<Tab>('status')
  const [said, say] = useAnnouncer()

  const tabs = [
    { key: 'status' as const, label: 'Status' },
    ...(isMaster ? [{ key: 'settings' as const, label: 'Settings' }] : []),
    { key: 'models' as const, label: 'Models and voices' },
    ...(isMaster ? [{ key: 'servers' as const, label: 'Servers and presets' }] : []),
    { key: 'calls' as const, label: 'Live calls' },
    ...(isMaster ? [{ key: 'history' as const, label: 'Change history' }] : []),
  ]

  return (
    <OpsLayout
      kicker="Platform"
      docTitle="Voice server"
      title="Voice server"
      lede={<p>The service that answers every organisation’s calls: it listens, runs the agent through the language model, and speaks with the voice server. Changes here apply to everyone.</p>}
    >
      <p className="sr-only" role="status">
        {said}
      </p>
      {!voiceAdminAvailable ? (
        <Alert tone="info">The voice server is only reachable through the AICA API. This demo build doesn’t have one.</Alert>
      ) : (
        <Tabs<Tab> label="Voice server" tabs={tabs} value={tab} onChange={setTab}>
          {tab === 'status' && <StatusPanel admin={admin} isMaster={isMaster} say={say} />}
          {tab === 'settings' && isMaster && <SettingsTab admin={admin} say={say} />}
          {tab === 'models' && <ModelsPanel admin={admin} isMaster={isMaster} say={say} />}
          {tab === 'servers' && isMaster && <ServersTab admin={admin} say={say} />}
          {tab === 'calls' && <SessionsPanel admin={admin} isMaster={isMaster} say={say} />}
          {tab === 'history' && isMaster && <HistoryPanel admin={admin} />}
        </Tabs>
      )}
    </OpsLayout>
  )
}

function useConfig(admin: ReturnType<typeof createVoiceAdmin>) {
  const load = useCallback(() => admin.config(), [admin])
  const [config, reload, setConfig] = useAsync<RuntimeConfig>(load)
  const refresh = useCallback(async () => {
    try {
      const c = await admin.config()
      setConfig({ state: 'ready', data: c })
      return c
    } catch {
      return null
    }
  }, [admin, setConfig])
  return { config, reload, setConfig, refresh }
}

function SettingsTab({ admin, say }: { admin: ReturnType<typeof createVoiceAdmin>; say(t: string): void }) {
  const loadSchema = useCallback(() => admin.schema(), [admin])
  const [schema, reloadSchema] = useAsync<ConfigSchema>(loadSchema)
  const { config, reload, setConfig, refresh } = useConfig(admin)

  if (schema.state === 'loading' || config.state === 'loading')
    return (
      <div className="loading-row" role="status">
        <Spinner />
        <span>Loading the settings…</span>
      </div>
    )
  if (schema.state === 'error' || config.state === 'error') {
    const err = schema.state === 'error' ? schema.error : config.state === 'error' ? config.error : null
    return (
      <Alert tone="error" title="Couldn't load the settings">
        <p>{asAuthError(err).message}</p>
        <button
          type="button"
          className="btn-text"
          onClick={() => {
            reloadSchema()
            reload()
          }}
        >
          Try again
        </button>
      </Alert>
    )
  }
  return (
    <SettingsEditor
      admin={admin}
      schema={schema.data}
      config={config.data}
      onSaved={(c, t) => {
        setConfig({ state: 'ready', data: c })
        say(t)
      }}
      onReload={refresh}
    />
  )
}

function ServersTab({ admin, say }: { admin: ReturnType<typeof createVoiceAdmin>; say(t: string): void }) {
  const { config, setConfig } = useConfig(admin)
  if (config.state === 'loading')
    return (
      <div className="loading-row" role="status">
        <Spinner />
        <span>Loading…</span>
      </div>
    )
  if (config.state === 'error') return <Alert tone="error">{asAuthError(config.error).message}</Alert>
  const saved = (c: RuntimeConfig, t: string) => {
    setConfig({ state: 'ready', data: c })
    say(t)
  }
  return (
    <div className="vops">
      <UpstreamPanel admin={admin} config={config.data} onSaved={saved} />
      <PresetsPanel admin={admin} config={config.data} onSaved={saved} />
    </div>
  )
}
