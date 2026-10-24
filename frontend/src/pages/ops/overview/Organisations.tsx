import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { homeFor, useAuth } from '../../../auth/AuthProvider'
import { BUSINESS_LABEL, STATUS_LABEL } from '../../../auth/roles'
import { asAuthError, type OrgStatus, type OrgSummary } from '../../../auth/types'
import { BarList } from '../../../components/charts/Charts'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ReasonForm } from '../../../components/ui/ReasonForm'
import { shortDate } from '../../../lib/time'
import type { PlatformOverview } from '../../../ops/types'
import { initials } from '../../ChooseOrgPage'
import { num, Panel, PanelState } from './bits'
import { PERIOD_LABEL } from './Kpis'

/** Worst first: ops staff triage, they don't browse. */
const ORDER: Record<OrgStatus, number> = { suspended: 0, pending_review: 1, declined: 2, active: 3 }
const RECENT = 5

/** Recently registered, the status mix and the busiest, above the full list. */
export function OrgSummaries({
  orgs,
  orgsError,
  reloadOrgs,
  overview,
  overviewError,
  reloadOverview,
  demo,
}: {
  orgs: OrgSummary[] | null
  orgsError: unknown
  reloadOrgs(): void
  overview: PlatformOverview | null
  overviewError: unknown
  reloadOverview(): void
  demo: boolean
}) {
  const recent = orgs ? [...orgs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RECENT) : []
  const statuses: OrgStatus[] = ['active', 'pending_review', 'suspended', 'declined']
  return (
    <div className="ov-grid ov-grid--3">
      <Panel title="Recently registered" note="Newest first">
        {!orgs ? (
          <PanelState error={orgsError} onRetry={reloadOrgs} />
        ) : recent.length === 0 ? (
          <p className="ov-empty">No organisations yet.</p>
        ) : (
          <ul className="ov-list">
            {recent.map((o) => (
              <li key={o.slug} className="ov-item">
                <div className="ov-item__main">
                  <span className="ov-item__title">{o.name}</span>
                  <span className="ov-item__meta">
                    {BUSINESS_LABEL[o.businessType]} in {o.city} · {shortDate(o.createdAt)}
                  </span>
                </div>
                <span className={`status-chip status-chip--${o.status}`}>{STATUS_LABEL[o.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="By status">
        {!orgs ? (
          <PanelState error={orgsError} onRetry={reloadOrgs} />
        ) : (
          <BarList label="Organisations by status" showShare items={statuses.map((s) => ({ label: STATUS_LABEL[s], value: orgs.filter((o) => o.status === s).length }))} />
        )}
      </Panel>

      <Panel title="Busiest by calls" demo={demo} note={overview ? PERIOD_LABEL[overview.days] : undefined}>
        {!overview ? (
          <PanelState error={overviewError} onRetry={reloadOverview} />
        ) : overview.orgs.every((o) => o.calls === 0) ? (
          <p className="ov-empty">No calls in this period.</p>
        ) : (
          <BarList
            label="Organisations by calls"
            valueText={(v) => `${num(v)} calls`}
            items={overview.orgs
              .filter((o) => o.calls > 0)
              .slice(0, RECENT)
              .map((o) => ({ label: o.name, value: o.calls }))}
          />
        )}
      </Panel>
    </div>
  )
}

/** Every organisation, needing attention first, with the master admin's actions. */
export function OrgList({ orgs, reload }: { orgs: OrgSummary[]; reload(): void }) {
  const { client, user, actAs } = useAuth()
  const navigate = useNavigate()
  const isMaster = user?.platformRole === 'master_admin'
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

  const list = [...orgs].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name))

  return (
    <>
      {notice && (
        <Alert tone={notice.tone} className="ops-section__notice">
          {notice.text}
        </Alert>
      )}
      {list.length === 0 ? (
        <p className="ov-empty">No organisations have signed up yet.</p>
      ) : (
        <ul className="rows">
          {list.map((o) => (
            <li key={o.slug} className="row">
              <div className="row__main">
                <span className="org__mark" aria-hidden="true">
                  {initials(o.name)}
                </span>
                <div className="row__text">
                  <Link className="row__name row__link" to={`/ops/orgs/${o.slug}`}>
                    {o.name}
                  </Link>
                  <span className="row__meta">
                    {BUSINESS_LABEL[o.businessType]} <i aria-hidden="true">·</i> {o.city} <i aria-hidden="true">·</i> {o.ownerEmail}
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
                  <Button variant="line" size="sm" busy={busy === o.slug} busyLabel="Restoring…" onClick={() => void act(o, false)} aria-label={`Restore ${o.name}`}>
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
      )}
    </>
  )
}
