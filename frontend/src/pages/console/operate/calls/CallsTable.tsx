import { useMemo, type ReactNode } from 'react'
import { DataTable, type Column } from '../../../../components/console/DataTable'
import type { CallSummary } from '../../../../console/types'
import { duration, languageName } from '../shared'
import type { Analysed } from './logic'
import { callerLabel, NotMeasured, OutcomePill, SentimentTag, shortWhen, SuccessTag } from './parts'

interface Props {
  calls: CallSummary[]
  /** Sentiment and success of the calls opened so far (the list has neither). */
  analysed: ReadonlyMap<string, Analysed>
  /** Callers' names are shown. */
  personal: boolean
  selectedId: string | null
  onOpen(id: string): void
  loading: boolean
  empty: ReactNode
}

/**
 * The calls as a table: sortable columns (time, caller, agent, topic,
 * outcome, length, how the caller sounded, success, who took it), arrow keys
 * or j and k to move, Enter or a click to open the preview beside it.
 * Sentiment and success aren't in the call list: they show once a call has
 * been opened, and a dash that reads "Not measured" until then.
 */
export function CallsTable({ calls, analysed, personal, selectedId, onOpen, loading, empty }: Props) {
  const columns = useMemo<Column<CallSummary>[]>(
    () => [
      { key: 'time', header: 'When', width: '8.5rem', sortValue: (c) => Date.parse(c.startedAt), cell: (c) => <time dateTime={c.startedAt}>{shortWhen(c.startedAt)}</time> },
      {
        key: 'caller',
        header: 'Caller',
        width: '11rem',
        sortValue: (c) => (personal ? (c.callerName ?? '') : '') || c.callerPhone,
        cell: (c) => (
          <span className="cl-caller">
            <span className="cl-caller__name">{callerLabel(c, personal)}</span>
            <span className="cl-caller__phone">{c.callerPhone}</span>
          </span>
        ),
      },
      { key: 'agent', header: 'Agent', width: '9rem', sortValue: (c) => c.agentName, cell: (c) => c.agentName },
      { key: 'topic', header: 'What they wanted', width: '12rem', sortValue: (c) => c.intent, cell: (c) => c.intent },
      { key: 'outcome', header: 'Outcome', width: '12rem', sortValue: (c) => c.outcome, cell: (c) => <OutcomePill outcome={c.outcome} /> },
      { key: 'length', header: 'Length', width: '7rem', align: 'end', sortValue: (c) => c.durationSec, cell: (c) => duration(c.durationSec) },
      { key: 'language', header: 'Language', width: '6.5rem', sortValue: (c) => c.language, cell: (c) => languageName(c.language) },
      {
        key: 'sentiment',
        header: 'Sounded',
        width: '7.5rem',
        sortValue: (c) => analysed.get(c.id)?.sentiment ?? null,
        cell: (c) => {
          const a = analysed.get(c.id)
          return a ? <SentimentTag sentiment={a.sentiment} /> : <NotMeasured />
        },
      },
      {
        key: 'success',
        header: 'Success',
        width: '8.5rem',
        sortValue: (c) => {
          const a = analysed.get(c.id)
          return a ? (a.success ? 1 : 0) : null
        },
        cell: (c) => {
          const a = analysed.get(c.id)
          return a ? <SuccessTag success={a.success} /> : <NotMeasured />
        },
      },
      { key: 'handled', header: 'Taken by', width: '8rem', sortValue: (c) => c.handledBy, cell: (c) => c.handledBy ?? <NotMeasured what="No one: the agent handled it" /> },
    ],
    [analysed, personal],
  )

  return (
    <DataTable
      columns={columns}
      rows={calls}
      rowKey={(c) => c.id}
      caption="Calls, newest first by default"
      defaultSort={{ key: 'time', dir: 'descending' }}
      selectedKey={selectedId}
      onSelect={(c) => onOpen(c.id)}
      loading={loading}
      empty={empty}
      densityKey="aica.table.calls"
      maxHeight="max(20rem, calc(100dvh - var(--split-top, 10rem) - 6.5rem))"
      bar={false}
    />
  )
}
