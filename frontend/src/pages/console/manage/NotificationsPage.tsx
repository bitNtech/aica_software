import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ROLE_LABEL } from '../../../auth/roles'
import { asAuthError, type Role } from '../../../auth/types'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Checkbox, TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { Switch } from '../../../components/ui/Switch'
import { useConsole } from '../../../console/ConsoleProvider'
import type { AlertKey, AlertRule, AlertSettingsInput, Member } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { useAsync } from '../../../lib/useAsync'
import { shortDate } from '../../../lib/time'
import '../library/Library.css'
import '../operate/Operate.css'
import './Manage.css'

const ROLES: Role[] = ['owner', 'admin', 'supervisor', 'front_desk', 'viewer']
const ALERT: Record<AlertKey, { label: string; hint: string; threshold?: { label: string; unit: string } }> = {
  emergency: { label: 'An emergency call', hint: 'The agent heard an emergency and is passing the caller to a person. Sent even in quiet hours.' },
  handoff_waiting: { label: 'A caller is waiting for a person', hint: 'Nobody has taken them yet.', threshold: { label: 'After waiting', unit: 'minutes' } },
  handoff_missed: { label: 'A caller hung up waiting for a person', hint: 'So someone calls them back.' },
  callback_overdue: { label: 'A callback is overdue', hint: 'Nobody has rung them back by the time it was due.', threshold: { label: 'Once overdue by', unit: 'minutes' } },
  agent_failing: { label: 'An agent is having problems', hint: 'Many calls failing, or a tool it uses not answering.' },
  agent_published: { label: 'An agent is published or rolled back', hint: 'Who did it, and their note.' },
  usage_threshold: { label: 'Minutes are running out', hint: 'This billing period’s minutes reach a share of the plan.', threshold: { label: 'At', unit: '% of the plan' } },
  invoice: { label: 'Invoices and payment problems', hint: 'A new invoice, or a payment that didn’t go through.' },
  daily_summary: { label: 'Each evening: the day’s calls', hint: 'Calls, handovers and anything left open.' },
  weekly_report: { label: 'Monday morning: last week’s report', hint: 'The same figures as Analytics.' },
  team_changes: { label: 'Someone joins, leaves or changes role', hint: 'Including owners.' },
}
const GROUPS: { title: string; keys: AlertKey[] }[] = [
  { title: 'Calls', keys: ['emergency', 'handoff_waiting', 'handoff_missed', 'callback_overdue'] },
  { title: 'Agents', keys: ['agent_failing', 'agent_published'] },
  { title: 'Plan and billing', keys: ['usage_threshold', 'invoice'] },
  { title: 'Reports', keys: ['daily_summary', 'weekly_report'] },
  { title: 'Team', keys: ['team_changes'] },
]

/**
 * /o/:slug/notifications: who in the organisation gets which alert, by
 * email, and quiet hours. Each person can still turn their own emails off
 * on their profile. Owners and admins.
 */
