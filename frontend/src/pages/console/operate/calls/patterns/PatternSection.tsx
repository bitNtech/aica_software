import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { asAuthError } from '../../../../../auth/types'
import { DetectedFlowBanner } from '../../../../../components/console/DetectedFlowBanner'
import { DetectedFlowChart } from '../../../../../components/console/DetectedFlowChart'
import { StatusPill } from '../../../../../components/console/StatusPill'
import { Button } from '../../../../../components/ui/Button'
import { Modal } from '../../../../../components/ui/Dialog'
import { editedFlowRequestDetail, flowRequestDetail } from '../../../../../console/flowRequest'
import { canSeeFlowPatterns, FLOW_PATTERN_WINDOW } from '../../../../../console/flowPatternConfig'
import { can, pageAccess } from '../../../../../console/access'
import { useConsole } from '../../../../../console/ConsoleProvider'
import type { CallRecord, CallSummary, DetectedFlowPattern, FlowNode } from '../../../../../console/types'
import { useOrg } from '../../../../../console/useOrg'
import { duration } from '../../shared'
import { callerLabel, OutcomePill, shortWhen } from '../parts'
import { useDesignedFlow } from '../useDesignedFlow'
import { firstCallerLine, patternCallsIn, patternToFlow, stepCounts, stepStatuses } from './logic'
import { PatternEditor } from './PatternEditor'

/** How many of a pattern's calls are shown as evidence. */
const SAMPLES = 3

interface SectionProps {
  /** The agent the list is filtered to; none: every agent. */
  agentId: string
  /** The calls loaded in the list. */
  loaded: CallSummary[]
  /** Another agent's pattern can be looked at in the list. */
  onFilterAgent(agentId: string): void
  /** A request went to bitNtech. */
  onRequested(pattern: DetectedFlowPattern): void
}

/**
 * Above the call list: patterns the agents' recent calls followed that
 * aren't in their designed flow. Each is a banner with "View flow", which
 * opens it drawn against the designed flow, with the calls behind it, and
 * a way to ask bitNtech to build it, as detected or edited as a diagram
 * first. Front desk (own calls) don't see these.
 */
export function PatternSection({ agentId, loaded, onFilterAgent, onRequested }: SectionProps) {
  const { org, access } = useOrg()
  const client = useConsole()
  const own = pageAccess(access, 'calls') === 'own'
  const allowed = !own && canSeeFlowPatterns(access)
  const [found, setFound] = useState<{ key: string; patterns: DetectedFlowPattern[] } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const key = `${org.orgSlug}|${agentId}`

  useEffect(() => {
    if (!allowed) return
    let live = true
    const ask = agentId ? client.detectNewFlowPatterns(org.orgSlug, agentId, { windowSize: FLOW_PATTERN_WINDOW }) : client.listNewFlowPatterns(org.orgSlug, { windowSize: FLOW_PATTERN_WINDOW })
    ask.then(
      (patterns) => live && setFound({ key, patterns }),
      // Patterns are a bonus: when they can't be read, the list works without them.
      () => live && setFound({ key, patterns: [] }),
    )
    return () => {
      live = false
    }
  }, [client, org.orgSlug, agentId, allowed, key])

  const patterns = allowed && found?.key === key ? found.patterns : []
  const open = patterns.find((p) => p.id === openId) ?? null
  if (patterns.length === 0) return null

  return (
    <section className="pt-section" aria-label="Detected call flow patterns">
      {patterns.map((p) => (
        <DetectedFlowBanner key={p.id} pattern={p} onView={() => setOpenId(p.id)} viewLabel={patterns.length > 1 ? `View flow for ${p.agentName}` : undefined} />
      ))}
      <Modal open={open !== null} title="Detected call flow pattern" onClose={() => setOpenId(null)} side="right">
        {open && (
          <PatternDetail
            key={open.id}
            pattern={open}
            loaded={loaded}
            onFilterAgent={(id) => {
              setOpenId(null)
              onFilterAgent(id)
            }}
            onRequested={() => {
              setOpenId(null)
              onRequested(open)
            }}
          />
        )}
      </Modal>
    </section>
  )
}

interface DetailProps {
  pattern: DetectedFlowPattern
  loaded: CallSummary[]
  onFilterAgent(agentId: string): void
  onRequested(): void
}

