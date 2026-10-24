import { useRef, useState, type FormEvent, type Ref } from 'react'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { LiveCall, Member } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { Button } from '../../../../components/ui/Button'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { SelectField, TextField } from '../../../../components/ui/Field'

/** A note only the agent hears, mid-call, e.g. "Offer Saturday with Dr. Arvind". */
export function GuideForm({ callId, inputRef, onSent }: { callId: string; inputRef: Ref<HTMLInputElement>; onSent(call: LiveCall): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const own = useRef<HTMLInputElement | null>(null)

  const field = (el: HTMLInputElement | null) => {
    own.current = el
    if (typeof inputRef === 'function') inputRef(el)
    else if (inputRef) inputRef.current = el
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) {
      setError('Write what the agent should know.')
      own.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const call = await client.whisperToAgent(org.orgSlug, callId, text)
      setText('')
      onSent(call)
    } catch (err) {
      setError(asAuthError(err).message)
      own.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="op-form live-guide" onSubmit={send} noValidate>
      <TextField
        ref={field}
        label="Note to the agent"
        hint="A note only the agent hears, e.g. “Offer Saturday 10 AM with Dr. Arvind”."
        maxLength={200}
        value={text}
        error={error}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="op-card__actions">
        <Button type="submit" variant="line" size="sm" busy={busy} busyLabel="Sending…">
          Send to the agent
        </Button>
      </div>
    </form>
  )
}

/** Hand the call to a colleague who takes calls: warm (the agent briefs them first) or straight through. */
export function TransferForm({ call, team, onCancel, onDone }: { call: LiveCall; team: Member[]; onCancel(): void; onDone(done: string, call: LiveCall): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const [to, setTo] = useState('')
  const [warm, setWarm] = useState<'warm' | 'cold'>('warm')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const select = useRef<HTMLSelectElement>(null)

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!to) {
      setError('Choose who takes the call.')
      select.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const out = await client.transferCall(org.orgSlug, call.id, to, warm === 'warm')
      onDone(`Handed to ${out.transferredTo?.name ?? 'your colleague'}.`, out)
    } catch (err) {
      setError(asAuthError(err).message)
      setBusy(false)
    }
  }

  return (
    <form className="op-form" onSubmit={send} noValidate>
      <p>
        {call.agentName}, {call.callerPhone}: {call.intent ?? 'still finding out what they need'}.
      </p>
      <SelectField
        ref={select}
        label="Who takes it"
        value={to}
        error={error}
        options={[{ value: '', label: team.length ? 'Choose a colleague' : 'Nobody else takes calls' }, ...team.map((m) => ({ value: m.id, label: m.name }))]}
        onChange={(e) => setTo(e.target.value)}
      />
      <ChoiceGroup
        legend="How"
        type="radio"
        value={[warm]}
        onChange={([v]) => setWarm(v)}
        options={[
          { value: 'warm', label: 'Warm', hint: 'The agent tells them who’s calling and why, then connects the caller.' },
          { value: 'cold', label: 'Straight through', hint: 'The caller is put through at once.' },
        ]}
      />
      <div className="dialog__actions">
        <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Handing over…">
          Hand over
        </Button>
        <Button variant="line" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
