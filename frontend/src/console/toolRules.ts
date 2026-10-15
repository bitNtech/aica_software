import type { AgentTool } from './types'

/** The rules for an HTTP tool, shared by the form and the (demo) server. */

const PARAM_NAME = /^[a-z][a-z0-9_]{0,39}$/

/** Problems with a tool, by field ("param-2" for the third input). */
export function checkTool(t: AgentTool, others: AgentTool[]): Record<string, string> {
  const e: Record<string, string> = {}
  if (t.name.trim().length < 3) e.name = 'Give it a name of at least 3 characters, e.g. “Book an appointment”.'
  else if (others.some((o) => o.id !== t.id && o.name.toLowerCase() === t.name.trim().toLowerCase())) e.name = 'Another tool has that name.'
  if (t.description.trim().length < 10) e.description = 'Say what it does in a sentence: agents use this to decide when to call it.'
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(t.url?.trim() ?? '')) e.url = 'Give the full address, starting with https://.'
  t.params.forEach((p, i) => {
    if (!PARAM_NAME.test(p.name)) e[`param-${i}`] = 'Use lower-case letters, digits and underscores, starting with a letter, e.g. patient_id.'
    else if (t.params.some((o, j) => j < i && o.name === p.name)) e[`param-${i}`] = `“${p.name}” is used twice.`
  })
  return e
}
