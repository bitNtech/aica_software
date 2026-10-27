/**
 * The two browser sockets of the voice server (docs/orchestrator-contract.md
 * §Protocol). Both authenticate with a short-lived token from the AICA API
 * in the `bearer.<token>` subprotocol: no key ever reaches the browser.
 *
 * - VoiceCall: a test call with an agent (aica.voice.v1). Sends the
 *   microphone, plays the agent, flushes on `audio.clear`, and reports
 *   playback (`playback.mark` / `playback.done`) so an interrupted reply is
 *   cut where the caller stopped hearing it.
 * - OperatorCall: a person listening in on, or taking over, a live call.
 *   Audio arrives with a one-byte channel prefix (caller or agent).
 */
import type { OperatorTicket, VoiceTicket } from '../types'
import { Player, startCapture, type Capture } from './audio'
import { closeMessage } from './closeCodes'
import { splitChannel } from './pcm'

type Listener = (event: Record<string, unknown>) => void
type Closed = (message: string | null) => void
/** For tests: a WebSocket and AudioContext stand-in. */
export interface VoiceDeps {
  WebSocket?: typeof WebSocket
  AudioContext?: typeof AudioContext
  capture?: typeof startCapture
}

const MARK_EVERY_MS = 300
const START_TIMEOUT_MS = 10_000

export class VoiceCall {
  private ws: WebSocket | null = null
  private ctx: AudioContext | null = null
  private player: Player | null = null
  private mic: Capture | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private current: string | null = null
  private done = new Set<string>()
  private generated = new Set<string>()
  private closed = false

  private readonly ticket: VoiceTicket
  private readonly onEvent: Listener
  private readonly onClosed: Closed
  private readonly onLevel?: (peak: number) => void
  private readonly deps: VoiceDeps

  constructor(ticket: VoiceTicket, onEvent: Listener, onClosed: Closed, onLevel?: (peak: number) => void, deps: VoiceDeps = {}) {
    this.ticket = ticket
    this.onEvent = onEvent
    this.onClosed = onClosed
    this.onLevel = onLevel
    this.deps = deps
  }

  /** Opens the microphone and the socket. Needs a click first (browser rules). */
  async start(): Promise<void> {
    const Ctx = this.deps.AudioContext ?? window.AudioContext
    this.ctx = new Ctx()
    await this.ctx.resume?.()
    const rate = this.ctx.sampleRate
    this.player = new Player(this.ctx, rate)
    const Ws = this.deps.WebSocket ?? WebSocket
    const ws = new Ws(`${this.ticket.wsBase}/v1/voice/ws`, ['aica.voice.v1', `bearer.${this.ticket.token}`])
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    const opened = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), START_TIMEOUT_MS)
      ws.onopen = () => {
        clearTimeout(t)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(t)
        reject(new Error('socket'))
      }
    })
    ws.onmessage = (m) => this.message(m.data)
    ws.onclose = (e) => this.finish(closeMessage(e.code))
    try {
      // The microphone first: if it's blocked, no call is opened.
      this.mic = await (this.deps.capture ?? startCapture)(this.ctx, (pcm) => this.ws?.readyState === 1 && this.ws.send(pcm), this.onLevel)
      await opened
    } catch (err) {
      this.close()
      throw err
    }
    ws.send(
      JSON.stringify({
        type: 'session.start',
        voice_agent_id: this.ticket.voiceAgentId,
        input_audio: { encoding: 'pcm16', sample_rate: rate },
        output_audio: { encoding: 'pcm16', sample_rate: rate },
        turn_detection: 'server_vad',
        client_tools: false,
        greeting: true,
        channel: 'web',
        metadata: this.ticket.metadata,
      }),
    )
    this.timer = setInterval(() => this.report(), MARK_EVERY_MS)
  }

  private message(data: unknown) {
    if (typeof data !== 'string') {
      if (data instanceof ArrayBuffer) this.player?.play(data)
      return
    }
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(data)
    } catch {
      return
    }
    const rid = typeof ev.response_id === 'string' ? ev.response_id : null
    if (ev.type === 'response.audio.started' && rid) {
      this.current = rid
      this.player?.newReply()
    }
    if (ev.type === 'response.done' && rid) this.generated.add(rid)
    // Barge-in: drop what's queued now, before anything else.
    if (ev.type === 'audio.clear') this.player?.clear()
    if (ev.type === 'response.audio.delta' && typeof ev.audio === 'string') {
      this.player?.play(Uint8Array.from(atob(ev.audio), (c) => c.charCodeAt(0)).buffer)
      return
    }
    this.onEvent(ev)
  }

  /** How much of the reply has been heard; and when it finished playing. */
  private report() {
    const id = this.current
    if (!id || !this.player || this.ws?.readyState !== 1 || this.done.has(id)) return
    this.send({ type: 'playback.mark', response_id: id, played_ms: Math.round(this.player.playedMs()) })
    if (this.generated.has(id) && this.player.drained()) {
      this.done.add(id)
      this.send({ type: 'playback.done', response_id: id })
    }
  }

  private send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg))
  }

  setMuted(m: boolean) {
    this.mic?.setMuted(m)
  }

  /** A typed caller turn (it interrupts the agent, as speech does). */
  say(text: string) {
    this.send({ type: 'input_text', text })
  }

  interrupt() {
    this.player?.clear()
    this.send({ type: 'response.cancel' })
  }

  hangUp() {
    this.send({ type: 'session.end', reason: 'client_ended' })
    // The server closes after session.ended; don't wait forever.
    setTimeout(() => this.close(), 2000)
  }

  private finish(message: string | null) {
    if (this.closed) return
    this.closed = true
    this.cleanup()
    this.onClosed(message)
  }

  close() {
    if (this.ws && this.ws.readyState <= 1) this.ws.close(1000)
    this.finish(null)
  }

  private cleanup() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.mic?.stop()
    this.mic = null
    this.player?.close()
    this.player = null
    void this.ctx?.close?.()
    this.ctx = null
  }
}

