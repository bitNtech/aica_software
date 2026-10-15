import { createContext, use, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { OpsDataClient } from './types'

const OpsDataContext = createContext<OpsDataClient | null>(null)

/** Gives the Ops pages without an API yet their data client (demo for now). */
export function OpsDataProvider({ client, children }: { client: OpsDataClient; children: ReactNode }) {
  const { user } = useAuth()
  // Who's asking, before any page below fetches (as ConsoleProvider does).
  client.setViewer?.(user ? { id: user.id, name: user.name, platformRole: user.platformRole ?? null } : null)
  return <OpsDataContext value={client}>{children}</OpsDataContext>
}

export function useOpsData(): OpsDataClient {
  const c = use(OpsDataContext)
  if (!c) throw new Error('useOpsData must be used inside <OpsDataProvider>')
  return c
}
