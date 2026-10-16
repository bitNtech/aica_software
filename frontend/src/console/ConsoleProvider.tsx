import { createContext, use, useEffect, useRef, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { permissionsFor } from './access'
import type { ConsoleClient } from './types'

const ConsoleContext = createContext<ConsoleClient | null>(null)

/** Gives organisation pages their data client: the demo one for now, the
 * real API later, with no change to the pages. When the signed-in person
 * changes (sign-out, or someone else signs in), the client forgets what it
 * held, so nobody sees the previous person's demo drafts. */
export function ConsoleProvider({ client, children }: { client: ConsoleClient; children: ReactNode }) {
  const { status, user } = useAuth()
  const who = status === 'restoring' ? undefined : (user?.id ?? null)
  const last = useRef<string | null | undefined>(undefined)

  // Who's asking, before any page below fetches (their effects run before
  // this component's own). Setting it again with the same person is harmless.
  client.setViewer?.(
    user
      ? {
          id: user.id,
          name: user.name,
          roles: Object.fromEntries(user.memberships.map((m) => [m.orgSlug, m.role])),
          permissions: Object.fromEntries(user.memberships.map((m) => [m.orgSlug, permissionsFor(m.role, m.permissions)])),
          platformRole: user.platformRole ?? null,
        }
      : null,
  )

  useEffect(() => {
    if (who === undefined) return
    if (last.current !== undefined && last.current !== who) client.reset?.()
    last.current = who
  }, [who, client])

  return <ConsoleContext value={client}>{children}</ConsoleContext>
}

export function useConsole(): ConsoleClient {
  const c = use(ConsoleContext)
  if (!c) throw new Error('useConsole must be used inside <ConsoleProvider>')
  return c
}
