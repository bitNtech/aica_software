import { StatusPill, ToneIcon, type Tone } from '../../../../components/console/StatusPill'
import type { CallOutcome, CallSummary, Sentiment } from '../../../../console/types'
import { OUTCOME_LABEL, SENTIMENT_LABEL } from '../shared'

/** Each outcome has a tone, and always its words: the pill's icon shape and
 * the label say it, not the colour. */
const OUTCOME_TONE: Record<CallOutcome, Tone> = {
  resolved: 'ok',
  booked: 'ok',
  handed_over: 'info',
  callback: 'warn',
  dropped: 'neutral',
  emergency: 'danger',
}

export const outcomeTone = (o: CallOutcome): Tone => OUTCOME_TONE[o]

export function OutcomePill({ outcome }: { outcome: CallOutcome }) {
  return <StatusPill tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABEL[outcome]}</StatusPill>
}

/** Who rang, for someone who may see names; otherwise "A caller". */
export const callerLabel = (c: Pick<CallSummary, 'callerName'>, personal: boolean) => (personal && c.callerName) || 'A caller'

/** "4:05 pm" for today, "21 Oct, 4:05 pm" otherwise. */
export function shortWhen(iso: string): string {
  const d = new Date(iso)
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/** A value the list doesn't have: a dash a screen reader reads as "not measured". */
export function NotMeasured({ what = 'Not measured' }: { what?: string }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{what}</span>
    </>
  )
}

const SENTIMENT_TONE: Record<Sentiment, Tone> = { positive: 'ok', neutral: 'neutral', negative: 'warn' }

/** How the caller sounded, as an icon and words. */
export function SentimentTag({ sentiment }: { sentiment: Sentiment }) {
  return (
    <span className="cl-tag">
      <ToneIcon tone={SENTIMENT_TONE[sentiment]} size={13} />
      <span>{SENTIMENT_LABEL[sentiment]}</span>
    </span>
  )
}

/** Whether the call met the agent's success criteria, as an icon and words. */
export function SuccessTag({ success }: { success: boolean }) {
  return (
    <span className="cl-tag">
      <ToneIcon tone={success ? 'ok' : 'warn'} size={13} />
      <span>{success ? 'Successful' : 'Not successful'}</span>
    </span>
  )
}
