import { afterEach, describe, expect, it, vi } from 'vitest'
import { callReducer, initialCall, type CallState } from '../console/voice/callState'
import { closeMessage, micMessage } from '../console/voice/closeCodes'
import { FrameBuffer, floatToPcm16, pcm16ToFloat, splitChannel } from '../console/voice/pcm'
import { OperatorCall, VoiceCall } from '../console/voice/sockets'
import type { OperatorTicket, VoiceTicket } from '../console/types'

describe('pcm16', () => {
  it('converts both ways, little-endian, clamped', () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 2, -0.5]))
    expect(Array.from(pcm)).toEqual([0, 32767, -32768, 32767, -16384])
    const bytes = new Uint8Array(pcm.buffer)
    expect([bytes[2], bytes[3]]).toEqual([0xff, 0x7f]) // 32767 little-endian
    const back = pcm16ToFloat(pcm.buffer as ArrayBuffer)
    expect(back[1]).toBeCloseTo(1, 3)
    expect(back[2]).toBe(-1)
  })

  it('reads the operator channel byte', () => {
    const f = new Uint8Array([1, 10, 0, 20, 0]).buffer
    expect(splitChannel(f).channel).toBe('caller')
    expect(new Uint8Array(splitChannel(f).pcm)).toEqual(new Uint8Array([10, 0, 20, 0]))
    expect(splitChannel(new Uint8Array([2, 0, 0]).buffer).channel).toBe('agent')
  })

  it('joins small chunks into frames', () => {
    const fb = new FrameBuffer(4)
    expect(fb.push(new Int16Array([1, 2]))).toBeNull()
    expect(Array.from(fb.push(new Int16Array([3, 4, 5]))!)).toEqual([1, 2, 3, 4, 5])
    expect(fb.push(new Int16Array([6]))).toBeNull()
  })
})

const run = (events: Record<string, unknown>[], from: CallState = { ...initialCall, status: 'connecting' }) => events.reduce((s, e) => callReducer(s, { type: 'event', event: e }), from)

describe('the call as the page shows it', () => {
  it('streams the agent, cuts it where the caller interrupted, and ends', () => {
    let s = run([
      { type: 'session.created', session: { id: 'call_1' }, agent: { name: 'Main reception' } },
      { type: 'response.created', response_id: 'r1' },
      { type: 'response.text.delta', response_id: 'r1', delta: 'Vanakkam, ' },
      { type: 'response.text.delta', response_id: 'r1', delta: 'how can I help?' },
      { type: 'response.done', response_id: 'r1', text: 'Vanakkam, how can I help?' },
      { type: 'input_audio.speech_started' },
    ])
    expect(s.status).toBe('live')
    expect(s.sessionId).toBe('call_1')
    expect(s.listening).toBe(true)
    expect(s.turns).toEqual([expect.objectContaining({ id: 'r1', speaker: 'agent', text: 'Vanakkam, how can I help?', streaming: false })])
    s = run(
      [
        { type: 'transcript.final', text: 'I want an appointment', language: 'en' },
        { type: 'response.created', response_id: 'r2' },
        { type: 'response.text.delta', response_id: 'r2', delta: 'Sure, which day suits you best?' },
        { type: 'response.audio.started', response_id: 'r2' },
        { type: 'audio.clear', response_id: 'r2' },
        { type: 'response.interrupted', response_id: 'r2', spoken_text: 'Sure, which' },
        { type: 'response.text.delta', response_id: 'r2', delta: ' ignored' },
        { type: 'response.metrics', first_audio_ms: 912.4, llm_first_text_ms: 540 },
        { type: 'error', error: { source: 'tts', message: 'slow' } },
        { type: 'session.ended', reason: 'client_ended' },
      ],
      s,
    )
    expect(s.turns[1]).toEqual(expect.objectContaining({ speaker: 'caller', text: 'I want an appointment', language: 'en' }))
    expect(s.turns[2]).toEqual(expect.objectContaining({ id: 'r2', text: 'Sure, which', interrupted: true }))
    expect(s.speaking).toBe(false)
    expect(s.metrics).toEqual({ firstAudioMs: 912, llmFirstTextMs: 540, ttsFirstAudioMs: null, asrMs: null })
    expect(s.notice).toBe('The voice had a problem: slow')
    expect(s.status).toBe('ending')
    s = callReducer(s, { type: 'closed', message: null })
    expect(s.status).toBe('ended')
    expect(s.ended).toBe('You ended the call.')
  })

  it('drops an empty reply, follows a handover, and treats a bad close as a failure', () => {
    let s = run([
      { type: 'session.created', session: { id: 'c' } },
      { type: 'response.created', response_id: 'r1' },
      { type: 'response.done', response_id: 'r1', text: '', status: 'requires_action' },
      { type: 'handoff.requested' },
      { type: 'unknown.future.event', x: 1 },
    ])
    expect(s.turns).toEqual([])
    expect(s.handoff).toBe('requested')
    s = callReducer(s, { type: 'closed', message: closeMessage(1013) })
    expect(s.status).toBe('failed')
    expect(s.error).toMatch(/busy/)
  })

  it('words close codes and microphone errors', () => {
    expect(closeMessage(1000)).toBeNull()
    expect(closeMessage(4404)).toMatch(/doesn’t have this agent/)
    expect(closeMessage(4429)).toMatch(/Too many calls/)
    expect(micMessage(new DOMException('no', 'NotAllowedError'))).toMatch(/blocked/)
    expect(micMessage(new DOMException('no', 'NotFoundError'))).toMatch(/No microphone/)
  })
})

