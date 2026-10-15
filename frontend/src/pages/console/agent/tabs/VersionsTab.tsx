import { useId, useRef, useState } from 'react'
import { asAuthError } from '../../../../auth/types'
import type { AgentSpec } from '../../../../console/types'
import { ConfirmDialog } from '../../../../components/ui/Dialog'
import { SelectField } from '../../../../components/ui/Field'
import { shortDate, timeAgo } from '../../../../lib/time'
import { ChangeList } from '../ChangeList'
import { diffSpecs, type NameLookup } from '../diff'
import type { TabProps } from '../shared'

const WORKING = 'working'

interface Props extends TabProps {
  hasChanges: boolean
  names: NameLookup
  canRollback: boolean
  onRollback(version: number): Promise<void>
}

/** Published versions, what changed between any two, and going back. */
export function VersionsTab({ detail, spec, hasChanges, names, canRollback, onRollback }: Props) {
  const id = useId()
  const versions = detail.versions
  const live = versions[0]
  const [from, setFrom] = useState(String(versions[1]?.version ?? live.version))
  const [to, setTo] = useState(hasChanges ? WORKING : String(live.version))
  const [back, setBack] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Said when the person changes what's compared, not when versions change under it. */
  const [said, setSaid] = useState('')
  const compareHeading = useRef<HTMLHeadingElement>(null)

  const specOf = (v: string): AgentSpec | undefined => (v === WORKING ? spec : versions.find((x) => String(x.version) === v)?.spec)
  const label = (v: string) => (v === WORKING ? 'your draft changes' : `version ${v}`)
  // A choice that's gone (after a rollback, say) falls back to the live version.
  const valid = (v: string) => (v === WORKING ? hasChanges : !!specOf(v))
  const fromV = valid(from) ? from : String(live.version)
  const toV = valid(to) ? to : String(live.version)
  const changes = diffSpecs(specOf(fromV)!, specOf(toV)!, names)
  const announce = (f: string, t: string) => {
    if (f === t) return setSaid('')
    const n = diffSpecs(specOf(f)!, specOf(t)!, names).length
    setSaid(n ? `${n} ${n === 1 ? 'area' : 'areas'} changed.` : 'No differences.')
  }
  const options = versions.map((v) => ({ value: String(v.version), label: `Version ${v.version}${v === live ? ' (live)' : ''}` }))

  async function confirmBack() {
    if (back === null) return
    setBusy(true)
    setError(null)
    try {
      await onRollback(back)
      setBack(null)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ws__sections">
      <section className="step__section" aria-labelledby={`${id}-hist`}>
        <h2 id={`${id}-hist`} className="step__heading">
          Published versions
        </h2>
        <ol className="versions" aria-labelledby={`${id}-hist`}>
          {versions.map((v) => (
            <li key={v.version} className="versions__item">
              <div className="versions__main">
                <p className="versions__title">
                  <strong>Version {v.version}</strong>
                  {v === live && <span className="status-chip status-chip--live">Live</span>}
                </p>
                <p className="row__meta">
                  Published <time dateTime={v.publishedAt}>{timeAgo(v.publishedAt)}</time>
                  {/* The date itself, in the text: a tooltip isn't there for touch or keyboard. */}
                  {Date.now() - Date.parse(v.publishedAt) > 864e5 && !timeAgo(v.publishedAt).startsWith('on ') && ` (${shortDate(v.publishedAt)})`} by {v.publishedBy}
                </p>
                {v.note && <p className="versions__note">{v.note}</p>}
              </div>
              {v !== live && (
                <div className="versions__actions">
                  <button
                    type="button"
                    className="btn-text"
                    aria-label={`Compare version ${v.version} with the live version`}
                    onClick={() => {
                      setFrom(String(v.version))
                      setTo(String(live.version))
                      announce(String(v.version), String(live.version))
                      compareHeading.current?.focus()
                    }}
                  >
                    Compare with live
                  </button>
                  {canRollback && (
                    <button type="button" className="btn-text" aria-label={`Make version ${v.version} live again`} onClick={() => setBack(v.version)}>
                      Make live again
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="step__section" aria-labelledby={`${id}-cmp`}>
        <h2 id={`${id}-cmp`} ref={compareHeading} tabIndex={-1} className="step__heading">
          Compare
        </h2>
        <div className="step__grid">
          <SelectField
            label="From"
            value={fromV}
            options={options}
            onChange={(e) => {
              setFrom(e.target.value)
              announce(e.target.value, toV)
            }}
          />
          <SelectField
            label="To"
            value={toV}
            options={[...(hasChanges ? [{ value: WORKING, label: 'Draft changes (not live)' }] : []), ...options]}
            onChange={(e) => {
              setTo(e.target.value)
              announce(fromV, e.target.value)
            }}
          />
        </div>
        {/* Only the count is announced; the list is there to read. */}
        <p className="sr-only" role="status">
          {said}
        </p>
        <h3 className="ws__subhead">
          From {label(fromV)} to {label(toV)}
        </h3>
        <ChangeList changes={changes} empty={fromV === toV ? 'Choose two different versions to compare.' : 'No differences.'} />
      </section>

      <ConfirmDialog
        open={back !== null}
        title={`Make version ${back} live again?`}
        confirmLabel="Make it live"
        busyLabel="Publishing…"
        busy={busy}
        danger={hasChanges}
        error={error}
        onConfirm={() => void confirmBack()}
        onCancel={() => {
          setBack(null)
          setError(null)
        }}
      >
        <p>
          Version {back}’s setup is published again as version {(detail.agent.version ?? 0) + 1}, and callers get it straight away.
          {hasChanges && ' Your draft changes will be deleted.'}
        </p>
      </ConfirmDialog>
    </div>
  )
}
