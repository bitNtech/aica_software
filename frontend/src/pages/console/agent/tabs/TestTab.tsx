import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Scenario, ScenarioInput } from '../../../../console/types'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { ConfirmDialog, Modal } from '../../../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import { Spinner } from '../../../../components/ui/Spinner'
import { useAsync } from '../../../../lib/useAsync'
import { timeAgo } from '../../../../lib/time'
import { TestChat } from '../../builder/TestChat'
import { useAnnouncer } from '../../operate/LiveBits'
import type { TabProps } from '../shared'

/** Try the agent: scripted test scenarios, a text simulation now, and a
 * test call once the voice servers are connected. */
export function TestTab(props: TabProps & { hasChanges: boolean; onBeforeRun(): Promise<void> }) {
  const { detail, spec, lib, hasChanges } = props
  const id = useId()
  return (
    <div className="ws__sections">
      <Scenarios {...props} />
      <section className="step__section" aria-labelledby={`${id}-text`}>
        <h2 id={`${id}-text`} className="step__heading">
          Type as the caller
        </h2>
        <p className="step__sub">
          {hasChanges
            ? `This tries your draft changes, not version ${detail.agent.version} that callers get.`
            : `This tries version ${detail.agent.version}, the one callers get.`}
        </p>
        <TestChat draft={spec} tools={lib.tools} knowledge={lib.knowledge} />
      </section>
      <section className="step__section" aria-labelledby={`${id}-call`}>
        <h2 id={`${id}-call`} className="step__heading">
          Test call in your browser
        </h2>
        <div className="ws__unavailable">
          <p>Talk to the agent through your microphone, as a caller would. This needs AICA’s voice servers, which aren’t connected yet.</p>
          <Button variant="line" size="sm" className="btn--inactive" aria-disabled aria-describedby={`${id}-why`}>
            Start a test call
          </Button>
          <p className="field__hint" id={`${id}-why`}>
            Not available yet.
          </p>
        </div>
      </section>
    </div>
  )
}

const HANDOVER = [
  { value: 'any', label: 'Either is fine' },
  { value: 'yes', label: 'Hands over to a person' },
  { value: 'no', label: 'Doesn’t hand over' },
]

const blank = (): ScenarioInput => ({ name: '', callerSays: [], expect: { intent: '', mustSay: [], handover: null } })

/** Scripted callers that check the agent before changes go live, as test
 * suites do in Vapi and simulations in Retell. */
