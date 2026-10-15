import type { Language } from '../../auth/types'
import type { ActivityEntry, Billing, DayHours, Invoice, OrgSettings, Plan } from '../types'
import { ago, DAY } from './runtime'

/** Sample data for the Manage pages: settings, the activity log, billing. */

const ORGS: Record<string, { name: string; city: string; languages: Language[] }> = {
  'arogya-demo': { name: 'Arogya Demo Hospital', city: 'Coimbatore', languages: ['tamil', 'english', 'tanglish'] },
  'nila-eye-demo': { name: 'Nila Eye Clinic (demo)', city: 'Madurai', languages: ['tamil', 'tanglish'] },
}

const day = (open: boolean, from = '08:00', to = '20:00'): DayHours => ({ open, from, to })

export function seedSettings(slug: string): OrgSettings {
  const o = ORGS[slug] ?? { name: slug, city: '', languages: ['tamil', 'english'] }
  const year = new Date().getFullYear()
  return {
    ...o,
    // Monday to Saturday 8 to 8, Sunday mornings.
    hours: [day(true), day(true), day(true), day(true), day(true), day(true, '08:00', '14:00'), day(true, '09:00', '13:00')],
    closed: [
      { date: `${year}-10-20`, label: 'Deepavali' },
      { date: `${year}-12-25`, label: 'Christmas' },
      { date: `${year + 1}-01-15`, label: 'Pongal' },
    ],
    updatedAt: ago(21),
    updatedBy: slug === 'arogya-demo' ? 'Lakshmi K' : 'Karthik R',
  }
}

/** Prices are placeholders until bitNtech's plans are agreed. */
export const PLANS: Plan[] = [
  { id: 'starter', name: 'Starter', price: 4999, minutes: 1000, agents: 1, numbers: 2, extraMinute: 6 },
  { id: 'growth', name: 'Growth', price: 14999, minutes: 4000, agents: 5, numbers: 5, extraMinute: 5 },
  { id: 'scale', name: 'Scale', price: 39999, minutes: 12000, agents: 15, numbers: 15, extraMinute: 4 },
]

const IST = 5.5 * 36e5
/** The current billing period: the calendar month, in India. */
export function billingPeriod(now = Date.now()) {
  const d = new Date(now + IST)
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - IST
  return { start, end, daysSoFar: Math.floor((now - start) / DAY) + 1 }
}

const MONTH = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function seedBilling(slug: string): Omit<Billing, 'plans' | 'usage'> {
  const plan = slug === 'arogya-demo' ? 'growth' : 'starter'
  const price = PLANS.find((p) => p.id === plan)!.price
  const d = new Date(Date.now() + IST)
  const invoices: Invoice[] = Array.from({ length: 6 }, (_, i) => {
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() - 1 - i
    const issued = new Date(Date.UTC(y, m + 1, 1, 4, 30))
    // A small overage some months, as real usage would have.
    const extra = [0, 410, 0, 0, 120, 0][i] * 5
    return {
      id: `inv_${i}`,
      number: `AICA/${issued.getUTCFullYear()}/${String(118 - i * 7).padStart(4, '0')}`,
      issuedAt: issued.toISOString(),
      period: MONTH(y, m),
      amount: Math.round((price + extra) * 1.18),
      status: 'paid',
    }
  })
  return {
    plan,
    pendingPlan: null,
    renewsOn: new Date(billingPeriod().end).toISOString(),
    paymentMethod: 'Visa ending 4242',
    details: {
      legalName: slug === 'arogya-demo' ? 'Arogya Health Services Pvt Ltd' : (ORGS[slug]?.name ?? slug),
      email: 'accounts@example.com',
      gstin: slug === 'arogya-demo' ? '33AABCA1234F1Z5' : '',
    },
    invoices,
  }
}

const h = (days: number, hour = 0) => new Date(Date.now() - days * DAY - hour * 36e5).toISOString()

/** What happened in the organisation, newest first. */
export function seedActivity(slug: string): ActivityEntry[] {
  let n = 0
  const e = (at: string, actor: string, actorId: string | undefined, area: ActivityEntry['area'], text: string, detail?: string): ActivityEntry => ({
    id: `act_seed_${n++}`,
    at,
    actor,
    actorKind: actorId ? 'member' : actor === 'AICA' ? 'aica' : 'bitntech',
    ...(actorId ? { actorId } : {}),
    area,
    text,
    ...(detail ? { detail } : {}),
  })
  if (slug !== 'arogya-demo') return [e(h(30), 'Karthik R', 'u_admin', 'team', 'Created the organisation')]
  const K = ['Karthik R', 'u_admin'] as const
  const L = ['Lakshmi K', 'u_owner'] as const
  return [
    e(h(0, 3), ...K, 'agents', 'Published OPD appointments, version 4', 'Added the Saturday OPD timings.'),
    e(h(0, 5), ...K, 'library', 'Re-read the knowledge source “Doctor schedule, October 2026”'),
    e(h(1, 2), ...K, 'team', 'Invited newstaff@example.com as Supervisor'),
    e(h(2, 6), 'Vikram S', undefined, 'access', 'Signed in as Karthik R for 30 minutes', 'Reason given: helping set up the lab reports line.'),
    e(h(2, 7), 'AICA', undefined, 'library', 'Couldn’t read the knowledge source “Insurance partners”', 'The page asked for a sign-in. Upload the list as a file instead.'),
    e(h(4, 1), ...K, 'library', 'Changed the secret LIS_TOKEN', 'The value isn’t shown here or anywhere else.'),
    e(h(5, 4), ...K, 'agents', 'Published OPD appointments, version 3', 'Shorter greeting; asks for the patient ID earlier.'),
    e(h(6, 2), ...L, 'settings', 'Changed the business hours', 'Sunday: 9 AM to 1 PM.'),
    e(h(9, 0), ...K, 'agents', 'Paused Lab report status', 'Until the lab system’s new address is ready.'),
    e(h(11, 3), ...K, 'team', 'Changed Suresh B’s role from Viewer to Front desk'),
    e(h(12, 5), ...L, 'billing', 'Changed the plan from Starter to Growth'),
    e(h(14, 1), ...K, 'library', 'Added the tool “Look up report status”'),
    e(h(18, 6), ...K, 'agents', 'Published Main reception, version 2', 'Hands over emergencies straight away.'),
    e(h(21, 2), ...L, 'settings', 'Added the closed day Deepavali'),
    e(h(26, 4), ...L, 'team', 'Added Arun V as Viewer'),
    e(h(33, 0), ...K, 'library', 'Added the knowledge source “OPD and lab price list”'),
    e(h(40, 3), ...K, 'library', 'Set the secret HIS_API_KEY', 'The value isn’t shown here or anywhere else.'),
    e(h(44, 1), ...K, 'agents', 'Published OPD appointments, version 1', 'First version, from the builder.'),
    e(h(52, 2), ...L, 'team', 'Made Karthik R an Admin'),
    e(h(60, 0), ...L, 'billing', 'Added the payment method Visa ending 4242'),
    e(h(120, 0), ...L, 'team', 'Created the organisation'),
  ]
}
