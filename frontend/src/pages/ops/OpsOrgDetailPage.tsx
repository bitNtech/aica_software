import { useCallback, useId, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { homeFor, useAuth } from '../../auth/AuthProvider'
import { BUSINESS_LABEL, ROLE_LABEL, STATUS_LABEL } from '../../auth/roles'
import { asAuthError, type OrgSummary } from '../../auth/types'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { opsOrgPages } from '../../components/ops/OpsOrgShell'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ReasonForm } from '../../components/ui/ReasonForm'
import { Spinner } from '../../components/ui/Spinner'
import { useOpsData } from '../../ops/OpsDataProvider'
import { useConsole } from '../../console/ConsoleProvider'
import type { OrgDetail, OrgJob } from '../../ops/types'
import { useAsync } from '../../lib/useAsync'
import { shortDate, timeAgo } from '../../lib/time'
import { useAnnouncer } from '../console/operate/LiveBits'
import { OrgVoiceLink } from './voice/OrgVoiceLink'
import '../../components/voice/Voice.css'
import '../console/library/Library.css'
import '../console/operate/Operate.css'
import './Ops.css'

const AGENT_STATUS = { live: 'Live', paused: 'Paused', draft: 'Draft' } as const
const JOB_STATUS: Record<OrgJob['status'], string> = {
  queued: 'Waiting',
  transcribing: 'Transcribing',
  extracting: 'Reading the flow',
  indexing: 'Indexing',
  ready: 'Done',
  failed: 'Failed',
}
const STATUS_WORD = { created: 'Signed up', active: 'Approved', pending_review: 'In review', declined: 'Declined', suspended: 'Suspended' } as const
const num = (n: number) => n.toLocaleString('en-IN')

