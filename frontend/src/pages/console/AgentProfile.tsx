import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { LANGUAGE_LABEL } from '../../auth/roles'
import { asAuthError } from '../../auth/types'
import { useConsole } from '../../console/ConsoleProvider'
import { BUILDER_STEPS, type AgentSummary } from '../../console/types'
import { useOrg } from '../../console/useOrg'
import { FlowCanvas } from '../../components/console/flow/FlowCanvas'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { shortDate, timeAgo } from '../../lib/time'
import { STEP_META, stepIndex } from './builder/steps'
import { useDesignedFlow } from './operate/calls/useDesignedFlow'

export const AGENT_STATUS_WORD = { live: 'Live', draft: 'Draft', paused: 'Paused' } as const

/** The agent's face: the first letter of the name it speaks as, with its
 * status as a ring (the status is always in words beside it too). */
export function AgentAvatar({ agent: a, size = 'md' }: { agent: AgentSummary; size?: 'md' | 'lg' }) {
  const who = (a.persona || a.name).trim()
  return (
    <span className={`agent-avatar agent-avatar--${size} agent-avatar--${a.status}`} aria-hidden="true">
      <span className="agent-avatar__letter">{who.charAt(0).toUpperCase() || '?'}</span>
      <svg className="agent-avatar__wave" viewBox="0 0 16 10" width="16" height="10">
        <path d="M1 5h2M5 2v6M8 0v10M11 3v4M14 5h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  )
}

interface Props {
  agent: AgentSummary
  /** `/o/:slug` or `/ops/orgs/:slug`. */
  base: string
  /** May open the agent builder: bitNtech's master admin, or someone who sends requests. */
  canBuild: boolean
  /** bitNtech's master admin, who builds and publishes. */
  master: boolean
  newPattern: boolean
  /** Moves focus here when it's chosen from the list. */
  focusOnShow: boolean
}

/**
 * One agent, as callers meet it: who it speaks as and in what voice, how
 * it greets them, what it handles (its conversation tree), and how it's
 * doing. From here it opens in its workspace, or in the agent builder,
 * where calls can be uploaded and its flow changed. The organisation
 * sends those changes to bitNtech as a request; the master admin publishes
 * them.
 */
export function AgentProfile({ agent: a, base, canBuild, master, newPattern, focusOnShow }: Props) {
  const id = useId()
  const { org } = useOrg()
  const client = useConsole()
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [treeOpen, setTreeOpen] = useState(false)
  const published = !a.setupStep
  const designed = useDesignedFlow(published ? a.id : null)

  useEffect(() => {
    if (focusOnShow) heading.current?.focus()
  }, [a.id, focusOnShow])

  const c = a.change
  // Someone else's changes: the organisation's, for bitNtech to build; or bitNtech's own.
  const theirs = c && !master && c.by === 'bitNtech'

  async function openBuilder() {
    setError(null)
    if (c) return navigate(`${base}/agents/drafts/${c.draftId}/${c.state === 'sent' && !master ? 'review' : 'calls'}`)
    if (!client.startAgentChange) return setError('Changing an agent in the builder needs the AICA server to be updated first. Ask for the change in Requests instead.')
    setBusy(true)
    try {
      const d = await client.startAgentChange(org.orgSlug, a.id)
      navigate(`${base}/agents/drafts/${d.id}/calls`)
    } catch (err) {
      setError(asAuthError(err).message)
      setBusy(false)
    }
  }

  const facts: [string, string][] = published
    ? [
        ['Answers', a.phoneNumber ?? 'No number yet'],
        ['Version', a.version !== null && a.lastPublishedAt ? `v${a.version}, ${shortDate(a.lastPublishedAt)}` : 'Never published'],
        ['Calls this week', a.callsThisWeek.toLocaleString('en-IN')],
        ...(a.builtBy ? ([['Set up by', a.builtBy]] as [string, string][]) : []),
      ]
    : [
        ['Set up', `Step ${stepIndex(a.setupStep!) + 1} of ${BUILDER_STEPS.length}: ${STEP_META[a.setupStep!].label.toLowerCase()}`],
        ['Last saved', timeAgo(a.updatedAt)],
      ]

  // A draft: who may carry on with it, and where.
  const draftLink = !published && (master || (a.request && a.request.state === 'drafting')) ? `${base}/agents/drafts/${a.id}/${a.setupStep}` : null
  const sentLink = !published && !master && a.request?.state === 'sent' ? `${base}/agents/drafts/${a.id}/review` : null

  return (
    <section className="agent-profile" id="agent-profile" aria-labelledby={`${id}-h`}>
      <div className="agent-profile__top">
        <AgentAvatar agent={a} size="lg" />
        <div className="agent-profile__who">
          <h2 id={`${id}-h`} ref={heading} tabIndex={-1} className="agent-profile__name">
            {a.name}
          </h2>
          <p className="agent-profile__line">
            {a.persona ? (
              <>
                Speaks as <strong>{a.persona}</strong>
                {a.voiceName ? <>, in the {a.voiceName} voice</> : null}
              </>
            ) : (
              a.useCase
            )}
          </p>
          <p className="agent-profile__langs">
            {a.useCase && a.persona && <span className="lang-tag">{a.useCase}</span>}
            {a.languages.map((l) => (
              <span key={l} className="lang-tag">
                {LANGUAGE_LABEL[l]}
              </span>
            ))}
          </p>
        </div>
        <span className={`status-chip status-chip--${a.status}`}>{AGENT_STATUS_WORD[a.status]}</span>
      </div>

      {a.greeting && (
        <figure className="agent-profile__greeting">
          <figcaption>How it answers</figcaption>
          <blockquote>“{a.greeting}”</blockquote>
        </figure>
      )}

      <dl className="agent-profile__facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {(newPattern || a.hasChanges || c || a.request) && (
        <ul className="agent-profile__notes">
          {newPattern && (
            <li>
              <Link className="link" to={`${base}/calls?agent=${a.id}`}>
                Its calls took a new path: see it in Call history
              </Link>
            </li>
          )}
          {a.hasChanges && <li>Saved settings not published yet.</li>}
          {c && (
            <li>
              {c.state === 'sent'
                ? `Changes from the builder, sent to bitNtech by ${c.by}.`
                : c.by === 'bitNtech'
                  ? 'bitNtech is changing it in the agent builder.'
                  : `${c.by} is changing it in the agent builder (not sent yet).`}{' '}
              {c.requestId && !master && (
                <Link className="link" to={`${base}/requests#${c.requestId}`}>
                  Follow the request
                </Link>
              )}
            </li>
          )}
          {a.request && (
            <li>
              {a.request.state === 'sent' ? `Asked for by ${a.request.by}. bitNtech is building it.` : `${a.request.by} is writing this request in the agent builder; it isn’t sent yet.`}{' '}
              {a.request.requestId && (
                <Link className="link" to={`${base}/requests#${a.request.requestId}`}>
                  {master ? 'Open the request' : 'Follow the request'}
                </Link>
              )}
            </li>
          )}
        </ul>
      )}

      <div className="agent-profile__handles">
        <h3 className="agent-profile__sub">What it handles</h3>
        {a.intents && a.intents.length > 0 ? (
          <ul className="agent-profile__intents" aria-label={`What ${a.name} handles`}>
            {a.intents.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-note">{published ? 'Its conversations aren’t shown here.' : 'No conversations yet: they come from the calls it learns from.'}</p>
        )}
        {published && designed.state === 'ready' && (
          <details className="agent-profile__tree" onToggle={(e) => setTreeOpen(e.currentTarget.open)}>
            <summary>How its calls go, as a tree</summary>
            {/* Drawn only once opened: most visits only need the summary. */}
            {treeOpen && <FlowCanvas nodes={designed.flow} label={`${a.name}: conversation flow`} height="min(24rem, 60vh)" description="Open the agent’s Flow tab to see it as a list." />}
          </details>
        )}
      </div>

      {error && (
        <Alert tone="error" className="agent-profile__error">
          {error}
        </Alert>
      )}

      <div className="agent-profile__actions">
        {published && (
          <Link className="btn btn--line btn--sm" to={`${base}/agents/${a.id}`}>
            <span>Open workspace</span>
          </Link>
        )}
        {published && canBuild && !theirs && (
          <Button variant="orange" size="sm" busy={busy} busyLabel="Opening…" onClick={() => void openBuilder()} aria-describedby={`${id}-builder`}>
            {c ? (c.state === 'sent' && !master ? 'See the changes you sent' : 'Continue in the agent builder') : 'Agent builder'}
          </Button>
        )}
        {draftLink && (
          <Link className="btn btn--orange btn--sm" to={draftLink}>
            <span>Continue setup</span>
          </Link>
        )}
        {sentLink && (
          <Link className="btn btn--line btn--sm" to={sentLink}>
            <span>See what you sent</span>
          </Link>
        )}
        {published && (
          <Link className="btn btn--line btn--sm" to={`${base}/calls?agent=${a.id}`}>
            <span>Call history</span>
          </Link>
        )}
      </div>
      {published && canBuild && !theirs && (
        <p className="field__hint" id={`${id}-builder`}>
          {master
            ? 'Change any part of it, or upload calls for it to learn from, then publish the next version.'
            : 'Upload calls you want it to handle the same way, change its flow and settings, then send the changes to bitNtech.'}
        </p>
      )}
    </section>
  )
}
