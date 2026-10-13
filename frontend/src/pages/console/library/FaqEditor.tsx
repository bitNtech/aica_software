import { useId, useRef, useState } from 'react'
import type { FaqEntry } from '../../../console/types'
import { Button } from '../../../components/ui/Button'
import { TextAreaField, TextField } from '../../../components/ui/Field'

export const MAX_FAQ = 60

/** Questions and answers for an FAQ source, edited in place. */
export function FaqEditor({ entries, onChange, error }: { entries: FaqEntry[]; onChange(next: FaqEntry[]): void; error?: string | null }) {
  const list = useRef<HTMLOListElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const errorId = useId()
  const [note, setNote] = useState('')
  const set = (i: number, patch: Partial<FaqEntry>) => onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  function add() {
    onChange([...entries, { q: '', a: '' }])
    // Focus the new question once it's there; that says it was added.
    requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>('li:last-child input')?.focus())
  }

  function remove(i: number) {
    onChange(entries.filter((_, j) => j !== i))
    setNote(`Question ${i + 1} removed.`)
    requestAnimationFrame(() => {
      const items = list.current?.querySelectorAll<HTMLInputElement>('li input')
      ;(items?.[Math.min(i, (items?.length ?? 1) - 1)] ?? addButton.current)?.focus()
    })
  }

  return (
    <div className="faq">
      {entries.length > 0 && (
        <ol className="faq__list" ref={list}>
          {entries.map((e, i) => (
            // Index keys: entries have no ids, and only the last is added or any removed.
            <li key={i} className="faq__item">
              {/* The list's error sits on its first question, so focusing that field reads it. */}
              <TextField label={`Question ${i + 1}`} value={e.q} maxLength={200} error={i === 0 ? error : undefined} onChange={(ev) => set(i, { q: ev.target.value })} />
              <TextAreaField label={`Answer ${i + 1}`} rows={2} value={e.a} maxLength={800} onChange={(ev) => set(i, { a: ev.target.value })} />
              <div>
                <button type="button" className="btn-text lib-row__remove" onClick={() => remove(i)}>
                  Remove question {i + 1}
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {error && entries.length === 0 && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
      <p className="sr-only" role="status">
        {note}
      </p>
      <div>
        <Button
          ref={addButton}
          variant="line"
          size="sm"
          className="faq__add"
          disabled={entries.length >= MAX_FAQ}
          aria-describedby={error && entries.length === 0 ? errorId : undefined}
          onClick={add}
        >
          Add a question
        </Button>
      </div>
    </div>
  )
}
