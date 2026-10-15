import { ContextEditor, KNOWLEDGE_KIND_LABEL, isExpired } from '../../builder/steps/StepContext'
import type { TabProps } from '../shared'

/** Builder step 6, one half per tab: what it knows, or what it can do. */
export function ContextTab({ org, spec, update, readOnly, errors, lib, part }: TabProps & { part: 'knowledge' | 'tools' }) {
  const c = spec.context
  if (readOnly) {
    if (part === 'knowledge') {
      const chosen = lib.knowledge.filter((k) => c.knowledgeSourceIds.includes(k.id))
      return (
        <div className="ws__sections">
          {chosen.length ? (
            <ul className="ws__ro-list" aria-label="Knowledge it answers from">
              {chosen.map((k) => (
                <li key={k.id}>
                  <strong>{k.name}</strong>
                  <span className="row__meta">
                    {KNOWLEDGE_KIND_LABEL[k.kind]} <i aria-hidden="true">·</i> {k.passages} sections
                    {isExpired(k) && <strong className="pick-list__warn"> · Expired</strong>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-note">It doesn’t answer from any knowledge.</p>
          )}
          <p>{c.answerOnlyFromKnowledge ? 'Answers only from this knowledge; otherwise it says it doesn’t know.' : 'May answer beyond this knowledge.'}</p>
        </div>
      )
    }
    const chosen = lib.tools.filter((t) => c.toolIds.includes(t.id))
    return (
      <div className="ws__sections">
        {chosen.length ? (
          <ul className="ws__ro-list" aria-label="Tools it can use">
            {chosen.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong>
                <span className="row__meta">{t.description}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-note">It uses no tools.</p>
        )}
        <p>{c.confirmBeforeActions ? 'Asks the caller before a tool changes anything.' : 'Acts without asking the caller first.'}</p>
      </div>
    )
  }
  return (
    <div className="step ws__sections">
      <ContextEditor
        orgSlug={org.orgSlug}
        context={c}
        onChange={(context) => update((s) => ({ ...s, context }))}
        errors={errors}
        part={part}
        library={{ knowledge: lib.knowledge, tools: lib.tools }}
      />
    </div>
  )
}
