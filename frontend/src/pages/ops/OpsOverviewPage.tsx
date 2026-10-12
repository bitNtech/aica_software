import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { homeFor, useAuth } from '../../auth/AuthProvider'
import { BUSINESS_LABEL, STATUS_LABEL } from '../../auth/roles'
import { asAuthError, type OrgStatus, type OrgSummary } from '../../auth/types'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ReasonForm } from '../../components/ui/ReasonForm'
import { Spinner } from '../../components/ui/Spinner'
import { useAsync } from '../../lib/useAsync'
import { shortDate } from '../../lib/time'
import { initials } from '../ChooseOrgPage'

/** Worst first: ops staff triage, they don't browse. */
const ORDER: Record<OrgStatus, number> = { suspended: 0, pending_review: 1, declined: 2, active: 3 }

/** /ops — every organisation, and what needs a decision. */
export default function OpsOverviewPage() {
  const { client, user, actAs } = useAuth()
  const navigate = useNavigate()
  const isMaster = user?.platformRole === 'master_admin'
  const load = useCallback(() => client.listOrgs(), [client])
  const [orgs, reload] = useAsync(load)
  /** Which row's reason box is open: suspending it, or acting as its owner. */
  const [open, setOpen] = useState<{ slug: string; kind: 'suspend' | 'act' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function act(o: OrgSummary, suspend: boolean, reason?: string) {
    setBusy(o.slug)
    setNotice(null)
    try {
      await client.setOrgSuspended(o.slug, suspend, reason)
      setNotice({ tone: 'ok', text: suspend ? `${o.name} is suspended. Its team can no longer sign in.` : `${o.name} is active again.` })
      setOpen(null)
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: asAuthError(err).message })
    } finally {
      setBusy(null)
    }
  }

  async function actAsOwner(o: OrgSummary, reason: string) {
    setBusy(o.slug)
    setNotice(null)
    try {
      await actAs(o.ownerId, reason, (s) => navigate(homeFor(s.user), { replace: true }))
    } catch (err) {
      setNotice({ tone: 'error', text: asAuthError(err).message })
      setBusy(null)
    }
  }

  const list = orgs.state === 'ready' ? [...orgs.data].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)) : []
  const count = (s: OrgStatus) => list.filter((o) => o.status === s).length

  return (
    <OpsLayout
      kicker="Overview"
      docTitle="Overview"
      pendingCount={orgs.state === 'ready' ? count('pending_review') : undefined}
      title={
        <>
          Every client, <em>one place.</em>
        </>
      }
      lede={
        <p>
          {isMaster
            ? 'You can approve sign-ups, and suspend or restore any organisation.'
            : 'You can review sign-ups. Only the master admin can suspend or restore an organisation.'}
        </p>
      }
    >
      {orgs.state === 'loading' && (
        <div className="loading-row">
          <Spinner label="Loading organisations" />
          <span>Loading organisations…</span>
        </div>
      )}

      {orgs.state === 'error' && (
        <Alert tone="error" title="Couldn't load organisations">
          <p>{asAuthError(orgs.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}

      {orgs.state === 'ready' && (
        <>
          <section className="stats" aria-label="Summary">
            <Link to="/ops/requests" className="stat stat--link">
              <span className="label label--quiet">Waiting for review</span>
              <span className="stat__num">{count('pending_review')}</span>
              <span className="stat__go">Review requests →</span>
            </Link>
            <div className="stat">
              <span className="label label--quiet">Active</span>
              <span className="stat__num">{count('active')}</span>
            </div>
            <div className="stat">
              <span className="label label--quiet">Suspended</span>
              <span className="stat__num">{count('suspended')}</span>
            </div>
          </section>

          <section className="ops-section" aria-labelledby="orgs-h">
            <div className="ops-section__head">
              <h2 id="orgs-h" className="ops-section__title">
                Organisations
              </h2>
              <p className="ops-section__note">Needs attention first</p>
            </div>

            {notice && (
              <Alert tone={notice.tone} className="ops-section__notice">
                {notice.text}
              </Alert>
            )}

            <ul className="rows">
              {list.map((o) => (
                <li key={o.slug} className="row">
                  <div className="row__main">
                    <span className="org__mark" aria-hidden="true">
                      {initials(o.name)}
                    </span>
                    <div className="row__text">
                      <span className="row__name">{o.name}</span>
                      <span className="row__meta">
                        {BUSINESS_LABEL[o.businessType]} <i aria-hidden="true">·</i> {o.city} <i aria-hidden="true">·</i>{' '}
                        {o.ownerEmail}
                      </span>
                      {o.statusReason && <span className="row__reason">“{o.statusReason}”</span>}
                    </div>
                  </div>
                  <div className="row__side">
                    <span className={`status-chip status-chip--${o.status}`}>{STATUS_LABEL[o.status]}</span>
                    <span className="row__date">Since {shortDate(o.createdAt)}</span>
                    {isMaster && o.ownerId && open?.slug !== o.slug && (
                      <Button variant="line" size="sm" onClick={() => setOpen({ slug: o.slug, kind: 'act' })} aria-label={`Act as the owner of ${o.name}`}>
                        Act as owner
                      </Button>
                    )}
                    {isMaster && o.status === 'active' && open?.slug !== o.slug && (
                      <Button variant="line" size="sm" onClick={() => setOpen({ slug: o.slug, kind: 'suspend' })} aria-label={`Suspend ${o.name}`}>
                        Suspend
                      </Button>
                    )}
                    {isMaster && o.status === 'suspended' && (
                      <Button
                        variant="line"
                        size="sm"
                        busy={busy === o.slug}
                        busyLabel="Restoring…"
                        onClick={() => void act(o, false)}
                        aria-label={`Restore ${o.name}`}
                      >
                        Restore
                      </Button>
                    )}
                    {o.status === 'pending_review' && (
                      <Link className="btn btn--line btn--sm" to="/ops/requests">
                        <span>Review</span>
                      </Link>
                    )}
                  </div>
                  {open?.slug === o.slug && open.kind === 'act' && (
                    <div className="row__extra">
                      <ReasonForm
                        label={`Why act as the owner of ${o.name}?`}
                        hint={`You'll see AICA exactly as ${o.ownerEmail} does for 30 minutes. The reason goes in the audit log; they aren't emailed.`}
                        confirmLabel="Act as owner"
                        busyLabel="Starting…"
                        busy={busy === o.slug}
                        tooShort="Write at least a short sentence. It goes in the audit log."
                        onConfirm={(reason) => void actAsOwner(o, reason)}
                        onCancel={() => setOpen(null)}
                      />
                    </div>
                  )}
                  {open?.slug === o.slug && open.kind === 'suspend' && (
                    <div className="row__extra">
                      <ReasonForm
                        label={`Why suspend ${o.name}?`}
                        hint="Their team sees this word for word when they try to sign in."
                        confirmLabel="Suspend organisation"
                        busyLabel="Suspending…"
                        busy={busy === o.slug}
                        onConfirm={(reason) => void act(o, true, reason)}
                        onCancel={() => setOpen(null)}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </OpsLayout>
  )
}
