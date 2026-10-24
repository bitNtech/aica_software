import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { ROLE_LABEL } from '../../auth/roles'
import { asAuthError, type OrgSummary } from '../../auth/types'
import { StatusPill } from '../../components/console/StatusPill'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Spinner'
import { Switch } from '../../components/ui/Switch'
import type { ConsoleClient } from '../../console/types'
import { useAsync } from '../../lib/useAsync'
import { shortDate } from '../../lib/time'
import { useOpsData } from '../../ops/OpsDataProvider'
import type { SecurityPolicy, SecurityPolicyInput } from '../../ops/types'
import { OrgFailures, useAcrossOrgs } from './acrossOrgs'
import { num } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'

const loadMembers = (c: ConsoleClient, o: OrgSummary) => c.listMembers(o.slug)
const NUMBERS: { key: keyof SecurityPolicyInput; label: string; hint: string }[] = [
  { key: 'passwordMinLength', label: 'Shortest password (characters)', hint: 'For every account, 8 to 64.' },
  { key: 'staffSessionHours', label: 'bitNtech sign-in lasts (hours)', hint: 'Then staff sign in again, 1 to 72.' },
  { key: 'memberSessionDays', label: 'Client sign-in lasts (days)', hint: '1 to 90.' },
  { key: 'idleMinutes', label: 'Sign out after idle (minutes)', hint: 'Everyone, 5 to 480.' },
  { key: 'actingMaxMinutes', label: 'Acting as a user lasts (minutes)', hint: 'Always audited, 5 to 120.' },
  { key: 'transcriptRetentionDays', label: 'Keep transcripts (days)', hint: 'Then deleted, 30 to 3650.' },
  { key: 'recordingRetentionDays', label: 'Keep call recordings (days)', hint: 'Then deleted, 7 to 3650.' },
]
/** An invitation not accepted in this long has lapsed (links last 7 days). */
const INVITE_DAYS = 7
/** Members who haven't signed in for this long are worth a look. */
const QUIET_DAYS = 60

/** /ops/security: sign-in and data policies for everyone, and who has access to each organisation. Master admin only. */
export default function OpsSecurityPage() {
  const { user } = useAuth()
  if (user?.platformRole !== 'master_admin') return <Navigate to="/ops" replace />
  return (
    <OpsLayout
      kicker="Security"
      docTitle="Security and access"
      title="Security and access"
      lede={
        <p>
          How sign-in works and how long call data is kept, for every organisation, and who can get in. bitNtech accounts are in <Link className="link" to="/ops/people">People</Link>; every change is in the{' '}
          <Link className="link" to="/ops/audit">audit log</Link>.
        </p>
      }
    >
      <Policies />
      <AccessReview />
    </OpsLayout>
  )
}