// ---- the sockets, with stand-ins for the browser

class FakeWs {
  static last: FakeWs | null = null
  readyState = 0
  binaryType = ''
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onmessage: ((m: { data: unknown }) => void) | null = null
  url: string
  protocols: string[]
  constructor(url: string, protocols: string[]) {
    this.url = url
    this.protocols = protocols
    FakeWs.last = this
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  send(d: unknown) {
    this.sent.push(typeof d === 'string' ? JSON.parse(d) : d)
  }
  close() {
    this.readyState = 3
    this.onclose?.({ code: 1000 })
  }
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data) })
  }
}

class FakeCtx {
  sampleRate = 48000
  currentTime = 0
  destination = {}
  started: number[] = []
  stopped = 0
  resume = async () => undefined
  close = async () => undefined
  createGain() {
    return { connect() {}, disconnect() {}, gain: { value: 1 } }
  }
  createBuffer(_c: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) }
  }
  createBufferSource() {
    const ctx = this
    return { buffer: null, onended: null, connect() {}, start(at: number) { ctx.started.push(at) }, stop() { ctx.stopped++ } }
  }
}

const ticket: VoiceTicket = { token: 'tok_1', expiresAt: null, wsBase: 'wss://orc.test', voiceAgentId: 'vagent_1', warnings: [], metadata: { aica_org: 'arogya', aica_target: 'test' } }

