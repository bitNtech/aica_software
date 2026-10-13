import { useRef, useState, type FormEvent } from 'react'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Field'

interface Props {
  items: string[]
  onChange(items: string[]): void
  /** One item, in words: "rule", "topic", "word". */
  noun: string
  /** The add field's label, e.g. "Add a rule". */
  label: string
  placeholder?: string
  /** Shown when the list is empty. */
  empty: string
  max: number
  /** Shortest and longest an item may be. */
  minLength?: number
  maxLength?: number
  /** Too short, in words, e.g. "Write the rule as a short sentence." */
  tooShort?: string
  readOnly?: boolean
}

/**
 * A short list of plain-text items (rules, topics, words): add with Enter,
 * remove each. Used for an agent's rules, topics it refuses and words to
 * listen for.
 */
export function ListEditor({ items, onChange, noun, label, placeholder, empty, max, minLength = 2, maxLength = 160, tooShort, readOnly }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Announced politely after adding or removing. */
  const [note, setNote] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const plural = (n: number) => `${n} ${n === 1 ? noun : `${noun}s`}`
  const Noun = noun[0].toUpperCase() + noun.slice(1)

  function add(e: FormEvent) {
    e.preventDefault()
    const item = text.trim()
    if (item.length < minLength) setError(tooShort ?? `Write the ${noun} first.`)
    else if (item.length > maxLength) setError(`Keep each ${noun} under ${maxLength} characters.`)
    else if (items.some((r) => r.toLowerCase() === item.toLowerCase())) setError(`That ${noun} is already in the list.`)
    else if (items.length >= max) setError(`Up to ${plural(max)}. Remove one first.`)
    else {
      onChange([...items, item])
      setText('')
      setError(null)
      setNote(`${Noun} added. ${plural(items.length + 1)}.`)
      return
    }
    input.current?.focus()
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i))
    setNote(`${Noun} removed. ${plural(items.length - 1)} left.`)
    // Focus stays in the list: the next item's button, else the input.
    requestAnimationFrame(() => {
      const buttons = list.current?.querySelectorAll('button')
      ;(buttons?.[Math.min(i, (buttons?.length ?? 1) - 1)] ?? input.current)?.focus()
    })
  }

  return (
    <div className="rules">
      {items.length > 0 ? (
        <ul className="rules__list" ref={list}>
          {items.map((r, i) => (
            <li key={r} className="rules__item">
              <span>{r}</span>
              {!readOnly && (
                <button type="button" className="btn-text" onClick={() => remove(i)} aria-label={`Remove ${noun}: ${r}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-note">{empty}</p>
      )}
      <p className="sr-only" role="status">
        {note}
      </p>
      {!readOnly && (
        // Its own small form: Enter adds the item.
        <form onSubmit={add} noValidate className="rules__form">
          <TextField
            ref={input}
            label={label}
            value={text}
            placeholder={placeholder}
            error={error}
            onChange={(e) => {
              setText(e.target.value)
              if (error) setError(null)
            }}
          />
          <Button type="submit" variant="line" className="rules__button">
            Add {noun}
          </Button>
        </form>
      )}
    </div>
  )
}
