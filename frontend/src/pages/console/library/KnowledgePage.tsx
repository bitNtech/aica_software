import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { can, pageAccess } from '../../../console/access'
import { useConsole } from '../../../console/ConsoleProvider'
import type { KnowledgeSource, Passage } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { SegFilter, useSettled } from '../../../components/console/ListTools'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { shortDate } from '../../../lib/time'
import { KNOWLEDGE_KIND_LABEL, isExpired } from '../builder/steps/StepContext'
import { AddKnowledgeDialog, KnowledgeDetailDialog } from './KnowledgeDialogs'
import '../builder/Builder.css'
import './Library.css'

type Filter = 'all' | 'ready' | 'indexing' | 'attention'
const FILTER_LABEL: Record<Filter, string> = { all: 'All', ready: 'Ready', indexing: 'Being read', attention: 'Needs a look' }
const STATUS_LABEL: Record<KnowledgeSource['status'], string> = { ready: 'Ready', indexing: 'Being read', failed: 'Failed' }
const DAY = 864e5
const expiresSoon = (k: KnowledgeSource) => !!k.expiresAt && !isExpired(k) && Date.parse(k.expiresAt) - Date.now() < 14 * DAY
const needsLook = (k: KnowledgeSource) => k.status === 'failed' || isExpired(k)
const matches = (k: KnowledgeSource, f: Filter) =>
  f === 'all' || (f === 'attention' ? needsLook(k) : f === 'ready' ? k.status === 'ready' : k.status === 'indexing')

