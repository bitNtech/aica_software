import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { AgentTool, KnowledgeSource } from '../../../console/types'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Field'
import { GLOBAL_META } from './steps/StepGlobal'
import { SIM_START, simulate, type SimAgent, type SimReply, type SimState } from './simulate'

interface Line {
  from: 'caller' | 'agent'
  text: string
  reply?: SimReply
}

const SUGGESTIONS = ['I want to book an appointment', 'Is my blood test report ready?', 'What are the Sunday timings?', 'I have chest pain']

/**
 * Try an agent by typing as the caller. Replies are simulated in the
 * browser from the agent's flow, with the path, tools and knowledge each
 * reply used; the real agent (speech, the LLM) runs on AICA's servers.
 */
export function TestChat({ draft, tools, knowledge }: { draft: SimAgent; tools: AgentTool[]; knowledge: KnowledgeSource[] }) {
  const greeting: Line = { from: 'agent', text: draft.behaviour.greeting || 'Hello!' }
  const [lines, setLines] = useState<Line[]>([greeting])
  const [state, setState] = useState<SimState>(SIM_START)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const log = useRef<HTMLOListElement>(null)
  const id = useId()
  /** Only the agent's reply is announced, not the tester's own words or the trace. */
  const [said, setSaid] = useState('')
  const persona = draft.behaviour.persona || 'Agent'

  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  function send(message: string) {
    const m = message.trim()
    if (!m) return
    const { reply, state: next } = simulate(draft, tools, knowledge, state, m)
    setLines((l) => [...l, { from: 'caller', text: m }, { from: 'agent', text: reply.text, reply }])
    setSaid(`${persona}: ${reply.text}`)
    setState(next)
    setText('')
    input.current?.focus()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    send(text)
  }

  return (
    <div className="chat">
      <p className="chat__note">Simulated in your browser from this agent’s flow. On a real call, AICA’s servers handle speech and wording.</p>
      <p className="sr-only" role="status">
        {said}
      </p>
      {/* Focusable, so keyboard users can scroll a long conversation. */}
      <ol className="chat__log" ref={log} aria-label="Test conversation (simulated)" tabIndex={0}>
        {lines.map((l, i) => (
          <li key={i} className={`chat__line chat__line--${l.from}`}>
            <span className="chat__who">{l.from === 'agent' ? persona : 'You'}</span>
            <p className="chat__text">{l.text}</p>
            {l.reply && <ReplyTrace reply={l.reply} />}
          </li>
        ))}
      </ol>
      <form className="chat__form" onSubmit={submit} noValidate>
        <TextField ref={input} label="Say something as the caller" value={text} autoComplete="off" onChange={(e) => setText(e.target.value)} />
        <Button type="submit" variant="plum" className="chat__send">
          Send
        </Button>
      </form>
      <div className="chat__tools">
        <p className="chat__try" id={`${id}-try`}>
          Try:
        </p>
        <ul className="chat__chips" aria-labelledby={`${id}-try`}>
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button type="button" className="chip-btn" onClick={() => send(s)}>
                {s}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn-text"
          onClick={() => {
            setLines([greeting])
            setState(SIM_START)
            setSaid('Started over.')
            input.current?.focus()
          }}
        >
          Start over
        </button>
      </div>
    </div>
  )
}

function ReplyTrace({ reply }: { reply: SimReply }) {
  const parts: string[] = []
  if (reply.global) parts.push(`Global flow: ${GLOBAL_META[reply.global].label}`)
  if (reply.path.length) parts.push(`Flow: ${reply.path.join(' › ')}`)
  // Nothing is run in a test: say what would happen.
  if (reply.tool) parts.push(`Tool: ${reply.tool.name}${reply.tool.asksFirst ? ' (asks the caller first)' : ''}, not run in a test`)
  if (reply.knowledge?.length) parts.push(`Knowledge: ${reply.knowledge.join(', ')}`)
  if (!parts.length) return null
  return (
    <ul className="chat__trace">
      {parts.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  )
}
