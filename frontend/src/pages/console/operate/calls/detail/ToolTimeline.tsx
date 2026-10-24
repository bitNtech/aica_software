import { Timeline, type TimelineItem } from '../../../../../components/console/Timeline'
import type { ToolCallRecord } from '../../../../../console/types'
import { clock } from '../../shared'
import { Section } from './parts'

/** Tools the agent used, in order, on a timeline: each says in words whether
 * it worked, what it did, and how far into the call it was. */
export function ToolTimeline({ calls, startedAt }: { calls: ToolCallRecord[]; startedAt: string }) {
  const start = Date.parse(startedAt)
  const items: TimelineItem[] = [...calls]
    .sort((a, b) => a.at - b.at)
    .map((t, i) => ({
      id: `${t.name}-${i}`,
      at: new Date(start + t.at * 1000),
      kind: t.ok ? 'agent' : 'alert',
      title: (
        <>
          <strong>{t.name}</strong> {t.ok ? 'worked' : 'failed'}
        </>
      ),
      who: `${clock(t.at)} into the call`,
      body: t.summary,
    }))
  return (
    <Section title="Tools used">
      {items.length === 0 ? <p className="row__meta">None.</p> : <Timeline items={items} label="Tools used, in order" />}
    </Section>
  )
}