export default function NotificationsPage() {
  const { org } = useOrg()
  const client = useConsole()
  const load = useCallback(async () => {
    const [settings, members] = await Promise.all([client.getAlertSettings(org.orgSlug), client.listMembers(org.orgSlug)])
    return { settings, members: members.filter((m) => m.status === 'active').sort((a, b) => a.name.localeCompare(b.name)) }
  }, [client, org.orgSlug])
  const [data, reload] = useAsync(load)
  const [form, setForm] = useState<AlertSettingsInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (data.state === 'ready') setForm({ rules: data.data.settings.rules, quietHours: data.data.settings.quietHours })
  }, [data])

  const setRule = (key: AlertKey, patch: Partial<AlertRule>) => form && setForm({ ...form, rules: form.rules.map((r) => (r.key === key ? { ...r, ...patch } : r)) })

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setNotice(null)
    try {
      const s = await client.updateAlertSettings(org.orgSlug, form)
      setForm({ rules: s.rules, quietHours: s.quietHours })
      setNotice({ tone: 'ok', text: 'Saved. Alerts follow these choices from now on.' })
    } catch (err) {
      setNotice({ tone: 'error', text: asAuthError(err).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConsolePage
      kicker="Manage"
      title="Notifications"
      docTitle="Notifications"
      lede={
        <p>
          Which alerts {org.orgName}’s team gets, and who gets them, by email. Each person can still turn their own emails off on{' '}
          <Link className="link" to="../profile">
            their profile
          </Link>
          .
        </p>
      }
    >
      {data.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading notifications…</span>
        </div>
      )}
      {data.state === 'error' && (
        <Alert tone="error" title="Couldn't load notifications">
          <p>{asAuthError(data.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {data.state === 'ready' && form && (
        <form className="set-form" onSubmit={save}>
          <p className="row__meta">
            Last changed {shortDate(data.data.settings.updatedAt)} by {data.data.settings.updatedBy}.
          </p>
          {GROUPS.map((g) => (
            <section key={g.title} className="set-card" aria-label={g.title}>
              <h2 className="lib__heading">{g.title}</h2>
              {g.keys.map((k) => {
                const r = form.rules.find((x) => x.key === k)
                return r ? <RuleRow key={k} rule={r} members={data.data.members} onChange={(p) => setRule(k, p)} /> : null
              })}
            </section>
          ))}

          <section className="set-card" aria-label="Quiet hours">
            <h2 className="lib__heading">Quiet hours</h2>
            <Switch
              label="Hold alerts overnight"
              hint="Nothing is sent between these times, except emergency calls. Held alerts arrive when quiet hours end."
              checked={form.quietHours.enabled}
              onChange={(v) => setForm({ ...form, quietHours: { ...form.quietHours, enabled: v } })}
            />
            {form.quietHours.enabled && (
              <div className="set-pair">
                <TextField label="From" type="time" value={form.quietHours.from} onChange={(e) => setForm({ ...form, quietHours: { ...form.quietHours, from: e.target.value } })} />
                <TextField label="Until" type="time" value={form.quietHours.to} onChange={(e) => setForm({ ...form, quietHours: { ...form.quietHours, to: e.target.value } })} />
              </div>
            )}
          </section>

          {notice && (
            <Alert tone={notice.tone} live>
              {notice.text}
            </Alert>
          )}
          <div>
            <Button type="submit" busy={busy} busyLabel="Saving…">
              Save notifications
            </Button>
          </div>
          <p className="row__meta">Alerts are sent by email. Text message and WhatsApp alerts aren’t available yet.</p>
        </form>
      )}
    </ConsolePage>
  )
}

function RuleRow({ rule: r, members, onChange }: { rule: AlertRule; members: Member[]; onChange(patch: Partial<AlertRule>): void }) {
  const a = ALERT[r.key]
  const toggle = <T,>(list: T[], x: T, on: boolean) => (on ? [...new Set([...list, x])] : list.filter((y) => y !== x))
  const count = members.filter((m) => r.roles.includes(m.role) || r.memberIds.includes(m.id)).length
  return (
    <div className={`ntf-rule${r.enabled ? '' : ' ntf-rule--off'}`}>
      <Switch label={a.label} hint={a.hint} checked={r.enabled} onChange={(v) => onChange({ enabled: v })} />
      {r.enabled && (
        <div className="ntf-rule__who">
          <fieldset className="ntf-roles">
            <legend className="field__label">Goes to</legend>
            {ROLES.map((role) => (
              <Checkbox key={role} label={`${ROLE_LABEL[role]}s`} checked={r.roles.includes(role)} onChange={(e) => onChange({ roles: toggle(r.roles, role, e.target.checked) })} />
            ))}
          </fieldset>
          <details className="ntf-people">
            <summary>
              Also named people{r.memberIds.length ? ` (${r.memberIds.length})` : ''}
            </summary>
            <div className="ntf-people__list">
              {members.map((m) => (
                <Checkbox key={m.id} label={`${m.name} (${ROLE_LABEL[m.role]})`} checked={r.memberIds.includes(m.id)} onChange={(e) => onChange({ memberIds: toggle(r.memberIds, m.id, e.target.checked) })} />
              ))}
            </div>
          </details>
          {a.threshold && (
            <TextField
              className="ntf-threshold"
              label={`${a.threshold.label} (${a.threshold.unit})`}
              type="number"
              inputMode="numeric"
              value={r.threshold === undefined ? '' : String(r.threshold)}
              onChange={(e) => onChange({ threshold: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          )}
          <p className="row__meta">
            {count === 0 ? 'Nobody in the team gets this yet.' : `${count} ${count === 1 ? 'person gets' : 'people get'} this now.`}
          </p>
        </div>
      )}
    </div>
  )
}
