import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { asAuthError } from '../../auth/types'
import { can, isMaster } from '../../console/access'
import { useConsole } from '../../console/ConsoleProvider'
import type { AgentSummary, ChangeKind, ChangeRequest, ChangeStatus, NewChangeRequest } from '../../console/types'
import { useOrg } from '../../console/useOrg'
import { ConsolePage } from '../../components/console/ConsolePage'
import { SegFilter } from '../../components/console/ListTools'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Spinner'
import { useAsync } from '../../lib/useAsync'
import { timeAgo } from '../../lib/time'
import { useAnnouncer } from './operate/LiveBits'
import './library/Library.css'
import './operate/Operate.css'
import './manage/Manage.css'
import './Requests.css'

export const KIND_LABEL: Record<ChangeKind, string> = {
  new_agent: 'New agent',
  flow_change: 'Change to a flow',
  integration: 'Integration or tool',
  number: 'Phone number',
  other: 'Something else',
}
export const STATUS_LABEL: Record<ChangeStatus, string> = {
  open: 'Waiting for bitNtech',
  in_progress: 'bitNtech is on it',
  done: 'Done',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
}
export const URGENCY_LABEL: Record<ChangeRequest['urgency'], string> = { normal: 'When you can', soon: 'This week', urgent: 'Urgent' }

const isOpen = (r: ChangeRequest) => r.status === 'open' || r.status === 'in_progress'
type Filter = 'open' | 'closed' | 'all'

/**
 * /o/:slug/requests: what the organisation has asked bitNtech for (a new
 * agent, a flow change, an integration), with the conversation about each.
 * The same page at /ops/orgs/:slug/requests is where bitNtech's master
 * admin replies and moves requests on.
 */
export default function RequestsPage() {
  const { org, access, user } = useOrg()
  const client = useConsole()
  const id = useId()
  const [params, setParams] = useSearchParams()
  const load = useCallback(async () => {
    const [requests, agents] = await Promise.all([client.listChangeRequests(org.orgSlug), client.listAgents(org.orgSlug)])
    return { requests, agents: agents.filter((a) => !a.setupStep) }
  }, [client, org.orgSlug])
  const [data, reload, setData] = useAsync(load)
  const [filter, setFilter] = useState<Filter>('open')
  const [said, say] = useAnnouncer()
  const canCreate = can(access, 'request.create')
  const master = isMaster(access)
  const platform = !!access.platform

  // "?new=flow_change&agent=agt_x" from an agent's Flow tab opens the form filled in.
  const newKind = params.get('new') as ChangeKind | null
  const [form, setForm] = useState<NewChangeRequest | null>(() =>
    canCreate && newKind && newKind in KIND_LABEL ? { kind: newKind, agentId: params.get('agent'), title: '', detail: '', urgency: 'normal' } : null,
  )
  useEffect(() => {
    if (newKind) setParams({}, { replace: true })
    // Once, on arrival.
  }, [])

  const put = (r: ChangeRequest) => setData((d) => (d.state === 'ready' ? { ...d, data: { ...d.data, requests: d.data.requests.some((x) => x.id === r.id) ? d.data.requests.map((x) => (x.id === r.id ? r : x)) : [r, ...d.data.requests] } } : d))

  const all = data.state === 'ready' ? data.data.requests : []
  const shown = all.filter((r) => filter === 'all' || (filter === 'open' ? isOpen(r) : !isOpen(r)))

  return (
    <ConsolePage
      section="requests"
      kicker="Agents"
      docTitle="Requests"
      title={platform ? `Requests from ${org.orgName}` : 'Requests to bitNtech'}
      lede={
        platform ? (
          <p>What {org.orgName} has asked for. Reply, build it, then mark it done: they see every reply.</p>
        ) : (
          <p>
            bitNtech builds new agents and changes their flows, tools and integrations, so every change is tested before callers hear it. Set up a new agent, or changes to one, in
            the agent builder and send it here; ask for anything else in words. Follow the conversation on each.
          </p>
        )
      }
      actions={
        canCreate &&
        !form && (
          <Button variant="orange" onClick={() => setForm({ kind: 'flow_change', agentId: null, title: '', detail: '', urgency: 'normal' })}>
            New request
          </Button>
        )
      }
    >
      <p className="sr-only" role="status">
        {said}
      </p>

      {form && data.state === 'ready' && (
        <NewRequestForm
          initial={form}
          agents={data.data.agents}
          onCancel={() => setForm(null)}
          onCreated={(r) => {
            put(r)
            setForm(null)
            setFilter('open')
            say(`Sent to bitNtech: “${r.title}”.`)
          }}
        />
      )}

      {data.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading requests…</span>
        </div>
      )}
      {data.state === 'error' && (
        <Alert tone="error" title="Couldn't load the requests">
          <p>{asAuthError(data.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}

      {data.state === 'ready' && (
        <section className="lib__section" aria-labelledby={`${id}-list`}>
          <h2 id={`${id}-list`} className="sr-only">
            Requests
          </h2>
          <div className="list-tools">
            <SegFilter<Filter>
              legend="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: 'Open', count: all.filter(isOpen).length },
                { value: 'closed', label: 'Finished', count: all.filter((r) => !isOpen(r)).length },
                { value: 'all', label: 'All', count: all.length },
              ]}
            />
          </div>
          {shown.length === 0 ? (
            <p className="empty-note">
              {all.length === 0
                ? platform
                  ? `${org.orgName} hasn’t asked for anything yet.`
                  : canCreate
                    ? 'Nothing asked for yet. Need a new agent, or a change to how one handles a call? Send a request.'
                    : 'Nothing asked for yet.'
                : filter === 'open'
                  ? 'Nothing open: bitNtech has dealt with every request.'
                  : 'Nothing finished yet.'}
            </p>
          ) : (
            <ul className="req__list" aria-label="Requests">
              {shown.map((r) => (
                <RequestCard key={r.id} request={r} master={master} canReply={master || (canCreate && !platform)} canWithdraw={!platform && (r.createdById === user.id || access.perms.has('team.manage'))} onChanged={put} say={say} />
              ))}
            </ul>
          )}
        </section>
      )}
    </ConsolePage>
  )
}

