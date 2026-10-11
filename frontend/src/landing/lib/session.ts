import { useEffect, useState } from 'react'

/**
 * Whether the visitor already has an AICA console session, so the page can
 * offer "Open console" instead of "Sign in". Asks the console's own backend
 * (GET /api/auth/session, same origin, HttpOnly cookie) once per page load,
 * however many components want to know; nothing about the user is kept here.
 * Starts as false on the server and in the first client render, so the
 * prerendered HTML and hydration agree, and stays false if the API can't be
 * reached in time.
 */
let check: Promise<boolean> | null = null

function hasSession(): Promise<boolean> {
  check ??= (async () => {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctrl.signal })
      return res.ok
    } catch {
      return false
    } finally {
      window.clearTimeout(timer)
    }
  })()
  return check
}

export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    let live = true
    hasSession().then((yes) => { if (live) setSignedIn(yes) })
    return () => { live = false }
  }, [])

  return signedIn
}
