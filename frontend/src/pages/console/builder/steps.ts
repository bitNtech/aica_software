import { BUILDER_STEPS, type BuilderStep } from '../../../console/types'

/** The builder's eight steps, in words. Order comes from BUILDER_STEPS. */
export const STEP_META: Record<BuilderStep, { label: string; title: string; lede: string }> = {
  calls: {
    label: 'Source calls',
    title: 'Learn from past calls',
    lede: 'Pick recordings of real calls. AICA transcribes them and finds the conversations your agent needs to handle.',
  },
  type: {
    label: 'Type',
    title: 'What will this agent do?',
    lede: 'Choose the kind of business and the job this agent does. It decides where AICA starts when it reads your calls.',
  },
  behaviour: {
    label: 'Behaviour',
    title: 'How it speaks',
    lede: 'Its name, tone, languages and voice, the rules it must always follow, and how it pronounces names and listens.',
  },
  flow: {
    label: 'Conversation flow',
    title: 'Conversation flow',
    lede: 'The conversations AICA found in your calls, as a tree: each step can go more than one way. Check them, fix what’s wrong, and add what’s missing.',
  },
  attributes: {
    label: 'Attributes',
    title: 'Details to collect',
    lede: 'What the agent asks the caller for, and how it checks the answers.',
  },
  global: {
    label: 'Global flows',
    title: 'Anywhere in a call',
    lede: 'What the agent does whenever these happen, whatever it was in the middle of; where it hands over, and what it won’t discuss.',
  },
  context: {
    label: 'Knowledge and tools',
    title: 'What it knows and can do',
    lede: 'The documents it answers from, and the actions it may take during a call.',
  },
  review: {
    label: 'Review',
    title: 'Review and confirm',
    lede: 'Check everything, say what counts as a successful call, try it out, then publish it or send it to bitNtech.',
  },
}

export const stepIndex = (s: BuilderStep) => BUILDER_STEPS.indexOf(s)
export const isStep = (s: string | undefined): s is BuilderStep => !!s && (BUILDER_STEPS as readonly string[]).includes(s)
export const later = (a: BuilderStep, b: BuilderStep) => (stepIndex(a) >= stepIndex(b) ? a : b)
