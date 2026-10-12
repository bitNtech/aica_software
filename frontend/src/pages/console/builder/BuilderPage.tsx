import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import { BUILDER_STEPS, type AgentDraft, type BuilderStep } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { Spinner } from '../../../components/ui/Spinner'
import { BuilderSteps } from './BuilderSteps'
import { STEP_META, isStep, later, stepIndex } from './steps'
import type { StepErrors, StepProps } from './StepShared'
import { useAutosave, type SaveState } from './useAutosave'
import { StepBehaviour } from './steps/StepBehaviour'
import { StepCalls } from './steps/StepCalls'
import { StepPending } from './steps/StepPending'
import { StepType } from './steps/StepType'
import './Builder.css'

const STEP_VIEW: Record<BuilderStep, (p: StepProps) => ReactNode> = {
  calls: StepCalls,
  type: StepType,
  behaviour: StepBehaviour,
  flow: StepPending,
  attributes: StepPending,
  global: StepPending,
  context: StepPending,
  review: StepPending,
}

/** /o/:slug/agents/drafts/:draftId/:step — the agent builder. The draft is
 * saved as you go; Next checks the step before moving on. Keyed by draft,
 * so opening another draft never shows or saves the previous one. */
export default function BuilderRoute() {
  const { draftId = '' } = useParams()
  return <BuilderPage key={draftId} />
}

function BuilderPage() {
  const { org } = useOrg()
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

  const base = `/o/${org.orgSlug}/agents/drafts/${draftId}`

  if (loadError) {
    return (
      <ConsolePage kicker="New agent" title="New agent" docTitle="New agent">
        <Alert tone="error" title="Couldn't open this draft">
          <p>{asAuthError(loadError).message}</p>
          <p className="builder__alert-actions">
            <button type="button" className="btn-text" onClick={load}>
              Try again
            </button>
            <Link className="link" to={`/o/${org.orgSlug}/agents`}>
              Back to agents
            </Link>
          </p>
        </Alert>
      </ConsolePage>
    )
  }

  if (!draft) {
    return (
      <ConsolePage kicker="New agent" title="New agent" docTitle="New agent">
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

  const update = (change: (d: AgentDraft) => AgentDraft) => {
    setDraft((d) => (d ? change(d) : d))
    autosave.changed()
  }

  async function goNext() {
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
      navigate(`/o/${org.orgSlug}/agents`)
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
      navigate(`/o/${org.orgSlug}/agents`, { replace: true })
    } catch (err) {
      setDiscardError(asAuthError(err).message)
      setDiscarding('open')
    }
  }

  const tries = attempt.step === step ? attempt.n : 0
  const props: StepProps = { draft, org, update, showErrors: tries > 0, attempt: tries, validator }

  return (
    <ConsolePage
      key={step}
      kicker={
        <>
          New agent <i aria-hidden="true">/</i> Step {at + 1} of {BUILDER_STEPS.length}
        </>
      }
      title={meta.title}
      lede={<p>{meta.lede}</p>}
      docTitle={`New agent: ${meta.label}`}
      actions={<SaveStatus state={autosave.state} onRetry={() => void autosave.retry()} />}
    >
      <div className="builder">
        <BuilderSteps base={base} current={step} reached={draft.reached} />
        <div className="builder__body">
          <View {...props} />

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
              <Button variant="line" onClick={() => void saveAndExit()} disabled={moving}>
                Save and exit
              </Button>
            </div>
            {at < BUILDER_STEPS.length - 1 && (
              <Button variant="orange" arrow busy={moving} busyLabel="Saving…" onClick={() => void goNext()}>
                Next: {STEP_META[BUILDER_STEPS[at + 1]].label}
              </Button>
            )}
          </div>
          <p className="builder__discard">
            <button type="button" className="btn-text" onClick={() => setDiscarding('open')}>
              Discard this draft
            </button>
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={discarding !== 'closed'}
        title="Discard this draft?"
        confirmLabel="Discard draft"
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
        <p>Everything you set up for {draft.name.trim() || 'this agent'} is deleted. Your call library isn’t affected.</p>
      </ConfirmDialog>
    </ConsolePage>
  )
}

/** Saving, saved, or failed. Only a failure, and the recovery after it,
 * is announced: the always-present status region gets text just then. */
function SaveStatus({ state, onRetry }: { state: SaveState; onRetry(): void }) {
  const [recovered, setRecovered] = useState(false)
  // Error → saving → saved: remember the error across the retry.
  const hadError = useRef(false)
  useEffect(() => {
    if (state === 'error') {
      hadError.current = true
      setRecovered(false)
    } else if (state === 'saved' && hadError.current) {
      hadError.current = false
      setRecovered(true)
    }
  }, [state])

  return (
    <div className="save-status-wrap">
      <p className={`save-status${state === 'error' ? ' save-status--error' : ''}`}>
        {state === 'error' ? (
          <>
            Couldn’t save.{' '}
            <button type="button" className="btn-text" onClick={onRetry}>
              Retry
            </button>
          </>
        ) : state === 'saving' ? (
          'Saving…'
        ) : state === 'unsaved' ? (
          'Unsaved changes'
        ) : (
          'All changes saved'
        )}
      </p>
      <p className="sr-only" role="status">
        {state === 'error' ? 'Couldn’t save your changes.' : recovered && state === 'saved' ? 'Your changes are saved now.' : ''}
      </p>
    </div>
  )
}