function NewRequestForm({ initial, agents, onCancel, onCreated }: { initial: NewChangeRequest; agents: AgentSummary[]; onCancel(): void; onCreated(r: ChangeRequest): void }) {
  const { org, base } = useOrg()
  const client = useConsole()
  const navigate = useNavigate()
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const id = useId()
  const [v, setV] = useState<NewChangeRequest>(() => ({ ...initial, agentId: initial.agentId && agents.some((a) => a.id === initial.agentId) ? initial.agentId : null }))
  const [errors, setErrors] = useState<{ title?: string; detail?: string; agent?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLTextAreaElement>(null)
  const agentRef = useRef<HTMLSelectElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  const needsAgent = v.kind === 'flow_change'
  const chosen = agents.find((a) => a.id === v.agentId)

  /** Changes to the chosen agent, in the agent builder. */
  async function openBuilder() {
    if (!chosen) return
    setOpenError(null)
    if (chosen.change) return navigate(`${base}/agents/drafts/${chosen.change.draftId}/${chosen.change.state === 'sent' ? 'review' : 'calls'}`)
    if (!client.startAgentChange) return setOpenError('Changing an agent in the builder needs the AICA server to be updated first. Describe the change below instead.')
    setOpening(true)
    try {
      const d = await client.startAgentChange(org.orgSlug, chosen.id)
      navigate(`${base}/agents/drafts/${d.id}/calls`)
    } catch (err) {
      setOpenError(asAuthError(err).message)
      setOpening(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    // New agents go through the builder, not a message.
    if (v.kind === 'new_agent') return
    const next: typeof errors = {}
    if (needsAgent && !v.agentId) next.agent = 'Choose the agent whose flow should change.'
    if (v.title.trim().length < 5) next.title = 'Give it a short title, at least 5 characters.'
    if (v.detail.trim().length < 10) next.detail = 'Describe what you need: what callers ask, and what the agent should do.'
    setErrors(next)
    if (next.agent) return agentRef.current?.focus()
    if (next.title) return titleRef.current?.focus()
    if (next.detail) return detailRef.current?.focus()
    setBusy(true)
    try {
      onCreated(await client.createChangeRequest(org.orgSlug, v))
    } catch (err) {
      setErrors({ form: asAuthError(err).message })
      setBusy(false)
    }
  }

  return (
    <section className="lib__section req__new" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} ref={heading} tabIndex={-1} className="lib__heading">
        New request to bitNtech
      </h2>
      <form className="op-form req__form" onSubmit={submit} noValidate>
        <SelectField
          label="What do you need?"
          value={v.kind}
          options={(Object.keys(KIND_LABEL) as ChangeKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          onChange={(e) => setV({ ...v, kind: e.target.value as ChangeKind })}
        />
        {v.kind === 'new_agent' && (
          <div className="req__builder">
            <p>
              New agents are set up step by step in the agent builder: upload calls or choose them from Call uploads, check the conversations AICA finds as a tree, set how it
              speaks, what it collects and what it can do, then send it here. bitNtech builds, tests and publishes it.
            </p>
            <div className="dialog__actions">
              <Link className="btn btn--orange btn--sm" to={`${base}/agents/new`}>
                <span>Start in the agent builder</span>
              </Link>
              <Button variant="line" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {v.kind !== 'new_agent' && (
          <SelectField
            ref={agentRef}
            label={needsAgent ? 'Which agent' : 'Which agent (optional)'}
            value={v.agentId ?? ''}
            error={errors.agent}
            options={[{ value: '', label: needsAgent ? 'Choose an agent' : 'Not about one agent' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
            onChange={(e) => setV({ ...v, agentId: e.target.value || null })}
          />
        )}
        {v.kind === 'flow_change' && chosen && (
          <div className="req__builder">
            <p>Change {chosen.name}’s flow yourself in the agent builder: upload calls it should handle the same way, add or change branches, then send it. Or describe it below.</p>
            <div>
              <Button variant="line" size="sm" busy={opening} busyLabel="Opening…" onClick={() => void openBuilder()}>
                {chosen.change ? `Continue changing ${chosen.name} in the builder` : `Change ${chosen.name} in the agent builder`}
              </Button>
            </div>
            {openError && <p className="field__error">{openError}</p>}
          </div>
        )}
        {v.kind !== 'new_agent' && (
          <>
            <TextField
              ref={titleRef}
              label="Title"
              placeholder="e.g. Let callers cancel an appointment"
              maxLength={120}
              value={v.title}
              error={errors.title}
              onChange={(e) => setV({ ...v, title: e.target.value })}
            />
            <TextAreaField
              ref={detailRef}
              label="Details"
              hint="What callers say, what the agent does now, and what it should do instead."
              rows={5}
              maxLength={2000}
              value={v.detail}
              error={errors.detail}
              onChange={(e) => setV({ ...v, detail: e.target.value })}
            />
            <SelectField
              label="How soon"
              value={v.urgency}
              options={(Object.keys(URGENCY_LABEL) as ChangeRequest['urgency'][]).map((u) => ({ value: u, label: URGENCY_LABEL[u] }))}
              onChange={(e) => setV({ ...v, urgency: e.target.value as ChangeRequest['urgency'] })}
            />
            {errors.form && (
              <p className="field__error" role="alert">
                {errors.form}
              </p>
            )}
            <div className="dialog__actions">
              <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Sending…">
                Send to bitNtech
              </Button>
              <Button variant="line" size="sm" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </form>
    </section>
  )
}

function RequestCard({
  request: r,
  master,
  canReply,
  canWithdraw,
  onChanged,
  say,
}: {
  request: ChangeRequest
  master: boolean
  canReply: boolean
  canWithdraw: boolean
  onChanged(r: ChangeRequest): void
  say(t: string): void
}) {
  const { org, base } = useOrg()
  const client = useConsole()
  const id = useId()
  const [reply, setReply] = useState('')
  const [status, setStatus] = useState<Exclude<ChangeStatus, 'withdrawn'>>(r.status === 'withdrawn' ? 'open' : r.status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState<'closed' | 'open' | 'busy'>('closed')
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const open = isOpen(r)

  async function send(e: FormEvent) {
    e.preventDefault()
    const changed = master && status !== r.status
    if (!reply.trim() && !changed) {
      setError(master ? 'Write a reply, or choose a new status.' : 'Write the reply first.')
      field.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const out = master ? await client.updateChangeRequest(org.orgSlug, r.id, { status: changed ? status : undefined, reply: reply.trim() || undefined }) : await client.replyChangeRequest(org.orgSlug, r.id, reply)
      onChanged(out)
      setReply('')
      say(changed ? `Marked “${r.title}” ${STATUS_LABEL[out.status].toLowerCase()}.` : 'Reply sent.')
    } catch (err) {
      setError(asAuthError(err).message)
      field.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  async function withdraw() {
    setWithdrawing('busy')
    setWithdrawError(null)
    try {
      onChanged(await client.withdrawChangeRequest(org.orgSlug, r.id))
      setWithdrawing('closed')
      say(`Withdrew “${r.title}”.`)
    } catch (err) {
      setWithdrawError(asAuthError(err).message)
      setWithdrawing('open')
    }
  }

  return (
    <li className="req__card" id={r.id} aria-labelledby={`${id}-t`}>
      <div className="req__head">
        <h3 id={`${id}-t`} className="req__title">
          {r.title}
        </h3>
        <span className={`status-chip req__status req__status--${r.status}`}>{STATUS_LABEL[r.status]}</span>
      </div>
      <p className="row__meta">
        {KIND_LABEL[r.kind]}
        {r.agentName && <> · {r.agentName}</>} · {URGENCY_LABEL[r.urgency]} · asked by {r.createdBy}, {timeAgo(r.createdAt)}
      </p>
      {r.draftId ? (
        <>
          <p className="req__detail">{r.detail.split('\n\n')[0]}</p>
          <div className="req__draft">
            <span className="req__tag req__tag--builder">Made in the agent builder</span>
            {open || master ? (
              <Link className="link" to={`${base}/agents/drafts/${r.draftId}/review`}>
                {master ? (r.kind === 'new_agent' ? 'Build and publish it in the builder' : 'Build and publish the changes in the builder') : 'See what was sent'}
              </Link>
            ) : null}
          </div>
          {r.detail.includes('\n\n') && (
            <details className="req__more">
              <summary>Everything that was sent</summary>
              <p className="req__detail">{r.detail.split('\n\n').slice(1).join('\n\n')}</p>
            </details>
          )}
        </>
      ) : (
        <p className="req__detail">{r.detail}</p>
      )}
      {r.replies.length > 0 && (
        <ol className="req__thread" aria-label={`Replies about ${r.title}`}>
          {r.replies.map((x) => (
            <li key={x.id} className={`req__reply req__reply--${x.byKind}`}>
              <span className="req__by">
                {x.by}
                {x.byKind === 'bitntech' && <> <span className="req__tag">bitNtech</span></>}, {timeAgo(x.at)}
              </span>
              <p>{x.text}</p>
            </li>
          ))}
        </ol>
      )}
      {canReply && r.status !== 'withdrawn' && (
        <form className="op-form req__reply-form" onSubmit={send} noValidate>
          <TextAreaField ref={field} label={master ? 'Reply to the organisation' : 'Reply to bitNtech'} rows={2} maxLength={1000} value={reply} error={error} onChange={(e) => setReply(e.target.value)} />
          <div className="req__reply-actions">
            {master && (
              <SelectField
                label="Status"
                value={status}
                options={(['open', 'in_progress', 'done', 'declined'] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              />
            )}
            <Button type="submit" variant="line" size="sm" busy={busy} busyLabel="Sending…">
              {master ? 'Save' : 'Send reply'}
            </Button>
            {canWithdraw && open && (
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setWithdrawError(null)
                  setWithdrawing('open')
                }}
              >
                Withdraw request
              </button>
            )}
          </div>
        </form>
      )}
      <ConfirmDialog
        open={withdrawing !== 'closed'}
        title={`Withdraw “${r.title}”?`}
        confirmLabel="Withdraw"
        busyLabel="Withdrawing…"
        busy={withdrawing === 'busy'}
        error={withdrawError}
        onConfirm={() => void withdraw()}
        onCancel={() => setWithdrawing('closed')}
      >
        <p>bitNtech stops work on it. You can send a new request any time.</p>
      </ConfirmDialog>
    </li>
  )
}
