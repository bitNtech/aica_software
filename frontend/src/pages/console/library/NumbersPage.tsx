import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AgentSummary, PhoneNumber } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { AGENT_STATUS_LABEL } from '../AgentsPage'
import '../builder/Builder.css'
import './Library.css'

const AFTER_LABEL: Record<PhoneNumber['afterHours'], string> = {
  agent: 'The agent keeps answering',
  voicemail: 'Callers leave a message',
  transfer: 'Put through to your team',
}

/** /o/:slug/numbers: which agent answers which line, and when. */
export default function NumbersPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const id = useId()
  const canEdit = pageAccess(access, 'numbers') === 'edit'
  const load = useCallback(async () => {
    const [numbers, agents] = await Promise.all([client.listNumbers(org.orgSlug), client.listAgents(org.orgSlug)])
    // Only published agents can answer a line.
    return { numbers, agents: agents.filter((a) => !a.setupStep) }
  }, [client, org.orgSlug])
  const [lib, reload] = useAsync(load)
  const [editing, setEditing] = useState<PhoneNumber | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [note, setNote] = useState('')

  const agentOf = (n: PhoneNumber) => (lib.state === 'ready' ? lib.data.agents.find((a) => a.id === n.agentId) : undefined)

  return (
    <ConsolePage section="numbers"
      kicker="Agents"
      title="Phone numbers"
      docTitle="Phone numbers"
      lede={<p>Your lines, the agent that answers each, its hours, and where calls go when your team is needed.</p>}
      actions={
        canEdit && (
          <Button variant="line" onClick={() => setRequesting(true)}>
            Ask for another number
          </Button>
        )
      }
    >
      <p className="sr-only" role="status">
        {note}
      </p>
      {lib.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading your numbers…</span>
        </div>
      )}
      {lib.state === 'error' && (
        <Alert tone="error" title="Couldn't load your numbers">
          <p>{asAuthError(lib.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {lib.state === 'ready' && !canEdit && <p className="lib__ro-note">You can look. Owners and admins change numbers.</p>}
      {lib.state === 'ready' &&
        (lib.data.numbers.length === 0 ? (
          <p className="empty-note">No numbers yet. {canEdit ? 'Ask for one: bitNtech sets it up for you.' : ''}</p>
        ) : (
          <>
            <h2 id={`${id}-h`} className="sr-only">
              Your numbers
            </h2>
            <ul className="lib-rows" aria-labelledby={`${id}-h`}>
              {lib.data.numbers.map((n) => {
                const agent = agentOf(n)
                return (
                  <li key={n.id} className="lib-row">
                    <div className="lib-row__main">
                      <h3 className="lib-row__name">
                        <span className="lib-row__mono">{n.number}</span> <span className="lib-row__label">{n.label}</span>
                      </h3>
                      <dl className="lib-facts lib-facts--row">
                        <div>
                          <dt>Answered by</dt>
                          <dd>{agent ? `${agent.name} (${AGENT_STATUS_LABEL[agent.status].toLowerCase()})` : 'No agent'}</dd>
                        </div>
                        <div>
                          <dt>Hours</dt>
                          <dd>{n.hours}</dd>
                        </div>
                        <div>
                          <dt>Out of hours</dt>
                          <dd>
                            {AFTER_LABEL[n.afterHours]}
                            {n.afterHours === 'transfer' && n.transferTo ? `: ${n.transferTo}` : ''}
                          </dd>
                        </div>
                        <div>
                          <dt>Handovers go to</dt>
                          <dd>{n.transferTo ?? 'Not set'}</dd>
                        </div>
                      </dl>
                      {agent?.status === 'paused' && <p className="lib-row__soon">The agent is paused: calls to this number go to {n.transferTo ?? 'your team'}.</p>}
                    </div>
                    {canEdit && (
                      <div className="lib-row__actions">
                        <button type="button" className="btn-text" aria-label={`Change ${n.number}`} onClick={() => setEditing(n)}>
                          Change
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        ))}

      <NumberDialog
        orgSlug={org.orgSlug}
        number={editing}
        agents={lib.state === 'ready' ? lib.data.agents : []}
        numbers={lib.state === 'ready' ? lib.data.numbers : []}
        onClose={() => setEditing(null)}
        onSaved={(n) => {
          setEditing(null)
          setNote(`${n.number} saved.`)
          reload()
        }}
      />
      <RequestDialog
        orgSlug={org.orgSlug}
        open={requesting}
        onClose={() => setRequesting(false)}
        onSent={() => {
          setRequesting(false)
          setNote('Request sent. bitNtech will set up the number and it will appear here.')
        }}
      />
    </ConsolePage>
  )
}

function NumberDialog({
  orgSlug,
  number,
  agents,
  numbers,
  onClose,
  onSaved,
}: {
  orgSlug: string
  number: PhoneNumber | null
  agents: AgentSummary[]
  numbers: PhoneNumber[]
  onClose(): void
  onSaved(n: PhoneNumber): void
}) {
  const client = useConsole()
  const [label, setLabel] = useState('')
  const [agentId, setAgentId] = useState('')
  const [hours, setHours] = useState('')
  const [afterHours, setAfterHours] = useState<PhoneNumber['afterHours']>('agent')
  const [transferTo, setTransferTo] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!number) return
    setLabel(number.label)
    setAgentId(number.agentId ?? '')
    setHours(number.hours)
    setAfterHours(number.afterHours)
    setTransferTo(number.transferTo ?? '')
    setErrors({})
    setError(null)
  }, [number])

  if (!number) return <Modal open={false} title="" onClose={onClose}>{null}</Modal>

  const chosen = agents.find((a) => a.id === agentId)
  const otherLine = chosen ? numbers.find((n) => n.agentId === chosen.id && n.id !== number.id) : undefined
  const current = agents.find((a) => a.id === number.agentId)
  const warnings = [
    otherLine && `${chosen!.name} stops answering ${otherLine.number}: an agent answers one number.`,
    current && current.id !== agentId && `${current.name} will have no number, so it’s paused.`,
    chosen?.status === 'paused' && chosen.id !== number.agentId && `${chosen.name} is paused: turn it on in its Settings to answer this number.`,
  ].filter((w): w is string => !!w)

  async function save(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (label.trim().length < 2) next.label = 'Give the number a label, e.g. “Main reception”.'
    if (!hours.trim()) next.hours = 'Say when the agent answers, e.g. “8 AM to 8 PM”.'
    if (afterHours === 'transfer' && !transferTo.trim()) next.transferTo = 'Say where calls go when your team is needed.'
    setErrors(next)
    if (Object.keys(next).length) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setBusy(true)
    setError(null)
    try {
      onSaved(await client.updateNumber(orgSlug, number!.id, { label, agentId: agentId || null, hours, afterHours, transferTo: transferTo || null }))
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!number} title={`Change ${number.number}`} onClose={() => !busy && onClose()}>
      <form ref={form} className="lib-form" onSubmit={save} noValidate>
        <TextField label="Label" hint="For your team, e.g. “OPD line”." value={label} maxLength={40} error={errors.label} onChange={(e) => setLabel(e.target.value)} />
        <SelectField
          label="Answered by"
          value={agentId}
          options={[{ value: '', label: 'No agent' }, ...agents.map((a) => ({ value: a.id, label: `${a.name} (${AGENT_STATUS_LABEL[a.status].toLowerCase()})` }))]}
          onChange={(e) => setAgentId(e.target.value)}
        />
        {/* What a change of agent does, said before saving: shown, and
            announced through a region that's always there. */}
        {warnings.length > 0 && (
          <Alert tone="warn" live={false}>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </Alert>
        )}
        <p className="sr-only" role="status">
          {warnings.join(' ')}
        </p>
        <TextField label="Hours the agent answers" hint="In words, e.g. “8 AM to 8 PM, Monday to Saturday”." value={hours} maxLength={80} error={errors.hours} onChange={(e) => setHours(e.target.value)} />
        <SelectField
          label="Out of hours"
          value={afterHours}
          options={(Object.keys(AFTER_LABEL) as PhoneNumber['afterHours'][]).map((v) => ({ value: v, label: AFTER_LABEL[v] }))}
          onChange={(e) => setAfterHours(e.target.value as PhoneNumber['afterHours'])}
        />
        <TextField
          label="Handovers go to"
          hint="The desk or extension that answers when the agent hands over."
          value={transferTo}
          maxLength={80}
          error={errors.transferTo}
          onChange={(e) => setTransferTo(e.target.value)}
        />
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…">
            Save
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function RequestDialog({ orgSlug, open, onClose, onSent }: { orgSlug: string; open: boolean; onClose(): void; onSent(): void }) {
  const client = useConsole()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setText('')
      setError(null)
    }
  }, [open])

  async function send(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await client.requestNumber(orgSlug, text.trim())
      onSent()
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Ask for another number" onClose={() => !busy && onClose()}>
      <form className="lib-form" onSubmit={send} noValidate>
        <p>bitNtech sets up new numbers and connects them to AICA. It usually takes a working day.</p>
        <TextAreaField label="What it’s for" hint="Optional, e.g. “A line for the lab, ideally ending 1250”." rows={3} maxLength={500} value={text} error={error} onChange={(e) => setText(e.target.value)} />
        <div className="dialog__actions">
          <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Sending…">
            Send request
          </Button>
          <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
