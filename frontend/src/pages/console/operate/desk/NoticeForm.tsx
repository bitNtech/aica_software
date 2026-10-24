import { useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../../auth/types'
import { useConsole } from '../../../../console/ConsoleProvider'
import type { Desk, Notice } from '../../../../console/types'
import { useOrg } from '../../../../console/useOrg'
import { Button } from '../../../../components/ui/Button'
import { ChoiceGroup } from '../../../../components/ui/Choice'
import { SelectField, TextAreaField, TextField } from '../../../../components/ui/Field'
import { checkNotice, endFor, fromLocalInput, noticePreview, NOTICE_TEMPLATES, noticeState, similarNotice, toLocalInput, until, when, type EndPreset } from './logic'

type StartMode = 'keep' | 'now' | 'later'

export interface Saved {
  desk: Desk
  /** A new notice (undo takes it down) or a change (undo puts `previous` back). */
  created: Notice | null
  previous: Notice | null
}

/** The choices for when it ends: counted from the start when that's later, otherwise from now. */
const endChoices = (later: boolean): { value: EndPreset; label: string }[] => [
  { value: '2h', label: later ? '2 hours after it starts' : 'In 2 hours' },
  { value: 'today', label: later ? 'At the end of the day it starts' : 'At the end of today' },
  { value: 'tomorrow', label: later ? 'At the end of the next day' : 'At the end of tomorrow' },
  { value: 'week', label: later ? 'A week after it starts' : 'In a week' },
  { value: 'custom', label: 'At a time I choose' },
]

/**
 * Post or change a notice: start from a ready-made one or write your own,
 * choose which agent says it and when it starts and ends, and see how a
 * caller will hear it before it goes out. A notice that says much the same
 * as one already showing is pointed out, not refused.
 */
export function NoticeForm({
  notice,
  agents,
  notices,
  now,
  onCancel,
  onSaved,
  onOpenOther,
}: {
  notice: Notice | null
  agents: { id: string; name: string }[]
  notices: Notice[]
  now: number
  onCancel(): void
  onSaved(saved: Saved): void
  /** "Change that one instead" on a duplicate warning. */
  onOpenOther(n: Notice): void
}) {
  const { org } = useOrg()
  const client = useConsole()
  const id = useId()
  const scheduled = !!notice && noticeState(notice, now) === 'scheduled'
  const [text, setText] = useState(notice?.text ?? '')
  const [agentId, setAgentId] = useState(notice?.agentId ?? '')
  const [template, setTemplate] = useState<string | null>(null)
  const [start, setStart] = useState<StartMode>(!notice ? 'now' : scheduled ? 'later' : 'keep')
  const [startAt, setStartAt] = useState(notice && scheduled ? toLocalInput(notice.from) : toLocalInput(new Date(Math.ceil(now / 36e5) * 36e5 + 36e5).toISOString()))
  const [ends, setEnds] = useState<EndPreset>(notice ? 'keep' : 'today')
  const [endAt, setEndAt] = useState(notice ? toLocalInput(notice.until) : '')
  const [errors, setErrors] = useState<{ text?: string; when?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLSelectElement>(null)

  const fromIso = start === 'keep' ? (notice?.from ?? null) : start === 'now' ? new Date(now).toISOString() : fromLocalInput(startAt)
  const untilIso = fromIso ? endFor(ends, Math.max(Date.parse(fromIso), now), { custom: endAt, keep: notice?.until }) : null
  const agentName = agentId ? (agents.find((a) => a.id === agentId)?.name ?? 'An agent') : null
  const dup = fromIso && untilIso ? similarNotice(text, notices, { agentId: agentId || null, from: fromIso, until: untilIso, ignoreId: notice?.id }, now) : null
  const preview = fromIso && untilIso && text.trim() ? noticePreview(text, agentName, fromIso, untilIso, now) : null
  const agentWho = (aid: string | null) => (aid ? (agents.find((a) => a.id === aid)?.name ?? 'an agent') : 'every agent')

  function applyTemplate(tid: string) {
    const t = NOTICE_TEMPLATES.find((x) => x.id === tid)
    if (!t) return
    setTemplate(tid)
    setText(t.text)
    setEnds(t.ends)
    setErrors({})
    // Straight to the first part to fill in.
    requestAnimationFrame(() => {
      const el = field.current
      if (!el) return
      el.focus()
      const m = /\[[^\]\n]+\]/.exec(t.text)
      if (m) el.setSelectionRange(m.index, m.index + m[0].length)
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const clock = Date.now()
    // "Now" is now, not when the form opened.
    const from = start === 'keep' ? (notice?.from ?? null) : start === 'now' ? new Date(clock).toISOString() : fromLocalInput(startAt)
    const to = from ? endFor(ends, Math.max(Date.parse(from), clock), { custom: endAt, keep: notice?.until }) : null
    const found = checkNotice({ text, from, until: to }, clock)
    if (found.text || found.when) {
      setErrors(found)
      if (found.text) field.current?.focus()
      else endRef.current?.focus()
      return
    }
    setBusy(true)
    setErrors({})
    try {
      const d = await client.saveNotice(org.orgSlug, { id: notice?.id, text, agentId: agentId || null, from: from!, until: to! })
      const created = notice ? null : (d.notices.find((n) => !notices.some((o) => o.id === n.id)) ?? null)
      onSaved({ desk: d, created, previous: notice })
    } catch (err) {
      setErrors({ form: asAuthError(err).message })
      field.current?.focus()
      setBusy(false)
    }
  }

  const when_ = (iso: string) => when(iso, now)

  return (
    <form className="op-form notice-form" onSubmit={(e) => void submit(e)} noValidate>
      {!notice && (
        <div role="group" aria-labelledby={`${id}-tpl`} className="notice-form__templates">
          <p id={`${id}-tpl`} className="field__label">
            Start from a ready-made notice
          </p>
          <div className="notice-form__chips">
            {NOTICE_TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="chip" aria-pressed={template === t.id} onClick={() => applyTemplate(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <TextAreaField
        ref={field}
        label="What callers should know"
        hint={template || /\[[^\]]+\]/.test(text) ? 'Fill in the parts in [square brackets], as you’d say it on the phone.' : 'Plain words, as you’d say it on the phone.'}
        rows={3}
        maxLength={300}
        value={text}
        error={errors.text}
        onChange={(e) => {
          setText(e.target.value)
          if (errors.text) setErrors((x) => ({ ...x, text: undefined }))
        }}
      />
      <SelectField label="Which agents" value={agentId} options={[{ value: '', label: 'Every agent' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} onChange={(e) => setAgentId(e.target.value)} />

      {start === 'keep' && notice ? (
        <p className="row__meta">Started {when_(notice.from)}.</p>
      ) : (
        <>
          <ChoiceGroup legend="Starts" type="radio" columns={2} value={[start]} onChange={([v]) => setStart(v)} options={[{ value: 'now', label: 'Straight away' }, { value: 'later', label: 'At a time I choose' }]} />
          {start === 'later' && <TextField label="Starts at" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />}
        </>
      )}
      <SelectField
        ref={endRef}
        label="Ends"
        value={ends}
        error={errors.when}
        options={[...(notice ? [{ value: 'keep', label: `As now (${until(notice.until, now)})` }] : []), ...endChoices(start === 'later')]}
        onChange={(e) => {
          setEnds(e.target.value as EndPreset)
          if (errors.when) setErrors((x) => ({ ...x, when: undefined }))
        }}
      />
      {ends === 'custom' && <TextField label="Ends at" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />}

      {dup && (
        <div className="notice-form__dup" role="status">
          <p>
            <strong>Much the same notice is already {noticeState(dup, now) === 'scheduled' ? 'coming up' : 'showing'}</strong> for {agentWho(dup.agentId)}, {noticeState(dup, now) === 'scheduled' ? `from ${when_(dup.from)}` : until(dup.until, now)}: “{dup.text}”
          </p>
          <p className="row__meta">Callers would be told twice. Change that one instead, or post this anyway if it says something different.</p>
          <button type="button" className="btn-text" onClick={() => onOpenOther(dup)}>
            Change that one instead
          </button>
        </div>
      )}

      <section className="notice-form__preview" aria-labelledby={`${id}-prev`}>
        <h3 id={`${id}-prev`} className="notice-form__preview-title">
          Preview
        </h3>
        {preview ? (
          <>
            <p className="row__meta">
              {preview.intro}, {preview.timing}, whenever it comes up:
            </p>
            <blockquote className="notice-form__says">{preview.says}</blockquote>
            <p className="row__meta">This is your wording as it stands. The agent says it when it’s relevant, in the caller’s language.</p>
          </>
        ) : (
          <p className="row__meta">Write the notice to see how callers will hear it.</p>
        )}
      </section>

      {errors.form && (
        <p className="field__error" role="alert">
          {errors.form}
        </p>
      )}
      <div className="dialog__actions">
        <Button type="submit" variant="orange" size="sm" busy={busy} busyLabel="Saving…">
          {notice ? 'Save notice' : start === 'later' ? 'Schedule notice' : 'Post notice'}
        </Button>
        <Button variant="line" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
