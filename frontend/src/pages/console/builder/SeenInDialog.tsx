import { useCallback, useState } from 'react'
import { useConsole } from '../../../console/ConsoleProvider'
import type { FlowNode, SourceCall } from '../../../console/types'
import { Modal } from '../../../components/ui/Dialog'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { TranscriptDialog } from '../calls/TranscriptDialog'

/** The calls a flow node was read from, each opening its transcript. */
export function SeenInDialog({ orgSlug, node, redact, onClose }: { orgSlug: string; node: FlowNode | null; redact: boolean; onClose(): void }) {
  const client = useConsole()
  const load = useCallback(() => client.listCalls(orgSlug), [client, orgSlug])
  const [calls] = useAsync(load)
  const [transcript, setTranscript] = useState<SourceCall | null>(null)
  const call = (id: string) => (calls.state === 'ready' ? calls.data.find((c) => c.id === id) : undefined)

  return (
    <>
      <Modal open={!!node} title={node ? `Where “${node.label}” came from` : 'Calls'} onClose={onClose}>
        {node &&
          (calls.state === 'loading' ? (
            <div className="loading-row" role="status">
              <Spinner />
              <span>Loading the calls…</span>
            </div>
          ) : (
            <ul className="seen-in">
              {node.sourceCallIds.map((id) => {
                const c = call(id)
                return (
                  <li key={id} className="seen-in__row">
                    <span>
                      <span className="seen-in__name">{c?.name ?? 'A call no longer in your library'}</span>
                      {c?.topic && <span className="seen-in__meta">{c.topic}</span>}
                    </span>
                    {c?.status === 'ready' && (
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => {
                          onClose()
                          setTranscript(c)
                        }}
                      >
                        Transcript<span className="sr-only">: {c.name}</span>
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          ))}
      </Modal>
      <TranscriptDialog orgSlug={orgSlug} call={transcript} redact={redact} onClose={() => setTranscript(null)} />
    </>
  )
}
