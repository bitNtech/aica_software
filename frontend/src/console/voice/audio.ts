/**
 * The browser's side of a voice call: the microphone as pcm16 frames, and
 * the agent's audio played in order with a small jitter buffer that can be
 * dropped at once (barge-in). One AudioContext at its native rate serves
 * both, so nothing is resampled here (the voice server accepts 44.1 and 48
 * kHz). Echo cancellation is on: without it the agent hears itself.
 */
import { FrameBuffer, pcm16ToFloat } from './pcm'

/** Runs on the audio thread: floats → pcm16, plus a level for the meter. */
const CAPTURE_WORKLET = `
class AicaCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length) {
      const out = new Int16Array(ch.length)
      let peak = 0
      for (let i = 0; i < ch.length; i++) {
        const v = Math.max(-1, Math.min(1, ch[i]))
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
        const a = v < 0 ? -v : v
        if (a > peak) peak = a
      }
      this.port.postMessage({ pcm: out.buffer, peak }, [out.buffer])
    }
    return true
  }
}
registerProcessor('aica-capture', AicaCapture)
`

/** The protocol asks for frames of 20–100 ms; 40 ms keeps latency low. */
const FRAME_MS = 40
/** Played audio starts this far ahead, so a late frame doesn't click. */
const JITTER_S = 0.12

export interface Capture {
  setMuted(muted: boolean): void
  stop(): void
}

export function micSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined' && window.isSecureContext
}

/** Starts the microphone. `onFrame` gets pcm16 at ctx.sampleRate. */
export async function startCapture(ctx: AudioContext, onFrame: (pcm: ArrayBuffer) => void, onLevel?: (peak: number) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const node = new AudioWorkletNode(ctx, 'aica-capture')
  const frames = new FrameBuffer(Math.round((ctx.sampleRate * FRAME_MS) / 1000))
  let muted = false
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
    onLevel?.(muted ? 0 : e.data.peak)
    if (muted) return
    const frame = frames.push(new Int16Array(e.data.pcm))
    if (frame) onFrame(frame.buffer as ArrayBuffer)
  }
  const source = ctx.createMediaStreamSource(stream)
  source.connect(node)
  return {
    setMuted(m) {
      muted = m
      for (const t of stream.getAudioTracks()) t.enabled = !m
    },
    stop() {
      node.port.onmessage = null
      source.disconnect()
      node.disconnect()
      for (const t of stream.getTracks()) t.stop()
    },
  }
}

/** Plays pcm16 chunks in order per channel; `clear` drops everything queued. */
export class Player {
  private heads = new Map<string, number>()
  private starts = new Map<string, number>()
  private sources = new Set<AudioBufferSourceNode>()
  private readonly out: GainNode
  private readonly ctx: AudioContext
  private readonly rate: number

  constructor(ctx: AudioContext, rate = ctx.sampleRate) {
    this.ctx = ctx
    this.rate = rate
    this.out = ctx.createGain()
    this.out.connect(ctx.destination)
  }

  play(pcm: ArrayBuffer, channel = 'main'): void {
    const samples = pcm16ToFloat(pcm)
    if (!samples.length) return
    const buf = this.ctx.createBuffer(1, samples.length, this.rate)
    buf.getChannelData(0).set(samples)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.out)
    const now = this.ctx.currentTime
    const head = this.heads.get(channel) ?? 0
    const at = head > now ? head : now + JITTER_S
    if (!this.starts.has(channel)) this.starts.set(channel, at)
    src.start(at)
    this.heads.set(channel, at + buf.duration)
    this.sources.add(src)
    src.onended = () => this.sources.delete(src)
  }

  /** Stops and forgets everything queued (the caller interrupted). */
  clear(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already ended
      }
    }
    this.sources.clear()
    this.heads.clear()
    this.starts.clear()
  }

  /** How much of the current reply has actually been heard, in ms. */
  playedMs(channel = 'main'): number {
    const start = this.starts.get(channel)
    const head = this.heads.get(channel)
    if (start === undefined || head === undefined) return 0
    return Math.max(0, (Math.min(this.ctx.currentTime, head) - start) * 1000)
  }

  /** Everything queued has played. */
  drained(channel = 'main'): boolean {
    const head = this.heads.get(channel)
    return head === undefined || this.ctx.currentTime >= head
  }

  /** A new reply starts counting from its first sound. */
  newReply(channel = 'main'): void {
    this.starts.delete(channel)
  }

  setVolume(v: number): void {
    this.out.gain.value = v
  }

  close(): void {
    this.clear()
    this.out.disconnect()
  }
}
