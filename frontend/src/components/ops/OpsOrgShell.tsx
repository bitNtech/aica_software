import { useCallback, useMemo, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Outlet, useParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError, type User } from '../../auth/types'
import { canOpen, platformAccess, type PageKey } from '../../console/access'
import { OrgScopeContext, useOrg, type OrgScope } from '../../console/useOrg'
import { useAsync } from '../../lib/useAsync'
import { Alert } from '../ui/Alert'
import { Spinner } from '../ui/Spinner'
import { OpsBar } from './OpsLayout'
import '../console/ConsoleShell.css'
import './OpsLayout.css'

/**
 * bitNtech working on one organisation's agents from Ops
 * (/ops/orgs/:slug/agents…): the Ops bar, a short menu for the
 * organisation, and the console's own agent pages beneath. Those pages read
 * the organisation from this frame (OrgScopeContext) instead of a
 * membership, so the master admin builds and changes agents without acting
 * as anyone. Staff look only. Every change is logged as bitNtech's.
 */
export function OpsOrgShell() {
  const { slug = '' } = useParams()
  const { user, client } = useAuth()
  const load = useCallback(async () => {
    const org = (await client.listOrgs()).find((o) => o.slug === slug)
    if (!org) throw new Error('missing')
    return org
  }, [client, slug])
  const [org, reload] = useAsync(load)

  const scope = useMemo((): OrgScope | null => {
    if (!user?.platformRole || org.state !== 'ready') return null
    const o = org.data
    return {
      user: user as User,
      org: { orgSlug: o.slug, orgName: o.name, city: o.city, role: 'owner', orgStatus: o.status },
      access: platformAccess(user.platformRole),
      base: `/ops/orgs/${o.slug}`,
    }
  }, [user, org])

  if (!user?.platformRole) return null
  const base = `/ops/orgs/${slug}`

  return (
    <div className="ops">
      <a className="skip-link" href="#ops-main">
        Skip to content
      </a>
      <OpsBar />
      <nav className="ops-org__nav" aria-label="Organisation">
        <div className="ops-org__inner">
          <Link to={base} className="ops-org__name">
            {org.state === 'ready' ? org.data.name : 'Organisation'}
          </Link>
          <NavLink to={`${base}/agents`} className="ops-org__link">
            Agents
          </NavLink>
          <NavLink to={`${base}/integrations`} className="ops-org__link">
            Tools and integrations
          </NavLink>
          <NavLink to={`${base}/uploads`} className="ops-org__link">
            Call uploads
          </NavLink>
          <NavLink to={`${base}/requests`} className="ops-org__link">
            Requests
          </NavLink>
        </div>
      </nav>
      <main id="ops-main" className="console__main ops-org__main" tabIndex={-1}>
        {org.state === 'loading' && (
          <div className="loading-row" role="status">
            <Spinner />
            <span>Loading the organisation…</span>
          </div>
        )}
        {org.state === 'error' && (
          <Alert tone="error" title="Couldn't open this organisation">
            <p>{org.error instanceof Error && org.error.message === 'missing' ? 'There’s no organisation at this address.' : asAuthError(org.error).message}</p>
            <p className="builder__alert-actions">
              <button type="button" className="btn-text" onClick={reload}>
                Try again
              </button>
              <Link className="link" to="/ops">
                Every organisation
              </Link>
            </p>
          </Alert>
        )}
        {scope && (
          <OrgScopeContext value={scope}>
            <Outlet />
          </OrgScopeContext>
        )}
      </main>
    </div>
  )
}

/** One page inside the Ops organisation frame: bitNtech's access must allow
 * it (the builder is the master admin's). If not, back to the organisation. */
export function OpsOrgPage({ page, children }: { page: PageKey; children: ReactNode }) {
  const { access, org } = useOrg()
  if (!canOpen(access, page)) return <Navigate to={`/ops/orgs/${org.orgSlug}`} replace />
  return children
}
