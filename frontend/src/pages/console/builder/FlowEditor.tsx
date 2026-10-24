import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { FlowNode, FlowNodeKind } from '../../../console/types'
import { FlowCanvas, type FlowCanvasHandle, type FlowMark } from '../../../components/console/flow/FlowCanvas'
import { ancestorIds, flatten } from '../../../components/console/flow/layout'
import { SegFilter } from '../../../components/console/ListTools'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { SelectField, TextAreaField, TextField } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import {
  KIND_LABEL,
  addNode,
  allIds,
  blankNode,
  confidenceLabel,
  countNodes,
  findNode,
  lowConfidence,
  mergeIntents,
  moveNode,
  NEEDS_REVIEW,
  neighbour,
  position,
  removeNode,
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
  const total = countNodes(flow)
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
      change(removeNode(flow, id))
      setFocusId(neighbour(flow, id) ?? 'add')
    } else setFocusId(id)
    setEditing(null)
    setFresh(null)
  }

  function remove(id: string) {
    const node = findNode(flow, id)
    const kind = node ? KIND_LABEL[node.kind].toLowerCase() : 'item'
    onChange(removeNode(flow, id))
    setUndo({ id, label: `${kind} “${node?.label || 'unnamed'}”`, flow })
    setNote(`Deleted the ${kind}.`)
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

  // A row being added or edited stays in view, even when filtered.
  const visible = (n: FlowNode) => !reviewOnly || flagged(n) || [n.id, ...allIds(n.children)].some((id) => id === editing || id === fresh)

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // A render function, not a component: a component defined in here would
  // be a new type each render, remounting the tree and losing the open form.
  function row(node: FlowNode, depth: number) {
    const open = !collapsed.has(node.id)
    const hasKids = node.children.length > 0
    const { first, last } = position(flow, node.id)
    const conf = node.confidence !== undefined ? confidenceLabel(node.confidence) : null
    const err = errors[node.id]
    const listId = `kids-${node.id}`
    const Title = node.kind === 'intent' ? 'h3' : 'p'
    const picked = showDiagram && selected === node.id
    return (
      <li key={node.id} className={`flow__item flow__item--${node.kind}`}>
        <div
          className={['flow__row', err && 'flow__row--error', editing === node.id && 'is-editing', picked && 'is-selected'].filter(Boolean).join(' ')}
          onClick={showDiagram ? () => setSelected(node.id) : undefined}
        >
          {hasKids ? (
            <button
              type="button"
              className="flow__toggle"
              aria-expanded={open}
              aria-controls={listId}
              aria-label={`Steps in ${node.label || 'unnamed'}`}
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
              <span className={`flow__kind flow__kind--${node.kind}`}>{KIND_LABEL[node.kind]}</span>
              <span className="flow__label" id={`node-${node.id}`} tabIndex={-1} data-node-focus={node.id} aria-current={picked ? 'true' : undefined}>
                {node.label || <em className="flow__unnamed">Unnamed</em>}
              </span>
            </Title>
            {node.kind === 'step' && node.say && <p className="flow__say">“{node.say}”</p>}
            {node.kind === 'branch' && node.condition && <p className="flow__say">When: {node.condition}</p>}
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
            </p>
            {err && <p className="field__error flow__error">{err}</p>}
          </div>
          {!readOnly && (
            <div className="flow__actions">
              <button
                type="button"
                className="flow__act"
                aria-label={`Edit ${node.label || 'unnamed'}`}
                aria-expanded={editing === node.id}
                onClick={() => setEditing(editing === node.id ? null : node.id)}
              >
                Edit
              </button>
              {node.kind !== 'step' && (
                <button type="button" className="flow__act" aria-label={`Add step to ${node.label || 'unnamed'}`} onClick={() => add(node.id, 'step')}>
                  Add step
                </button>
              )}
              {node.kind === 'intent' && (
                <button type="button" className="flow__act" aria-label={`Add branch to ${node.label || 'unnamed'}`} onClick={() => add(node.id, 'branch')}>
                  Add branch
                </button>
              )}
              <span className="flow__moves">
                <button type="button" className="flow__act flow__act--icon" aria-label={`Move ${node.label || 'unnamed'} up`} title="Move up" data-node-focus={`move:${node.id}:-1`} disabled={first} onClick={() => move(node, -1)}>
                  ↑
                </button>
                <button type="button" className="flow__act flow__act--icon" aria-label={`Move ${node.label || 'unnamed'} down`} title="Move down" data-node-focus={`move:${node.id}:1`} disabled={last} onClick={() => move(node, 1)}>
                  ↓
                </button>
              </span>
            </div>
          )}
        </div>

        {editing === node.id && !readOnly && (
          <NodeForm
            node={node}
            intents={depth === 0 ? flow.filter((n) => n.id !== node.id) : []}
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
            onDelete={() => remove(node.id)}
            onCancel={() => cancelEdit(node.id)}
          />
        )}

        {hasKids && open && (
          <ul className="flow__kids" id={listId}>
            {node.children.map((c) => row(c, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

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
            intents={flow.some((n) => n.id === editingNode.id) ? flow.filter((n) => n.id !== editingNode.id) : []}
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
            onDelete={() => remove(editingNode.id)}
            onCancel={() => cancelEdit(editingNode.id)}
          />
        </div>
      )}
      {view === 'diagram' && !editingNode && (
        <NodeDetail
          node={picked}
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
          {intents} {intents === 1 ? 'intent' : 'intents'}, {total - intents} steps and branches.{' '}
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
        confirmLabel={`Delete ${findNode(flow, confirmDelete ?? '') ? kindWord(findNode(flow, confirmDelete ?? '')!) : 'item'}`}
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
        <p>
          Its {countNodes(findNode(flow, confirmDelete ?? '')?.children ?? [])} nested {countNodes(findNode(flow, confirmDelete ?? '')?.children ?? []) === 1 ? 'item goes' : 'items go'} too.
        </p>
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
function NodeDetail({ node, error, onShowCalls }: { node: FlowNode | null; error?: string; onShowCalls?(node: FlowNode): void }) {
  if (!node) return <p className="flow__detail flow__detail--empty">Select a step to see what the agent says and where it came from.</p>
  const conf = node.confidence !== undefined ? confidenceLabel(node.confidence) : null
  const calls = node.sourceCallIds.length
  return (
    <section className="flow__detail" aria-label={`About ${node.label || 'unnamed'}`}>
      <p className="flow__title">
        <span className={`flow__kind flow__kind--${node.kind}`}>{KIND_LABEL[node.kind]}</span>
        <span className="flow__label">{node.label || <em className="flow__unnamed">Unnamed</em>}</span>
      </p>
      {node.kind === 'step' && node.say && <p className="flow__say">“{node.say}”</p>}
      {node.kind === 'branch' && node.condition && <p className="flow__say">When: {node.condition}</p>}
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

function NodeForm({
  node,
  intents,
  onSave,
  onMerge,
  onDelete,
  onCancel,
}: {
  node: FlowNode
  /** Other intents this one can merge into; empty for steps and branches. */
  intents: FlowNode[]
  onSave(patch: Partial<FlowNode>): void
  onMerge(into: string): void
  onDelete(): void
  onCancel(): void
}) {
  const id = useId()
  const [label, setLabel] = useState(node.label)
  const [say, setSay] = useState(node.say ?? '')
  const [condition, setCondition] = useState(node.condition ?? '')
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
    onSave({ label: label.trim(), say: node.kind === 'step' ? say.trim() : undefined, condition: node.kind === 'branch' ? condition.trim() : undefined })
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
      <div className="flow__form-actions">
        <Button type="submit" variant="plum" size="sm">
          Save
        </Button>
        <Button variant="line" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <button type="button" className="btn-text flow__delete" onClick={() => (node.children.length ? setConfirm('delete') : onDelete())}>
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
        confirmLabel={`Delete ${kind}`}
        danger
        onConfirm={() => {
          setConfirm(null)
          onDelete()
        }}
        onCancel={() => setConfirm(null)}
      >
        <p>Its {node.children.length} nested {node.children.length === 1 ? 'item goes' : 'items go'} too.</p>
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
          The steps of “{node.label}” move to the end of “{intents.find((n) => n.id === into)?.label}”, and “{node.label}” goes.
        </p>
      </ConfirmDialog>
    </form>
  )
}
