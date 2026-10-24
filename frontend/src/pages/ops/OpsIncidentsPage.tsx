import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError } from '../../auth/types'
import { SegFilter } from '../../components/console/ListTools'
import { StatusPill, type Tone } from '../../components/console/StatusPill'
import { Timeline } from '../../components/console/Timeline'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Spinner'
import { useAsync } from '../../lib/useAsync'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { IncidentRecord, IncidentSeverity, IncidentStatus } from '../../ops/types'
import { since, when } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'
import './overview/Overview.css'

type Filter = 'open' | 'resolved'
const STATUS: Record<IncidentStatus, { tone: Tone; label: string }> = {
  investigating: { tone: 'danger', label: 'Investigating' },
  identified: { tone: 'warn', label: 'Cause found' },
  monitoring: { tone: 'info', label: 'Monitoring' },
  resolved: { tone: 'ok', label: 'Resolved' },
}
const SEVERITY: Record<IncidentSeverity, string> = { minor: 'Minor: slower or worse, still working', major: 'Major: some calls failing', critical: 'Critical: calls not answered' }
const SERVICE: Record<IncidentRecord['service'], string> = { speech: 'ASR (speech to text)', language: 'LLM (language model)', voice: 'TTS (voice)', telephony: 'Telephony', app: 'AICA web app' }

/** /ops/incidents: problems with the platform, from monitoring or declared by the master admin, with their updates. */
export default function OpsIncidentsPage() {
  const ops = useOpsData()
  const { user } = useAuth()
  const isMaster = user?.platformRole === 'master_admin'
  const load = useCallback(() => ops.listIncidents(), [ops])
  const [list, reload] = useAsync(load)
  const [filter, setFilter] = useState<Filter>('open')
  const [declaring, setDeclaring] = useState(false)
  const all = list.state === 'ready' ? list.data : []
  const shown = all.filter((i) => (filter === 'open' ? i.status !== 'resolved' : i.status === 'resolved'))

  return (
    <OpsLayout
      kicker="Incidents"
      docTitle="Incidents"
      title="Incidents"
      demoData={ops.isDemo}
      lede={<p>When the platform isn’t working as it should: what’s affected, what’s being done, and each update. Monitoring opens one by itself when a service slows down.</p>}
    >
      {isMaster && !declaring && (
        <div className="ops-toolbar">
          <Button variant="line" size="sm" onClick={() => setDeclaring(true)}>
            Declare an incident
          </Button>
        </div>
      )}
      {declaring && (
        <DeclareForm
          onCancel={() => setDeclaring(false)}
          onDone={() => {
            setDeclaring(false)
            setFilter('open')
            reload()
          }}
        />
      )}
      {list.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading incidents…</span>
        </div>
      )}
      {list.state === 'error' && (
        <Alert tone="error" title="Couldn't load incidents">
          <p>{asAuthError(list.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {list.state === 'ready' && (
        <>
          <div className="list-tools">
            <SegFilter<Filter>
              legend="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: 'Open', count: all.filter((i) => i.status !== 'resolved').length },
                { value: 'resolved', label: 'Resolved', count: all.filter((i) => i.status === 'resolved').length },
              ]}
            />
          </div>
          {shown.length === 0 ? (
            <p className="empty-note">{filter === 'open' ? 'No open incidents. Every service is working.' : 'No resolved incidents yet.'}</p>
          ) : (
            <ul className="ops-incidents">
              {shown.map((i) => (
                <IncidentCard key={i.id} incident={i} canUpdate={isMaster} onChanged={reload} />
              ))}
            </ul>
          )}
        </>
      )}
    </OpsLayout>
  )
}

function IncidentCard({ incident: i, canUpdate, onChanged }: { incident: IncidentRecord; canUpdate: boolean; onChanged(): void }) {
  const ops = useOpsData()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<IncidentStatus>(i.status === 'investigating' ? 'identified' : i.status === 'identified' ? 'monitoring' : 'resolved')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (open) area.current?.focus()
  }, [open])

  async function post(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await ops.updateIncident(i.id, { status, text })
      setOpen(false)
      setText('')
      onChanged()
    } catch (err) {
      setError(asAuthError(err).message)
      area.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`ov-panel ops-incident${i.status !== 'resolved' ? ' ops-incident--open' : ''}`}>
      <div className="ov-panel__head">
        <h2 className="ov-panel__title">{i.title}</h2>
        <StatusPill tone={STATUS[i.status].tone}>{STATUS[i.status].label}</StatusPill>
      </div>
      <p className="ov-item__meta">
        {SERVICE[i.service]} · {SEVERITY[i.severity]} · started {when(i.startedAt)}
        {i.resolvedAt ? `, resolved after ${since(i.startedAt, Date.parse(i.resolvedAt))}` : `, ${since(i.startedAt)} ago`}
        {i.automatic && ' · opened by monitoring'}
      </p>
      <Timeline label={`Updates on ${i.title}`} items={i.updates.map((u, k) => ({ id: `${i.id}-${k}`, at: u.at, who: u.by, kind: u.by === 'Monitoring' ? 'system' : 'person', title: STATUS[u.status].label, body: u.text }))} />
      {canUpdate && i.status !== 'resolved' && !open && (
        <div>
          <Button variant="line" size="sm" onClick={() => setOpen(true)}>
            Post an update
          </Button>
        </div>
      )}
      {open && (
        <form className="ops-form" onSubmit={post} aria-label={`Update on ${i.title}`}>
          <SelectField label="Now" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)} options={(Object.keys(STATUS) as IncidentStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))} />
          <TextAreaField ref={area} label="What changed" rows={3} value={text} onChange={(e) => setText(e.target.value)} error={error} />
          <div className="ops-form__actions">
            <Button type="submit" size="sm" busy={busy} busyLabel="Posting…">
              Post update
            </Button>
            <button type="button" className="btn-text" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  )
}

function DeclareForm({ onCancel, onDone }: { onCancel(): void; onDone(): void }) {
  const ops = useOpsData()
  const [title, setTitle] = useState('')
  const [service, setService] = useState<IncidentRecord['service']>('telephony')
  const [severity, setSeverity] = useState<IncidentSeverity>('major')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await ops.createIncident({ title, service, severity, text })
      onDone()
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ov-panel ops-form ops-gap-b" onSubmit={submit} aria-label="Declare an incident">
      <h2 className="ov-panel__title">Declare an incident</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <TextField ref={first} label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Calls from one network not connecting" />
      <div className="ops-form__row">
        <SelectField label="Affected" value={service} onChange={(e) => setService(e.target.value as IncidentRecord['service'])} options={(Object.keys(SERVICE) as IncidentRecord['service'][]).map((s) => ({ value: s, label: SERVICE[s] }))} />
        <SelectField label="How bad" value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)} options={(Object.keys(SEVERITY) as IncidentSeverity[]).map((s) => ({ value: s, label: SEVERITY[s] }))} />
      </div>
      <TextAreaField label="What’s happening" rows={3} value={text} onChange={(e) => setText(e.target.value)} hint="What callers and organisations notice. No callers’ details." />
      <div className="ops-form__actions">
        <Button type="submit" size="sm" busy={busy} busyLabel="Declaring…">
          Declare incident
        </Button>
        <button type="button" className="btn-text" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
