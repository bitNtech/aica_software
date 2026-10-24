import { useEffect, useState } from 'react'
import { tabAccess } from '../../../../console/access'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { FlowNode } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'

export type DesignedFlow = { state: 'loading' } | { state: 'ready'; flow: FlowNode[] } | { state: 'unavailable' }

/**
 * The flow an agent was designed with, for drawing calls and patterns on.
 * It is the version callers get (the newest published one; the working copy
 * only when nothing is published). Reading it needs the same permission as
 * the agent's Flow tab; without it, or when the agent can't be read or has
 * no flow, the state is "unavailable" and callers fall back to plain lists.
 */
export function useDesignedFlow(agentId: string | null): DesignedFlow {
  const { org, access } = useOrg()
  const client = useConsole()
  const mayRead = tabAccess(access, 'flow') !== null
  const [result, setResult] = useState<{ id: string; value: DesignedFlow } | null>(null)

  useEffect(() => {
    if (!agentId || !mayRead) return
    let live = true
    client.getAgent(org.orgSlug, agentId).then(
      (d) => {
        if (!live) return
        const flow = d.versions[0]?.spec.flow ?? d.working.flow
        setResult({ id: agentId, value: flow.length > 0 ? { state: 'ready', flow } : { state: 'unavailable' } })
      },
      () => live && setResult({ id: agentId, value: { state: 'unavailable' } }),
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, agentId, mayRead])

  if (!agentId || !mayRead) return { state: 'unavailable' }
  return result?.id === agentId ? result.value : { state: 'loading' }
}
