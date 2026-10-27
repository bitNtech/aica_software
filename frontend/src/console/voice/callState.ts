/**
 * A voice call as the page shows it, built from the voice server's events
 * (aica.voice.v1, and the operator socket's mirror of them). Pure: the
 * socket clients feed events in, React renders the state. Unknown events
 * are ignored, as the protocol asks: v1 only ever adds to them.
 */
import { endedMessage } from './closeCodes'

export type CallStatus = 'idle' | 'connecting' | 'live' | 'ending' | 'ended' | 'failed'

export interface CallTurn {
  /** The response id for the agent's turns; a counter for the caller's. */
  id: string
  speaker: 'caller' | 'agent' | 'staff'
  text: string
  /** Still being generated. */
  streaming: boolean
  /** The caller talked over it: `text` is what they heard. */
  interrupted: boolean
  language?: string
}

export interface CallMetrics {
  firstAudioMs: number | null
  llmFirstTextMs: number | null
  ttsFirstAudioMs: number | null
  asrMs: number | null
}

export interface CallState {
  status: CallStatus
  sessionId: string | null
  agentName: string | null
  turns: CallTurn[]
  /** What the caller is saying, before it's final (when partials are on). */
  partial: string | null
  /** The caller is speaking. */
  listening: boolean
  /** The agent's audio is playing. */
  speaking: boolean
  /** A person: asked for, connected, or gone back to the agent. */
  handoff: 'requested' | 'accepted' | 'released' | 'timeout' | null
  metrics: CallMetrics | null
  /** The latest problem the voice server reported; the call may go on. */
  notice: string | null
  /** Why it ended, in words. */
  ended: string | null
  /** The end was a failure (not a hang-up). */
  error: string | null
}

export const initialCall: CallState = {
  status: 'idle',
  sessionId: null,
  agentName: null,
  turns: [],
  partial: null,
  listening: false,
  speaking: false,
  handoff: null,
  metrics: null,
  notice: null,
  ended: null,
  error: null,
}

export type CallAction =
  | { type: 'connecting' }
  | { type: 'event'; event: Record<string, unknown> }
  | { type: 'typed'; text: string }
  | { type: 'ending' }
  | { type: 'closed'; message: string | null }
  | { type: 'failed'; message: string }

// Events are the server's JSON: read defensively, field by field.
type Ev = Record<string, any>

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
let seq = 0
const nextId = (p: string) => `${p}-${++seq}`

/** Puts text on the agent turn `id`, making it if needed. */
function agentTurn(turns: CallTurn[], id: string, update: (t: CallTurn) => CallTurn, speaker: CallTurn['speaker'] = 'agent'): CallTurn[] {
  const i = turns.findIndex((t) => t.id === id)
  if (i === -1) return [...turns, update({ id, speaker, text: '', streaming: true, interrupted: false })]
  const out = turns.slice()
  out[i] = update(out[i])
  return out
}

