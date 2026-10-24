import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { asAuthError, type OrgSummary } from '../../auth/types'
import { SegFilter } from '../../components/console/ListTools'
import { StatusPill } from '../../components/console/StatusPill'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import type { ConsoleClient, Invoice } from '../../console/types'
import { shortDate } from '../../lib/time'
import { OrgFailures, useAcrossOrgs } from './acrossOrgs'
import { num } from './overview/bits'
import '../console/operate/Operate.css'
import './Ops.css'

const load = (c: ConsoleClient, o: OrgSummary) => c.getBilling(o.slug)
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`
const INVOICE: Record<Invoice['status'], { tone: 'ok' | 'warn' | 'danger'; label: string }> = {
  paid: { tone: 'ok', label: 'Paid' },
  due: { tone: 'warn', label: 'Due' },
  failed: { tone: 'danger', label: 'Payment failed' },
}
type InvFilter = 'unpaid' | 'all'

/** /ops/billing: every organisation's plan, usage against it, payment method and invoices. Master admin only. */
export default function OpsBillingPage() {
  const { user } = useAuth()
  const across = useAcrossOrgs(load)
  const [inv, setInv] = useState<InvFilter>('unpaid')
  if (user?.platformRole !== 'master_admin') return <Navigate to="/ops" replace />

  const rows = across.results ?? []
  const billed = rows.filter((r) => r.data)
  const invoices = billed.flatMap((r) => r.data!.invoices.map((i) => ({ ...i, org: r.org }))).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
  const unpaid = invoices.filter((i) => i.status !== 'paid')
  const planOf = (r: (typeof billed)[number]) => r.data!.plans.find((p) => p.id === r.data!.plan)
  const monthly = billed.reduce((s, r) => s + (planOf(r)?.price ?? 0), 0)

  return (
    <OpsLayout
      kicker="Billing"
      docTitle="Billing and subscriptions"
      title="Billing and subscriptions"
      lede={
        <p>
          Each organisation’s plan, minutes used this period, how they pay and their invoices. Change prices and plans in <Link className="link" to="/ops/platform">Platform settings</Link>; change one organisation’s plan from its billing page.
        </p>
      }
    >
      {across.error ? (
        <Alert tone="error" title="Couldn't load organisations">
          <p>{asAuthError(across.error).message}</p>
          <button type="button" className="btn-text" onClick={across.reload}>
            Try again
          </button>
        </Alert>
      ) : !across.results ? (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading billing…</span>
        </div>
      ) : (
        <>
          <OrgFailures results={rows} onRetry={across.reload} />
          <dl className="kpis ops-gap-b">
            <div className="kpi">
              <dt className="kpi__label">Paying organisations</dt>
              <dd className="kpi__value num">{num(billed.length)}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Plans a month</dt>
              <dd className="kpi__value num">{rupees(monthly)}</dd>
              <dd className="kpi__sub">Before extra minutes</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Unpaid invoices</dt>
              <dd className="kpi__value num">{num(unpaid.length)}</dd>
              <dd className="kpi__sub">{rupees(unpaid.reduce((s, i) => s + i.amount, 0))}</dd>
            </div>
            <div className="kpi">
              <dt className="kpi__label">Failed payments</dt>
              <dd className="kpi__value num">{num(invoices.filter((i) => i.status === 'failed').length)}</dd>
            </div>
          </dl>

          <section className="ops-section" aria-labelledby="bill-subs">
            <div className="ops-section__head">
              <h2 id="bill-subs" className="ops-section__title">
                Subscriptions
              </h2>
            </div>
            <div className="ops-table" role="region" aria-labelledby="bill-subs" tabIndex={0}>
              <table className="op-table ops-left">
                <thead>
                  <tr>
                    <th scope="col">Organisation</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Minutes this period</th>
                    <th scope="col">Renews</th>
                    <th scope="col">Pays by</th>
                  </tr>
                </thead>
                <tbody>
                  {billed.map((r) => {
                    const b = r.data!
                    const plan = planOf(r)
                    const share = plan ? b.usage.minutes / plan.minutes : 0
                    const pending = b.pendingPlan ? b.plans.find((p) => p.id === b.pendingPlan) : null
                    return (
                      <tr key={r.org.slug}>
                        <th scope="row">
                          <Link className="row__link" to={`/ops/orgs/${r.org.slug}/billing`}>
                            {r.org.name}
                          </Link>
                          {r.org.status !== 'active' && <span className="ops-cell-sub">Suspended</span>}
                        </th>
                        <td>
                          {plan ? `${plan.name}, ${rupees(plan.price)} a month` : b.plan}
                          {pending && <span className="ops-cell-sub">Moving to {pending.name} at renewal</span>}
                        </td>
                        <td className={share > 1 ? 'ops-over' : undefined}>
                          {num(b.usage.minutes)} of {plan ? num(plan.minutes) : '—'} ({Math.round(share * 100)}%)
                          {share > 1 && plan && <span className="ops-cell-sub">{num(b.usage.minutes - plan.minutes)} extra at {rupees(plan.extraMinute)} each</span>}
                        </td>
                        <td>{shortDate(b.renewsOn)}</td>
                        <td>{b.paymentMethod ?? <StatusPill tone="warn">No payment method</StatusPill>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ops-section" aria-labelledby="bill-inv">
            <div className="ops-section__head">
              <h2 id="bill-inv" className="ops-section__title">
                Invoices
              </h2>
              <p className="ops-section__note">Newest first</p>
            </div>
            <div className="list-tools">
              <SegFilter<InvFilter>
                legend="Show"
                value={inv}
                onChange={setInv}
                options={[
                  { value: 'unpaid', label: 'Unpaid', count: unpaid.length },
                  { value: 'all', label: 'All', count: invoices.length },
                ]}
              />
            </div>
            {(inv === 'unpaid' ? unpaid : invoices).length === 0 ? (
              <p className="empty-note">{inv === 'unpaid' ? 'Every invoice is paid.' : 'No invoices yet.'}</p>
            ) : (
              <div className="ops-table" role="region" aria-labelledby="bill-inv" tabIndex={0}>
                <table className="op-table ops-left">
                  <thead>
                    <tr>
                      <th scope="col">Invoice</th>
                      <th scope="col">Organisation</th>
                      <th scope="col">Period</th>
                      <th scope="col">Issued</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(inv === 'unpaid' ? unpaid : invoices).map((i) => (
                      <tr key={`${i.org.slug}/${i.id}`}>
                        <th scope="row">{i.number}</th>
                        <td>{i.org.name}</td>
                        <td>{i.period}</td>
                        <td>{shortDate(i.issuedAt)}</td>
                        <td className="num">{rupees(i.amount)}</td>
                        <td>
                          <StatusPill tone={INVOICE[i.status].tone}>{INVOICE[i.status].label}</StatusPill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="row__meta">Payment methods are shown as the payment provider reports them; card numbers never reach AICA.</p>
          </section>
        </>
      )}
    </OpsLayout>
  )
}
