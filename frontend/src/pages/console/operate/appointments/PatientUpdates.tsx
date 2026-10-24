import { useState } from 'react'
import { asAuthError } from '../../../../auth/types'
import { StatusPill, type Tone } from '../../../../components/console/StatusPill'
import { Button } from '../../../../components/ui/Button'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Appointment, PatientUpdate } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { timeAgo } from '../../../../lib/time'
import { howTold, sourceOf, UPDATE_ABOUT_LABEL, UPDATE_CHANNEL_LABEL, UPDATE_STATE_LABEL } from './model'
import type { Shared } from './parts'

const STATE_TONE: Record<PatientUpdate['state'], Tone> = { queued: 'neutral', in_progress: 'info', done: 'ok', no_answer: 'warn', sent: 'info', delivered: 'ok', read: 'ok', failed: 'danger' }

/**
 * What the patient has been told about an agent's booking: the agent's
 * callback and the WhatsApp message, each with how far it got. A failed one
 * can be sent again by people who manage appointments.
 */
export function PatientUpdates({ appt: a, shared }: { appt: Appointment; shared: Shared }) {
  const client = useConsole()
  const { org } = useOrg()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = a.updates ?? []
  const told = howTold(shared.booking)

  if (sourceOf(a) !== 'ai_call') return <p className="ap-muted">Booked by the desk: AICA doesn’t contact the patient about it.</p>
  if (list.length === 0) {
    if (!shared.booking) return <p className="ap-muted">Nothing reported. Updates to patients need the AICA server to be updated first.</p>
    if (a.status === 'pending') return <p className="ap-muted">{told ? `Nothing sent yet. Once it’s confirmed or declined, ${told}.` : 'Patient updates are off in Booking settings: let the patient know yourself.'}</p>
    return <p className="ap-muted">Nothing was sent for this booking.</p>
  }

  async function retry(u: PatientUpdate) {
    if (!client.retryPatientUpdate) return
    setBusy(u.id)
    setError(null)
    try {
      shared.onReplace(await client.retryPatientUpdate(org.orgSlug, a.id, u.id))
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <ul className="ap-updates">
        {list.map((u) => {
          const retryLater = u.state === 'no_answer' && shared.booking?.retryCallback && u.attempts === 1
          return (
            <li key={u.id} className="ap-update">
              <div className="ap-update__head">
                <strong>{UPDATE_CHANNEL_LABEL[u.channel]}</strong>
                <span className="ap-muted">{UPDATE_ABOUT_LABEL[u.about]}</span>
                <StatusPill tone={STATE_TONE[u.state]}>{UPDATE_STATE_LABEL[u.state]}</StatusPill>
              </div>
              <p className="ap-update__sub">
                {timeAgo(u.updatedAt ?? u.at)}
                {u.attempts > 1 ? `, attempt ${u.attempts}` : ''}
                {u.detail ? `. ${u.detail}` : ''}
              </p>
              {shared.canEdit && (u.state === 'failed' || (u.state === 'no_answer' && !retryLater)) && (
                <Button variant="line" size="sm" busy={busy === u.id} busyLabel="Sending…" disabled={!!busy} onClick={() => void retry(u)}>
                  {u.channel === 'callback' ? 'Call again' : 'Send again'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
