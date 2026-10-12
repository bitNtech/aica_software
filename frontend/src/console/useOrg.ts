import { useParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import type { Membership, User } from '../auth/types'

/** The signed-in person and their membership of the organisation in the
 * URL. Only for pages behind <RequireOrgPage>, which guarantees both. */
export function useOrg(): { user: User; org: Membership } {
  const { user } = useAuth()
  const { slug } = useParams()
  const org = user?.memberships.find((m) => m.orgSlug === slug)
  if (!user || !org) throw new Error('useOrg must be used inside <RequireOrgPage>')
  return { user, org }
}
