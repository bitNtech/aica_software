/** What a closed voice socket means, for the person on the call
 * (docs/orchestrator-contract.md §Close codes). Null: nothing went wrong. */
export function closeMessage(code: number): string | null {
  switch (code) {
    case 1000:
      return null
    case 1013:
      return 'The voice server is busy or one of its services is down. Try again in a minute.'
    case 4400:
      return 'The voice server didn’t accept how the call was started. Reload the page and try again.'
    case 4401:
      return 'The call’s pass expired before it connected. Start the call again.'
    case 4403:
      return 'This agent can’t take calls right now. It may be switched off on the voice server.'
    case 4404:
      return 'The voice server doesn’t have this agent. Save or publish it again, then retry.'
    case 4409:
      return 'This call is already open somewhere else.'
    case 4429:
      return 'Too many calls are open at once. End one and try again.'
    case 1006:
      return 'The connection to the voice server dropped.'
    default:
      return `The call ended unexpectedly (code ${code}).`
  }
}

/** Why the browser can't use the microphone, in words. */
export function micMessage(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The microphone is blocked. Allow it for this site in your browser, then start the call again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in, then start the call again.'
  if (name === 'NotReadableError') return 'Another app is using the microphone. Close it, then start the call again.'
  return 'The microphone couldn’t start. Check your browser’s settings and try again.'
}

/** Why a call ended, from the server's reason, in words. */
export function endedMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'client_ended':
    case 'ended_by_staff':
      return 'You ended the call.'
    case 'end_conversation':
    case 'agent_ended':
      return 'The agent ended the call.'
    case 'idle_timeout':
    case 'hangup_after_reprompts':
      return 'The call ended after a long silence.'
    case 'max_duration':
      return 'The call reached its time limit.'
    case 'llm_unavailable':
    case 'tts_unavailable':
    case 'asr_unavailable':
      return 'The call ended because a voice service stopped answering.'
    default:
      return 'The call has ended.'
  }
}
