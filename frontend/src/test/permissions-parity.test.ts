import { describe, expect, it } from 'vitest'
// @ts-ignore -- Vercel builds frontend/ on its own, without backend/, and the
// build typechecks tests too. Tests run (CI, locally) with the whole repo.
import shared from '../../../backend/app/access/permissions.json'
import type { Role } from '../auth/types'
import { ALL_PERMISSIONS, PERMISSIONS, platformAccess } from '../console/access'

/**
 * The backend enforces backend/app/access/permissions.json; the console shows and
 * hides from console/access.ts. They must say the same, or the console
 * offers what the server refuses (or hides what it allows). Change both.
 */
interface Table {
  roles: Role[]
  permissions: Record<string, { defaults: Role[]; grantable: Role[] }>
  platformStaff: string[]
}

const table = shared as unknown as Table
const sorted = (xs: readonly string[]) => [...xs].sort()

describe('the permission table matches the backend', () => {
  it('has the same permissions, in the same order', () => {
    expect(Object.keys(table.permissions)).toEqual([...ALL_PERMISSIONS])
  })

  it.each(ALL_PERMISSIONS)('%s has the same defaults and grantable roles', (p) => {
    expect(sorted(PERMISSIONS[p].defaults)).toEqual(sorted(table.permissions[p].defaults))
    expect(sorted(PERMISSIONS[p].grantable)).toEqual(sorted(table.permissions[p].grantable))
  })

  it('gives bitNtech staff the same permissions', () => {
    expect(sorted([...platformAccess('staff').perms])).toEqual(sorted(table.platformStaff))
  })

  it('knows the same roles', () => {
    const roles = new Set<Role>(Object.values(PERMISSIONS).flatMap((m) => [...m.defaults, ...m.grantable]))
    expect(sorted([...roles])).toEqual(sorted(table.roles))
  })
})