describe('VoiceCall', () => {
  afterEach(() => vi.useRealTimers())

  it('opens with a token, never a key, and starts the session at the native rate', async () => {
    vi.useFakeTimers()
    const events: Record<string, unknown>[] = []
    const capture = vi.fn().mockResolvedValue({ setMuted: vi.fn(), stop: vi.fn() })
    let ctx: FakeCtx | null = null
    const Ctx = class extends FakeCtx {
      constructor() {
        super()
        ctx = this
      }
    }
    const call = new VoiceCall(ticket, (e) => events.push(e), vi.fn(), undefined, { WebSocket: FakeWs as never, AudioContext: Ctx as never, capture })
    const started = call.start()
    await vi.waitFor(() => expect(FakeWs.last).not.toBeNull())
    const ws = FakeWs.last!
    expect(ws.url).toBe('wss://orc.test/v1/voice/ws')
    expect(ws.protocols).toEqual(['aica.voice.v1', 'bearer.tok_1'])
    ws.open()
    await started
    expect(ws.sent[0]).toEqual(expect.objectContaining({ type: 'session.start', voice_agent_id: 'vagent_1', input_audio: { encoding: 'pcm16', sample_rate: 48000 }, output_audio: { encoding: 'pcm16', sample_rate: 48000 }, channel: 'web', metadata: ticket.metadata }))

    // Agent audio plays; audio.clear stops it at once, before the page hears about it.
    ws.receive({ type: 'response.audio.started', response_id: 'r1' })
    ws.receive(new Int16Array(4800).buffer)
    ws.receive(new Int16Array(4800).buffer)
    expect(ctx!.started.length).toBe(2)
    vi.advanceTimersByTime(300)
    expect(ws.sent.at(-1)).toEqual({ type: 'playback.mark', response_id: 'r1', played_ms: 0 })
    ws.receive({ type: 'audio.clear', response_id: 'r1' })
    expect(ctx!.stopped).toBe(2)
    expect(events.map((e) => e.type)).toEqual(['response.audio.started', 'audio.clear'])

    // After the reply has been generated and played out: playback.done, once.
    ws.receive({ type: 'response.audio.started', response_id: 'r2' })
    ws.receive(new Int16Array(480).buffer)
    ws.receive({ type: 'response.done', response_id: 'r2' })
    ctx!.currentTime = 5
    vi.advanceTimersByTime(300)
    vi.advanceTimersByTime(300)
    expect(ws.sent.filter((m) => (m as { type?: string }).type === 'playback.done')).toEqual([{ type: 'playback.done', response_id: 'r2' }])

    call.say('Book for Friday')
    call.interrupt()
    expect(ws.sent.slice(-2)).toEqual([{ type: 'input_text', text: 'Book for Friday' }, { type: 'response.cancel' }])
    call.close()
    expect(ws.readyState).toBe(3)
  })

  it('opens no call when the microphone is blocked', async () => {
    const capture = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const closed = vi.fn()
    const call = new VoiceCall(ticket, vi.fn(), closed, undefined, { WebSocket: FakeWs as never, AudioContext: FakeCtx as never, capture })
    await expect(call.start()).rejects.toThrow()
    expect(FakeWs.last!.sent).toEqual([])
    expect(closed).toHaveBeenCalledWith(null)
  })
})

describe('OperatorCall', () => {
  it('listens on both channels, then takes over and hands back', async () => {
    const t: OperatorTicket = { token: 'tok_op', expiresAt: null, wsBase: 'wss://orc.test', path: '/v1/voice/sessions/call_1/operator', mode: 'listen', name: 'Front Desk' }
    const capture = vi.fn().mockResolvedValue({ setMuted: vi.fn(), stop: vi.fn() })
    const call = new OperatorCall(t, vi.fn(), vi.fn(), undefined, { WebSocket: FakeWs as never, AudioContext: FakeCtx as never, capture })
    const started = call.start()
    await vi.waitFor(() => expect(FakeWs.last?.url).toContain('/operator'))
    const ws = FakeWs.last!
    expect(ws.url).toBe('wss://orc.test/v1/voice/sessions/call_1/operator?mode=listen&sample_rate=48000&name=Front+Desk')
    expect(ws.protocols).toEqual(['aica.operator.v1', 'bearer.tok_op'])
    ws.open()
    await started
    expect(capture).not.toHaveBeenCalled()
    await call.takeOver()
    expect(capture).toHaveBeenCalledTimes(1)
    call.say('Hello, this is the front desk.')
    call.release(true)
    expect(ws.sent).toEqual([{ type: 'takeover' }, { type: 'say', text: 'Hello, this is the front desk.' }, { type: 'release', resume_ai: true }])
    expect(call.mode).toBe('listen')
  })
})
