import { useLocation } from 'react-router'
import { ROLE_LABEL } from '../auth/roles'
import { UpdatedAgo } from '../components/console/UpdatedAgo'
import { Alert } from '../components/ui/Alert'
import { ConsolePage } from '../components/console/ConsolePage'
import { can, canOpen, PAGE_LABEL, type PageKey } from '../console/access'
import { useOrg } from '../console/useOrg'
import { useNow } from '../lib/useNow'
import { NeedsAPerson, expectsToday } from './console/home/NeedsAPerson'
import { ReportDashboard } from './console/home/ReportDashboard'
import { ShiftStrip, YourShift } from './console/home/YourShift'
import { useToday } from './console/home/useToday'
import './console/operate/Operate.css'
import './console/home/Home.css'

/**
 * Home, by what the person does here. People who take calls get "Your shift"
 * (callers waiting, their callbacks, appointments to check, today's notices);
 * people who read reports get the dashboard; someone who does both gets a
 * one-line shift strip above it. Everyone else who can see any of it gets the
 * "Needs a person" cards, which link to the page where each is dealt with; the
 * full shift already says all of that, so it leaves them out.
 */
export default function ConsoleHomePage() {
  const { user, org, access } = useOrg()
  const denied = (useLocation().state as { deniedPage?: PageKey } | null)?.deniedPage
  const takesCalls = can(access, 'call.takeOver')
  const readsReports = canOpen(access, 'reports')
  const shift = takesCalls ? (readsReports ? 'strip' : 'full') : null
  const { today, checkedAt, reload } = useToday({ wantDesk: shift === 'full' })
  // Refreshes with the data: for "overdue" and "due in", which are said in minutes.
  const now = useNow(15000)

  return (
    <ConsolePage
      kicker="Home"
      docTitle="Home"
      title={<>You're <em>in,</em> {user.name.split(' ')[0]}.</>}
      status={expectsToday(access) ? <UpdatedAgo at={checkedAt} /> : undefined}
      lede={
        <p>
          Signed in to <strong className="console__em">{org.orgName}</strong> as {ROLE_LABEL[org.role].toLowerCase()}.
        </p>
      }
    >
      {denied && denied in PAGE_LABEL && (
        <Alert tone="info" className="home-denied">
          {upperFirst(PAGE_LABEL[denied])} isn't part of the {ROLE_LABEL[org.role].toLowerCase()} role here. If you need it, ask an owner or admin of {org.orgName}.
        </Alert>
      )}

      {shift === 'strip' && <ShiftStrip today={today} now={now} reload={reload} />}
      {shift === 'full' && <YourShift today={today} now={now} reload={reload} />}

      {shift !== 'full' && <NeedsAPerson today={today} checkedAt={checkedAt} now={now} reload={reload} compact={readsReports} />}

      {readsReports && <ReportDashboard />}
    </ConsolePage>
  )
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