/** /ops/orgs/:slug: everything behind one organisation. Master admin acts; staff read. */
export default function OpsOrgDetailPage() {
  const { slug = '' } = useParams()
  const { client, user } = useAuth()
  const ops = useOpsData()
  const isMaster = user?.platformRole === 'master_admin'
  const load = useCallback(async () => {
    // Usage, team, jobs and history still come from sample data, which only
    // knows the demo organisations: a real one shows everything else.
    const [orgs, detail] = await Promise.all([client.listOrgs(), ops.getOrgDetail(slug).catch(() => null)])
    const org = orgs.find((o) => o.slug === slug)
    if (!org) throw new Error('missing')
    return { org, detail }
  }, [client, ops, slug])
  const [data, reload] = useAsync(load)

  const name = data.state === 'ready' ? data.data.org.name : 'Organisation'
  return (
    <OpsLayout kicker="Organisation" docTitle={name} title={name} demoData lede={<Link className="link" to="/ops/orgs">← Every organisation</Link>}>
      {data.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading the organisation…</span>
        </div>
      )}
      {data.state === 'error' && (
        <Alert tone="error" title="Couldn't load this organisation">
          <p>{data.error instanceof Error && data.error.message === 'missing' ? 'There’s no organisation at this address.' : asAuthError(data.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {data.state === 'ready' && user?.platformRole && (
        <nav aria-label={`Manage ${name}`}>
          <ul className="ops-manage">
            {opsOrgPages(user.platformRole).map((p) => (
              <li key={p.path}>
                <Link to={`/ops/orgs/${slug}/${p.path}`}>{p.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {data.state === 'ready' && <Detail org={data.data.org} detail={data.data.detail} isMaster={isMaster} onChanged={reload} />}
    </OpsLayout>
  )
}

function Detail({ org, detail: d, isMaster, onChanged }: { org: OrgSummary; detail: OrgDetail | null; isMaster: boolean; onChanged(): void }) {
  const { client, actAs } = useAuth()
  const ops = useOpsData()
  const navigate = useNavigate()
  const id = useId()
  const [open, setOpen] = useState<'suspend' | 'act' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState(d?.jobs ?? [])
  const [jobError, setJobError] = useState<{ id: string; text: string } | null>(null)
  /** Failed jobs, then the newest few, until "Show all". */
  const [allJobs, setAllJobs] = useState(false)
  const [note, say] = useAnnouncer()
  const actionsRef = useRef<HTMLDivElement>(null)

  async function suspend(on: boolean, reason?: string) {
    setBusy('status')
    setError(null)
    try {
      await client.setOrgSuspended(org.slug, on, reason)
      setOpen(null)
      say(on ? `${org.name} is suspended.` : `${org.name} is active again.`)
      onChanged()
      // The button pressed is gone: focus stays with the actions.
      window.setTimeout(() => actionsRef.current?.focus(), 0)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  async function actAsOwner(reason: string) {
    setBusy('act')
    setError(null)
    try {
      await actAs(org.ownerId, reason, (s) => navigate(homeFor(s.user), { replace: true }))
    } catch (err) {
      setError(asAuthError(err).message)
      setBusy(null)
    }
  }

  async function retry(job: OrgJob) {
    setBusy(job.id)
    setJobError(null)
    try {
      const next = await ops.retryJob(org.slug, job.id)
      setJobs((js) => js.map((j) => (j.id === next.id ? next : j)))
      say(`${job.name}: queued again.`)
      // Its button is gone: keep focus on the job.
      window.setTimeout(() => document.getElementById(`${id}-job-${job.id}`)?.focus(), 0)
    } catch (err) {
      setJobError({ id: job.id, text: asAuthError(err).message })
    } finally {
      setBusy(null)
    }
  }

  const failed = jobs.filter((j) => j.status === 'failed').length
  const JOBS_SHOWN = 8
  const ordered = [...jobs.filter((j) => j.status === 'failed'), ...jobs.filter((j) => j.status !== 'failed')]
  const shownJobs = allJobs ? ordered : ordered.slice(0, Math.max(JOBS_SHOWN, failed))

  return (
    <>
      <p className="sr-only" role="status">
        {note}
      </p>
      <section className="ops-detail__card" aria-label="Profile">
        <dl className="lib-facts">
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`status-chip status-chip--${org.status}`}>{STATUS_LABEL[org.status]}</span>
            </dd>
          </div>
          <div>
            <dt>Business</dt>
            <dd>
              {BUSINESS_LABEL[org.businessType]}, {org.city}
            </dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{org.ownerEmail}</dd>
          </div>
          {d && (
            <div>
              <dt>Plan</dt>
              <dd>{d.plan}</dd>
            </div>
          )}
          <div>
            <dt>Since</dt>
            <dd>{shortDate(org.createdAt)}</dd>
          </div>
        </dl>
        {org.statusReason && <p className="row__reason">“{org.statusReason}”</p>}
        {isMaster ? (
          <div className="ops-detail__actions" ref={actionsRef} tabIndex={-1} role="group" aria-label="Actions">
            {open === null && (
              <>
                {org.ownerId && org.status === 'active' && (
                  <Button variant="line" size="sm" onClick={() => setOpen('act')}>
                    Act as owner
                  </Button>
                )}
                {org.status === 'active' && (
                  <Button variant="line" size="sm" onClick={() => setOpen('suspend')}>
                    Suspend
                  </Button>
                )}
                {org.status === 'suspended' && (
                  <Button variant="line" size="sm" busy={busy === 'status'} busyLabel="Restoring…" onClick={() => void suspend(false)}>
                    Restore
                  </Button>
                )}
                {org.status === 'pending_review' && (
                  <Link className="btn btn--line btn--sm" to="/ops/requests">
                    <span>Review the sign-up</span>
                  </Link>
                )}
              </>
            )}
            {open === 'act' && (
              <ReasonForm
                label={`Why act as the owner of ${org.name}?`}
                hint={`You'll see AICA exactly as ${org.ownerEmail} does for 30 minutes. The reason goes in the audit log, and their organisation's activity shows it.`}
                confirmLabel="Act as owner"
                busyLabel="Starting…"
                busy={busy === 'act'}
                tooShort="Write at least a short sentence. It goes in the audit log."
                onConfirm={(reason) => void actAsOwner(reason)}
                onCancel={() => setOpen(null)}
              />
            )}
            {open === 'suspend' && (
              <ReasonForm
                label={`Why suspend ${org.name}?`}
                hint="Their team sees this word for word when they try to sign in."
                confirmLabel="Suspend organisation"
                busyLabel="Suspending…"
                busy={busy === 'status'}
                onConfirm={(reason) => void suspend(true, reason)}
                onCancel={() => setOpen(null)}
              />
            )}
            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <p className="row__meta">You can look. Only the master admin suspends, restores or acts as someone.</p>
        )}
      </section>

      {d ? (
        <>
          <section className="ops-section" aria-labelledby={`${id}-use`}>
            <div className="ops-section__head">
              <h2 id={`${id}-use`} className="ops-section__title">
                Last 30 days
              </h2>
              <Link className="link" to="/ops/analytics">
                All usage
              </Link>
            </div>
            <dl className="stats ops-stats">
              <div className="stat">
                <dt className="stat__label">Calls</dt>
                <dd className="stat__value">{num(d.usage.calls)}</dd>
              </div>
              <div className="stat">
                <dt className="stat__label">Call minutes</dt>
                <dd className="stat__value">{num(d.usage.minutes)}</dd>
              </div>
              <div className="stat">
                <dt className="stat__label">Recordings processed</dt>
                <dd className="stat__value">{d.usage.uploadHours} h</dd>
              </div>
            </dl>
          </section>

          <section className="ops-section" aria-labelledby={`${id}-team`}>
            <div className="ops-section__head">
              <h2 id={`${id}-team`} className="ops-section__title">
                Team <span className="op-count">{d.members.length}</span>
              </h2>
            </div>
            <div className="ops-table" role="region" aria-labelledby={`${id}-team`} tabIndex={0}>
              <table className="op-table ops-left">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {d.members.map((m) => (
                    <tr key={m.id}>
                      <th scope="row">{m.status === 'invited' ? 'Invited' : m.name}</th>
                      <td>{m.email}</td>
                      <td>{ROLE_LABEL[m.role]}</td>
                      <td>{m.lastActiveAt ? timeAgo(m.lastActiveAt) : 'Never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <p className="empty-note">Usage figures, the team, processing jobs and status history aren’t available for this organisation yet.</p>
      )}

      <OrgAgents slug={org.slug} active={org.status === 'active'} isMaster={isMaster} />

      <OrgVoiceLink slug={org.slug} isMaster={isMaster} />

      {d && (
        <>
          <section className="ops-section" aria-labelledby={`${id}-jobs`}>
            <div className="ops-section__head">
              <h2 id={`${id}-jobs`} className="ops-section__title">
                Processing jobs
              </h2>
              <p className="ops-section__note">{failed ? `${failed} failed` : 'None failed'}</p>
            </div>
            {jobs.length === 0 ? (
              <p className="empty-note">No uploads or knowledge yet.</p>
            ) : (
              <ul className="lib-rows" aria-labelledby={`${id}-jobs`}>
                {shownJobs.map((j) => (
                  <li key={j.id} className="lib-row">
                    <div className="lib-row__main">
                      <h3 className="lib-row__name" id={`${id}-job-${j.id}`} tabIndex={-1}>
                        <span className="lib-row__origin">{j.name}</span>
                        <span className={`status-chip status-chip--call-${j.status === 'indexing' ? 'queued' : j.status}`}>{JOB_STATUS[j.status]}</span>
                      </h3>
                      <p className="row__meta">
                        {j.kind === 'recording' ? 'Call recording' : 'Knowledge'} <i aria-hidden="true">·</i> added {timeAgo(j.addedAt)}
                      </p>
                      {j.error && <p className="lib-row__warn">{j.error}</p>}
                      {jobError?.id === j.id && (
                        <p className="field__error" role="alert">
                          {jobError.text}
                        </p>
                      )}
                    </div>
                    {isMaster && j.status === 'failed' && (
                      <div className="lib-row__actions">
                        <Button variant="line" size="sm" busy={busy === j.id} busyLabel="Queuing…" onClick={() => void retry(j)}>
                          Try again<span className="sr-only">: {j.name}</span>
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {jobs.length > shownJobs.length && (
              <p className="op-log__more">
                Showing {shownJobs.length} of {jobs.length}: failed ones first, then the newest.{' '}
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    const next = shownJobs.length
                    setAllJobs(true)
                    // The first job it adds takes focus.
                    window.setTimeout(() => document.querySelectorAll<HTMLElement>(`[id^="${id}-job-"]`)[next]?.focus(), 0)
                  }}
                >
                  Show all {jobs.length}
                </button>
              </p>
            )}
          </section>

          <section className="ops-section" aria-labelledby={`${id}-hist`}>
            <div className="ops-section__head">
              <h2 id={`${id}-hist`} className="ops-section__title">
                Status history
              </h2>
              {isMaster && (
                <Link className="link" to="/ops/audit">
                  Audit log
                </Link>
              )}
            </div>
            <ol className="ops-history">
              {d.history.map((h) => (
                <li key={h.at + h.status}>
                  <span className="ops-history__what">{STATUS_WORD[h.status]}</span> <span className="row__meta">{shortDate(h.at)}, by {h.by}</span>
                  {h.reason && <p className="row__reason">“{h.reason}”</p>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  )
}

/** The organisation's agents and requests, from the same data its console
 * shows, so an agent built here appears at once. */
function OrgAgents({ slug, active, isMaster }: { slug: string; active: boolean; isMaster: boolean }) {
  const client = useConsole()
  const id = useId()
  const load = useCallback(async () => {
    const [agents, requests] = await Promise.all([client.listAgents(slug), client.listChangeRequests(slug)])
    return { agents, open: requests.filter((r) => r.status === 'open' || r.status === 'in_progress') }
  }, [client, slug])
  const [data, reload] = useAsync(load)
  const base = `/ops/orgs/${slug}`

  return (
    <section className="ops-section" aria-labelledby={`${id}-agents`}>
      <div className="ops-section__head">
        <h2 id={`${id}-agents`} className="ops-section__title">
          Agents {data.state === 'ready' && <span className="op-count">{data.data.agents.length}</span>}
        </h2>
        <div className="ops-section__links">
          {active && (
            <Link className="link" to={`${base}/agents`}>
              {isMaster ? 'Build and change agents' : 'Open agents'}
            </Link>
          )}
          {isMaster && active && (
            <Link className="btn btn--orange btn--sm" to={`${base}/agents/new`}>
              <span>New agent</span>
            </Link>
          )}
        </div>
      </div>
      {data.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading agents…</span>
        </div>
      )}
      {data.state === 'error' && (
        <Alert tone="error" title="Couldn't load the agents">
          <p>{asAuthError(data.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {data.state === 'ready' && (
        <>
          {data.data.open.length > 0 && (
            <p className="ops-org__asks">
              <strong>
                {data.data.open.length} open {data.data.open.length === 1 ? 'request' : 'requests'}
              </strong>{' '}
              from the organisation: {data.data.open.map((r) => `“${r.title}”`).join(', ')}.{' '}
              <Link className="link" to={`${base}/requests`}>
                Reply and act
              </Link>
            </p>
          )}
          {data.data.agents.length === 0 ? (
            <p className="empty-note">No agents yet.{isMaster && active ? ' Build the first from their call uploads.' : ''}</p>
          ) : (
            <ul className="lib-rows" aria-labelledby={`${id}-agents`}>
              {data.data.agents.map((a) => (
                <li key={a.id} className="lib-row">
                  <div className="lib-row__main">
                    <h3 className="lib-row__name">
                      {active && !a.setupStep ? (
                        <Link className="link" to={`${base}/agents/${a.id}`}>
                          {a.name}
                        </Link>
                      ) : (
                        a.name
                      )}
                      <span className={`status-chip status-chip--${a.status}`}>{AGENT_STATUS[a.status]}</span>
                    </h3>
                    <p className="row__meta">
                      {a.useCase} <i aria-hidden="true">·</i> {a.phoneNumber ?? 'No number'} <i aria-hidden="true">·</i>{' '}
                      {a.version ? `version ${a.version}, ${a.lastPublishedAt ? shortDate(a.lastPublishedAt) : ''}` : 'never published'}
                      {a.hasChanges && ' · unpublished changes'}
                    </p>
                    {a.setupStep && isMaster && active && (
                      <p>
                        <Link className="link" to={`${base}/agents/drafts/${a.id}/${a.setupStep}`}>
                          Continue setup<span className="sr-only"> of {a.name}</span>
                        </Link>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
