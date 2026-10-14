import { useCallback, useId } from 'react'
import { Link, useLocation } from 'react-router'
import { ROLE_LABEL } from '../auth/roles'
import { asAuthError } from '../auth/types'
import { canOpen, navFor, PAGE_LABEL, type PageKey } from '../console/access'
import { useConsole } from '../console/ConsoleProvider'
import type { Appointment, Callback, Handoff, LiveCall, Report } from '../console/types'
import { useOrg } from '../console/useOrg'
import { ConsolePage } from '../components/console/ConsolePage'
import { StatTile } from '../components/console/StatTile'
import { Alert } from '../components/ui/Alert'
import { Spinner } from '../components/ui/Spinner'
import { localDay } from '../lib/time'
import { StaleNote } from './console/operate/LiveBits'
import { duration, points, share, since, useLiveData, useNow } from './console/operate/shared'
import './console/operate/Operate.css'

interface Today {
  report: Report | null
  live: LiveCall[] | null
  handoffs: Handoff[] | null
  callbacks: Callback[] | null
  appointments: Appointment[] | null
}

/** /o/:slug: today at a glance. What shows depends on the role: the front
 * desk see the work waiting for them first; managers see today's numbers. */
export default function ConsoleHomePage() {
  const { user, org } = useOrg()
  const client = useConsole()
  const id = useId()
  // Set by RequireOrgPage when this role can't open the page asked for.
  const denied = (useLocation().state as { deniedPage?: PageKey } | null)?.deniedPage
  const pages = navFor(org.role)
    .flatMap((s) => s.items)
    .filter((i) => i.page !== 'home')
  const may = (p: PageKey) => canOpen(org.role, p)

  const load = useCallback(async (): Promise<Today> => {
    const today = localDay(0)
    const [report, live, handoffs, callbacks, appointments] = await Promise.all([
      may('reports') ? client.getReport(org.orgSlug, { days: 1 }) : null,
      may('live') ? client.listLiveCalls(org.orgSlug) : null,
      may('handoffs') ? client.listHandoffs(org.orgSlug) : null,
      may('callbacks') ? client.listCallbacks(org.orgSlug) : null,
      may('appointments') ? client.listAppointments(org.orgSlug, today, today) : null,
    ])
    return { report, live, handoffs, callbacks, appointments }
    // `may` reads only org.role.
  }, [client, org.orgSlug, org.role])
  const today = useLiveData(load, 15000)
  const now = useNow(15000)
  const t = today.data
  const waiting = t?.handoffs?.filter((h) => h.status === 'waiting') ?? []
  const openCallbacks = t?.callbacks?.filter((c) => c.status === 'open' && (org.role !== 'front_desk' || c.assignedTo?.id === user.id || !c.assignedTo)) ?? []
  const overdue = openCallbacks.filter((c) => Date.parse(c.dueBy) < now)
  const toCheck = t?.appointments?.filter((a) => a.status === 'needs_check') ?? []
  const base = `/o/${org.orgSlug}`

  return (
    <ConsolePage
      kicker="Home"
      docTitle="Home"
      title={
        <>
          You're <em>in,</em> {user.name.split(' ')[0]}.
        </>
      }
      lede={
        <p>
          Signed in to <strong className="console__em">{org.orgName}</strong> as {ROLE_LABEL[org.role].toLowerCase()}.
        </p>
      }
    >
      {denied && denied in PAGE_LABEL && (
        <Alert tone="info" className="home-denied">
          {upperFirst(PAGE_LABEL[denied])} isn't part of the {ROLE_LABEL[org.role].toLowerCase()} role here. If you need it, ask an
          owner or admin of {org.orgName}.
        </Alert>
      )}

      {!t && !today.error && (
        <div className="loading-row" role="status">
          <Spinner />
          <span>Loading today…</span>
        </div>
      )}
      {!t && today.error ? (
        <Alert tone="error" title="Couldn't load today">
          <p>{asAuthError(today.error).message}</p>
          <button type="button" className="btn-text" onClick={today.reload}>
            Try again
          </button>
        </Alert>
      ) : null}
      {t && today.error ? <StaleNote error={today.error} checkedAt={today.checkedAt} onRetry={today.reload} /> : null}

      {t && (t.handoffs || t.callbacks || t.appointments || t.live) && (
        <section className="op-section" aria-labelledby={`${id}-now`}>
          <h2 id={`${id}-now`} className="op-section__title">
            Needs a person
          </h2>
          <ul className="home-attn">
            {t.handoffs && (
              <AttnCard
                to={`${base}/handoffs`}
                label="Waiting in the handoff queue"
                count={waiting.length}
                urgent={waiting.length > 0}
                detail={waiting.length ? `Longest waiting ${since(waiting[0].waitingSince, now)}` : 'Nobody waiting'}
              />
            )}
            {t.live && <AttnCard to={`${base}/live`} label="Calls in progress" count={t.live.length} urgent={t.live.some((c) => c.flagged && !c.takenBy)} detail={t.live.some((c) => c.flagged && !c.takenBy) ? 'A caller sounds upset' : 'The agents are handling them'} />}
            {t.callbacks && (
              <AttnCard
                to={`${base}/callbacks`}
                label={org.role === 'front_desk' ? 'Callbacks for you or nobody yet' : 'Callbacks to make'}
                count={openCallbacks.length}
                urgent={overdue.length > 0}
                detail={overdue.length ? `${overdue.length} overdue` : 'None overdue'}
              />
            )}
            {t.appointments && (
              <AttnCard
                to={`${base}/appointments`}
                label="Today’s appointments to check"
                count={toCheck.length}
                urgent={false}
                detail={`${t.appointments.filter((a) => a.status !== 'cancelled').length} appointments today`}
              />
            )}
          </ul>
        </section>
      )}

      {t?.report && (
        <section className="op-section" aria-labelledby={`${id}-today`}>
          <div className="op-section__head">
            <h2 id={`${id}-today`} className="op-section__title">
              Today so far
            </h2>
            <Link className="link" to={`${base}/reports`}>
              Reports
            </Link>
          </div>
          <TodayTiles report={t.report} />
        </section>
      )}

      {pages.length > 0 && (
        <section className="ops-section" aria-labelledby={`${id}-pages`}>
          <div className="ops-section__head">
            <h2 id={`${id}-pages`} className="ops-section__title">
              Your pages
            </h2>
          </div>
          <ul className="home-links">
            {pages.map((p) => (
              <li key={p.page}>
                <Link to={`${base}/${p.path}`} className="home-link">
                  <span className="home-link__name">{p.label}</span>
                  <span className="home-link__text">{p.description}</span>
                  <span className="home-link__go" aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ConsolePage>
  )
}

/** A count of something waiting, linking to where it's handled. */
function AttnCard({ to, label, count, detail, urgent }: { to: string; label: string; count: number; detail: string; urgent: boolean }) {
  return (
    <li>
      {/* One name, read in order with pauses: the parts are separate boxes. */}
      <Link to={to} className={`home-attn__card${urgent ? ' is-urgent' : ''}`} aria-label={`${count} ${label.toLowerCase()}. ${urgent ? 'Needs attention: ' : ''}${detail}.`}>
        <span className="home-attn__count">{count}</span>
        <span className="home-attn__label">{label}</span>
        <span className="home-attn__detail">{detail}</span>
      </Link>
    </li>
  )
}

/** Today's headline numbers so far, against yesterday by this time. */
export function TodayTiles({ report: r }: { report: Report }) {
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')
  return (
    <dl className="stats">
      <StatTile label="Calls" value={r.totals.calls.toLocaleString('en-IN')} change={{ now: r.totals.calls, before: r.previous.calls, period: 'yesterday by this time', upIsGood: true }} />
      <StatTile
        label="Answered by the agents"
        value={pct(r.totals.byAgent, r.totals.calls)}
        sub={`${r.totals.byAgent.toLocaleString('en-IN')} calls, with no person needed`}
        change={{ now: share(r.totals.byAgent, r.totals.calls), before: share(r.previous.byAgent, r.previous.calls), period: 'yesterday by this time', upIsGood: true, format: points, words: ['higher', 'lower'] }}
      />
      <StatTile label="Handed to your team" value={r.totals.handedOver.toLocaleString('en-IN')} change={{ now: r.totals.handedOver, before: r.previous.handedOver, period: 'yesterday by this time', upIsGood: false }} />
      <StatTile
        label="Average call"
        value={duration(r.totals.avgDurationSec)}
        change={{ now: r.totals.avgDurationSec, before: r.previous.avgDurationSec, period: 'yesterday by this time', upIsGood: false, format: duration, words: ['longer', 'shorter'] }}
      />
    </dl>
  )
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
