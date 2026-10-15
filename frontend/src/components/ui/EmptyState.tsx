import { useId, type ReactNode } from 'react'

/** Nothing here yet: what this place is for, and what to do next. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  const id = useId()
  return (
    <section className="empty-card" aria-labelledby={id}>
      <h2 id={id} className="empty-card__title">
        {title}
      </h2>
      {children && <div className="empty-card__text">{children}</div>}
      {action && <div className="empty-card__action">{action}</div>}
    </section>
  )
}