/** /o/:slug/knowledge: what the agents answer from. */
export default function KnowledgePage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const id = useId()
  const canEdit = pageAccess(access, 'knowledge') === 'edit'
  const load = useCallback(() => client.listKnowledge(org.orgSlug), [client, org.orgSlug])
  const [lib, reload] = useAsync(load)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)

  const all = lib.state === 'ready' ? lib.data : []
  const indexing = all.some((k) => k.status === 'indexing')
  // Check again a while after each reply (not on a fixed beat, which a slow
  // reply would never keep up with) until nothing is being read.
  useEffect(() => {
    if (!indexing) return
    const t = window.setTimeout(reload, 2000)
    return () => window.clearTimeout(t)
  }, [indexing, lib, reload])

  const usedBy = (k: KnowledgeSource) => k.usedBy ?? []
  const q = query.trim().toLowerCase()
  const shown = all.filter((k) => matches(k, filter) && (!q || [k.name, k.description, k.origin].some((v) => v.toLowerCase().includes(q))))
  const said = useSettled(shown.length === all.length ? `${all.length} sources` : `${shown.length} of ${all.length} sources shown`, lib.state === 'ready')
  const opened = all.find((k) => k.id === openId) ?? null

  return (
    <ConsolePage
      kicker="Agents"
      title="Knowledge"
      docTitle="Knowledge"
      lede={<p>What your agents answer from: doctor schedules, price lists, FAQs and pages from your website. Each agent uses the sources chosen for it.</p>}
      actions={
        canEdit && (
          <Button ref={addButton} variant="orange" onClick={() => setAdding(true)}>
            Add knowledge
          </Button>
        )
      }
    >
      <p className="sr-only" role="status">
        {note}
      </p>

      {lib.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading your knowledge…</span>
        </div>
      )}
      {lib.state === 'error' && (
        <Alert tone="error" title="Couldn't load your knowledge">
          <p>{asAuthError(lib.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {lib.state === 'ready' && all.length === 0 && (
        <EmptyState title="No knowledge yet">
          <p>{canEdit ? 'Add your doctor schedule, price list or FAQs, so agents can answer from them.' : 'When an owner or admin adds knowledge, it appears here.'}</p>
        </EmptyState>
      )}

      {lib.state === 'ready' && !canEdit && <p className="lib__ro-note">You can look. Owners and admins add and change knowledge.</p>}

      {lib.state === 'ready' && all.length > 0 && (
        <>
          <AskBox orgSlug={org.orgSlug} sources={all.filter((k) => k.status === 'ready')} />

          <section className="lib__section" aria-labelledby={`${id}-list`}>
            <h2 id={`${id}-list`} className="lib__heading">
              Sources
            </h2>
            <div className="list-tools">
              <TextField
                ref={search}
                label="Search sources"
                type="search"
                value={query}
                placeholder="Name, description or file"
                autoComplete="off"
                className="list-tools__search"
                onChange={(e) => setQuery(e.target.value)}
              />
              <SegFilter<Filter>
                legend="Show"
                value={filter}
                onChange={setFilter}
                options={(Object.keys(FILTER_LABEL) as Filter[]).map((f) => ({ value: f, label: FILTER_LABEL[f], count: all.filter((k) => matches(k, f)).length }))}
              />
            </div>
            <p className="sr-only" aria-live="polite">
              {said}
            </p>
            {shown.length === 0 ? (
              <p className="empty-note">
                No sources match.{' '}
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                    search.current?.focus()
                  }}
                >
                  Clear search and filter
                </button>
              </p>
            ) : (
              <ul className="lib-rows" aria-label="Knowledge sources">
                {shown.map((k) => {
                  const users = usedBy(k)
                  return (
                    <li key={k.id} className="lib-row">
                      <div className="lib-row__main">
                        <h3 className="lib-row__name">
                          <button type="button" className="lib-row__open" data-open={k.id} onClick={() => setOpenId(k.id)}>
                            {k.name}
                          </button>
                        </h3>
                        <p className="row__meta">
                          {KNOWLEDGE_KIND_LABEL[k.kind]} <i aria-hidden="true">·</i> <span className="lib-row__origin">{k.origin}</span>
                          {k.status === 'ready' && k.kind !== 'faq' && (
                            <>
                              {' '}
                              <i aria-hidden="true">·</i> {k.passages} sections <i aria-hidden="true">·</i> read {shortDate(k.refreshedAt)}
                            </>
                          )}
                        </p>
                        <p className="lib-row__used">{users.length ? `Used by ${users.join(', ')}` : 'Not used by an agent yet'}</p>
                        {isExpired(k) && <p className="lib-row__warn">Expired {shortDate(k.expiresAt!)}: check it’s still right, then update or extend it.</p>}
                        {expiresSoon(k) && <p className="lib-row__soon">Expires {shortDate(k.expiresAt!)}.</p>}
                        {k.error && <p className="field__error">{k.error}</p>}
                      </div>
                      {/* Expired outranks Ready: the row's chip agrees with its warning. */}
                      {k.status === 'ready' && isExpired(k) ? (
                        <span className="status-chip status-chip--kb-failed">Expired</span>
                      ) : (
                        <span className={`status-chip status-chip--kb-${k.status}`}>{STATUS_LABEL[k.status]}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <AddKnowledgeDialog
        orgSlug={org.orgSlug}
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(k) => {
          setAdding(false)
          setNote(`${k.name} added. ${k.status === 'failed' ? 'It couldn’t be read: see the list.' : 'AICA is reading it now.'}`)
          reload()
        }}
      />
      <KnowledgeDetailDialog
        orgSlug={org.orgSlug}
        source={opened}
        usedBy={opened ? usedBy(opened) : []}
        canEdit={canEdit}
        canDelete={can(access, 'knowledge.delete')}
        onClose={() => setOpenId(null)}
        onChanged={(_, done) => {
          setNote(done)
          reload()
        }}
        onDeleted={(k) => {
          setOpenId(null)
          setNote(`${k.name} deleted.`)
          reload()
          // Its row has gone: carry on from the search field (or Add).
          requestAnimationFrame(() => (search.current ?? addButton.current)?.focus())
        }}
      />
    </ConsolePage>
  )
}

/** Type a question callers ask and see what the agents would find. */
function AskBox({ orgSlug, sources }: { orgSlug: string; sources: KnowledgeSource[] }) {
  const client = useConsole()
  const id = useId()
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [results, setResults] = useState<Passage[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A short summary is announced, not every passage. */
  const [said, setSaid] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function ask(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q) {
      setError('Type a question first.')
      input.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    setSaid('')
    try {
      const found = await client.searchKnowledge(orgSlug, sources.map((k) => k.id), q)
      setResults(found)
      setAsked(q)
      setSaid(found.length ? `${found.length} ${found.length === 1 ? 'match' : 'matches'} found.` : 'Nothing found.')
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lib__section lib-ask" aria-labelledby={`${id}-ask`}>
      <h2 id={`${id}-ask`} className="lib__heading">
        Try a question
      </h2>
      <p className="lib__sub">See what an agent would find in all your ready sources. Each agent only looks in the sources chosen for it.</p>
      <form className="lib-ask__form" onSubmit={ask} noValidate>
        <TextField ref={input} label="A question a caller might ask" value={question} placeholder="e.g. Is the cardiologist in on Wednesday?" error={error} onChange={(e) => setQuestion(e.target.value)} />
        <Button type="submit" variant="plum" busy={busy} busyLabel="Looking…" className="rules__button">
          Look it up
        </Button>
      </form>
      <p className="sr-only" role="status">
        {said}
      </p>
      <div>
        {results &&
          (results.length ? (
            <>
              <h3 className="ws__subhead">
                {results.length} {results.length === 1 ? 'match' : 'matches'} for “{asked}”
              </h3>
              <ol className="passages passages--scored">
                {results.map((p) => (
                  <li key={p.sourceId + p.text}>
                    <span className="passages__text">{p.text}</span>
                    <span className="row__meta">
                      {p.sourceName} <i aria-hidden="true">·</i> {Math.round((p.score ?? 0) * 100)}% match
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="empty-note">Nothing close to “{asked}”. An agent that answers only from its knowledge would say it doesn’t know, and offer to hand over.</p>
          ))}
      </div>
    </section>
  )
}
