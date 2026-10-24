import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../../auth/types'
import { canOpen } from '../../../../console/access'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Desk, Notice } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { StatusPill } from '../../../../components/console/StatusPill'
import { useToast } from '../../../../components/console/Toast'
import { Button } from '../../../../components/ui/Button'
import { Modal } from '../../../../components/ui/Dialog'
import type { Say } from './LineBoard'
import { endsSoon, groupNotices, remaining, until, when } from './logic'
import { NoticeForm, type Saved } from './NoticeForm'

/**
 * What the agents are telling callers: the notices showing now, and the ones
 * scheduled to start. Whoever may post notices makes one (from a ready-made
 * template or their own words, with a preview), changes one, or ends one
 * early; each of those can be undone from its toast. Notices that run out
 * while the page is open leave by themselves.
 */
export function Notices({
  desk,
  canEdit,
  now,
  creating,
  onCreating,
  onDesk,
  say,
}: {
  desk: Desk
  canEdit: boolean
  now: number
  creating: boolean
  onCreating(on: boolean): void
  onDesk(d: Desk): void
  say: Say
}) {
  const { org, access } = useOrg()
  const client = useConsole()
  const toast = useToast()
  const id = useId()
  const agents = desk.lines.filter((l) => l.agentId).map((l) => ({ id: l.agentId!, name: l.agentName! }))
  const { showing, scheduled, ended } = groupNotices(desk.notices, now)
  const [editing, setEditing] = useState<Notice | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const agentName = (aid: string | null) => (aid ? (agents.find((a) => a.id === aid)?.name ?? 'An agent') : 'Every agent')

  // A notice that has run out since the desk was last read: said once, and gone from the list.
  const announced = useRef(new Set<string>())
  useEffect(() => {
    for (const n of ended) {
      if (announced.current.has(n.id)) continue
      announced.current.add(n.id)
      say(`A notice has ended: ${n.text}`)
    }
  }, [ended, say])

  const saved = ({ desk: d, created, previous }: Saved) => {
    onDesk(d)
    setEditing(null)
    onCreating(false)
    const words = previous ? 'Notice changed.' : Date.parse(created?.from ?? '') > Date.now() ? 'Notice scheduled. The agents tell callers about it from then.' : 'Notice posted. The agents tell callers about it now.'
    say(words)
    toast.show({
      message: words,
      tone: 'ok',
      action: {
        label: 'Undo',
        onClick: () => {
          const undo = previous ? client.saveNotice(org.orgSlug, { id: previous.id, text: previous.text, agentId: previous.agentId, from: previous.from, until: previous.until }) : created ? client.removeNotice(org.orgSlug, created.id) : null
          void undo?.then(
            (back) => {
              onDesk(back)
              toast.show({ message: 'Undone.', tone: 'ok' })
            },
            (err) => toast.show({ message: asAuthError(err).message, tone: 'danger' }),
          )
        },
      },
    })
  }

  async function end(n: Notice) {
    setBusyId(n.id)
    setError(null)
    const wasScheduled = Date.parse(n.from) > Date.now()
    try {
      onDesk(await client.removeNotice(org.orgSlug, n.id))
      const words = wasScheduled ? 'Scheduled notice cancelled.' : 'Notice ended. The agents stop mentioning it.'
      say(words)
      toast.show({
        message: words,
        tone: 'ok',
        action: {
          label: 'Undo',
          onClick: () =>
            void client.saveNotice(org.orgSlug, { text: n.text, agentId: n.agentId, from: n.from, until: n.until }).then(
              (back) => {
                onDesk(back)
                toast.show({ message: 'Undone.', tone: 'ok' })
              },
              (err) => toast.show({ message: asAuthError(err).message, tone: 'danger' }),
            ),
        },
      })
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusyId(null)
    }
  }

  const item = (n: Notice, scheduledItem: boolean) => (
    <li key={n.id} className={`desk-notice${scheduledItem ? ' desk-notice--scheduled' : ''}`}>
      <p className="desk-notice__text">{n.text}</p>
      <p className="desk-notice__when">
        {scheduledItem ? (
          <>
            <StatusPill tone="info">Starts in {remaining(n.from, now)}</StatusPill> <span className="row__meta">from {when(n.from, now)}, {until(n.until, now)}</span>
          </>
        ) : endsSoon(n, now) ? (
          <>
            <StatusPill tone="warn">Ends in {remaining(n.until, now)}</StatusPill> <span className="row__meta">{until(n.until, now)}</span>
          </>
        ) : (
          <span className="row__meta">
            Ends in {remaining(n.until, now)} ({until(n.until, now)})
          </span>
        )}
      </p>
      <p className="row__meta">
        {agentName(n.agentId)} · posted by {n.createdBy}
      </p>
      {canEdit && (
        <div className="desk-notice__actions">
          <button type="button" className="btn-text" onClick={() => setEditing(n)} aria-label={`Change the notice: ${n.text}`}>
            Change
          </button>
          <button type="button" className="btn-text" disabled={busyId === n.id} onClick={() => void end(n)} aria-label={`${scheduledItem ? 'Cancel the scheduled notice' : 'End the notice early'}: ${n.text}`}>
            {scheduledItem ? 'Cancel it' : 'End early'}
          </button>
        </div>
      )}
    </li>
  )

  return (
    <section className="desk-panel" aria-labelledby={`${id}-n`}>
      <div className="op-section__head">
        <h2 id={`${id}-n`} className="op-section__title">
          Notices
        </h2>
        {canEdit && (
          <Button variant="line" size="sm" onClick={() => onCreating(true)}>
            Post a notice
          </Button>
        )}
      </div>
      <p className="row__meta">
        The agents tell callers about these when it’s relevant, until each one ends. For anything lasting, add it to{' '}
        {canOpen(access, 'knowledge') ? <Link to={`/o/${org.orgSlug}/knowledge`}>Knowledge</Link> : 'Knowledge'} instead.
      </p>
      {!canEdit && <p className="row__meta">Posting or ending a notice needs the “Post notices” permission, which you don’t have.</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {showing.length === 0 && scheduled.length === 0 ? (
        <p className="empty-note">No notices. Post one when something’s different today: a lift out of order, a camp, a closed counter.</p>
      ) : (
        <>
          <h3 className="desk-panel__group">
            Showing now <span className="num desk-panel__count">{showing.length}</span>
          </h3>
          {showing.length === 0 ? (
            <p className="row__meta">Nothing is being said right now.</p>
          ) : (
            <ul className="desk-notices" aria-label="Notices showing now">
              {showing.map((n) => item(n, false))}
            </ul>
          )}
          {scheduled.length > 0 && (
            <>
              <h3 className="desk-panel__group">
                Scheduled <span className="num desk-panel__count">{scheduled.length}</span>
              </h3>
              <ul className="desk-notices" aria-label="Scheduled notices">
                {scheduled.map((n) => item(n, true))}
              </ul>
            </>
          )}
        </>
      )}

      <Modal wide open={creating || editing !== null} title={editing ? 'Change the notice' : 'Post a notice'} onClose={() => (setEditing(null), onCreating(false))}>
        <NoticeForm
          // A fresh form for each notice opened.
          key={editing?.id ?? 'new'}
          notice={editing}
          agents={agents}
          notices={desk.notices}
          now={now}
          onCancel={() => (setEditing(null), onCreating(false))}
          onSaved={saved}
          onOpenOther={(n) => {
            onCreating(false)
            setEditing(n)
          }}
        />
      </Modal>
    </section>
  )
}