/** A person on a live call. Listen: hear both sides. Take over: the agent
 * pauses and the person speaks, by microphone or typed through the voice. */
export class OperatorCall {
  private ws: WebSocket | null = null
  private ctx: AudioContext | null = null
  private player: Player | null = null
  private mic: Capture | null = null
  private closed = false
  private _mode: 'listen' | 'takeover'

  private readonly ticket: OperatorTicket
  private readonly onEvent: Listener
  private readonly onClosed: Closed
  private readonly onLevel?: (peak: number) => void
  private readonly deps: VoiceDeps

  constructor(ticket: OperatorTicket, onEvent: Listener, onClosed: Closed, onLevel?: (peak: number) => void, deps: VoiceDeps = {}) {
    this.ticket = ticket
    this.onEvent = onEvent
    this.onClosed = onClosed
    this.onLevel = onLevel
    this.deps = deps
    this._mode = ticket.mode
  }

  get mode() {
    return this._mode
  }

  async start(): Promise<void> {
    const Ctx = this.deps.AudioContext ?? window.AudioContext
    this.ctx = new Ctx()
    await this.ctx.resume?.()
    const rate = this.ctx.sampleRate
    this.player = new Player(this.ctx, rate)
    const q = new URLSearchParams({ mode: this.ticket.mode, sample_rate: String(rate), name: this.ticket.name })
    const Ws = this.deps.WebSocket ?? WebSocket
    const ws = new Ws(`${this.ticket.wsBase}${this.ticket.path}?${q}`, ['aica.operator.v1', `bearer.${this.ticket.token}`])
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), START_TIMEOUT_MS)
      ws.onopen = () => {
        clearTimeout(t)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(t)
        reject(new Error('socket'))
      }
      ws.onclose = (e) => {
        clearTimeout(t)
        reject(new Error(closeMessage(e.code) ?? 'closed'))
      }
    })
    ws.onmessage = (m) => this.message(m.data)
    ws.onclose = (e) => this.finish(closeMessage(e.code))
    if (this._mode === 'takeover') await this.takeOver()
  }

  private message(data: unknown) {
    if (data instanceof ArrayBuffer) {
      const { channel, pcm } = splitChannel(data)
      this.player?.play(pcm, channel)
      return
    }
    if (typeof data !== 'string') return
    try {
      const ev = JSON.parse(data) as Record<string, unknown>
      if (ev.type === 'audio.clear') this.player?.clear()
      this.onEvent(ev)
    } catch {
      // not JSON: ignore
    }
  }

  private send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg))
  }

  /** The agent pauses; the microphone goes to the caller. */
  async takeOver() {
    this.send({ type: 'takeover' })
    this._mode = 'takeover'
    if (!this.mic && this.ctx) this.mic = await (this.deps.capture ?? startCapture)(this.ctx, (pcm) => this.ws?.readyState === 1 && this.ws.send(pcm), this.onLevel)
  }

  setMuted(m: boolean) {
    this.mic?.setMuted(m)
  }

  /** Spoken to the caller in the agent's voice. */
  say(text: string) {
    this.send({ type: 'say', text })
  }

  interrupt() {
    this.send({ type: 'interrupt' })
  }

  /** Gives the call back to the agent (or lets it end after playback). */
  release(resumeAi = true) {
    this.send({ type: 'release', resume_ai: resumeAi })
    this.mic?.stop()
    this.mic = null
    this._mode = 'listen'
  }

  hangUp() {
    this.send({ type: 'end', reason: 'ended_by_operator' })
    setTimeout(() => this.close(), 2000)
  }

  private finish(message: string | null) {
    if (this.closed) return
    this.closed = true
    this.mic?.stop()
    this.player?.close()
    void this.ctx?.close?.()
    this.onClosed(message)
  }

  close() {
    if (this.ws && this.ws.readyState <= 1) this.ws.close(1000)
    this.finish(null)
  }
}
