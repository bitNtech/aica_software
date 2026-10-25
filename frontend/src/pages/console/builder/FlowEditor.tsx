import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { FlowNode, FlowNodeKind } from '../../../console/types'
import { FlowCanvas, type FlowCanvasHandle, type FlowMark } from '../../../components/console/flow/FlowCanvas'
import { ancestorIds, flatten } from '../../../components/console/flow/layout'
import { SegFilter } from '../../../components/console/ListTools'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import { canJoin, indexFlow, joinTarget } from '../../../console/flowGraph'
import {
  KIND_LABEL,
  addNode,
  allIds,
  blankNode,
  confidenceLabel,
  canRemoveOnly,
  countForks,
  countNodes,
  countPaths,
  findNode,
  joinOptions,
  lowConfidence,
  mergeIntents,
  moveNode,
  NEEDS_REVIEW,
  neighbour,
  numberFlow,
  position,
  removeNode,
  removeOnly,
  updateNode,
} from './flowTree'
import './FlowViews.css'

/** How the flow is shown: the outline (a list, and the accessible default),
 * the diagram, or both side by side. */
export type FlowView = 'outline' | 'diagram' | 'both'
const VIEW_KEY = 'aica.flow.view'
const VIEWS: FlowView[] = ['outline', 'diagram', 'both']

function readView(): FlowView {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return VIEWS.includes(v as FlowView) ? (v as FlowView) : 'outline'
  } catch {
    return 'outline'
  }
}

interface Props {
  flow: FlowNode[]
  onChange(flow: FlowNode[]): void
  /** Node id → what's wrong with it. */
  errors?: Record<string, string>
  readOnly?: boolean
  /** Opens the list of calls a node was seen in. */
  onShowCalls?(node: FlowNode): void
  /** Id for the summary line, so the page can move focus to it. */
  summaryId?: string
  /** Start in this view instead of the remembered one. The choice then
   * isn't remembered either (used where the flow is a one-off copy). */
  initialView?: FlowView
}

/**
 * The conversation flow as an editable outline: intents at the top, their
 * steps and branches nested under them. Each row can be expanded, edited,
 * moved, or given new steps; editing opens a small form under the row.
 *
 * The same flow can also be shown as a diagram (FlowCanvas), alone or beside
 * the outline. Both are views of one state: folding, selection, editing,
 * undo and the "needs a look" filter are shared, and the diagram's edit
 * buttons call the very same handlers as the outline's. The choice of view
 * is remembered.
 */
