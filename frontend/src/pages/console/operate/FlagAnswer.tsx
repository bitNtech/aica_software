import { useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AnswerFlag } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Dialog'
import { TextAreaField, TextField } from '../../../components/ui/Field'
import { useAnnouncer } from './LiveBits'

/**
 * "Flag a wrong answer": anyone who handles calls tells whoever looks after
 * the agent what it got wrong, and what it should have said. The flag shows
 * on the Bot desk until someone fixes the knowledge or dismisses it.
 */
export function FlagAnswerButton({ callId, agentName, onFlagged }: { callId: string | null; agentName: string | null; onFlagged?(f: AnswerFlag): void }) {
  const { org } = useOrg()
  const client = useConsole()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [correction, setCorrection] = useState('')
  const [agent, setAgent] = useState(agentName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [said, say] = useAnnouncer()
  const field = useRef<HTMLTextAreaElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (text.trim().length < 5) {
      setError('Say what the agent got wrong.')
      field.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const f = await client.flagAnswer(org.orgSlug, { callId, agentName: agent.trim() || null, text, correction })
      onFlagged?.(f)
      setOpen(false)
      setText('')
      setCorrection('')
      say('Flagged. It’s on the Bot desk for whoever looks after the agent.')
    } catch (err) {
      setError(asAuthError(err).message)
      field.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="sr-only" role="status">
        {said}
      </p>
      <Button variant="line" size="sm" onClick={() => setOpen(true)}>
        Flag a wrong answer
      </Button>
      <Modal open={open} title="Flag a wrong answer" onClose={() => !busy && setOpen(false)}>
        <form className="op-form" onSubmit={submit} noValidate>
          {agentName === null && <TextField label="Which agent" hint="Optional, e.g. Main reception." maxLength={60} value={agent} onChange={(e) => setAgent(e.target.value)} />}
          <TextAreaField ref={field} label="What it got wrong" rows={3} maxLength={300} value={text} error={error} onChange={(e) => setText(e.target.value)} />
          <TextAreaField label="What it should have said" hint="Optional, but it helps whoever fixes it." rows={2} maxLength={300} value={correction} onChange={(e) => setCorrection(e.target.value)} />
          <div className="dialog__actions">
            <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Flagging…">
              Flag it
            </Button>
            <Button variant="line" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
