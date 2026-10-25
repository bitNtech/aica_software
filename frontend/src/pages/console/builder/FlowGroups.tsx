import { useId, useState } from 'react'
import type { AgentDraft, FlowGroup, FlowNode } from '../../../console/types'
import { FlowCanvas } from '../../../components/console/flow/FlowCanvas'
import { normaliseLabel } from '../../../components/console/flow/compare'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { countForks, countPaths } from './flowTree'

interface Props {
  draft: AgentDraft
  update(change: (d: AgentDraft) => AgentDraft): void
  /** Look only (a draft sent to bitNtech). */
  readOnly?: boolean
  /** Said to screen readers after a change. */
  onSaid(text: string): void
}

const sameIntent = (a: FlowNode, b: FlowNode) => normaliseLabel(a.label) === normaliseLabel(b.label)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * What reading the calls found, one flow per group of related calls.
 *
 * A new agent takes one group's flow: when the calls are about unrelated
 * things there's a choice, and the job's own group is suggested. Changes to
 * a published agent keep its flow; each conversation the calls found is
 * added to it, or replaces the one of the same name.
 */
export function FlowGroups({ draft, update, readOnly, onSaid }: Props) {
  const id = useId()
  const groups = draft.flowGroups ?? []
  const [switchTo, setSwitchTo] = useState<FlowGroup | null>(null)
  const [replace, setReplace] = useState<{ intent: FlowNode; group: FlowGroup } | null>(null)
  if (!groups.length) return null
  const change = !!draft.baseAgentId
  const calls = new Set(groups.flatMap((g) => g.callIds)).size
  const inUse = groups.find((g) => g.id === draft.flowGroupId) ?? null
  // The flow as it came from its group, untouched: switching loses nothing.
  const untouched = !inUse || JSON.stringify(inUse.flow) === JSON.stringify(draft.flow)

  function use(g: FlowGroup) {
    update((d) => ({ ...d, flow: g.flow, flowGroupId: g.id }))
    onSaid(`Using the flow for ${g.title}: ${plural(g.flow.length, 'conversation')}.`)
  }

  function add(g: FlowGroup, intents: FlowNode[]) {
    update((d) => ({ ...d, flow: [...d.flow, ...intents], flowGroupId: g.id }))
    onSaid(intents.length === 1 ? `Added “${intents[0].label}” to the flow.` : `Added ${intents.length} conversations to the flow.`)
  }

  function swap(intent: FlowNode, g: FlowGroup) {
    update((d) => ({ ...d, flow: d.flow.map((n) => (sameIntent(n, intent) ? intent : n)), flowGroupId: g.id }))
    onSaid(`Replaced “${intent.label}” with the version from the calls.`)
  }

  return (
    <section className="fgroups" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="step__heading">
        {change ? 'What AICA found in the calls' : 'What AICA found in your calls'}
      </h2>
      <p className="step__sub step__sub--flat">
        {change
          ? `From ${plural(calls, 'call')}. Add what’s new to ${draft.name.trim()}’s flow; a conversation it already has can be replaced with the version from the calls.`
          : groups.length > 1
            ? `Your ${plural(calls, 'call')} are about ${groups.length} unrelated things, so AICA made a separate flow for each. Choose the one this agent handles; another agent can be built from the rest.`
            : `All ${plural(calls, 'call')} are about related things, so AICA made one flow from them.`}
      </p>

      <ul className="fgroups__list">
        {groups.map((g) => {
          const using = !change && g.id === draft.flowGroupId
          const fresh = g.flow.filter((n) => !draft.flow.some((x) => sameIntent(x, n)))
          return (
            <li key={g.id} className={['fgroups__card', using && 'is-using'].filter(Boolean).join(' ')} aria-labelledby={`${id}-${g.id}`}>
              <div className="fgroups__head">
                <h3 id={`${id}-${g.id}`} className="fgroups__title">
                  {g.title}
                </h3>
                {using && <span className="status-chip status-chip--live">In use</span>}
                {!change && g.matchesJob && !using && <span className="status-chip">Fits the job you chose</span>}
              </div>
              <p className="row__meta">
                {g.summary} {plural(g.flow.length, 'conversation')}, {plural(countForks(g.flow), 'point')} where the call can go more than one way, {plural(countPaths(g.flow), 'way')} a call can end.
              </p>

              {change ? (
                <ul className="fgroups__intents">
                  {g.flow.map((n) => {
                    const there = draft.flow.find((x) => sameIntent(x, n))
                    const same = there && JSON.stringify(there) === JSON.stringify(n)
                    return (
                      <li key={n.id} className="fgroups__intent">
                        <span className="fgroups__intent-name">{n.label}</span>
                        <span className={`flag${there ? ' flag--quiet' : ''}`}>{same ? 'In the flow' : there ? 'The agent has its own version' : 'New'}</span>
                        {!readOnly && !there && (
                          <Button variant="line" size="sm" aria-label={`Add “${n.label}” to the flow`} onClick={() => add(g, [n])}>
                            Add
                          </Button>
                        )}
                        {!readOnly && there && !same && (
                          <Button variant="line" size="sm" aria-label={`Replace “${n.label}” with the version from the calls`} onClick={() => setReplace({ intent: n, group: g })}>
                            Use this version
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="row__meta">{g.flow.map((n) => n.label).join(' · ')}</p>
              )}

              <TreePreview flow={g.flow} label={`Flow found for ${g.title}`} />

              {!readOnly && (
                <div className="fgroups__actions">
                  {change ? (
                    fresh.length > 1 && (
                      <Button variant="line" size="sm" onClick={() => add(g, fresh)}>
                        Add all {fresh.length} new conversations
                      </Button>
                    )
                  ) : using ? null : (
                    <Button variant="line" size="sm" aria-label={`Use the flow for ${g.title}`} onClick={() => (untouched ? use(g) : setSwitchTo(g))}>
                      Use this flow
                    </Button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={switchTo !== null}
        title={`Use the flow for ${switchTo?.title ?? 'these calls'}?`}
        confirmLabel="Use this flow"
        danger
        onConfirm={() => {
          if (switchTo) use(switchTo)
          setSwitchTo(null)
        }}
        onCancel={() => setSwitchTo(null)}
      >
        <p>It takes the place of the flow below, and the changes you made to it are lost.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={replace !== null}
        title={`Replace “${replace?.intent.label ?? ''}”?`}
        confirmLabel="Replace it"
        danger
        onConfirm={() => {
          if (replace) swap(replace.intent, replace.group)
          setReplace(null)
        }}
        onCancel={() => setReplace(null)}
      >
        <p>The agent’s own version of this conversation goes, and the one from the calls takes its place. You can still change it below.</p>
      </ConfirmDialog>
    </section>
  )
}

/** The group's flow as a tree, drawn only once it's opened. */
function TreePreview({ flow, label }: { flow: FlowNode[]; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="fgroups__preview" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>See it as a tree</summary>
      {open && <FlowCanvas nodes={flow} label={label} height="min(22rem, 55vh)" emptyText="Nothing was found in these calls." />}
    </details>
  )
}
