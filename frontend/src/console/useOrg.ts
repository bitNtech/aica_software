import { createContext, use, useMemo } from 'react'
import { useParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import type { Membership, User } from '../auth/types'
import { accessFor, type Access } from './access'

export interface OrgScope {
  user: User
  org: Membership
  /** What this person may do here (console/access.ts). */
  access: Access
  /** Where this organisation's pages live: `/o/:slug`, or `/ops/orgs/:slug`
   * when bitNtech works on it from Ops. Agent pages link from here. */
  base: string
}

/** Set by the Ops frame around agent pages, where the person is bitNtech,
 * not a member. Organisation pages read it in place of a membership. */
export const OrgScopeContext = createContext<OrgScope | null>(null)

/** The signed-in person, the organisation in the URL and what they may do
 * there. Only for pages behind <RequireOrgPage> (a member), or inside the
 * Ops organisation frame (bitNtech), which guarantee both. */
export function useOrg(): OrgScope {
  const scoped = use(OrgScopeContext)
  const { user } = useAuth()
  const { slug } = useParams()
  const org = scoped ? null : user?.memberships.find((m) => m.orgSlug === slug)
  const member = useMemo(() => (user && org ? { user, org, access: accessFor(org), base: `/o/${org.orgSlug}` } : null), [user, org])
  if (scoped) return scoped
  if (!member) throw new Error('useOrg must be used inside <RequireOrgPage>')
  return member
}
