import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import { BUILDER_STEPS, type AgentDraft, type BuilderStep } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { isMaster } from '../../../console/access'
import { timeAgo } from '../../../lib/time'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { Spinner } from '../../../components/ui/Spinner'
import { BuilderSteps } from './BuilderSteps'
import { STEP_META, isStep, later, stepIndex } from './steps'
import type { StepErrors, StepProps } from './StepShared'
import { SaveStatus } from './SaveStatus'
import { useAutosave } from './useAutosave'
import { StepAttributes } from './steps/StepAttributes'
import { StepBehaviour } from './steps/StepBehaviour'
import { StepCalls } from './steps/StepCalls'
import { StepContext } from './steps/StepContext'
import { StepFlow } from './steps/StepFlow'
import { StepGlobal } from './steps/StepGlobal'
import { StepReview } from './steps/StepReview'
import { StepType } from './steps/StepType'
import './Builder.css'

const STEP_VIEW: Record<BuilderStep, (p: StepProps) => ReactNode> = {
  calls: StepCalls,
  type: StepType,
  behaviour: StepBehaviour,
  flow: StepFlow,
  attributes: StepAttributes,
  global: StepGlobal,
  context: StepContext,
  review: StepReview,
}

/** /ops/orgs/:slug/agents/drafts/:draftId/:step — the agent builder. The
 * master admin builds and publishes; at /o/:slug/... the organisation builds
 * its own draft, of a new agent or of changes to one, and sends it to
 * bitNtech as a request. The draft is saved as you go; Next checks the step
 * before moving on. Keyed by draft, so opening another draft never shows or
 * saves the previous one. */
export default function BuilderRoute() {
  const { draftId = '' } = useParams()
  return <BuilderPage key={draftId} />
}

