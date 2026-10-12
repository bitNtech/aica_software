import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { FlowNode, FlowNodeKind } from '../../../console/types'
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
  findParent,
  mergeIntents,
  moveNode,
  position,
  removeNode,
  updateNode,
} from './flowTree'

interface Props {
  flow: FlowNode[]
  onChange(flow: FlowNode[]): void
  /** Node id → what's wrong with it. */
  errors?: Record<string, string>
  readOnly?: boolean
  /** Opens the list of calls a node was seen in. */
  onShowCalls?(node: FlowNode): void
}

const NEEDS_REVIEW = 0.7

/**
 * The conversation flow as an editable outline: intents at the top, their
 * steps and branches nested under them. Each row can be expanded, edited,
 * moved, or given new steps; editing opens a small form under the row.
 */
export function FlowEditor({ flow, onChange, errors = {}, readOnly, onShowCalls }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  /** A node just added: removed again if its form is cancelled while empty. */
  const [fresh, setFresh] = useState<string | null>(null)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)

  // After a move or delete, put focus back on a sensible row.
  useEffect(() => {
    if (!focusId) return
    document.querySelector<HTMLElement>(`[data-node-focus="${focusId}"]`)?.focus()
    setFocusId(null)
  }, [focusId, flow])

  const intents = flow.length
  const total = countNodes(flow)
  const review = flow.filter((n) => (n.confidence ?? 1) < NEEDS_REVIEW || errors[n.id] || allIds(n.children).some((c) => errors[c])).length

  function add(parentId: string | null, kind: FlowNodeKind) {
    const node = blankNode(kind)
    onChange(addNode(flow, parentId, node))
    if (parentId) setCollapsed((c) => new Set([...c].filter((x) => x !== parentId)))
    setEditing(node.id)
    setFresh(node.id)
  }

  function cancelEdit(id: string) {
    if (fresh === id) {
      const parent = findParent(flow, id)
      onChange(removeNode(flow, id))
      setFocusId(parent ? parent.id : null)
    } else setFocusId(id)
    setEditing(null)
    setFresh(null)
  }

  function remove(id: string) {
    const parent = findParent(flow, id)
    onChange(removeNode(flow, id))
    setEditing(null)
    setFresh(null)
    setFocusId(parent ? parent.id : null)
  }

  const visible = (n: FlowNode) => !reviewOnly || (n.confidence ?? 1) < NEEDS_REVIEW || !!errors[n.id] || allIds(n.children).some((c) => errors[c])

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
    return (
      <li key={node.id} className={`flow__item flow__item--${node.kind}`}>
        <div className={['flow__row', err && 'flow__row--error', editing === node.id && 'is-editing'].filter(Boolean).join(' ')}>
          {hasKids ? (
            <button
              type="button"
              className="flow__toggle"
              aria-expanded={open}
              aria-controls={listId}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label || 'unnamed'}`}
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
            <p className="flow__title">
              <span className={`flow__kind flow__kind--${node.kind}`}>{KIND_LABEL[node.kind]}</span>
              <span className="flow__label" tabIndex={-1} data-node-focus={node.id}>
                {node.label || <em className="flow__unnamed">Unnamed</em>}
              </span>
            </p>
            {node.kind === 'step' && node.say && <p className="flow__say">“{node.say}”</p>}
            {node.kind === 'branch' && node.condition && <p className="flow__say">When: {node.condition}</p>}
            <p className="flow__meta">
              {conf && <span className={`conf conf--${conf.level}`}>{conf.text}</span>}
              {node.sourceCallIds.length > 0 && onShowCalls && (
                <button type="button" className="btn-text flow__calls" onClick={() => onShowCalls(node)}>
                  Seen in {node.sourceCallIds.length} {node.sourceCallIds.length === 1 ? 'call' : 'calls'}
                  <span className="sr-only">: {node.label}</span>
                </button>
              )}
              {node.sourceCallIds.length === 0 && node.confidence === undefined && <span className="flow__added">Added by hand</span>}
            </p>
            {err && <p className="field__error flow__error">{err}</p>}
          </div>
          {!readOnly && (
            <div className="flow__actions">
              <button type="button" className="flow__act" onClick={() => setEditing(editing === node.id ? null : node.id)} aria-expanded={editing === node.id}>
                Edit<span className="sr-only"> {node.label}</span>
              </button>
              {node.kind !== 'step' && (
                <button type="button" className="flow__act" onClick={() => add(node.id, 'step')}>
                  Add step<span className="sr-only"> to {node.label}</span>
                </button>
              )}
              {node.kind === 'intent' && (
                <button type="button" className="flow__act" onClick={() => add(node.id, 'branch')}>
                  Add branch<span className="sr-only"> to {node.label}</span>
                </button>
              )}
              <button
                type="button"
                className="flow__act flow__act--icon"
                aria-label={`Move ${node.label || 'unnamed'} up`}
                disabled={first}
                onClick={() => {
                  onChange(moveNode(flow, node.id, -1))
                  setFocusId(node.id)
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="flow__act flow__act--icon"
                aria-label={`Move ${node.label || 'unnamed'} down`}
                disabled={last}
                onClick={() => {
                  onChange(moveNode(flow, node.id, 1))
                  setFocusId(node.id)
                }}
              >
                ↓
              </button>
            </div>
          )}
        </div>

        {editing === node.id && !readOnly && (
          <NodeForm
            node={node}
            intents={depth === 0 ? flow.filter((n) => n.id !== node.id) : []}
            onSave={(patch) => {
              onChange(updateNode(flow, node.id, patch))
              setEditing(null)
              setFresh(null)
              setFocusId(node.id)
            }}
            onMerge={(into) => {
              onChange(mergeIntents(flow, node.id, into))
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

  return (
    <div className="flow">
      <div className="flow__bar">
        <p className="flow__summary">
          {intents} {intents === 1 ? 'intent' : 'intents'}, {total - intents} steps and branches.{' '}
          {review > 0 ? <strong>{review} need a look.</strong> : 'Nothing flagged.'}
        </p>
        <div className="flow__tools">
          <Switch label="Only what needs a look" checked={reviewOnly} onChange={setReviewOnly} />
          <button type="button" className="btn-text" onClick={() => setCollapsed(new Set())}>
            Expand all
          </button>
          <button type="button" className="btn-text" onClick={() => setCollapsed(new Set(flow.map((n) => n.id)))}>
            Collapse all
          </button>
        </div>
      </div>

      {shown.length > 0 ? (
        <ul className="flow__tree" aria-label="Conversation flow">
          {shown.map((n) => row(n, 0))}
        </ul>
      ) : (
        <p className="empty-note">{reviewOnly ? 'Nothing needs a look.' : 'No intents yet. Add the first conversation the agent should handle.'}</p>
      )}

      {!readOnly && (
        <div>
          <Button variant="line" size="sm" onClick={() => add(null, 'intent')}>
            Add intent
          </Button>
        </div>
      )}
    </div>
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
