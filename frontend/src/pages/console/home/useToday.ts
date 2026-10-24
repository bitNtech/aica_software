import { useCallback, useRef } from 'react'
import { can, canOpen } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Appointment, Callback, Desk, Handoff, LiveCall } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { localDay } from '../../../lib/time'
import { useLiveData } from '../operate/shared'

/** One source of today's data: what it last held, and why the last check failed, if it did. */
export interface Slice<T> {
  data: T | null
  error: unknown
}

/** Each source is null when this person can't see it (and so is never asked for). */
export interface Today {
  live: Slice<LiveCall[]> | null
  handoffs: Slice<Handoff[]> | null
  callbacks: Slice<Callback[]> | null
  appointments: Slice<Appointment[]> | null
  desk: Slice<Desk> | null
}

const EVERY_MS = 15_000

/**
 * What Home needs about today, kept fresh every 15 seconds. Each source is
 * fetched on its own and fails on its own: a callbacks error never blanks the
 * waiting callers, and a failed refresh keeps that source's last data (with
 * `error` set, so its block can say it is old). The waiting list is asked for
 * only by people who take calls (the server refuses everyone else); the desk
 * only when `wantDesk` and the person may open it.
 */
export function useToday({ wantDesk }: { wantDesk: boolean }) {
  const { org, access } = useOrg()
  const client = useConsole()
  const slug = org.orgSlug
  const wantLive = canOpen(access, 'live')
  const wantHandoffs = can(access, 'call.seeWaiting')
  const wantCallbacks = canOpen(access, 'callbacks')
  const wantAppointments = canOpen(access, 'appointments')
  const deskOk = wantDesk && canOpen(access, 'desk')
  const last = useRef<{ slug: string; today: Today } | null>(null)

  const load = useCallback(async (): Promise<Today> => {
    const today = localDay(0)
    const prev = last.current?.slug === slug ? last.current.today : null
    async function slice<T>(wanted: boolean, key: keyof Today, ask: () => Promise<T>): Promise<Slice<T> | null> {
      if (!wanted) return null
      try {
        return { data: await ask(), error: null }
      } catch (error) {
        return { data: ((prev?.[key] as Slice<T> | null | undefined)?.data ?? null) as T | null, error }
      }
    }
    const [live, handoffs, callbacks, appointments, desk] = await Promise.all([
      slice(wantLive, 'live', () => client.listLiveCalls(slug)),
      slice(wantHandoffs, 'handoffs', () => client.listHandoffs(slug)),
      slice(wantCallbacks, 'callbacks', () => client.listCallbacks(slug)),
      slice(wantAppointments, 'appointments', () => client.listAppointments(slug, today, today)),
      slice(deskOk, 'desk', () => client.getDesk(slug)),
    ])
    const next: Today = { live, handoffs, callbacks, appointments, desk }
    last.current = { slug, today: next }
    return next
  }, [client, slug, wantLive, wantHandoffs, wantCallbacks, wantAppointments, deskOk])

  const { data, checkedAt, reload } = useLiveData(load, EVERY_MS)
  return { today: data, checkedAt, reload }
}
