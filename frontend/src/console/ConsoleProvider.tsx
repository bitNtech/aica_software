import { createContext, use, type ReactNode } from 'react'
import type { ConsoleClient } from './types'

const ConsoleContext = createContext<ConsoleClient | null>(null)

/** Gives organisation pages their data client: the demo one for now, the
 * real API later, with no change to the pages. */
export function ConsoleProvider({ client, children }: { client: ConsoleClient; children: ReactNode }) {
  return <ConsoleContext value={client}>{children}</ConsoleContext>
}

export function useConsole(): ConsoleClient {
  const c = use(ConsoleContext)
  if (!c) throw new Error('useConsole must be used inside <ConsoleProvider>')
  return c
}
