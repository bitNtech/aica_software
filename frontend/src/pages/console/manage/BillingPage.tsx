import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { asAuthError } from '../../../auth/types'
import { useConsole } from '../../../console/ConsoleProvider'
import type { Billing, BillingDetails, Plan, PlanId } from '../../../console/types'
import { useOrg } from '../../../console/useOrg'
import { ConsolePage } from '../../../components/console/ConsolePage'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/Dialog'
import { TextField } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Spinner'
import { useAsync } from '../../../lib/useAsync'
import { shortDate } from '../../../lib/time'
import { useAnnouncer } from '../operate/LiveBits'
import '../library/Library.css'
import '../operate/Operate.css'
import './Manage.css'

const rupees = (n: number) => n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const num = (n: number) => n.toLocaleString('en-IN')
const STATUS_LABEL = { paid: 'Paid', due: 'Due', failed: 'Payment failed' } as const

/** /o/:slug/billing: plan, usage, invoices, payment. Owners only. */
export default function BillingPage() {
  const { org, access } = useOrg()
  const client = useConsole()
  const load = useCallback(() => client.getBilling(org.orgSlug), [client, org.orgSlug])
  const [billing, reload, setBilling] = useAsync(load)
  const [note, say] = useAnnouncer()
  const update = (b: Billing, text: string) => {
    setBilling({ state: 'ready', data: b })
    say(text)
  }

  return (
    <ConsolePage kicker="Manage" title="Billing and plan" docTitle="Billing and plan" lede={<p>Your plan, this month’s use, invoices and how you pay. {access.platform ? 'Owners see this page too; changes you make here are logged as bitNtech’s.' : 'Only owners (and bitNtech’s master admin) see this page.'}</p>}>
      <p className="sr-only" role="status">
        {note}
      </p>
      {billing.state === 'loading' && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading billing…</span>
        </div>
      )}
      {billing.state === 'error' && (
        <Alert tone="error" title="Couldn't load billing">
          <p>{asAuthError(billing.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {billing.state === 'ready' && (
        <>
          <PlanAndUsage billing={billing.data} onChanged={update} />
          <Plans billing={billing.data} onChanged={update} />
          <Payment billing={billing.data} onChanged={update} />
          <Invoices billing={billing.data} />
        </>
      )}
    </ConsolePage>
  )
}

function PlanAndUsage({ billing: b, onChanged }: { billing: Billing; onChanged(b: Billing, text: string): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const plan = b.plans.find((p) => p.id === b.plan)!
  const pending = b.plans.find((p) => p.id === b.pendingPlan)
  const share = b.usage.minutes / plan.minutes
  const over = Math.max(0, b.usage.minutes - plan.minutes)
  // A straight line to the end of the period, from the days gone.
  const start = new Date(b.renewsOn)
  start.setMonth(start.getMonth() - 1)
  const total = (Date.parse(b.renewsOn) - start.getTime()) / 864e5
  const gone = Math.max(1, Math.min(total, (Date.now() - start.getTime()) / 864e5))
  const projected = Math.round((b.usage.minutes / gone) * total)

  async function keep() {
    setBusy(true)
    setError(null)
    try {
      onChanged(await client.changePlan(org.orgSlug, null), `You stay on ${plan.name}.`)
      // The button is gone with the pending change.
      window.setTimeout(() => heading.current?.focus(), 0)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lib__section" aria-labelledby={`${id}-h`}>
      <h2 className="lib__heading" id={`${id}-h`} ref={heading} tabIndex={-1}>
        Your plan
      </h2>
      <div className="bill-now">
        <div className="bill-now__plan">
          <p className="bill-now__name">{plan.name}</p>
          <p className="bill-now__price">
            {rupees(plan.price)} <span>a month, plus GST</span>
          </p>
          <p className="row__meta">Renews on {shortDate(b.renewsOn)}.</p>
          {pending && (
            <div className="bill-now__pending">
              <p>
                Moves to <strong>{pending.name}</strong> on {shortDate(b.renewsOn)}.
              </p>
              <Button variant="line" size="sm" busy={busy} busyLabel="Saving…" onClick={() => void keep()}>
                Stay on {plan.name}
              </Button>
              {error && (
                <p className="field__error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="bill-now__use">
          <p className="bill-use__label">Call minutes this month</p>
          <p className="bill-use__value">
            {num(b.usage.minutes)} <span>of {num(plan.minutes)}</span>
          </p>
          <div className={`bill-meter${share > 1 ? ' bill-meter--over' : share > 0.8 ? ' bill-meter--near' : ''}`} aria-hidden="true">
            <span style={{ width: `${Math.min(100, share * 100)}%` }} />
          </div>
          <p className="row__meta">
            {over > 0
              ? `${num(over)} minutes over: about ${rupees(over * plan.extraMinute)} extra, plus GST, on the next invoice.`
              : `${Math.round(share * 100)}% used. At this rate, about ${num(projected)} by the end of the month${projected > plan.minutes ? `: ${num(projected - plan.minutes)} over, at ${rupees(plan.extraMinute)} a minute` : ''}.`}
          </p>
          <dl className="lib-facts bill-facts">
            <div>
              <dt>Calls</dt>
              <dd>{num(b.usage.calls)}</dd>
            </div>
            <div>
              <dt>Recordings processed</dt>
              <dd>{b.usage.uploadHours} hours</dd>
            </div>
            <div>
              <dt>Plan allows</dt>
              <dd>
                {plan.agents} {plan.agents === 1 ? 'agent' : 'agents'}, {plan.numbers} {plan.numbers === 1 ? 'number' : 'numbers'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}

function Plans({ billing: b, onChanged }: { billing: Billing; onChanged(b: Billing, text: string): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const id = useId()
  const [choosing, setChoosing] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = b.plans.find((p) => p.id === b.plan)!
  const up = !!choosing && choosing.price > current.price

  async function change(planId: PlanId) {
    setBusy(true)
    setError(null)
    try {
      const next = await client.changePlan(org.orgSlug, planId)
      setChoosing(null)
      const p = next.plans.find((x) => x.id === planId)!
      onChanged(next, up ? `You’re on ${p.name} now.` : `You move to ${p.name} on ${shortDate(next.renewsOn)}.`)
      // Its button is gone: once the dialog has closed, focus the plan.
      window.setTimeout(() => document.getElementById(`${id}-${planId}`)?.focus(), 0)
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lib__section" aria-labelledby={`${id}-h`}>
      <h2 className="lib__heading" id={`${id}-h`}>
        Plans
      </h2>
      <p className="lib__sub">Upgrades start now, charged for the rest of the month. Moving to a smaller plan happens when your plan renews. Prices are for the demo.</p>
      <ul className="bill-plans">
        {b.plans.map((p) => {
          const mine = p.id === b.plan
          const next = p.id === b.pendingPlan
          return (
            <li key={p.id} className={`bill-plan${mine ? ' bill-plan--mine' : ''}`} aria-labelledby={`${id}-${p.id}`}>
              <h3 className="bill-plan__name" id={`${id}-${p.id}`} tabIndex={-1}>
                {p.name}
                {mine && <span className="op-badge bill-plan__badge">Your plan</span>}
                {next && <span className="op-badge bill-plan__badge">From {shortDate(b.renewsOn)}</span>}
              </h3>
              <p className="bill-plan__price">
                {rupees(p.price)} <span>a month</span>
              </p>
              <ul className="bill-plan__list">
                <li>{num(p.minutes)} call minutes</li>
                <li>
                  {p.agents} {p.agents === 1 ? 'agent' : 'agents'}, {p.numbers} {p.numbers === 1 ? 'number' : 'numbers'}
                </li>
                <li>{rupees(p.extraMinute)} a minute after that</li>
              </ul>
              {!mine && !next && (
                <Button
                  variant={p.price > current.price ? 'plum' : 'line'}
                  size="sm"
                  onClick={() => {
                    setError(null)
                    setChoosing(p)
                  }}
                >
                  {p.price > current.price ? 'Upgrade' : 'Move'} to {p.name}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <ConfirmDialog
        open={!!choosing}
        title={choosing ? (up ? `Upgrade to ${choosing.name}?` : `Move to ${choosing.name}?`) : ''}
        confirmLabel={up ? 'Upgrade now' : `Move on ${shortDate(b.renewsOn)}`}
        busyLabel="Saving…"
        busy={busy}
        error={error}
        onConfirm={() => choosing && void change(choosing.id)}
        onCancel={() => setChoosing(null)}
      >
        {choosing &&
          (up ? (
            <p>
              {choosing.name} starts now, with {num(choosing.minutes)} minutes a month. The rest of this month is charged at the difference, {rupees(choosing.price - current.price)} for a full month, plus GST, to {b.paymentMethod ?? 'your payment method'}.
            </p>
          ) : (
            <p>
              You keep {current.name} until {shortDate(b.renewsOn)}, then pay {rupees(choosing.price)} a month for {num(choosing.minutes)} minutes. You can change your mind before then.
            </p>
          ))}
      </ConfirmDialog>
    </section>
  )
}

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function Payment({ billing: b, onChanged }: { billing: Billing; onChanged(b: Billing, text: string): void }) {
  const client = useConsole()
  const { org } = useOrg()
  const id = useId()
  const [form, setForm] = useState<BillingDetails>(b.details)
  const [errors, setErrors] = useState<Partial<Record<keyof BillingDetails, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(b.details)

  // The saved details changed (e.g. after saving): show them.
  const saved = JSON.stringify(b.details)
  useEffect(() => setForm(JSON.parse(saved) as BillingDetails), [saved])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy || !dirty) return
    const found: typeof errors = {}
    if (form.legalName.trim().length < 2) found.legalName = 'Give the name invoices are made out to.'
    if (!EMAIL.test(form.email.trim())) found.email = 'Enter the email invoices go to, like accounts@hospital.in.'
    if (form.gstin.trim() && !GSTIN.test(form.gstin.trim().toUpperCase())) found.gstin = 'A GST number has 15 characters, like 33AABCA1234F1Z5.'
    setErrors(found)
    setError(null)
    if (Object.keys(found).length) {
      window.setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0)
      return
    }
    setBusy(true)
    try {
      onChanged(await client.updateBillingDetails(org.orgSlug, form), 'Billing details saved.')
    } catch (err) {
      setError(asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lib__section" aria-labelledby={`${id}-h`}>
      <h2 className="lib__heading" id={`${id}-h`}>
        Payment and invoice details
      </h2>
      <div className="bill-pay">
        <div className="bill-pay__method">
          <p className="bill-use__label">Paid with</p>
          <p className="bill-pay__card">{b.paymentMethod ?? 'No payment method yet'}</p>
          <p className="row__meta" id={`${id}-pm`}>
            Card and UPI details are entered on the payment provider’s secure page, never in AICA. Not available with demo data.
          </p>
          <Button variant="line" size="sm" aria-disabled="true" aria-describedby={`${id}-pm`}>
            Change payment method
          </Button>
        </div>
        <form ref={formRef} className="bill-pay__form" onSubmit={save} noValidate>
          <TextField label="Invoices made out to" value={form.legalName} maxLength={120} error={errors.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          <TextField label="Invoices go to" type="email" value={form.email} error={errors.email} spellCheck={false} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <TextField
            label="GST number"
            hint="Optional. On your invoices, so you can claim input tax credit."
            value={form.gstin}
            maxLength={15}
            autoCapitalize="characters"
            spellCheck={false}
            error={errors.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
          />
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <div className="set-bar__row">
            <Button type="submit" variant="plum" size="sm" busy={busy} busyLabel="Saving…" aria-disabled={!dirty || undefined}>
              Save details
            </Button>
            {dirty && <span className="set-bar__state">Unsaved changes</span>}
          </div>
        </form>
      </div>
    </section>
  )
}

function Invoices({ billing: b }: { billing: Billing }) {
  const id = useId()
  return (
    <section className="lib__section" aria-labelledby={`${id}-h`}>
      <h2 className="lib__heading" id={`${id}-h`}>
        Invoices
      </h2>
      {b.invoices.length === 0 ? (
        <p className="empty-note">No invoices yet. The first comes at the end of your first month.</p>
      ) : (
        <>
          <div className="bill-table" role="region" aria-labelledby={`${id}-h`} tabIndex={0}>
            <table className="op-table bill-invoices">
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">For</th>
                  <th scope="col">Issued</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {b.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <th scope="row" className="lib-row__mono">
                      {inv.number}
                    </th>
                    <td>{inv.period}</td>
                    <td>{shortDate(inv.issuedAt)}</td>
                    <td>{rupees(inv.amount)}</td>
                    <td>
                      <span className={`status-chip status-chip--inv-${inv.status}`}>{STATUS_LABEL[inv.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="row__meta">Amounts include 18% GST. Invoice PDFs come from the billing system, and aren’t available with demo data.</p>
        </>
      )}
    </section>
  )
}
