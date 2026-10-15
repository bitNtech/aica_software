import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { asAuthError } from '../../../auth/types'
import { can, tabAccess, type AgentTab } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AgentDetail, AgentPatch, AgentSpec } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog, Modal } from '../../../components/ui/Dialog'
import { TextAreaField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { timeAgo } from '../../../lib/time'
import { SaveStatus } from '../builder/SaveStatus'
import { useAutosave } from '../builder/useAutosave'
import { AGENT_STATUS_LABEL } from '../AgentsPage'
import { specProblems } from './checks'
import { diffSpecs, type NameLookup } from './diff'
import { TAB_LABEL, TAB_ORDER, type Library, type TabProps } from './shared'
import { BehaviourTab } from './tabs/BehaviourTab'
import { ContextTab } from './tabs/ContextTab'
import { FlowTab } from './tabs/FlowTab'
import { RulesTab } from './tabs/RulesTab'
import { SettingsTab } from './tabs/SettingsTab'
import { TestTab } from './tabs/TestTab'
import { VersionsTab } from './tabs/VersionsTab'
import { ChangeList } from './ChangeList'
import '../builder/Builder.css'
import './Workspace.css'

/** /o/:slug/agents/:agentId/:tab — keyed by agent, so another agent starts fresh. */
export default function AgentWorkspaceRoute() {
  const { agentId = '' } = useParams()
  return <AgentWorkspace key={agentId} agentId={agentId} />
}

function AgentWorkspace({ agentId }: { agentId: string }) {
  const { org } = useOrg()
  const client = useConsole()
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const id = useId()
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [spec, setSpec] = useState<AgentSpec | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  /** Publishing was tried with problems: show them on every tab. */
  const [showErrors, setShowErrors] = useState(false)
  const [publish, setPublish] = useState<'closed' | 'open' | 'busy'>('closed')
  const [publishError, setPublishError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [discard, setDiscard] = useState<'closed' | 'open' | 'busy'>('closed')
  const [discardError, setDiscardError] = useState<string | null>(null)
  /** The outcome of the last action, shown and announced. */
  const [notice, setNotice] = useState<string | null>(null)
  const problemsRef = useRef<HTMLDivElement>(null)

  const loadLib = useCallback(async (): Promise<Library> => {
    const [voices, tools, knowledge, numbers] = await Promise.all([client.listVoices(), client.listTools(org.orgSlug), client.listKnowledge(org.orgSlug), client.listNumbers(org.orgSlug)])
    return { voices, tools, knowledge, numbers }
  }, [client, org.orgSlug])
  const [lib, reloadLib, setLib] = useAsync(loadLib)

  const save = useCallback(
    async (s: AgentSpec) => {
      const d = await client.saveAgent(org.orgSlug, agentId, s)
      // Only hasChanges comes from a save: a slow reply mustn't undo a
      // rename or pause that landed meanwhile. The edits stay local.
      setDetail((cur) => (cur ? { ...cur, agent: { ...cur.agent, hasChanges: d.agent.hasChanges } } : d))
    },
    [client, org.orgSlug, agentId],
  )
  const autosave = useAutosave(spec, save)

  const load = useCallback(() => {
    setLoadError(null)
    client.getAgent(org.orgSlug, agentId).then((d) => {
      setDetail(d)
      setSpec(d.working)
    }, setLoadError)
  }, [client, org.orgSlug, agentId])
  useEffect(load, [load])

  const live = detail?.versions[0]
  const hasChanges = useMemo(() => !!spec && !!live && JSON.stringify(spec) !== JSON.stringify(live.spec), [spec, live])

  // On a phone the tabs scroll sideways: bring the current one into view,
  // sideways only, so the page itself doesn't jump.
  const tabsRef = useRef<HTMLElement>(null)
  const ready = !!detail && lib.state === 'ready'
  useEffect(() => {
    const nav = tabsRef.current
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !el) return
    const left = el.getBoundingClientRect().left - nav.getBoundingClientRect().left
    if (left < 0 || left + el.offsetWidth > nav.clientWidth) nav.scrollLeft += left - 16
  }, [tabParam, ready])

  // A message about one tab's action doesn't follow you to the next tab.
  useEffect(() => setNotice(null), [tabParam])

  /** After an action whose button has gone (publish, discard): focus the
   * current tab, a place that's always there, rather than losing it. */
  const focusTab = () => requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus())

  if (loadError) {
    return (
      <ConsolePage kicker="Agent" title="Agent" docTitle="Agent">
        <Alert tone="error" title="Couldn't open this agent">
          <p>{asAuthError(loadError).message}</p>
          <p className="builder__alert-actions">
            <button type="button" className="btn-text" onClick={load}>
              Try again
            </button>
            <Link className="link" to={`/o/${org.orgSlug}/agents`}>
              Back to agents
            </Link>
          </p>
        </Alert>
      </ConsolePage>
    )
  }
  if (!detail || !spec || !live || lib.state !== 'ready') {
    return (
      <ConsolePage kicker="Agent" title={detail?.agent.name ?? 'Agent'} docTitle={detail?.agent.name ?? 'Agent'}>
        {lib.state === 'error' ? (
          <Alert tone="error" title="Couldn't load your voices, knowledge and tools">
            <p>{asAuthError(lib.error).message}</p>
            <button type="button" className="btn-text" onClick={reloadLib}>
              Try again
            </button>
          </Alert>
        ) : (
          <div className="loading-row" role="status">
            <Spinner />
            <span>Opening the agent…</span>
          </div>
        )}
      </ConsolePage>
    )
  }

  const base = `/o/${org.orgSlug}/agents/${agentId}`
  const tabs = TAB_ORDER.filter((t) => tabAccess(org.role, t))
  const tab = tabs.find((t) => t === tabParam)
  // No tab, or one this role can't see: the first it can.
  if (!tab) return <Navigate to={`${base}/${tabs[0]}`} replace />

  const a = detail.agent
  const canEdit = tabAccess(org.role, 'flow') === 'edit'
  const canPublish = can(org.role, 'agent.publish')
  const problems = specProblems(spec, lib.data.voices, lib.data.tools)
  const problemTabs = (Object.keys(problems) as AgentTab[]).filter((t) => tabs.includes(t))
  const names: NameLookup = {
    knowledge: (k) => lib.data.knowledge.find((x) => x.id === k)?.name ?? 'a removed source',
    // Roles without the Tools tab don't learn the tools' names here either.
    tool: (t) => (tabAccess(org.role, 'tools') ? (lib.data.tools.find((x) => x.id === t)?.name ?? 'a removed tool') : 'a tool'),
    voice: (v) => lib.data.voices.find((x) => x.id === v)?.name ?? v,
  }

  const update = (change: (s: AgentSpec) => AgentSpec) => {
    setSpec((s) => (s ? change(s) : s))
    setNotice(null)
    autosave.changed()
  }

  /** After an action on the server: take its copy as the new starting point. */
  const adopt = (d: AgentDetail) => {
    setDetail(d)
    setSpec(d.working)
    autosave.reset()
  }

  function startPublish() {
    if (problemTabs.length) {
      setShowErrors(true)
      requestAnimationFrame(() => problemsRef.current?.focus())
      return
    }
    setPublishError(null)
    setPublish('open')
  }

  async function confirmPublish() {
    setPublish('busy')
    setPublishError(null)
    try {
      await autosave.flush()
    } catch {
      setPublishError('Couldn’t save your last edits, so nothing was published. Check your connection and try again.')
      setPublish('open')
      return
    }
    try {
      const d = await client.publishAgent(org.orgSlug, agentId, note)
      adopt(d)
      setNote('')
      setShowErrors(false)
      setPublish('closed')
      setNotice(d.agent.status === 'live' ? `Version ${d.agent.version} is live on ${d.agent.phoneNumber}.` : `Version ${d.agent.version} is published. The agent is paused, so it isn’t answering calls.`)
      focusTab()
    } catch (err) {
      setPublishError(asAuthError(err).message)
      setPublish('open')
    }
  }

  async function confirmDiscard() {
    setDiscard('busy')
    setDiscardError(null)
    try {
      // Let any save in flight land first, so it can't bring the changes back.
      await autosave.flush().catch(() => {})
      adopt(await client.discardAgentChanges(org.orgSlug, agentId))
      setDiscard('closed')
      setShowErrors(false)
      setNotice(`Draft changes deleted. You’re back to version ${a.version}.`)
      focusTab()
    } catch (err) {
      setDiscardError(asAuthError(err).message)
      setDiscard('open')
    }
  }

  async function rollback(version: number) {
    await autosave.flush().catch(() => {})
    const d = await client.rollbackAgent(org.orgSlug, agentId, version)
    adopt(d)
    setShowErrors(false)
    setNotice(`Version ${version}’s setup is live again, as version ${d.agent.version}.`)
  }

  async function updateAgent(patch: AgentPatch, done: string) {
    const d = await client.updateAgent(org.orgSlug, agentId, patch)
    setDetail((cur) => (cur ? { ...cur, agent: { ...d.agent, hasChanges: cur.agent.hasChanges } } : d))
    setNotice(done)
    // Numbers may have moved. Only they are re-read, and a failure leaves
    // the old list, rather than replacing the whole workspace with an error.
    if (patch.numberId !== undefined)
      client.listNumbers(org.orgSlug).then(
        (numbers) => setLib((r) => (r.state === 'ready' ? { ...r, data: { ...r.data, numbers } } : r)),
        () => {},
      )
  }

  async function deleteAgent() {
    // Saves stop only once it's gone: if the delete fails, editing carries on.
    await autosave.flush().catch(() => {})
    await client.deleteAgent(org.orgSlug, agentId)
    autosave.cancel()
    navigate(`/o/${org.orgSlug}/agents`, { replace: true, state: { notice: `${a.name} is deleted.` } })
  }

  const props: TabProps = {
    org,
    detail,
    spec,
    update,
    readOnly: tabAccess(org.role, tab) !== 'edit',
    errors: showErrors ? (problems[tab] ?? {}) : {},
    lib: lib.data,
  }
  const changes = publish !== 'closed' ? diffSpecs(live.spec, spec, names) : []

  return (
    <ConsolePage
      kicker={
        <>
          <Link className="ws__crumb" to={`/o/${org.orgSlug}/agents`}>
            Agents
          </Link>{' '}
          <i aria-hidden="true">/</i> {a.useCase}
        </>
      }
      title={a.name}
      docTitle={`${a.name}: ${TAB_LABEL[tab]}`}
      actions={
        <>
          {canEdit && <SaveStatus state={autosave.state} onRetry={() => void autosave.retry()} />}
          <span className={`status-chip status-chip--${a.status}`}>{AGENT_STATUS_LABEL[a.status]}</span>
        </>
      }
      lede={
        <p>
          {a.status === 'live' ? `Answering ${a.phoneNumber}` : a.phoneNumber ? `Paused: not answering ${a.phoneNumber}` : 'Paused, with no phone number'}
          <i aria-hidden="true"> · </i>
          Version {a.version}, published {live ? timeAgo(live.publishedAt) : ''} by {live.publishedBy}.
        </p>
      }
    >
      <p className="sr-only" role="status">
        {notice ?? ''}
      </p>

      {hasChanges && (
        <div className="ws__changes" role="region" aria-labelledby={`${id}-changes`}>
          <p id={`${id}-changes`}>
            <strong>Draft changes, not live yet.</strong> Callers still get version {a.version}
            {canPublish ? '. Publish to make them the next version.' : ' until an owner or admin publishes them.'}
          </p>
          {canPublish && (
            <div className="ws__changes-actions">
              <Button variant="orange" size="sm" onClick={startPublish}>
                Review and publish
              </Button>
              <Button variant="line" size="sm" onClick={() => setDiscard('open')}>
                Delete draft changes
              </Button>
            </div>
          )}
        </div>
      )}

      {showErrors && problemTabs.length > 0 && (
        <Alert ref={problemsRef} live={false} tone="error" title="Fix these before publishing">
          <ul className="review__fix">
            {problemTabs.map((t) => (
              <li key={t}>
                <Link className="link" to={`${base}/${t}`}>
                  {TAB_LABEL[t]}
                </Link>
                : {Object.values(problems[t]!).join(' ')}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <nav ref={tabsRef} className="route-tabs ws__tabs" aria-label="Agent sections">
        {tabs.map((t) => {
          const count = showErrors ? Object.keys(problems[t] ?? {}).length : 0
          return (
            <Link key={t} to={`${base}/${t}`} aria-current={t === tab ? 'page' : undefined} aria-label={count > 0 ? `${TAB_LABEL[t]}, ${count} to fix` : undefined}>
              {TAB_LABEL[t]}
              {count > 0 && (
                <span className="ws__tab-count" aria-hidden="true">
                  {count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {notice && (
        <Alert tone="ok" live={false} className="ws__notice">
          {notice}
        </Alert>
      )}
      {props.readOnly && (
        <>
          {/* The read-only views are lists without a heading of their own. */}
          {tab !== 'flow' && tab !== 'versions' && <h2 className="sr-only">{TAB_LABEL[tab]}</h2>}
          <p className="ws__ro-note">You can view this agent. Owners and admins can change it.</p>
        </>
      )}

      <div className="ws__panel">
        {tab === 'flow' && <FlowTab {...props} />}
        {tab === 'behaviour' && <BehaviourTab {...props} />}
        {tab === 'knowledge' && <ContextTab {...props} part="knowledge" />}
        {tab === 'tools' && <ContextTab {...props} part="tools" />}
        {tab === 'rules' && <RulesTab {...props} />}
        {tab === 'test' && <TestTab {...props} hasChanges={hasChanges} />}
        {tab === 'versions' && <VersionsTab {...props} hasChanges={hasChanges} names={names} canRollback={canPublish} onRollback={rollback} />}
        {tab === 'settings' && <SettingsTab {...props} canDelete={can(org.role, 'agent.delete')} onUpdate={updateAgent} onDelete={deleteAgent} />}
      </div>

      <Modal open={publish !== 'closed'} title={`Publish version ${(a.version ?? 0) + 1}?`} onClose={() => publish !== 'busy' && setPublish('closed')} wide>
        <form
          className="ws__publish"
          onSubmit={(e) => {
            e.preventDefault()
            void confirmPublish()
          }}
          noValidate
        >
          <p>
            {a.status === 'live'
              ? `Callers to ${a.phoneNumber} get it straight away. You can go back to version ${a.version} from Versions.`
              : 'The agent is paused, so nobody gets it until it’s turned on.'}
          </p>
          <h3 className="ws__subhead">What changed since version {a.version}</h3>
          <ChangeList changes={changes} empty="Nothing: this setup matches the live version." />
          <TextAreaField label="Note for your team" hint="Optional. Shown in Versions, e.g. “Added Sunday timings”." rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          {publishError && (
            <p className="field__error" role="alert">
              {publishError}
            </p>
          )}
          <div className="dialog__actions">
            <Button type="submit" variant="orange" size="sm" busy={publish === 'busy'} busyLabel="Publishing…">
              Publish
            </Button>
            <Button variant="line" size="sm" disabled={publish === 'busy'} onClick={() => setPublish('closed')}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={discard !== 'closed'}
        title="Delete the draft changes?"
        confirmLabel="Delete draft changes"
        busyLabel="Discarding…"
        busy={discard === 'busy'}
        danger
        error={discardError}
        onConfirm={() => void confirmDiscard()}
        onCancel={() => setDiscard('closed')}
      >
        <p>This deletes every edit made since version {a.version}, including other people’s. It can’t be undone.</p>
      </ConfirmDialog>
    </ConsolePage>
  )
}