function Scenarios({ org, detail, spec, hasChanges, onBeforeRun }: TabProps & { hasChanges: boolean; onBeforeRun(): Promise<void> }) {
  const client = useConsole()
  const id = useId()
  const agentId = detail.agent.id
  const load = useCallback(() => client.listScenarios(org.orgSlug, agentId), [client, org.orgSlug, agentId])
  const [list, reload, setList] = useAsync(load)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ScenarioInput | null>(null)
  const [removing, setRemoving] = useState<Scenario | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [said, say] = useAnnouncer()

  async function runAll() {
    setRunning(true)
    setRunError(null)
    try {
      // The run uses the saved setup, so save what's on screen first.
      await onBeforeRun()
      const out = await client.runScenarios(org.orgSlug, agentId)
      setList((r) => (r.state === 'ready' ? { ...r, data: out } : r))
      const failed = out.filter((s) => s.lastRun && !s.lastRun.passed).length
      say(failed ? `${failed} of ${out.length} scenarios failed.` : `All ${out.length} scenarios passed.`)
    } catch (err) {
      setRunError(asAuthError(err).message)
    } finally {
      setRunning(false)
    }
  }

  async function remove() {
    if (!removing) return
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      await client.deleteScenario(org.orgSlug, agentId, removing.id)
      setList((r) => (r.state === 'ready' ? { ...r, data: r.data.filter((x) => x.id !== removing.id) } : r))
      say(`Deleted “${removing.name}”.`)
      setRemoving(null)
    } catch (err) {
      setRemoveError(asAuthError(err).message)
    } finally {
      setRemoveBusy(false)
    }
  }

  const scenarios = list.state === 'ready' ? list.data : []
  const ran = scenarios.filter((s) => s.lastRun)
  const passed = ran.filter((s) => s.lastRun!.passed).length

  return (
    <section className="step__section" aria-labelledby={`${id}-scn`}>
      <div className="step__head-row">
        <h2 id={`${id}-scn`} className="step__heading">
          Test scenarios
        </h2>
        {list.state === 'ready' && (
          <div className="scn__actions">
            <Button variant="line" size="sm" onClick={() => setEditing(blank())}>
              Add a scenario
            </Button>
            {scenarios.length > 0 && (
              <Button variant="orange" size="sm" busy={running} busyLabel="Running…" onClick={() => void runAll()}>
                Run all
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="step__sub">
        A scripted caller and what the agent should do. Run them before publishing: they try {hasChanges ? 'your draft changes' : `version ${detail.agent.version}`}.
      </p>
      <p className="sr-only" role="status">
        {said}
      </p>
      {list.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading scenarios…</span>
        </div>
      )}
      {list.state === 'error' && (
        <Alert tone="error" title="Couldn't load the scenarios">
          <p>{asAuthError(list.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {runError && <Alert tone="error">{runError}</Alert>}
      {list.state === 'ready' && scenarios.length === 0 && <p className="empty-note">No scenarios yet. Add the calls you most want this agent to get right.</p>}
      {ran.length > 0 && (
        <p className={`scn__score${passed === ran.length ? ' scn__score--ok' : ''}`}>
          {passed} of {ran.length} passed{ran.length < scenarios.length ? `; ${scenarios.length - ran.length} not run since they changed` : ''}.
        </p>
      )}
      {scenarios.length > 0 && (
        <ul className="scn__list" aria-label="Test scenarios">
          {scenarios.map((s) => (
            <li key={s.id} className="scn__item">
              <div className="scn__head">
                <strong>{s.name}</strong>
                {s.lastRun ? (
                  <span className={`flag ${s.lastRun.passed ? 'flag--ok' : 'flag--warn'}`}>{s.lastRun.passed ? 'Passed' : 'Failed'}</span>
                ) : (
                  <span className="flag flag--quiet">Not run</span>
                )}
              </div>
              <p className="row__meta">
                Caller: {s.callerSays.map((l) => `“${l}”`).join(' → ')}
              </p>
              <p className="row__meta">
                Expects: {[s.expect.intent && `reaches “${s.expect.intent}”`, s.expect.mustSay.length && `says ${s.expect.mustSay.map((w) => `“${w}”`).join(', ')}`, s.expect.handover === true ? 'hands over' : s.expect.handover === false ? 'doesn’t hand over' : null].filter(Boolean).join('; ') || 'nothing in particular'}
              </p>
              {s.lastRun && !s.lastRun.passed && (
                <ul className="scn__problems">
                  {s.lastRun.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {s.lastRun && (
                <details className="scn__replies">
                  <summary>What it said ({timeAgo(s.lastRun.at)}, {s.lastRun.version === null ? 'draft changes' : `version ${s.lastRun.version}`})</summary>
                  <ol>
                    {s.lastRun.replies.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ol>
                </details>
              )}
              <div className="scn__row-actions">
                <button type="button" className="btn-text" onClick={() => setEditing({ id: s.id, name: s.name, callerSays: s.callerSays, expect: s.expect })} aria-label={`Change ${s.name}`}>
                  Change
                </button>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    setRemoveError(null)
                    setRemoving(s)
                  }}
                  aria-label={`Delete ${s.name}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ScenarioDialog
        scenario={editing}
        intents={spec.flow.map((n) => n.label)}
        onClose={() => setEditing(null)}
        onSave={async (input) => {
          const saved = await client.saveScenario(org.orgSlug, agentId, input)
          setList((r) => (r.state === 'ready' ? { ...r, data: input.id ? r.data.map((x) => (x.id === saved.id ? saved : x)) : [...r.data, saved] } : r))
          say(input.id ? `Saved “${saved.name}”.` : `Added “${saved.name}”. Run it to check.`)
          setEditing(null)
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={`Delete “${removing?.name ?? ''}”?`}
        confirmLabel="Delete scenario"
        busyLabel="Deleting…"
        busy={removeBusy}
        danger
        error={removeError}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        <p>The agent isn’t affected.</p>
      </ConfirmDialog>
    </section>
  )
}

function ScenarioDialog({ scenario, intents, onClose, onSave }: { scenario: ScenarioInput | null; intents: string[]; onClose(): void; onSave(s: ScenarioInput): Promise<void> }) {
  return (
    <Modal open={!!scenario} title={scenario?.id ? 'Change the scenario' : 'Add a scenario'} onClose={onClose} wide>
      {scenario && <ScenarioForm key={scenario.id ?? 'new'} scenario={scenario} intents={intents} onCancel={onClose} onSave={onSave} />}
    </Modal>
  )
}

function ScenarioForm({ scenario, intents, onCancel, onSave }: { scenario: ScenarioInput; intents: string[]; onCancel(): void; onSave(s: ScenarioInput): Promise<void> }) {
  const [name, setName] = useState(scenario.name)
  const [lines, setLines] = useState(scenario.callerSays.join('\n'))
  const [intent, setIntent] = useState(scenario.expect.intent)
  const [mustSay, setMustSay] = useState(scenario.expect.mustSay.join(', '))
  const [handover, setHandover] = useState(scenario.expect.handover === null ? 'any' : scenario.expect.handover ? 'yes' : 'no')
  const [errors, setErrors] = useState<{ name?: string; lines?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const linesRef = useRef<HTMLTextAreaElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const callerSays = lines.split('\n').map((l) => l.trim()).filter(Boolean)
    const next: typeof errors = {}
    if (name.trim().length < 3) next.name = 'Give it a name of at least 3 characters.'
    if (!callerSays.length) next.lines = 'Write at least one thing the caller says.'
    else if (callerSays.length > 10) next.lines = 'Keep it to 10 lines or fewer.'
    setErrors(next)
    if (next.name) return nameRef.current?.focus()
    if (next.lines) return linesRef.current?.focus()
    setBusy(true)
    try {
      await onSave({
        id: scenario.id,
        name,
        callerSays,
        expect: { intent, mustSay: mustSay.split(',').map((w) => w.trim()).filter(Boolean), handover: handover === 'any' ? null : handover === 'yes' },
      })
    } catch (err) {
      setErrors({ form: asAuthError(err).message })
      setBusy(false)
    }
  }

  return (
    <form className="op-form" onSubmit={submit} noValidate>
      <TextField ref={nameRef} label="Name" placeholder="e.g. Books a first visit" maxLength={80} value={name} error={errors.name} onChange={(e) => setName(e.target.value)} />
      <TextAreaField ref={linesRef} label="What the caller says" hint="One line per turn, in order." rows={4} value={lines} error={errors.lines} onChange={(e) => setLines(e.target.value)} />
      <SelectField label="It should reach" value={intent} options={[{ value: '', label: 'Any part of the flow' }, ...intents.map((i) => ({ value: i, label: i }))]} onChange={(e) => setIntent(e.target.value)} />
      <TextField label="Words it must say" hint="Optional. Separated by commas, e.g. slot, confirm." value={mustSay} onChange={(e) => setMustSay(e.target.value)} />
      <SelectField label="Handing over" value={handover} options={HANDOVER} onChange={(e) => setHandover(e.target.value)} />
      {errors.form && (
        <p className="field__error" role="alert">
          {errors.form}
        </p>
      )}
      <div className="dialog__actions">
        <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Saving…">
          Save scenario
        </Button>
        <Button variant="line" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