function BuilderPage() {
  const { org, access, base: orgBase } = useOrg()
  const mode = isMaster(access) ? 'build' : 'request'
  const client = useConsole()
  const navigate = useNavigate()
  const { draftId = '', step: stepParam } = useParams()
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  /** Failed Next presses, per step: errors show only on that step. */
  const [attempt, setAttempt] = useState<{ step: string | undefined; n: number }>({ step: undefined, n: 0 })
  const [moving, setMoving] = useState(false)
  const [discarding, setDiscarding] = useState<'closed' | 'open' | 'busy'>('closed')
  const [actionError, setActionError] = useState<string | null>(null)
  const [discardError, setDiscardError] = useState<string | null>(null)
  const validator = useRef<() => StepErrors>(() => ({}))

  const save = useCallback((d: AgentDraft) => client.saveDraft(org.orgSlug, d), [client, org.orgSlug])
  const autosave = useAutosave(draft, save)

  const load = useCallback(() => {
    setLoadError(null)
    client.getDraft(org.orgSlug, draftId).then(setDraft, setLoadError)
  }, [client, org.orgSlug, draftId])
  useEffect(load, [load])

  // A new step starts without the last step's action error.
  useEffect(() => {
    setActionError(null)
  }, [stepParam])

  const base = `${orgBase}/agents/drafts/${draftId}`

  if (loadError) {
    return (
      <ConsolePage section="agents" kicker="Agent builder" title="Agent builder" docTitle="Agent builder">
        <Alert tone="error" title="Couldn't open this draft">
          <p>{asAuthError(loadError).message}</p>
          <p className="builder__alert-actions">
            <button type="button" className="btn-text" onClick={load}>
              Try again
            </button>
            <Link className="link" to={`${orgBase}/agents`}>
              Back to agents
            </Link>
          </p>
        </Alert>
      </ConsolePage>
    )
  }

  if (!draft) {
    return (
      <ConsolePage section="agents" kicker="Agent builder" title="Agent builder" docTitle="Agent builder">
        <div className="loading-row" role="status">
          <Spinner />
          <span>Opening the draft…</span>
        </div>
      </ConsolePage>
    )
  }

  // Unknown step, or one not reached yet: go to the furthest reached.
  if (!isStep(stepParam) || stepIndex(stepParam) > stepIndex(draft.reached)) return <Navigate to={`${base}/${draft.reached}`} replace />
  const step = stepParam
  const at = stepIndex(step)
  const meta = STEP_META[step]
  const View = STEP_VIEW[step]

  // Sent to bitNtech: the organisation looks, but changes nothing until it
  // withdraws the request.
  const locked = mode === 'request' && !!draft.submittedAt
  const change = !!draft.baseAgentId
  const what = change ? `Changes to ${draft.name.trim() || 'the agent'}` : mode === 'request' ? 'New agent request' : 'New agent'
  const requestHref = draft.requestId ? `${orgBase}/requests#${draft.requestId}` : `${orgBase}/requests`

  const update = (change: (d: AgentDraft) => AgentDraft) => {
    if (locked) return
    setDraft((d) => (d ? change(d) : d))
    autosave.changed()
  }

  async function goNext() {
    if (locked) {
      const next = BUILDER_STEPS[at + 1]
      if (next) navigate(`${base}/${next}`)
      return
    }
    if (Object.keys(validator.current()).length > 0) {
      setAttempt((a) => ({ step, n: a.step === step ? a.n + 1 : 1 }))
      return
    }
    const next = BUILDER_STEPS[at + 1]
    if (!next || !draft) return
    setMoving(true)
    setActionError(null)
    // Reaching a new step is part of the draft, so it's saved with it.
    const moved = { ...draft, reached: later(draft.reached, next) }
    setDraft(moved)
    try {
      await autosave.flush(moved)
      navigate(`${base}/${next}`)
    } catch {
      setActionError("Couldn't save the draft, so we stayed on this step. Check your connection and try again.")
    } finally {
      setMoving(false)
    }
  }

  async function saveAndExit() {
    setMoving(true)
    setActionError(null)
    try {
      await autosave.flush()
      navigate(`${orgBase}/agents`)
    } catch {
      setActionError("Couldn't save the draft. Check your connection and try again.")
      setMoving(false)
    }
  }

  async function discard() {
    setDiscarding('busy')
    setDiscardError(null)
    // No save may land after (or race) the delete.
    autosave.cancel()
    try {
      await client.discardDraft(org.orgSlug, draftId)
      navigate(`${orgBase}/agents`, { replace: true })
    } catch (err) {
      setDiscardError(asAuthError(err).message)
      setDiscarding('open')
    }
  }

  const tries = attempt.step === step ? attempt.n : 0
  const props: StepProps = { draft, org, base: orgBase, update, showErrors: tries > 0 && !locked, attempt: tries, validator, save: () => autosave.flush(), done: autosave.cancel, mode, locked }

  return (
    <ConsolePage section="agents"
      key={step}
      kicker={
        <>
          {what} <i aria-hidden="true">/</i> Step {at + 1} of {BUILDER_STEPS.length}
        </>
      }
      title={meta.title}
      lede={<p>{meta.lede}</p>}
      docTitle={`${what}: ${meta.label}`}
      actions={locked ? <span className="status-chip req__status req__status--open">Sent to bitNtech</span> : <SaveStatus state={autosave.state} onRetry={() => void autosave.retry()} />}
    >
      {locked && (
        <Alert tone="info" title={`Sent to bitNtech ${draft.submittedAt ? timeAgo(draft.submittedAt) : ''}`} className="builder__sent">
          <p>
            bitNtech builds and tests it from here. You can look through every step; to change something, withdraw the request in{' '}
            <Link className="link" to={requestHref}>
              Requests
            </Link>{' '}
            and send it again.
          </p>
        </Alert>
      )}
      {mode === 'build' && draft.requestedBy && (
        <Alert tone="info" title={draft.submittedAt ? `Asked for by ${draft.requestedBy.name}, ${timeAgo(draft.submittedAt)}` : `${draft.requestedBy.name} is still writing this`} className="builder__sent">
          <p>
            {draft.submittedAt ? (change ? 'Their changes to this agent, made in the builder. Check and finish them, then publish: the request is marked done and they’re told.' : 'Their agent, made in the builder. Check and finish it, then publish it for them: the request is marked done and they’re told.') : 'They haven’t sent it yet.'}{' '}
            {draft.requestId && (
              <Link className="link" to={requestHref}>
                Open the request
              </Link>
            )}
          </p>
        </Alert>
      )}
      <div className="builder">
        <BuilderSteps base={base} current={step} reached={draft.reached} />
        <div className="builder__body">
          {locked ? (
            // Look only: every control in the step is disabled.
            <fieldset className="builder__locked" disabled aria-label={`${meta.title} (sent to bitNtech, look only)`}>
              <View {...props} />
            </fieldset>
          ) : (
            <View {...props} />
          )}

          {actionError && (
            <Alert tone="error" className="builder__action-error">
              {actionError}
            </Alert>
          )}

          <div className="builder__nav">
            <div className="builder__nav-side">
              {at > 0 && (
                <Link className="btn btn--line" to={`${base}/${BUILDER_STEPS[at - 1]}`}>
                  <span>Back</span>
                </Link>
              )}
              {locked ? (
                <Link className="btn btn--line" to={`${orgBase}/agents`}>
                  <span>Back to agents</span>
                </Link>
              ) : (
                <Button variant="line" onClick={() => void saveAndExit()} disabled={moving}>
                  Save and exit
                </Button>
              )}
            </div>
            {at < BUILDER_STEPS.length - 1 && (
              <Button variant="orange" arrow busy={moving} busyLabel="Saving…" onClick={() => void goNext()}>
                Next: {STEP_META[BUILDER_STEPS[at + 1]].label}
              </Button>
            )}
          </div>
          {!locked && (
            <p className="builder__discard">
              <button type="button" className="btn-text" onClick={() => setDiscarding('open')}>
                {change ? 'Discard these changes' : 'Discard this draft'}
              </button>
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={discarding !== 'closed'}
        title={change ? 'Discard these changes?' : 'Discard this draft?'}
        confirmLabel={change ? 'Discard changes' : 'Discard draft'}
        busyLabel="Discarding…"
        busy={discarding === 'busy'}
        danger
        error={discardError}
        onConfirm={() => void discard()}
        onCancel={() => {
          setDiscarding('closed')
          setDiscardError(null)
        }}
      >
        <p>
          {change
            ? `Your changes are deleted. ${draft.name.trim()} carries on as it is, and your call library isn’t affected.`
            : `Everything you set up for ${draft.name.trim() || 'this agent'} is deleted. Your call library isn’t affected.`}
        </p>
      </ConfirmDialog>
    </ConsolePage>
  )
}
