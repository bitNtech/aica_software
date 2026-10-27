import { useCallback, useId, useState } from 'react'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AgentVoice, AgentVoiceDetail } from '../../../console/types'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { timeAgo } from '../../../lib/time'
import '../../../components/voice/Voice.css'

const STATUS: Record<AgentVoice['status'], { label: string; tone: string }> = {
  synced: { label: 'On the voice server', tone: 'flag--ok' },
  out_of_date: { label: 'Older version on the voice server', tone: 'flag--warn' },
  failed: { label: 'Not updated on the voice server', tone: 'flag--warn' },
  not_synced: { label: 'Not on the voice server', tone: 'flag--quiet' },
}

/** The settings a call uses, in words, with the server's own key beside each. */
const SHOWN: { path: string; label: string; unit?: string }[] = [
  { path: 'vad.semantic_turn', label: 'Listens for whether the caller sounds finished' },
  { path: 'vad.turn_check_ms', label: 'Checks if the caller is done after', unit: 'ms' },
  { path: 'vad.end_silence_ms', label: 'Longest wait after the caller stops', unit: 'ms' },
  { path: 'vad.provider', label: 'Voice detection' },
  { path: 'asr.provider', label: 'Speech recognition' },
  { path: 'asr.language', label: 'Language it listens for' },
  { path: 'voice.reference_id', label: 'Voice' },
  { path: 'pipeline.barge_in.enabled', label: 'Callers can interrupt' },
  { path: 'pipeline.barge_in.min_speech_ms', label: 'Speech before it stops for the caller', unit: 'ms' },
  { path: 'pipeline.fillers.phrases', label: 'Said while a tool runs' },
  { path: 'pipeline.idle.reprompt_after_s', label: 'Checks the caller is there after', unit: 's' },
  { path: 'pipeline.idle.max_reprompts', label: 'Times it checks before hanging up' },
  { path: 'pipeline.max_call_duration_s', label: 'Longest call', unit: 's' },
  { path: 'handoff.enabled', label: 'Can pass calls to a person' },
  { path: 'prompts.handoff_message', label: 'Says when passing to a person' },
]

function at(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

function show(v: unknown, unit?: string): string {
  if (v === null || v === undefined || v === '') return 'Server default'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.length ? v.join(' · ') : 'None'
  return unit ? `${v} ${unit}` : String(v)
}

/**
 * Where the agent stands on the voice server: whether the published
 * version reached it, what it doesn't use, and the settings a call
 * actually gets (its own defaults merged with this agent's setup).
 */
export function VoiceServerCard({ orgSlug, agentId, version, canSync, onSynced }: { orgSlug: string; agentId: string; version: number | null; canSync: boolean; onSynced?(v: AgentVoice): void }) {
  const client = useConsole()
  const id = useId()
  const load = useCallback(() => client.getAgentVoice!(orgSlug, agentId), [client, orgSlug, agentId])
  const [info, reload, setInfo] = useAsync<AgentVoiceDetail>(load)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  async function sync() {
    setSyncing(true)
    setSyncError(null)
    try {
      const v = await client.resyncAgentVoice!(orgSlug, agentId)
      onSynced?.(v)
      setInfo((r) => (r.state === 'ready' ? { ...r, data: { ...r.data, ...v } } : r))
      reload()
    } catch (err) {
      setSyncError(asAuthError(err).message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="step__section" aria-labelledby={`${id}-voice`}>
      <h2 id={`${id}-voice`} className="step__heading">
        Voice server
      </h2>
      <p className="step__sub">Publishing sends each version to the voice server, which answers the calls. Pausing the agent switches it off there too.</p>
      {info.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Checking the voice server…</span>
        </div>
      )}
      {info.state === 'error' && (
        <Alert tone="error" title="Couldn't check the voice server">
          <p>{asAuthError(info.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {info.state === 'ready' && <Details v={info.data} version={version} />}
      {info.state === 'ready' && !info.data.connected && (
        <Alert tone="info">This organisation isn’t linked to the voice server yet. bitNtech links it from Ops; until then, agents can be built and published but don’t take calls.</Alert>
      )}
      {syncError && <Alert tone="error">{syncError}</Alert>}
      {info.state === 'ready' && info.data.connected && canSync && version !== null && info.data.status !== 'synced' && (
        <div>
          <Button variant="orange" size="sm" busy={syncing} busyLabel="Sending…" onClick={() => void sync()}>
            Send version {version} to the voice server
          </Button>
        </div>
      )}
    </section>
  )
}

function Details({ v, version }: { v: AgentVoiceDetail; version: number | null }) {
  const status = STATUS[v.status]
  const profile = v.profile?.profile
  return (
    <div className="vsync">
      <div className="vsync__head">
        <span className={`flag ${status.tone}`}>{status.label}</span>
        {v.syncedAt && (
          <span className="row__meta">
            Version {v.syncedVersion ?? '—'} sent {timeAgo(v.syncedAt)}
            {version !== null && v.syncedVersion !== null && v.syncedVersion !== version ? `; version ${version} is published` : ''}.
          </span>
        )}
      </div>
      {v.status === 'failed' && v.error && (
        <Alert tone="warn" title="The last publish didn’t reach the voice server">
          <p>{v.error} Callers still get the version that was there before.</p>
        </Alert>
      )}
      {v.warnings.length > 0 && (
        <Alert tone="info" title="What the voice server does differently">
          <ul className="vcall__list">
            {v.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      {(v.voiceAgentId || v.llmAgentId) && (
        <dl className="vsync__facts">
          <div>
            <dt>Voice agent</dt>
            <dd className="vsync__code">{v.voiceAgentId ?? '—'}</dd>
          </div>
          <div>
            <dt>Language-model agent</dt>
            <dd className="vsync__code">{v.llmAgentId ?? '—'}</dd>
          </div>
          {v.testSyncedAt && (
            <div>
              <dt>Test copy updated</dt>
              <dd>{timeAgo(v.testSyncedAt)}</dd>
            </div>
          )}
        </dl>
      )}
      {v.profileError && <Alert tone="warn">{v.profileError}</Alert>}
      {profile && (
        <details className="vsync__profile">
          <summary>Settings a call gets</summary>
          <table>
            <tbody>
              {SHOWN.map((f) => (
                <tr key={f.path}>
                  <th scope="row">
                    {f.label} <span className="vsync__code">({f.path})</span>
                  </th>
                  <td>{show(at(profile, f.path), f.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