/** One pattern: against the designed flow, the calls behind it, and the request. */
export function PatternDetail({ pattern, loaded, onFilterAgent, onRequested }: DetailProps) {
  const { org, base, access } = useOrg()
  const client = useConsole()
  const redact = !can(access, 'call.personal')
  const designed = useDesignedFlow(pattern.agentId)
  const flow = designed.state === 'ready' ? designed.flow : undefined
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [edited, setEdited] = useState<FlowNode[]>(() => patternToFlow(pattern))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The calls behind the pattern, read for evidence and for how many reached each step.
  const [records, setRecords] = useState<{ ready: boolean; list: CallRecord[] }>({ ready: false, list: [] })
  useEffect(() => {
    let live = true
    Promise.allSettled(pattern.callIds.slice(0, FLOW_PATTERN_WINDOW).map((id) => client.getCallRecord(org.orgSlug, id))).then((results) => {
      if (!live) return
      setRecords({ ready: true, list: results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])) })
    })
    return () => {
      live = false
    }
  }, [client, org.orgSlug, pattern.callIds])

  const counts = records.list.length > 0 ? stepCounts(pattern.steps, records.list.map((r) => r.path)) : undefined
  const statuses = flow ? stepStatuses(pattern.steps, flow) : null
  const fresh = statuses?.filter((s) => s.status !== 'in').length ?? 0
  const inList = patternCallsIn(pattern, loaded).length

  async function request(edit?: { flow: FlowNode[]; note: string }) {
    setBusy(true)
    setError(null)
    try {
      await client.createChangeRequest(org.orgSlug, {
        kind: 'flow_change',
        agentId: pattern.agentId,
        title: edit ? 'New call flow pattern detected, with our changes' : 'New call flow pattern detected',
        detail: edit ? editedFlowRequestDetail(pattern, edit) : flowRequestDetail(pattern),
        urgency: 'normal',
      })
      onRequested()
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'edit') {
    return (
      <PatternEditor
        pattern={pattern}
        flow={edited}
        onFlow={setEdited}
        note={note}
        onNote={setNote}
        designed={flow}
        busy={busy}
        error={error}
        onRequest={() => void request({ flow: edited, note })}
        onBack={() => {
          setError(null)
          setMode('view')
        }}
      />
    )
  }

  return (
    <div className="pt">
      <DetectedFlowChart pattern={pattern} onRequestFlow={() => void request()} busy={busy} designed={flow} stepCounts={counts} />
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="pt__edit-row">
        <Button variant="line" size="sm" onClick={() => setMode('edit')}>
          Edit as a diagram
        </Button>
        <span className="pt__quiet">Change the steps first, then ask bitNtech to build your version.</span>
      </div>

      <section className="pt__sec" aria-labelledby="pt-compare">
        <h3 id="pt-compare" className="pt__title">
          Against the designed flow
        </h3>
        {designed.state === 'loading' && <p className="pt__quiet">Reading the designed flow…</p>}
        {designed.state === 'unavailable' && <p className="pt__quiet">The designed flow isn’t available to compare with (it needs permission to see the agent), so the steps stand alone.</p>}
        {statuses && (
          <>
            <p className="pt__summary">
              {statuses.length - fresh} of {statuses.length} {statuses.length === 1 ? 'step is' : 'steps are'} in the designed flow; {fresh} {fresh === 1 ? 'is' : 'are'} new.
            </p>
            <ol className="pt__steps" aria-label="Each step against the designed flow">
              {statuses.map((s) => (
                <li key={s.index}>
                  <span className="pt__step">{s.step}</span>
                  {s.status === 'in' ? <StatusPill tone="info">In the designed flow</StatusPill> : <StatusPill tone="warn">{s.status === 'elsewhere' ? 'In the flow, under another intent' : 'New'}</StatusPill>}
                  {counts && (
                    <span className="pt__count">
                      {counts[s.index]} of {records.list.length} {records.list.length === 1 ? 'call' : 'calls'}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section className="pt__sec" aria-labelledby="pt-calls">
        <h3 id="pt-calls" className="pt__title">
          Calls in this pattern
        </h3>
        {!records.ready && <p className="pt__quiet">Reading the calls…</p>}
        {records.ready && records.list.length === 0 && (
          <p className="pt__quiet">
            These calls can’t be opened from here.{' '}
            <button type="button" className="btn-text" onClick={() => onFilterAgent(pattern.agentId)}>
              Show {pattern.agentName}’s calls in the list
            </button>
          </p>
        )}
        {records.list.length > 0 && (
          <>
            <p className="pt__quiet">
              {pattern.callIds.length} {pattern.callIds.length === 1 ? 'call' : 'calls'} followed it
              {inList > 0 ? `; ${inList} ${inList === 1 ? 'is' : 'are'} in the list now` : ''}. {Math.min(SAMPLES, records.list.length)} shown.
            </p>
            <ul className="pt__calls">
              {records.list.slice(0, SAMPLES).map((r) => {
                const line = firstCallerLine(r, redact)
                return (
                  <li key={r.id} className="pt__call">
                    <p className="pt__call-head">
                      <Link className="link" to={`${base}/calls/${r.id}`}>
                        {callerLabel(r, !redact)} <span className="pt__quiet">at {shortWhen(r.startedAt)}</span>
                      </Link>
                      <OutcomePill outcome={r.outcome} />
                      <span className="pt__quiet">{duration(r.durationSec)}</span>
                    </p>
                    {line && <blockquote className="pt__quote">“{line}”</blockquote>}
                  </li>
                )
              })}
            </ul>
            <button type="button" className="btn-text" onClick={() => onFilterAgent(pattern.agentId)}>
              Show all of {pattern.agentName}’s calls in the list
            </button>
          </>
        )}
      </section>
    </div>
  )
}
