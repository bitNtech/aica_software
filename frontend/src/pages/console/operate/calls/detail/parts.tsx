import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { asAuthError } from '../../../../../auth/types'
import { can } from '../../../../../console/access'
import { useConsole } from '../../../../../console/ConsoleProvider'
import type { CallNote, CallRecord } from '../../../../../console/types'
import { useOrg } from '../../../../../console/useOrg'
import { Button } from '../../../../../components/ui/Button'
import { TextAreaField } from '../../../../../components/ui/Field'
import { useAnnouncer } from '../../LiveBits'

/** A titled block of the call. */
export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId()
  return (
    <section className={`op-detail__section${className ? ` ${className}` : ''}`} aria-labelledby={id}>
      <h2 id={id} className="op-detail__title">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Playing the recording: who may, and why it isn't there when it isn't. */
export function Recording({ call, className }: { call: CallRecord; className?: string }) {
  const { access, user } = useOrg()
  const client = useConsole()
  // Front desk only for calls they handled: the server checks that; here
  // they can only open those anyway.
  const allowed = can(access, 'call.playRecording') && (access.perms.has('calls.recordings') || call.handledById === user.id)
  return (
    <Section title="Recording" className={className}>
      {!allowed ? (
        <p className="row__meta">You can play recordings of the calls you handled. Ask an owner or admin for more.</p>
      ) : (client.isDemo && !client.isLive?.('calls')) || !call.hasRecording ? (
        <div className="op-unavailable">
          <p>{client.isDemo && !client.isLive?.('calls') ? 'The demo has no recordings: real calls play here.' : call.hasRecording ? 'Playing recordings isn’t available yet.' : 'There’s no recording of this call.'}</p>
        </div>
      ) : null}
    </Section>
  )
}

/** The team's notes on the call, and a form to add one. */
export function Notes({ call, canAdd, onAdded, className }: { call: CallRecord; canAdd: boolean; onAdded(n: CallNote): void; className?: string }) {
  const { org } = useOrg()
  const client = useConsole()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [said, say] = useAnnouncer()
  const field = useRef<HTMLTextAreaElement>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) {
      setError('Write the note first.')
      field.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      onAdded(await client.addCallNote(org.orgSlug, call.id, text))
      setText('')
      say('Note added.')
    } catch (err) {
      setError(asAuthError(err).message)
      field.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Notes" className={className}>
      <p className="sr-only" role="status">
        {said}
      </p>
      {call.notes.length === 0 ? (
        <p className="row__meta">No notes yet.</p>
      ) : (
        <ul className="op-notes">
          {call.notes.map((n) => (
            <li key={n.id}>
              <span className="op-notes__by">
                {n.by}, {new Date(n.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}:
              </span>{' '}
              {n.text}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form className="op-form" onSubmit={add} noValidate>
          <TextAreaField ref={field} label="Add a note" hint="For your team, e.g. what you told the caller." rows={3} maxLength={1000} value={text} error={error} onChange={(e) => setText(e.target.value)} />
          <div>
            <Button type="submit" variant="line" size="sm" busy={busy} busyLabel="Adding…">
              Add note
            </Button>
          </div>
        </form>
      )}
    </Section>
  )
}
