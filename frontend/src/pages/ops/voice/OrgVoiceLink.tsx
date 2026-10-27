import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { createVoiceAdmin, voiceAdminAvailable } from '../../../ops/voiceAdmin'

/**
 * Which voice-server tenant the organisation's agents and calls live in.
 * Until it's linked, agents are built and published but aren't sent to
 * the voice server and take no calls. One tenant per organisation.
 */
export function OrgVoiceLink({ slug, isMaster }: { slug: string; isMaster: boolean }) {
  const id = useId()
  const admin = useMemo(() => createVoiceAdmin(), [])
  const load = useCallback(() => admin.orgVoice(slug), [admin, slug])
  const [info, reload, setInfo] = useAsync(load)
  const [editing, setEditing] = useState(false)
  const [tenant, setTenant] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  if (!voiceAdminAvailable) return null

  async function save(value: string | null) {
    setBusy(true)
    setError(null)
    try {
      setInfo({ state: 'ready', data: await admin.linkTenant(slug, value) })
      setEditing(false)
    } catch (err) {
      setError(asAuthError(err).message)
      field.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ops-section" aria-labelledby={`${id}-voice`}>
      <div className="ops-section__head">
        <h2 id={`${id}-voice`} className="ops-section__title">
          Voice server
        </h2>
        <Link className="link" to="/ops/voice">
          Voice server status
        </Link>
      </div>
      {info.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading…</span>
        </div>
      )}
      {info.state === 'error' && (
        <Alert tone="error">
          {asAuthError(info.error).message}{' '}
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {info.state === 'ready' && (
        <>
          {!info.data.connected && <Alert tone="warn">This AICA server isn’t connected to the voice server: set ORCH_BASE_URL and ORCH_API_KEY.</Alert>}
          <p>
            {info.data.tenantId ? (
              <>
                Linked to tenant <code className="vsync__code">{info.data.tenantId}</code>. Its agents are sent to the voice server when published, and its calls come into Call history.
              </>
            ) : (
              'Not linked. Its agents are built and published here but don’t reach the voice server, so they take no calls.'
            )}
          </p>
          {info.data.connected && !info.data.webhooks && (
            <p className="field__hint">Call and handoff events can’t reach this server (it needs a public https address and ORCH_WEBHOOK_SECRET), so finished calls are brought in when Call history is opened.</p>
          )}
          {isMaster && !editing && (
            <div className="op-card__actions">
              <Button
                variant="line"
                size="sm"
                onClick={() => {
                  setTenant(info.data.tenantId ?? '')
                  setError(null)
                  setEditing(true)
                }}
              >
                {info.data.tenantId ? 'Change the tenant' : 'Link a tenant'}
              </Button>
              {info.data.tenantId && (
                <Button variant="line" size="sm" busy={busy} busyLabel="Unlinking…" onClick={() => void save(null)}>
                  Unlink
                </Button>
              )}
            </div>
          )}
          {isMaster && editing && (
            <form
              className="op-form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                void save(tenant.trim())
              }}
              noValidate
            >
              <TextField ref={field} label="Tenant id" hint="From the LLM server’s Master Admin, e.g. ten_7e28f7ee…. It’s checked before it’s saved." value={tenant} error={error} onChange={(e) => setTenant(e.target.value)} />
              <div className="op-card__actions">
                <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Checking…" disabled={!tenant.trim()}>
                  Link it
                </Button>
                <Button variant="line" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {!editing && error && <Alert tone="error">{error}</Alert>}
        </>
      )}
    </section>
  )
}
