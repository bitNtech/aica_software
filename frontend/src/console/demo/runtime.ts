import { AuthError } from '../../auth/types'

/** Shared plumbing for the demo console client. */

export const DAY = 864e5
export const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
export const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString()

/** A simulated round trip; fails like the network would when offline. */
export function makeWait(latency: number) {
  return () =>
    new Promise<void>((resolve, reject) => {
      const ms = latency ? latency * (0.8 + Math.random() * 0.5) : 0
      setTimeout(() => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          reject(new AuthError('network', "We couldn't reach AICA. Check your connection and try again."))
        } else resolve()
      }, ms)
    })
}

/** Callers get copies, so editing what a page holds never edits the store
 * behind its back (as with a real API). */
export const copy = <T,>(v: T): T => structuredClone(v)

let n = 0
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(n++).toString(36)}`
