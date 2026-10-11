import { useCallback, useRef, useState } from 'react'

/**
 * Error display for a form. A field shows its error once it has been left
 * (blur) or after the first submit, never while the person is still typing
 * into it for the first time. `check()` reveals everything and moves focus
 * to the first invalid field, in the order the errors object lists them.
 */
export function useFormErrors<K extends string>(errors: Record<K, string | null>) {
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const refs = useRef<Partial<Record<K, HTMLInputElement | null>>>({})

  const shown = (k: K) => (submitted || touched[k] ? errors[k] : null)
  const blur = (k: K) => () => setTouched((t) => (t[k] ? t : { ...t, [k]: true }))
  const ref = useCallback(
    (k: K) => (el: HTMLInputElement | null) => {
      refs.current[k] = el
    },
    [],
  )

  const check = () => {
    setSubmitted(true)
    const first = (Object.keys(errors) as K[]).find((k) => errors[k])
    if (first) {
      refs.current[first]?.focus()
      return false
    }
    return true
  }

  const focus = (k: K) => refs.current[k]?.focus()

  return { shown, blur, ref, check, focus }
}
