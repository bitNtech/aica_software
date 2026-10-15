import { useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../../auth/types'
import type { AgentPatch } from '../../../../console/types'
import { Button } from '../../../../components/ui/Button'
import { ConfirmDialog } from '../../../../components/ui/Dialog'
import { SelectField, TextField } from '../../../../components/ui/Field'
import type { TabProps } from '../shared'

interface Props extends TabProps {
  canDelete: boolean
  /** Applies at once; `done` is said when it worked. */
  onUpdate(patch: AgentPatch, done: string): Promise<void>
  onDelete(): Promise<void>
}

/** Name, number, on or off, and deleting: outside versions, applied at once. */
export function SettingsTab({ detail, spec, lib, canDelete, onUpdate, onDelete }: Props) {
  const id = useId()
  const a = detail.agent
  const current = lib.numbers.find((n) => n.agentId === a.id)

  const [name, setName] = useState(a.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)

  const [numberId, setNumberId] = useState(current?.id ?? '')
  const [numberError, setNumberError] = useState<string | null>(null)
  const [savingNumber, setSavingNumber] = useState(false)

  const [confirm, setConfirm] = useState<'pause' | 'unassign' | 'delete' | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const numberRef = useRef<HTMLSelectElement>(null)
  const typedRef = useRef<HTMLInputElement>(null)
  /** The typed name didn't match: shown on the field. */
  const [typedError, setTypedError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [statusError, setStatusError] = useState<string | null>(null)
  const [turningOn, setTurningOn] = useState(false)

  async function rename(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    // Errors aren't live: focusing the field reads it, with its error.
    if (n.length < 3 || n.length > 60) {
      setNameError('Give the agent a name of 3 to 60 characters.')
      nameRef.current?.focus()
      return
    }
    if (n === a.name) return setNameError(null)
    setSavingName(true)
    setNameError(null)
    try {
      await onUpdate({ name: n }, `Renamed to ${n}.`)
    } catch (err) {
      setNameError(asAuthError(err).message)
      nameRef.current?.focus()
    } finally {
      setSavingName(false)
    }
  }

  async function saveNumber(e: FormEvent) {
    e.preventDefault()
    if (numberId === (current?.id ?? '')) return
    // Taking a live agent off its number stops it answering: ask first.
    if (!numberId && a.status === 'live') {
      setDialogError(null)
      setConfirm('unassign')
      return
    }
    await applyNumber()
  }

  async function applyNumber() {
    setSavingNumber(true)
    setNumberError(null)
    const chosen = lib.numbers.find((n) => n.id === numberId)
    try {
      await onUpdate({ numberId: numberId || null }, chosen ? `${a.name} now answers ${chosen.number}.` : `${a.name} has no number now, so it’s paused.`)
    } catch (err) {
      setNumberError(asAuthError(err).message)
      numberRef.current?.focus()
    } finally {
      setSavingNumber(false)
    }
  }

  async function turnOn() {
    if (turningOn) return
    setTurningOn(true)
    setStatusError(null)
    try {
      await onUpdate({ status: 'live' }, `${a.name} is answering ${a.phoneNumber} again.`)
    } catch (err) {
      setStatusError(asAuthError(err).message)
    } finally {
      setTurningOn(false)
    }
  }

  async function confirmAction() {
    setBusy(true)
    setDialogError(null)
    try {
      if (confirm === 'pause') {
        await onUpdate({ status: 'paused' }, `${a.name} is paused.`)
        setConfirm(null)
      } else if (confirm === 'unassign') {
        setConfirm(null)
        await applyNumber()
      } else {
        if (typed.trim() !== a.name) {
          setTypedError(`Type “${a.name}” exactly, to confirm.`)
          typedRef.current?.focus()
          setBusy(false)
          return
        }
        await onDelete()
      }
    } catch (err) {
      setDialogError(asAuthError(err).message)
    }
    setBusy(false)
  }

  const numbers = lib.numbers.filter((n) => !n.agentId || n.agentId === a.id)

  return (
    <div className="ws__sections">
      <p className="step__sub ws__apply-note">Changes here apply straight away. They aren’t saved as a version.</p>
      <section className="step__section" aria-labelledby={`${id}-name`}>
        <h2 id={`${id}-name`} className="step__heading">
          Name
        </h2>
        <form className="ws__inline-form" onSubmit={rename} noValidate>
          <TextField ref={nameRef} label="Agent name" hint="Only your team sees this." value={name} maxLength={80} error={nameError} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="line" busy={savingName} busyLabel="Saving…" className="rules__button">
            Save name
          </Button>
        </form>
      </section>

      <section className="step__section" aria-labelledby={`${id}-num`}>
        <h2 id={`${id}-num`} className="step__heading">
          Phone number
        </h2>
        <form className="ws__inline-form" onSubmit={saveNumber} noValidate>
          <SelectField
            ref={numberRef}
            label="Answers"
            hint={numberId ? undefined : 'With no number, it’s paused.'}
            value={numberId}
            error={numberError}
            options={[{ value: '', label: 'No number' }, ...numbers.map((n) => ({ value: n.id, label: `${n.number} (${n.label})` }))]}
            onChange={(e) => setNumberId(e.target.value)}
          />
          <Button type="submit" variant="line" busy={savingNumber} busyLabel="Saving…" className="rules__button">
            Save number
          </Button>
        </form>
      </section>

      <section className="step__section" aria-labelledby={`${id}-on`}>
        <h2 id={`${id}-on`} className="step__heading">
          Answering calls
        </h2>
        {a.status === 'live' ? (
          <>
            <p>
              It’s answering {a.phoneNumber}. Pause it to stop, without changing its setup. Calls then go to {spec.guardrails.transferTo}.
            </p>
            <div>
              <Button variant="line" onClick={() => setConfirm('pause')}>
                Pause agent
              </Button>
            </div>
          </>
        ) : (
          <>
            <p id={`${id}-paused`}>
              {a.phoneNumber ? `It’s paused: calls to ${a.phoneNumber} go to ${spec.guardrails.transferTo}.` : 'It’s paused, and has no number to answer. Give it one above first.'}
            </p>
            <div>
              <Button
                variant="plum"
                className={a.phoneNumber ? undefined : 'btn--inactive'}
                aria-disabled={a.phoneNumber ? undefined : true}
                aria-describedby={a.phoneNumber ? undefined : `${id}-paused`}
                onClick={() => a.phoneNumber && void turnOn()}
              >
                Turn on
              </Button>
            </div>
            {statusError && (
              <p className="field__error" role="alert">
                {statusError}
              </p>
            )}
          </>
        )}
      </section>

      {canDelete && (
        <section className="step__section ws__danger" aria-labelledby={`${id}-del`}>
          <h2 id={`${id}-del`} className="step__heading">
            Delete this agent
          </h2>
          <p>Its versions go with it, and its number is freed. Past calls stay in Call history.</p>
          <div>
            <Button
              variant="danger"
              onClick={() => {
                setTyped('')
                setTypedError(null)
                setDialogError(null)
                setConfirm('delete')
              }}
            >
              Delete agent
            </Button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'pause' ? `Pause ${a.name}?` : confirm === 'unassign' ? `Take ${a.phoneNumber} away from ${a.name}?` : `Delete ${a.name}?`}
        confirmLabel={confirm === 'pause' ? 'Pause' : confirm === 'unassign' ? 'Remove number' : 'Delete agent'}
        busyLabel={confirm === 'pause' ? 'Pausing…' : confirm === 'unassign' ? 'Saving…' : 'Deleting…'}
        busy={busy}
        danger={confirm !== 'pause'}
        error={dialogError}
        initialFocus={confirm === 'delete' ? typedRef : undefined}
        onConfirm={() => void confirmAction()}
        onCancel={() => setConfirm(null)}
      >
        {confirm === 'pause' ? (
          <p>It stops answering {a.phoneNumber} straight away. Calls go to {spec.guardrails.transferTo} until you turn it on again.</p>
        ) : confirm === 'unassign' ? (
          <p>It stops answering {a.phoneNumber} straight away and is paused until it has a number again.</p>
        ) : (
          // A form, so Enter in the field confirms.
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void confirmAction()
            }}
            noValidate
          >
            <p>This can’t be undone. Type the agent’s name to confirm.</p>
            <TextField
              ref={typedRef}
              label={`Type “${a.name}”`}
              value={typed}
              autoComplete="off"
              error={typedError}
              onChange={(e) => {
                setTyped(e.target.value)
                if (typedError) setTypedError(null)
              }}
            />
          </form>
        )}
      </ConfirmDialog>
    </div>
  )
}
