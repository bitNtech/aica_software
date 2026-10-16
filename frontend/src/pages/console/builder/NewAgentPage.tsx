import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Spinner } from '../../../components/ui/Spinner'

/** /ops/orgs/:slug/agents/new — starts a draft and opens the builder on it.
 * Only bitNtech's master admin creates agents. */
export default function NewAgentPage() {
  const { org, base } = useOrg()
  const client = useConsole()
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>(null)
  const started = useRef(false)
  const here = useRef(true)

  // Leaving before the draft exists cancels the redirect into the builder.
  useEffect(() => {
    here.current = true
    return () => {
      here.current = false
    }
  }, [])

  const start = useCallback(() => {
    setError(null)
    client.createDraft(org.orgSlug, org.orgName).then(
      (d) => {
        if (here.current) navigate(`${base}/agents/drafts/${d.id}/calls`, { replace: true })
      },
      (err) => {
        if (here.current) setError(err)
      },
    )
  }, [client, org.orgSlug, org.orgName, base, navigate])

  useEffect(() => {
    // Once, even when React runs effects twice in development.
    if (started.current) return
    started.current = true
    start()
  }, [start])

  return (
    <ConsolePage kicker="New agent" title="New agent" docTitle="New agent">
      {error ? (
        <Alert tone="error" title="Couldn't start a new agent">
          <p>{asAuthError(error).message}</p>
          <p className="builder__alert-actions">
            <button type="button" className="btn-text" onClick={start}>
              Try again
            </button>
            <Link className="link" to={`${base}/agents`}>
              Back to agents
            </Link>
          </p>
        </Alert>
      ) : (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Starting a new agent…</span>
        </div>
      )}
    </ConsolePage>
  )
}
