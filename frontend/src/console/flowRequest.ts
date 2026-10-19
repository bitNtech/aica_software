import type { DetectedFlowPattern } from './types'
/** The request bitNtech gets for a detected pattern. Requests hold up to
 * 2,000 characters, so long step lists and call lists are cut short. */
export function flowRequestDetail(pattern: DetectedFlowPattern, max = 2000): string {
  const head = `${pattern.occurrences} of the last ${pattern.windowSize} calls to ${pattern.agentName} followed this step sequence, which isn't part of its current flow:`
  const steps = pattern.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  let calls = pattern.callIds
  const build = (ids: string[], more: number) => `${head}\n${steps}\n\nCalls: ${ids.join(', ')}${more ? ` and ${more} more` : ''}`
  let text = build(calls, 0)
  while (text.length > max && calls.length > 1) {
    calls = calls.slice(0, -1)
    text = build(calls, pattern.callIds.length - calls.length)
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
