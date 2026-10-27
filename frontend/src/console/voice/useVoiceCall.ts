import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { asAuthError } from '../../auth/types'
import type { OperatorTicket, VoiceTicket } from '../types'
import { micSupported } from './audio'
import { callReducer, initialCall, type CallState } from './callState'
import { micMessage } from './closeCodes'
import { OperatorCall, VoiceCall } from './sockets'

export interface VoiceCallControls {
  state: CallState
  /** Microphone level 0…1 while live, for a meter. */
  level: number
  muted: boolean
  warnings: string[]
  /** Gets a ticket from the AICA API, then opens the microphone and the call. */
  start(): Promise<void>
  hangUp(): void
  setMuted(m: boolean): void
  say(text: string): void
  interrupt(): void
  supported: boolean
}

/** A test call with an agent, from `getTicket` (the API mints the token). */
export function useVoiceCall(getTicket: () => Promise<VoiceTicket>): VoiceCallControls {
  const [state, dispatch] = useReducer(callReducer, initialCall)
  const [level, setLevel] = useState(0)
  const [muted, setMutedState] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const call = useRef<VoiceCall | null>(null)

  // Leaving the page hangs up.
  useEffect(() => () => call.current?.close(), [])

  const start = useCallback(async () => {
    if (call.current) return
    dispatch({ type: 'connecting' })
    setMutedState(false)
    let ticket: VoiceTicket
    try {
      ticket = await getTicket()
    } catch (err) {
      dispatch({ type: 'failed', message: asAuthError(err).message })
      return
    }
    setWarnings(ticket.warnings ?? [])
    const c = new VoiceCall(
      ticket,
      (event) => dispatch({ type: 'event', event }),
      (message) => {
        call.current = null
        setLevel(0)
        dispatch({ type: 'closed', message })
      },
      (p) => setLevel(p),
    )
    call.current = c
    try {
      await c.start()
    } catch (err) {
      call.current = null
      // getUserMedia fails with a DOMException; the socket with a plain Error.
      dispatch({ type: 'failed', message: err instanceof DOMException ? micMessage(err) : 'The voice server didn’t answer. Try again in a minute.' })
    }
  }, [getTicket])

  return {
    state,
    level,
    muted,
    warnings,
    start,
    supported: micSupported(),
    hangUp: () => {
      dispatch({ type: 'ending' })
      call.current?.hangUp()
    },
    setMuted: (m) => {
      setMutedState(m)
      call.current?.setMuted(m)
    },
    say: (text) => {
      if (!call.current || !text.trim()) return
      call.current.say(text.trim())
      dispatch({ type: 'typed', text: text.trim() })
    },
    interrupt: () => call.current?.interrupt(),
  }
}

export interface OperatorControls {
  state: CallState
  level: number
  muted: boolean
  mode: 'listen' | 'takeover' | null
  join(mode: 'listen' | 'takeover'): Promise<void>
  takeOver(): Promise<void>
  release(resumeAi: boolean): void
  say(text: string): void
  interrupt(): void
  setMuted(m: boolean): void
  hangUp(): void
  leave(): void
  supported: boolean
}

/** Listening in on, or taking over, a live call. */
export function useOperatorCall(getTicket: (mode: 'listen' | 'takeover') => Promise<OperatorTicket>): OperatorControls {
  const [state, dispatch] = useReducer(callReducer, initialCall)
  const [level, setLevel] = useState(0)
  const [muted, setMutedState] = useState(false)
  const [mode, setMode] = useState<'listen' | 'takeover' | null>(null)
  const call = useRef<OperatorCall | null>(null)

  useEffect(() => () => call.current?.close(), [])

  const join = useCallback(
    async (m: 'listen' | 'takeover') => {
      if (call.current) return
      dispatch({ type: 'connecting' })
      let ticket: OperatorTicket
      try {
        ticket = await getTicket(m)
      } catch (err) {
        dispatch({ type: 'failed', message: asAuthError(err).message })
        return
      }
      const c = new OperatorCall(
        ticket,
        (event) => dispatch({ type: 'event', event }),
        (message) => {
          call.current = null
          setMode(null)
          setLevel(0)
          dispatch({ type: 'closed', message })
        },
        (p) => setLevel(p),
      )
      call.current = c
      try {
        await c.start()
        dispatch({ type: 'event', event: { type: 'operator.joined' } })
        setMode(c.mode)
      } catch (err) {
        call.current = null
        dispatch({ type: 'failed', message: err instanceof DOMException ? micMessage(err) : err instanceof Error && err.message && err.message !== 'socket' && err.message !== 'timeout' ? err.message : 'Couldn’t join the call. It may have just ended.' })
      }
    },
    [getTicket],
  )

  return {
    state,
    level,
    muted,
    mode,
    join,
    supported: micSupported(),
    takeOver: async () => {
      try {
        await call.current?.takeOver()
        setMode('takeover')
      } catch (err) {
        dispatch({ type: 'event', event: { type: 'error', error: { message: micMessage(err) } } })
      }
    },
    release: (resumeAi) => {
      call.current?.release(resumeAi)
      setMode('listen')
    },
    say: (text) => {
      if (text.trim()) call.current?.say(text.trim())
    },
    interrupt: () => call.current?.interrupt(),
    setMuted: (m) => {
      setMutedState(m)
      call.current?.setMuted(m)
    },
    hangUp: () => {
      dispatch({ type: 'ending' })
      call.current?.hangUp()
    },
    leave: () => call.current?.close(),
  }
}