export function FlowEditor({ flow, onChange, errors = {}, readOnly, onShowCalls, summaryId, initialView }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  /** A node just added: removed again if its form is cancelled while empty. */
  const [fresh, setFresh] = useState<string | null>(null)
  const [reviewOnly, setReviewOnly] = useState(false)
  /** A row id, or 'add' for the Add intent button when the list is empty. */
  const [focusId, setFocusId] = useState<string | null>(null)
  /** Said to screen readers after a move or delete. */
  const [note, setNote] = useState('')
  /** The flow before the last delete, so it can be undone. */
  const [undo, setUndo] = useState<{ id: string; label: string; flow: FlowNode[] } | null>(null)
  const addIntent = useRef<HTMLButtonElement>(null)
  const [view, setViewState] = useState<FlowView>(() => initialView ?? readView())
  const showOutline = view !== 'diagram'
  const showDiagram = view !== 'outline'
  /** The node picked in either view; the other follows it. */
  const [selected, setSelected] = useState<string | null>(null)
  /** A delete asked for in the diagram on a node that has steps inside. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const canvas = useRef<FlowCanvasHandle>(null)
  const treeRef = useRef<HTMLUListElement>(null)
  /** The last change was made in the diagram, so focus goes back there. */
  const fromCanvas = useRef(false)

  const setView = (v: FlowView) => {
    setViewState(v)
    if (initialView) return
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* not remembered */
    }
  }

  // After a move or delete, put focus back on a sensible row.
  useEffect(() => {
    if (!focusId) return
    if (focusId === 'add') addIntent.current?.focus()
    else if (showDiagram && (fromCanvas.current || !showOutline)) {
      canvas.current?.focusNode(focusId.startsWith('move:') ? focusId.split(':')[1] : focusId)
    } else {
      // A move keeps focus on its button, unless the row can't move further.
      const el = document.querySelector<HTMLButtonElement>(`[data-node-focus="${focusId}"]`)
      const row = focusId.startsWith('move:') ? focusId.split(':')[1] : null
      if (el && !el.disabled) el.focus()
      else if (row) document.querySelector<HTMLElement>(`[data-node-focus="${row}"]`)?.focus()
    }
    fromCanvas.current = false
    setFocusId(null)
  }, [focusId, flow])

  /** Every change but a delete makes the undo stale. */
  const change = (next: FlowNode[]) => {
    setUndo(null)
    onChange(next)
  }

  const intents = flow.length
  const numbers = useMemo(() => numberFlow(flow), [flow])
  const index = useMemo(() => indexFlow(flow), [flow])
  /** Where `n` carries on, if it joins back up. */
  const joinOf = (n: FlowNode) => joinTarget(index, n)
  const numbered = (n: FlowNode) => `${numbers.get(n.id) ? `${numbers.get(n.id)} · ` : ''}${n.label || 'Unnamed'}`
  const forks = countForks(flow)
  const paths = countPaths(flow)
  const flagged = (n: FlowNode) => lowConfidence([n]).length > 0 || !!errors[n.id] || allIds(n.children).some((c) => errors[c])
  const review = flow.filter(flagged).length

  function add(parentId: string | null, kind: FlowNodeKind) {
    const node = blankNode(kind)
    change(addNode(flow, parentId, node))
    if (parentId) setCollapsed((c) => new Set([...c].filter((x) => x !== parentId)))
    setEditing(node.id)
    setFresh(node.id)
  }

  function cancelEdit(id: string) {
    if (fresh === id) {
      // A step put in between gives back what followed it.
      change(findNode(flow, id)?.children.length ? removeOnly(flow, id) : removeNode(flow, id))
      setFocusId(neighbour(flow, id) ?? 'add')
    } else setFocusId(id)
    setEditing(null)
    setFresh(null)
  }

  /** `keep`: what followed it stays, in its place. */
  function remove(id: string, keep = false) {
    const node = findNode(flow, id)
    const kind = node ? KIND_LABEL[node.kind].toLowerCase() : 'item'
    onChange(keep ? removeOnly(flow, id) : removeNode(flow, id))
    setUndo({ id, label: `${kind} “${node?.label || 'unnamed'}”`, flow })
    setNote(keep ? `Deleted the ${kind}. What followed it moved up.` : `Deleted the ${kind}.`)
    setEditing(null)
    setFresh(null)
    setFocusId(neighbour(flow, id) ?? 'add')
  }

  function move(node: FlowNode, dir: -1 | 1) {
    const next = moveNode(flow, node.id, dir)
    change(next)
    const { first, last } = position(next, node.id)
    setNote(`Moved ${dir < 0 ? 'up' : 'down'}${first ? ', now first' : last ? ', now last' : ''}.`)
    setFocusId(`move:${node.id}:${dir}`)
  }

  /** Moves to the step a node carries on at, unfolding what hides it. */
  function goTo(id: string) {
    const hidden = ancestorIds(flow, id)
    setCollapsed((c) => new Set([...c].filter((x) => !hidden.includes(x))))
    setSelected(id)
    setFocusId(id)
  }

  // A row being added or edited stays in view, even when filtered.
  const visible = (n: FlowNode) => !reviewOnly || flagged(n) || [n.id, ...allIds(n.children)].some((id) => id === editing || id === fresh)

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Rows that can fold what follows them: intents, branches, and any node
   * the call can leave more than one way. */
  const foldable = (n: FlowNode) => n.children.length > 0 && (n.kind !== 'step' || n.children.length > 1 || n.children[0].kind === 'branch')

  // Render functions, not components: a component defined in here would
  // be a new type each render, remounting the tree and losing the open form.

  /** One node's row (and its edit form). An intent's path is nested in it. */
  function row(node: FlowNode, depth: number) {
    const open = !collapsed.has(node.id)
    const canFold = foldable(node)
    const { first, last } = position(flow, node.id)
    const conf = node.confidence !== undefined ? confidenceLabel(node.confidence) : null
    const err = errors[node.id]
    const listId = `kids-${node.id}`
    const Title = node.kind === 'intent' ? 'h3' : 'p'
    const picked = showDiagram && selected === node.id
    const name = node.label || 'unnamed'
    const joins = joinOf(node)
    const fork = node.children.length + (joins ? 1 : 0) > 1
    return (
      <li key={node.id} className={`flow__item flow__item--${node.kind}`}>
        <div
          className={['flow__row', err && 'flow__row--error', editing === node.id && 'is-editing', picked && 'is-selected'].filter(Boolean).join(' ')}
          onClick={showDiagram ? () => setSelected(node.id) : undefined}
        >
          {canFold ? (
            <button
              type="button"
              className="flow__toggle"
              aria-expanded={open}
              aria-controls={node.kind === 'intent' || fork ? listId : undefined}
              aria-label={`What follows ${name}`}
              onClick={() => toggle(node.id)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={open ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'} />
              </svg>
            </button>
          ) : (
            <span className="flow__toggle flow__toggle--none" aria-hidden="true" />
          )}
          <div className="flow__main">
            {/* Intents are headings, so screen-reader users can jump between them. */}
            <Title className="flow__title">
              {numbers.get(node.id) && <span className="flow__num">{numbers.get(node.id)}</span>}
              <span className={`flow__kind flow__kind--${node.kind}`}>{KIND_LABEL[node.kind]}</span>
              <span className="flow__label" id={`node-${node.id}`} tabIndex={-1} data-node-focus={node.id} aria-current={picked ? 'true' : undefined}>
                {node.label || <em className="flow__unnamed">Unnamed</em>}
              </span>
            </Title>
            {node.kind === 'step' && node.say && <p className="flow__say">“{node.say}”</p>}
            {node.kind === 'branch' && node.condition && <p className="flow__say">When: {node.condition}</p>}
            {joins && !node.children.length && (
              <p className="flow__joins">
                Then carries on at{' '}
                <button type="button" className="btn-text" onClick={() => goTo(joins.id)}>
                  {numbered(joins)}
                </button>
              </p>
            )}
            <p className="flow__meta">
              {conf && <span className={`conf conf--${conf.level}`}>{conf.text}</span>}
              {node.sourceCallIds.length > 0 && onShowCalls && (
                <button
                  type="button"
                  className="btn-text flow__calls"
                  aria-label={`Seen in ${node.sourceCallIds.length} ${node.sourceCallIds.length === 1 ? 'call' : 'calls'}: ${node.label}`}
                  onClick={() => onShowCalls(node)}
                >
                  Seen in {node.sourceCallIds.length} {node.sourceCallIds.length === 1 ? 'call' : 'calls'}
                </button>
              )}
              {node.sourceCallIds.length === 0 && node.confidence === undefined && <span className="flow__added">Added by hand</span>}
              {!open && canFold && <span className="flow__added">{countNodes(node.children)} hidden after it</span>}
            </p>
            {err && <p className="field__error flow__error">{err}</p>}
          </div>
          {!readOnly && (
            <div className="flow__actions">
              <button
                type="button"
                className="flow__act"
                aria-label={`Edit ${name}`}
                aria-expanded={editing === node.id}
                onClick={() => setEditing(editing === node.id ? null : node.id)}
              >
                Edit
              </button>
              <button type="button" className="flow__act" aria-label={`Add a step after ${name}`} onClick={() => add(node.id, 'step')}>
                Add step
              </button>
              <button type="button" className="flow__act" aria-label={`Add a branch after ${name}`} onClick={() => add(node.id, 'branch')}>
                Add branch
              </button>
              {!(first && last) && (
                <span className="flow__moves">
                  <button type="button" className="flow__act flow__act--icon" aria-label={`Move ${name} up`} title="Move up" data-node-focus={`move:${node.id}:-1`} disabled={first} onClick={() => move(node, -1)}>
                    ↑
                  </button>
                  <button type="button" className="flow__act flow__act--icon" aria-label={`Move ${name} down`} title="Move down" data-node-focus={`move:${node.id}:1`} disabled={last} onClick={() => move(node, 1)}>
                    ↓
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {editing === node.id && !readOnly && (
          <NodeForm
            node={node}
            flow={flow}
            intents={depth === 0 ? flow.filter((n) => n.id !== node.id) : []}
            joinChoices={joinChoices(node)}
            joinedBy={joinedBy(node)}
            canKeepFollowers={canRemoveOnly(flow, node.id)}
            onSave={(patch) => {
              change(updateNode(flow, node.id, patch))
              setEditing(null)
              setFresh(null)
              setFocusId(node.id)
            }}
            onMerge={(into) => {
              change(mergeIntents(flow, node.id, into))
              setNote('Intents merged.')
              setEditing(null)
              setFocusId(into)
            }}
            onDelete={(keep) => remove(node.id, keep)}
            onCancel={() => cancelEdit(node.id)}
          />
        )}

        {node.kind === 'intent' && node.children.length > 0 && open && (
          <ol className="flow__path" id={listId} aria-label={`What happens in ${name}`}>
            {follow(node.children, node, depth + 1)}
          </ol>
        )}
      </li>
    )
  }

  /**
   * What follows `from`, on its path: a single step carries straight on in
   * the same list, so a long path reads top to bottom; a fork is a list of
   * the ways out, each its own path, indented.
   */
  function follow(list: FlowNode[], from: FlowNode, depth: number): ReactNode[] {
    if (!list.length) return []
    if (list.length === 1 && list[0].kind !== 'branch') {
      const next = list[0]
      return [row(next, depth), ...(collapsed.has(next.id) ? [] : follow(next.children, next, depth))]
    }
    // With only branches here, a join is the way on when none applies.
    const joins = joinOf(from)
    const ways = list.length + (joins ? 1 : 0)
    return [
      <li key={`fork-${from.id}`} className="flow__fork" id={from.kind === 'intent' ? undefined : `kids-${from.id}`}>
        <p className="flow__fork-head" aria-hidden="true">
          {ways === 1 ? 'Only when' : `${ways} ways on`}
        </p>
        <ul className="flow__alts" aria-label={`${ways === 1 ? 'The way on' : `${ways} ways on`} after ${from.label || 'unnamed'}`}>
          {list.map((alt) => (
            <li key={`alt-${alt.id}`} className={`flow__alt flow__alt--${alt.kind}`}>
              {alt.kind !== 'branch' && <p className="flow__otherwise">Otherwise</p>}
              <ol className="flow__path">
                {row(alt, depth + 1)}
                {!collapsed.has(alt.id) && follow(alt.children, alt, depth + 1)}
              </ol>
            </li>
          ))}
          {joins && (
            <li className="flow__alt flow__alt--join">
              <p className="flow__otherwise">Otherwise</p>
              <p className="flow__joins flow__joins--alt">
                Carries on at{' '}
                <button type="button" className="btn-text" onClick={() => goTo(joins.id)}>
                  {numbered(joins)}
                </button>
              </p>
            </li>
          )}
        </ul>
      </li>,
    ]
  }

  /** The steps a node can carry on at, named as on the diagram. */
  const joinChoices = (n: FlowNode) => (canJoin(n) ? joinOptions(flow, n.id).map((x) => ({ value: x.id, label: numbered(x) })) : null)
  /** How many other nodes carry on at `n`. */
  const joinedBy = (n: FlowNode) => [...index.values()].filter((p) => p.node.joinsAt === n.id).length

  const shown = flow.filter(visible)

  /** A line of status on each node of the diagram: icon and words. */
  const marks = useMemo(() => {
    const out: Record<string, FlowMark> = {}
    for (const n of flatten(flow)) {
      if (errors[n.id]) out[n.id] = { tone: 'danger', text: 'Needs fixing', detail: errors[n.id] }
      else if (n.confidence !== undefined && n.confidence < NEEDS_REVIEW)
        out[n.id] = { tone: 'warn', text: confidenceLabel(n.confidence).text, detail: 'Check this against the calls it came from.' }
    }
    return out
  }, [flow, errors])

  /** With "only what needs a look" on, the diagram dims the rest (and keeps
   * the intents above what's flagged in view, for context). */
  const dimExcept = useMemo(() => {
    if (!reviewOnly) return undefined
    return [...new Set(Object.keys(marks).flatMap((id) => [...ancestorIds(flow, id), id]))]
  }, [reviewOnly, marks, flow])

  // The outline row for a node picked in the diagram: unfolded already (the
  // diagram shares the folding), so scroll to it and focus it.
  function focusOutlineRow(id: string) {
    const el = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-node-focus]') ?? [])].find((e) => e.getAttribute('data-node-focus') === id)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView?.({ block: 'nearest' })
  }

  function pickInDiagram(id: string) {
    setSelected(id)
    if (view === 'both') focusOutlineRow(id)
  }

  function removeFromDiagram(id: string) {
    fromCanvas.current = true
    const node = findNode(flow, id)
    if (node && node.children.length > 0) setConfirmDelete(id)
    else remove(id)
  }

  const picked = selected ? findNode(flow, selected) : null
  const editingNode = editing ? findNode(flow, editing) : null
  const kindWord = (n: FlowNode) => KIND_LABEL[n.kind].toLowerCase()

  const outline = (
    <>
      {shown.length > 0 ? (
        <ul className="flow__tree" aria-label="Conversation flow" ref={treeRef}>
          {shown.map((n) => row(n, 0))}
        </ul>
      ) : (
        <p className="empty-note">{reviewOnly ? 'Nothing needs a look.' : 'No intents yet. Add the first conversation the agent should handle.'}</p>
      )}
    </>
  )

  const diagram = (
    <div className="flow__diagram">
      <FlowCanvas
        ref={canvas}
        nodes={flow}
        label="Conversation flow diagram"
        description="The Outline view lists the same flow as text."
        height={view === 'both' ? 'clamp(22rem, 68vh, 40rem)' : undefined}
        selectedId={selected}
        onSelect={pickInDiagram}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        marks={marks}
        dimExcept={dimExcept}
        editable={!readOnly}
        onAddChild={(parent, kind) => {
          fromCanvas.current = true
          add(parent, kind)
        }}
        onRename={(id) => {
          fromCanvas.current = true
          setEditing(id)
          setFresh(null)
        }}
        onMove={(id, dir) => {
          const node = findNode(flow, id)
          if (node) {
            fromCanvas.current = true
            move(node, dir)
          }
        }}
        onDelete={removeFromDiagram}
        emptyText="No intents yet. Add the first conversation the agent should handle."
      />
      {view === 'diagram' && editingNode && !readOnly && (
        <div className="flow__inspector">
          <NodeForm
            key={editingNode.id}
            node={editingNode}
            flow={flow}
            intents={flow.some((n) => n.id === editingNode.id) ? flow.filter((n) => n.id !== editingNode.id) : []}
            joinChoices={joinChoices(editingNode)}
            joinedBy={joinedBy(editingNode)}
            canKeepFollowers={canRemoveOnly(flow, editingNode.id)}
            onSave={(patch) => {
              change(updateNode(flow, editingNode.id, patch))
              setEditing(null)
              setFresh(null)
              setFocusId(editingNode.id)
            }}
            onMerge={(into) => {
              change(mergeIntents(flow, editingNode.id, into))
              setNote('Intents merged.')
              setEditing(null)
              setFocusId(into)
            }}
            onDelete={(keep) => remove(editingNode.id, keep)}
            onCancel={() => cancelEdit(editingNode.id)}
          />
        </div>
      )}
      {view === 'diagram' && !editingNode && (
        <NodeDetail
          node={picked}
          number={picked ? (numbers.get(picked.id) ?? null) : null}
          joins={picked ? joinOf(picked) : null}
          joinsName={picked && joinOf(picked) ? numbered(joinOf(picked)!) : ''}
          error={picked ? errors[picked.id] : undefined}
          onShowCalls={onShowCalls}
        />
      )}
    </div>
  )

  return (
    <div className="flow">
      <p className="sr-only" role="status">
        {note}
      </p>
      <div className="flow__bar">
        <p className="flow__summary" id={summaryId} tabIndex={-1}>
          {intents} {intents === 1 ? 'intent' : 'intents'}, {forks} {forks === 1 ? 'point' : 'points'} where the call can go more than one way, {paths} {paths === 1 ? 'way' : 'ways'} a call can end.{' '}
          {review > 0 ? <strong>{review} {review === 1 ? 'needs' : 'need'} a look.</strong> : 'Nothing flagged.'}
        </p>
        <div className="flow__tools">
          <SegFilter
            legend="View"
            options={[
              { value: 'outline', label: 'Outline' },
              { value: 'diagram', label: 'Diagram' },
              { value: 'both', label: 'Side by side' },
            ]}
            value={view}
            onChange={setView}
          />
          <Switch label="Only what needs a look" checked={reviewOnly} onChange={setReviewOnly} />
          <button type="button" className="btn-text" onClick={() => setCollapsed(new Set())}>
            Expand all
          </button>
          <button type="button" className="btn-text" onClick={() => setCollapsed(new Set(flow.map((n) => n.id)))}>
            Collapse all
          </button>
        </div>
      </div>

      {undo && !readOnly && (
        <div className="flow__undo">
          <span>Deleted the {undo.label}.</span>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              onChange(undo.flow)
              setUndo(null)
              setNote('Delete undone.')
              setFocusId(undo.id)
            }}
          >
            Undo
          </button>
        </div>
      )}

      {view === 'both' ? (
        <div className="flow__split">
          <div className="flow__split-list">{outline}</div>
          {diagram}
        </div>
      ) : view === 'diagram' ? (
        diagram
      ) : (
        outline
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete “${findNode(flow, confirmDelete ?? '')?.label || 'this item'}”?`}
        confirmLabel={`Delete it and what follows`}
        danger
        onConfirm={() => {
          const id = confirmDelete
          setConfirmDelete(null)
          if (id) remove(id)
        }}
        onCancel={() => {
          fromCanvas.current = false
          setConfirmDelete(null)
        }}
      >
        <FollowersNote node={findNode(flow, confirmDelete ?? '')} flow={flow} />
        {confirmDelete && canRemoveOnly(flow, confirmDelete) && (
          <p>
            <button
              type="button"
              className="btn-text"
              onClick={() => {
                const id = confirmDelete
                setConfirmDelete(null)
                remove(id, true)
              }}
            >
              Delete only this {kindWord(findNode(flow, confirmDelete)!)}, keep what follows
            </button>
          </p>
        )}
      </ConfirmDialog>

      {!readOnly && (
        <div>
          <Button ref={addIntent} variant="line" size="sm" onClick={() => add(null, 'intent')}>
            Add intent
          </Button>
        </div>
      )}
    </div>
  )
}

/** What a node says, how sure AICA is and where it came from: the outline
 * row's content, for the diagram view where there are no rows. */
function NodeDetail({
  node,
  number,
  joins,
  joinsName,
  error,
  onShowCalls,
}: {
  node: FlowNode | null
  number: string | null
  joins: FlowNode | null
  joinsName: string
  error?: string
  onShowCalls?(node: FlowNode): void
}) {
  if (!node) return <p className="flow__detail flow__detail--empty">Select a step to see what the agent says and where it came from.</p>
  const conf = node.confidence !== undefined ? confidenceLabel(node.confidence) : null
  const calls = node.sourceCallIds.length
  return (
    <section className="flow__detail" aria-label={`About ${node.label || 'unnamed'}`}>
      <p className="flow__title">
        {number && <span className="flow__num">{number}</span>}
        <span className={`flow__kind flow__kind--${node.kind}`}>{KIND_LABEL[node.kind]}</span>
        <span className="flow__label">{node.label || <em className="flow__unnamed">Unnamed</em>}</span>
      </p>
      {node.kind === 'step' && node.say && <p className="flow__say">“{node.say}”</p>}
      {node.kind === 'branch' && node.condition && <p className="flow__say">When: {node.condition}</p>}
      {joins && (
        <p className="flow__joins">
          {node.children.length ? 'If none of its branches applies, the call carries on at' : 'Then carries on at'} {joinsName}
        </p>
      )}
      <p className="flow__meta">
        {conf && <span className={`conf conf--${conf.level}`}>{conf.text}</span>}
        {calls > 0 && onShowCalls && (
          <button type="button" className="btn-text flow__calls" aria-label={`Seen in ${calls} ${calls === 1 ? 'call' : 'calls'}: ${node.label}`} onClick={() => onShowCalls(node)}>
            Seen in {calls} {calls === 1 ? 'call' : 'calls'}
          </button>
        )}
        {calls === 0 && node.confidence === undefined && <span className="flow__added">Added by hand</span>}
      </p>
      {error && <p className="field__error flow__error">{error}</p>}
    </section>
  )
}

/** How much goes with a node that's deleted, and the paths that carry on
 * at something going (they end there instead). */
function FollowersNote({ node, flow }: { node: FlowNode | null; flow: FlowNode[] }) {
  const n = countNodes(node?.children ?? [])
  const going = new Set(node ? allIds([node]) : [])
  const joining = [...indexFlow(flow).values()].filter((p) => p.node.joinsAt && going.has(p.node.joinsAt) && !going.has(p.node.id)).length
  return (
    <>
      <p>{n === 1 ? '1 step or branch follows it.' : `${n} steps and branches follow it.`} They go too, unless you keep them.</p>
      {joining > 0 && <p>{joining === 1 ? '1 other path carries on at what goes; it will end there instead.' : `${joining} other paths carry on at what goes; they will end there instead.`}</p>}
    </>
  )
}

function NodeForm({
  node,
  flow,
  intents,
  joinChoices,
  joinedBy,
  canKeepFollowers,
  onSave,
  onMerge,
  onDelete,
  onCancel,
}: {
  node: FlowNode
  /** The whole flow, to say what a delete takes with it. */
  flow: FlowNode[]
  /** Other intents this one can merge into; empty for steps and branches. */
  intents: FlowNode[]
  /** Steps it can carry on at; null when it can't join back up (an intent,
   * or a node a step of its own already carries on). */
  joinChoices: { value: string; label: string }[] | null
  /** How many other nodes carry on at this one. */
  joinedBy: number
  /** It can go on its own, what follows it moving up into its place. */
  canKeepFollowers: boolean
  onSave(patch: Partial<FlowNode>): void
  onMerge(into: string): void
  /** `keep`: what follows it stays. */
  onDelete(keep: boolean): void
  onCancel(): void
}) {
  const id = useId()
  const [label, setLabel] = useState(node.label)
  const [say, setSay] = useState(node.say ?? '')
  const [condition, setCondition] = useState(node.condition ?? '')
  const [joinsAt, setJoinsAt] = useState(node.joinsAt ?? '')
  const [into, setInto] = useState(intents[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'merge' | null>(null)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.focus()
  }, [])

  function save(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) {
      setError('Give it a short name.')
      first.current?.focus()
      return
    }
    onSave({
      label: label.trim(),
      say: node.kind === 'step' ? say.trim() : undefined,
      condition: node.kind === 'branch' ? condition.trim() : undefined,
      ...(joinChoices ? { joinsAt: joinsAt || undefined } : {}),
    })
  }

  const kind = KIND_LABEL[node.kind].toLowerCase()

  return (
    <form
      className="flow__form"
      onSubmit={save}
      noValidate
      aria-labelledby={`${id}-h`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !confirm) {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <p className="flow__form-title" id={`${id}-h`}>
        {node.label ? `Edit ${kind}: ${node.label}` : `New ${kind}`}
      </p>
      <TextField
        ref={first}
        label="Name"
        value={label}
        maxLength={80}
        error={error}
        onChange={(e) => {
          setLabel(e.target.value)
          if (error) setError(null)
        }}
      />
      {node.kind === 'step' && (
        <TextAreaField
          label="What the agent says"
          hint="Use {curly braces} for details filled in during the call, e.g. {date}."
          rows={3}
          value={say}
          onChange={(e) => setSay(e.target.value)}
        />
      )}
      {node.kind === 'branch' && <TextField label="When this applies" value={condition} onChange={(e) => setCondition(e.target.value)} />}
      {joinChoices && (joinChoices.length > 0 || joinsAt) && (
        <SelectField
          label={node.children.length ? 'If none of its branches applies, carry on at' : 'Then carry on at'}
          hint="Join this path back up with a step further on, so the call carries on there."
          options={[
            { value: '', label: node.children.length ? 'Nowhere: the call ends' : 'Nowhere: the call ends here' },
            ...joinChoices,
            ...(joinsAt && !joinChoices.some((c) => c.value === joinsAt) ? [{ value: joinsAt, label: 'A step that can’t be used any more' }] : []),
          ]}
          value={joinsAt}
          onChange={(e) => setJoinsAt(e.target.value)}
        />
      )}
      {joinedBy > 0 && (
        <p className="flow__joins">
          {joinedBy === 1 ? '1 other path carries on here.' : `${joinedBy} other paths carry on here.`}
        </p>
      )}
      <div className="flow__form-actions">
        <Button type="submit" variant="plum" size="sm">
          Save
        </Button>
        <Button variant="line" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <button type="button" className="btn-text flow__delete" onClick={() => (node.children.length ? setConfirm('delete') : onDelete(false))}>
          Delete {kind}
        </button>
      </div>

      {intents.length > 0 && node.kind === 'intent' && (
        <div className="flow__merge">
          <SelectField label="Merge into another intent" options={intents.map((n) => ({ value: n.id, label: n.label || 'Unnamed' }))} value={into} onChange={(e) => setInto(e.target.value)} />
          <Button variant="line" size="sm" onClick={() => setConfirm('merge')}>
            Merge
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'delete'}
        title={`Delete “${node.label || 'this ' + kind}”?`}
        confirmLabel="Delete it and what follows"
        danger
        onConfirm={() => {
          setConfirm(null)
          onDelete(false)
        }}
        onCancel={() => setConfirm(null)}
      >
        <FollowersNote node={node} flow={flow} />
        {canKeepFollowers && (
          <p>
            <button
              type="button"
              className="btn-text"
              onClick={() => {
                setConfirm(null)
                onDelete(true)
              }}
            >
              Delete only this {kind}, keep what follows
            </button>
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'merge'}
        title="Merge these intents?"
        confirmLabel="Merge"
        onConfirm={() => {
          setConfirm(null)
          onMerge(into)
        }}
        onCancel={() => setConfirm(null)}
      >
        <p>
          The ways “{node.label}” can go become more ways out of “{intents.find((n) => n.id === into)?.label}”, and “{node.label}” goes.
        </p>
      </ConfirmDialog>
    </form>
  )
}