function onEvent(s: CallState, e: Ev): CallState {
  switch (e.type) {
    case 'session.created':
    case 'operator.joined':
      return { ...s, status: 'live', sessionId: e.session?.id ?? e.session_id ?? s.sessionId, agentName: e.agent?.name ?? s.agentName }
    case 'input_audio.speech_started':
      return { ...s, listening: true }
    case 'input_audio.speech_stopped':
      return { ...s, listening: false }
    case 'transcript.partial':
      return { ...s, partial: typeof e.text === 'string' ? e.text : s.partial }
    case 'transcript.final': {
      if (!e.text) return { ...s, partial: null }
      return { ...s, partial: null, listening: false, turns: [...s.turns, { id: nextId('caller'), speaker: 'caller', text: e.text, streaming: false, interrupted: false, language: e.language }] }
    }
    // The operator socket mirrors the event log: {type: transcript, data: {role, text}}.
    case 'transcript': {
      const d = (e.data ?? e) as Ev
      if (!d.text) return s
      const speaker = d.role === 'assistant' ? 'agent' : d.role === 'operator' ? 'staff' : 'caller'
      if (speaker === 'agent' && d.response_id) return { ...s, turns: agentTurn(s.turns, d.response_id, (t) => ({ ...t, text: d.text, streaming: false })) }
      return { ...s, turns: [...s.turns, { id: nextId(speaker), speaker, text: d.text, streaming: false, interrupted: false }] }
    }
    case 'response.created':
      return e.response_id ? { ...s, turns: agentTurn(s.turns, e.response_id, (t) => t) } : s
    case 'response.text.delta': {
      const id = e.response_id ?? [...s.turns].reverse().find((t) => t.speaker === 'agent' && t.streaming)?.id
      if (!id || typeof e.delta !== 'string') return s
      return { ...s, turns: agentTurn(s.turns, id, (t) => (t.interrupted ? t : { ...t, text: t.text + e.delta })) }
    }
    case 'response.done': {
      const id = e.response_id ?? [...s.turns].reverse().find((t) => t.speaker === 'agent' && t.streaming)?.id
      if (!id) return s
      const turns = agentTurn(s.turns, id, (t) => ({ ...t, streaming: false, text: t.interrupted ? t.text : typeof e.text === 'string' && e.text ? e.text : t.text }))
      // A reply with nothing to say (a tool call, a handover) leaves no bubble.
      return { ...s, turns: turns.filter((t) => !(t.id === id && !t.text.trim())) }
    }
    case 'response.audio.started':
      return { ...s, speaking: true, turns: e.kind === 'operator' && e.response_id ? agentTurn(s.turns, e.response_id, (t) => ({ ...t, speaker: 'staff' }), 'staff') : s.turns }
    case 'response.audio.done':
    case 'audio.clear':
      return { ...s, speaking: false }
    case 'response.interrupted': {
      if (!e.response_id) return s
      const heard = typeof e.spoken_text === 'string' ? e.spoken_text : null
      return { ...s, speaking: false, turns: agentTurn(s.turns, e.response_id, (t) => ({ ...t, interrupted: true, streaming: false, text: heard ?? t.text })).filter((t) => t.text.trim() || t.speaker !== 'agent') }
    }
    case 'response.metrics':
      return { ...s, metrics: { firstAudioMs: num(e.first_audio_ms), llmFirstTextMs: num(e.llm_first_text_ms), ttsFirstAudioMs: num(e.tts_first_audio_ms), asrMs: num(e.asr_ms) } }
    case 'handoff.requested':
    case 'handoff.pending':
      return { ...s, handoff: 'requested' }
    case 'handoff.accepted':
    case 'handoff.active':
      return { ...s, handoff: 'accepted' }
    case 'handoff.released':
      return { ...s, handoff: 'released' }
    case 'handoff.timeout':
      return { ...s, handoff: 'timeout' }
    case 'error': {
      const err = (e.error ?? {}) as Ev
      const where = err.source === 'asr' ? 'Speech recognition' : err.source === 'llm' ? 'The language model' : err.source === 'tts' ? 'The voice' : null
      return { ...s, notice: where ? `${where} had a problem: ${err.message ?? err.code ?? 'unknown error'}` : (err.message ?? 'The voice server reported a problem.') }
    }
    case 'session.closing':
      return { ...s, notice: 'The voice server is restarting: this call will end soon.' }
    case 'session.recovered':
      return { ...s, notice: null }
    case 'session.ended':
      return { ...s, status: 'ending', ended: endedMessage(e.reason), speaking: false, listening: false }
    default:
      return s
  }
}

export function callReducer(s: CallState, a: CallAction): CallState {
  switch (a.type) {
    case 'connecting':
      return { ...initialCall, status: 'connecting' }
    case 'event':
      return onEvent(s, a.event)
    case 'typed':
      return { ...s, turns: [...s.turns, { id: nextId('caller'), speaker: 'caller', text: a.text, streaming: false, interrupted: false }] }
    case 'ending':
      return s.status === 'live' ? { ...s, status: 'ending' } : s
    case 'closed':
      if (s.status === 'ended' || s.status === 'failed') return s
      if (a.message && s.status !== 'ending') return { ...s, status: 'failed', error: a.message, speaking: false, listening: false, turns: s.turns.map((t) => ({ ...t, streaming: false })) }
      return { ...s, status: 'ended', ended: s.ended ?? endedMessage(null), speaking: false, listening: false, turns: s.turns.map((t) => ({ ...t, streaming: false })) }
    case 'failed':
      return { ...s, status: 'failed', error: a.message, speaking: false, listening: false }
  }
}
