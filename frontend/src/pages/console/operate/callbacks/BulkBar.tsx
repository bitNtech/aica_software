import { useState } from 'react'
import { ToneIcon } from '../../../../components/console/StatusPill'
import { Button } from '../../../../components/ui/Button'
import { SelectField } from '../../../../components/ui/Field'
import type { Member } from '../../../../console/types'

/** What the last bulk "Give to" did, kept on screen until it is dismissed. */
export interface BulkReport {
  to: string
  total: number
  gave: number
  /** Callbacks that couldn't be given, by caller, with why. */
  failed: { name: string; message: string }[]
}

/**
 * Above the queue for people who may give callbacks to others: tick some
 * rows (or all that are shown), choose who, and give them in one go. The
 * changes are made one by one; those that fail are named in a summary that
 * stays until dismissed, and the successes are kept.
 */
export function BulkBar({
  shown,
  ticked,
  team,
  busy,
  report,
  onTickAll,
  onClear,
  onGive,
  onDismissReport,
}: {
  /** How many rows are shown. */
  shown: number
  ticked: number
  team: Member[]
  busy: boolean
  report: BulkReport | null
  onTickAll(): void
  onClear(): void
  onGive(memberId: string): void
  onDismissReport(): void
}) {
  const [who, setWho] = useState('')
  return (
    <div className="cb-bulk">
      <div className="cb-bulk__row">
        {ticked === 0 ? (
          <button type="button" className="btn-text" onClick={onTickAll} disabled={shown === 0}>
            Tick all {shown} shown
          </button>
        ) : (
          <form
            className="cb-bulk__form"
            aria-label="Give the ticked callbacks to someone"
            onSubmit={(e) => {
              e.preventDefault()
              if (who && !busy) onGive(who)
            }}
          >
            <p className="cb-bulk__count" role="status">
              {ticked} ticked
            </p>
            <SelectField label="Give to…" value={who} options={[{ value: '', label: 'Choose someone' }, ...team.map((m) => ({ value: m.id, label: m.name }))]} onChange={(e) => setWho(e.target.value)} />
            <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Giving…" aria-disabled={!who || undefined}>
              Give {ticked === 1 ? 'it' : 'them'}
            </Button>
            <button type="button" className="btn-text" onClick={onClear} disabled={busy}>
              Clear ticks
            </button>
          </form>
        )}
      </div>
      {report && (
        <div className="cb-bulk__report" role={report.failed.length > 0 ? 'alert' : 'status'}>
          <ToneIcon tone={report.failed.length > 0 ? 'warn' : 'ok'} size={18} />
          <div>
            <p>
              <strong>
                {report.failed.length === 0
                  ? `Gave ${report.gave === 1 ? 'the callback' : `all ${report.gave} callbacks`} to ${report.to}.`
                  : `Gave ${report.gave} of ${report.total} to ${report.to}. ${report.failed.length} couldn’t be given.`}
              </strong>
            </p>
            {report.failed.length > 0 && (
              <ul className="cb-plain">
                {report.failed.map((f, i) => (
                  <li key={i}>
                    {f.name}: {f.message}
                  </li>
                ))}
              </ul>
            )}
            {report.failed.length > 0 && <p className="cb-quiet cb-quiet--tight">The ones that failed are still ticked, so you can try them again.</p>}
          </div>
          <button type="button" className="btn-text" onClick={onDismissReport}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
