import { useState } from 'react'
import { asAuthError } from '../../../../auth/types'
import type { Appointment } from '../../../../console/types'
import { ConfirmRequestDialog } from './ConfirmRequestDialog'
import { DeclineDialog } from './DeclineDialog'
import { patientLabel, rivalsOf } from './model'
import type { Shared } from './parts'

/**
 * Confirm and Decline for a request, wherever it is shown. A request with
 * others for the same time opens the dialog that settles them; a lone one
 * is confirmed at once. The dialogs are rendered by whoever uses this, so
 * they sit inside the drawer when used there.
 */
export function useRequestActions(shared: Shared) {
  const [winner, setWinner] = useState<Appointment | null>(null)
  const [declining, setDeclining] = useState<Appointment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Throws with the API's words when a lone request is refused. */
  async function confirm(a: Appointment): Promise<void> {
    if (rivalsOf(a, shared.rows).length > 0) return setWinner(a)
    await shared.onAct(a, 'confirm', { status: 'confirmed' })
  }

  function decline(a: Appointment) {
    setError(null)
    setDeclining(a)
  }

  const dialogs = (
    <>
      <ConfirmRequestDialog
        winner={winner}
        rows={shared.rows}
        ctx={shared.ctx}
        sees={shared.sees}
        today={shared.today}
        booking={shared.booking}
        onClose={() => setWinner(null)}
        onConfirm={async (w, others) => {
          await shared.onResolve(w, others)
          setWinner(null)
        }}
      />
      <DeclineDialog
        appt={declining}
        who={declining ? patientLabel(declining, shared.sees) : ''}
        today={shared.today}
        booking={shared.booking}
        busy={busy}
        error={error}
        onCancel={() => setDeclining(null)}
        onConfirm={(reason) => {
          if (!declining) return
          setBusy(true)
          setError(null)
          shared.onAct(declining, 'decline', { status: 'declined', changeReason: reason }).then(
            () => {
              setBusy(false)
              setDeclining(null)
            },
            (err) => {
              setBusy(false)
              setError(asAuthError(err).message)
            },
          )
        }}
      />
    </>
  )

  return { confirm, decline, dialogs, open: !!winner || !!declining }
}