function Policies() {
  const ops = useOpsData()
  const load = useCallback(() => ops.getSecurityPolicy(), [ops])
  const [policy, reload, setPolicy] = useAsync(load)
  const [form, setForm] = useState<SecurityPolicyInput | null>(null)
  const [ranges, setRanges] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (policy.state !== 'ready') return
    const { updatedAt: _a, updatedBy: _b, ...rest } = policy.data
    setForm(rest)
    setRanges(rest.staffIpRanges.join('\n'))
  }, [policy])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setNotice(null)
    try {
      const saved: SecurityPolicy = await ops.updateSecurityPolicy({ ...form, staffIpRanges: ranges.split(/[\s,]+/).filter(Boolean) })
      setPolicy({ state: 'ready', data: saved })
      setNotice({ tone: 'ok', text: 'Saved. New sign-ins follow these rules; people already signed in keep theirs until it ends.' })
    } catch (err) {
      setNotice({ tone: 'error', text: asAuthError(err).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ops-section" aria-labelledby="sec-pol">
      <div className="ops-section__head">
        <h2 id="sec-pol" className="ops-section__title">
          Policies
        </h2>
        {ops.isDemo && <span className="demo-chip">Demo data</span>}
        {policy.state === 'ready' && (
          <p className="ops-section__note">
            Changed {shortDate(policy.data.updatedAt)} by {policy.data.updatedBy}
          </p>
        )}
      </div>
      {policy.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading policies…</span>
        </div>
      )}
      {policy.state === 'error' && (
        <Alert tone="error" title="Couldn't load the policies">
          <p>{asAuthError(policy.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {form && (
        <form className="ops-form ops-form--wide" onSubmit={save}>
          {notice && (
            <Alert tone={notice.tone} live>
              {notice.text}
            </Alert>
          )}
          <fieldset className="ops-fieldset">
            <legend className="ops-section__title">Two-step sign-in</legend>
            <Switch label="Required for bitNtech staff" hint="A code from an authenticator app, as well as the password." checked={form.staffTwoStep} onChange={(v) => setForm({ ...form, staffTwoStep: v })} />
            <SelectField
              label="Required in client organisations for"
              value={form.memberTwoStep}
              onChange={(e) => setForm({ ...form, memberTwoStep: e.target.value as SecurityPolicyInput['memberTwoStep'] })}
              options={[
                { value: 'off', label: 'Nobody (optional for everyone)' },
                { value: 'owners', label: 'Owners and admins' },
                { value: 'everyone', label: 'Everyone' },
              ]}
            />
          </fieldset>
          <div className="ops-form__row">
            {NUMBERS.map((n) => (
              <TextField
                key={n.key}
                label={n.label}
                hint={n.hint}
                type="number"
                inputMode="numeric"
                value={String(form[n.key])}
                onChange={(e) => setForm({ ...form, [n.key]: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
            ))}
          </div>
          <TextAreaField
            label="Ops can be opened only from (address ranges)"
            hint="One range per line, like 203.0.113.0/24. Leave empty to allow anywhere. Check your own address is included before saving."
            rows={3}
            className="ops-ranges"
            value={ranges}
            onChange={(e) => setRanges(e.target.value)}
          />
          <p className="row__meta">Callers’ names, numbers and transcripts are shown to the master admin only; staff see calls without them. This isn’t a setting.</p>
          <div className="ops-form__actions">
            <Button type="submit" busy={busy} busyLabel="Saving…">
              Save policies
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

function AccessReview() {
  const across = useAcrossOrgs(loadMembers)
  const now = Date.now()
  const rows = across.results ?? []
  const people = rows.flatMap((r) => (r.data ?? []).map((m) => ({ ...m, org: r.org })))
  const lapsed = people.filter((m) => m.status === 'invited' && m.invitedAt && now - Date.parse(m.invitedAt) > INVITE_DAYS * 864e5)
  const quiet = people.filter((m) => m.status === 'active' && (!m.lastActiveAt || now - Date.parse(m.lastActiveAt) > QUIET_DAYS * 864e5))
  const custom = people.filter((m) => m.status === 'active' && m.permissions)

  return (
    <section className="ops-section" aria-labelledby="sec-acc">
      <div className="ops-section__head">
        <h2 id="sec-acc" className="ops-section__title">
          Access review
        </h2>
        <p className="ops-section__note">Client organisations’ teams</p>
      </div>
      {across.error ? (
        <Alert tone="error" title="Couldn't load organisations">
          <p>{asAuthError(across.error).message}</p>
        </Alert>
      ) : !across.results ? (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading teams…</span>
        </div>
      ) : (
        <>
          <OrgFailures results={rows} onRetry={across.reload} />
          <dl className="kpis ops-gap-b">
            <div className="kpi">
              <dt className="kpi__label">People with access</dt>
              <dd className="kpi__value num">{num(people.filter((m) => m.status === 'active').length)}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Owners and admins</dt>
              <dd className="kpi__value num">{num(people.filter((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin')).length)}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Not signed in for {QUIET_DAYS} days</dt>
              <dd className="kpi__value num">{num(quiet.length)}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Lapsed invitations</dt>
              <dd className="kpi__value num">{num(lapsed.length)}</dd>
            </div>
          </dl>
          <div className="ops-table" role="region" aria-label="Access by organisation" tabIndex={0}>
            <table className="op-table ops-left">
              <thead>
                <tr>
                  <th scope="col">Organisation</th>
                  <th scope="col">Active</th>
                  <th scope="col">Owners and admins</th>
                  <th scope="col">Own permissions</th>
                  <th scope="col">Worth a look</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ms = r.data ?? []
                  const look = [...quiet, ...lapsed].filter((m) => m.org.slug === r.org.slug)
                  return (
                    <tr key={r.org.slug}>
                      <th scope="row">
                        <Link className="row__link" to={`/ops/orgs/${r.org.slug}/team`}>
                          {r.org.name}
                        </Link>
                      </th>
                      <td className="num">{num(ms.filter((m) => m.status === 'active').length)}</td>
                      <td>
                        {ms
                          .filter((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin'))
                          .map((m) => `${m.name} (${ROLE_LABEL[m.role]})`)
                          .join(', ') || '—'}
                      </td>
                      <td className="num">{num(custom.filter((m) => m.org.slug === r.org.slug).length)}</td>
                      <td>
                        {look.length === 0 ? (
                          <span className="ops-muted">Nothing</span>
                        ) : (
                          <>
                            <StatusPill tone="warn">{look.length === 1 ? '1 person' : `${look.length} people`}</StatusPill>
                            <span className="ops-cell-sub">{look.map((m) => m.name).join(', ')}</span>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="row__meta">“Worth a look”: not signed in for {QUIET_DAYS} days, or an invitation older than {INVITE_DAYS} days. Remove or re-invite them from the organisation’s team page.</p>
        </>
      )}
    </section>
  )
}
