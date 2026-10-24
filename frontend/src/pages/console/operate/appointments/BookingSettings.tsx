import { useEffect, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../../auth/types'
import { Button } from '../../../../components/ui/Button'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { Modal } from '../../../../components/ui/Dialog'
import { Checkbox, TextField } from '../../../../components/ui/Field'
import type { BookingSettings as Settings } from '../../../../console/types'
import { timeAgo } from '../../../../lib/time'
import { time12 } from './model'

interface Props {
  open: boolean
  /** null while loading or when it can't be read; `error` says which. */
  settings: Settings | null
  error: string | null
  /** Owners and admins (Organisation settings) change them; others look. */
  canChange: boolean
  orgName: string
  onClose(): void
  onSave(next: Settings): Promise<void>
}

/**
 * How the agent's requests are confirmed (by staff, or automatically each
 * evening, the top-ranked request for each time) and how the patient is
 * told afterwards (the agent's callback, a WhatsApp message).
 */
export function BookingSettingsDialog({ open, settings, error, canChange, orgName, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Settings | null>(settings)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setDraft(settings)
      setSaveError(null)
    }
  }, [open, settings])

  const set = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    if (draft.confirm === 'auto' && !/^\d{2}:\d{2}$/.test(draft.autoAt)) return setSaveError('Choose a time for the automatic confirmation.')
    setBusy(true)
    setSaveError(null)
    try {
      await onSave(draft)
    } catch (err) {
      setSaveError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} wide title="Booking settings" onClose={() => !busy && onClose()}>
      {!draft ? (
        <p className={error ? 'field__error' : 'ap-muted'} role={error ? 'alert' : 'status'}>
          {error ?? 'Loading…'}
        </p>
      ) : (
        <form className="op-form ap-change" onSubmit={save} noValidate>
          {!canChange && <p className="ap-hint">Owners and admins change these. You can look.</p>}
          <fieldset className="ap-settings" disabled={!canChange || busy}>
            <ChoiceGroup<Settings['confirm']>
              legend="How the agent’s requests are confirmed"
              type="radio"
              value={[draft.confirm]}
              onChange={([v]) => set({ confirm: v })}
              options={[
                { value: 'staff', label: 'By staff', hint: 'Each request waits for someone to confirm or decline it.' },
                { value: 'auto', label: 'Automatically, at the end of the day', hint: 'The top-ranked request for each time is confirmed. Staff can still decide before then.' },
              ]}
            />
            {draft.confirm === 'auto' && (
              <div className="ap-settings__auto">
                <TextField label="Run at" type="time" value={draft.autoAt} onChange={(e) => set({ autoAt: e.target.value })} hint={`Every day at ${/^\d{2}:\d{2}$/.test(draft.autoAt) ? time12(draft.autoAt) : '…'}, for requests still to come.`} />
                <Checkbox label="Leave urgent requests for a person" hint="A time whose top request is urgent isn’t confirmed automatically." checked={draft.autoSkipUrgent} onChange={(e) => set({ autoSkipUrgent: e.target.checked })} />
                <Checkbox label="Leave requests the agent flagged for a check" checked={draft.autoSkipFlagged} onChange={(e) => set({ autoSkipFlagged: e.target.checked })} />
              </div>
            )}
            <ChoiceGroup<Settings['others']>
              legend="The other requests for a time that went to someone else"
              type="radio"
              value={[draft.others]}
              onChange={([v]) => set({ others: v })}
              options={[
                { value: 'offer', label: 'Offer the next free time', hint: 'The patient is asked to agree to it.' },
                { value: 'decline', label: 'Decline them', hint: 'The patient is told the time was taken.' },
              ]}
            />
            <div className="ap-settings__group" role="group" aria-labelledby="ap-told">
              <p className="field__label" id="ap-told">
                Telling the patient, after a request is confirmed, declined or moved
              </p>
              <Checkbox label="The agent calls the patient back" checked={draft.callback} onChange={(e) => set({ callback: e.target.checked })} />
              {draft.callback && <Checkbox label="If nobody answers, call once more 30 minutes later" checked={draft.retryCallback} onChange={(e) => set({ retryCallback: e.target.checked })} />}
              <Checkbox label="Send a WhatsApp message" checked={draft.whatsapp} onChange={(e) => set({ whatsapp: e.target.checked })} />
              {draft.whatsapp && (
                <figure className="ap-wa">
                  <figcaption className="ap-muted">The confirmation message, for example</figcaption>
                  <p className="ap-wa__bubble">
                    Hello Lakshmi, your appointment with Dr. R. Ramachandran at {orgName} is confirmed for Tue 28 Oct at 10:45 am. Please come 15 minutes early. To change it, call us on our usual number.
                  </p>
                </figure>
              )}
              {!draft.callback && !draft.whatsapp && <p className="ap-hint">With both off, staff tell patients themselves.</p>}
            </div>
          </fieldset>
          {settings?.updatedAt && (
            <p className="ap-muted">
              Last changed {timeAgo(settings.updatedAt)}
              {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}.
            </p>
          )}
          {saveError && (
            <p className="field__error" role="alert">
              {saveError}
            </p>
          )}
          <div className="dialog__actions">
            {canChange && (
              <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…">
                Save settings
              </Button>
            )}
            <Button variant="line" size="sm" disabled={busy} onClick={onClose}>
              {canChange ? 'Cancel' : 'Close'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
