import { useEffect, useRef, useState, type RefObject } from 'react'

export const prefersLessMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** True once the element has come on screen (and stays true). */
export function useSeen<T extends Element>(rootMargin = '0px 0px -12% 0px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (!('IntersectionObserver' in window)) return setSeen(true)
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setSeen(true)
        io.disconnect()
      }
    }, { rootMargin, threshold: 0.12 })
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin, seen])
  return [ref, seen]
}

/** Whether the element is on screen right now. Used to park animation loops. */
export function useOnScreen<T extends Element>(rootMargin = '100px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin])
  return [ref, on]
}

/**
 * How far the page has scrolled through a tall section, 0 → 1. 'sticky': 0 when
 * its top reaches the top of the screen, 1 when its bottom reaches the bottom.
 * 'center': how much of it has passed the middle of the screen. This is
 * what drives the sticky, scroll-told sections. One rAF-coalesced read per frame.
 */
export function useScrollProgress<T extends HTMLElement>(anchor: 'sticky' | 'center' = 'sticky'): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [p, setP] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const measure = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      let v: number
      if (anchor === 'center') {
        /* How much of the element has passed the middle of the screen. */
        v = Math.min(1, Math.max(0, (window.innerHeight * 0.5 - r.top) / r.height))
      } else {
        const travel = r.height - window.innerHeight
        v = travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : r.top < 0 ? 1 : 0
      }
      setP((old) => (Math.abs(old - v) > 0.001 ? v : old))
    }
    const on = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [anchor])
  return [ref, p]
}

/** A 1 Hz clock that only ticks while `running`. */
export function useTicker(running: boolean, ms = 1000) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => {
      if (!document.hidden) setN((v) => v + 1)
    }, ms)
    return () => window.clearInterval(t)
  }, [running, ms])
  return n
}

export const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
