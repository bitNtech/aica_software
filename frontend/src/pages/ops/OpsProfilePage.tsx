import { useCallback } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { ROLE_LABEL } from '../../auth/roles'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { StatusPill } from '../../components/console/StatusPill'
import { useAsync } from '../../lib/useAsync'
import { useOpsData } from '../../ops/OpsDataProvider'
import { Devices, Notifications, Organisations, Password, Profile, rolesOf } from '../AccountPage'
import '../Account.css'
import './Ops.css'

/** /ops/profile: a bitNtech account's own settings and security, inside Ops (was /account). */
export default function OpsProfilePage() {
  const { user } = useAuth()
  const ops = useOpsData()
  const load = useCallback(() => ops.getSecurityPolicy(), [ops])
  const [policy] = useAsync(load)
  if (!user?.platformRole) return null
  const isMaster = user.platformRole === 'master_admin'

  return (
    <OpsLayout kicker="Profile" docTitle="Your account" title="Your account" lede={<p>Your name, password, where you’re signed in and the emails you get.</p>}>
      <div className="acct__main ops-profile">
        <section className="acct-card" aria-labelledby="prof-access">
          <h2 className="acct-card__title" id="prof-access">
            Your access
          </h2>
          <p>
            <StatusPill tone={isMaster ? 'info' : 'neutral'}>{ROLE_LABEL[user.platformRole]}</StatusPill>
          </p>
          <ul className="ops-profile__list">
            {isMaster ? (
              <>
                <li>You can approve sign-ups, suspend and restore organisations, and act as a client user for a short, audited time.</li>
                <li>You build, publish and roll back agents, and see callers’ names, numbers and transcripts.</li>
                <li>You manage billing, security policies, platform settings and bitNtech staff.</li>
              </>
            ) : (
              <>
                <li>You can review sign-ups, read every organisation’s agents, calls (without callers’ details) and reports, and reply to support requests.</li>
                <li>The master admin changes agents, billing, security and platform settings.</li>
              </>
            )}
          </ul>
          {policy.state === 'ready' && (
            <p className="row__meta">
              Two-step sign-in is {policy.data.staffTwoStep ? 'required' : 'optional'} for bitNtech staff. Your sign-in lasts {policy.data.staffSessionHours} hours, and ends after {policy.data.idleMinutes} minutes idle.
              {isMaster && (
                <>
                  {' '}
                  <Link className="link" to="/ops/security">
                    Change the policies
                  </Link>
                </>
              )}
            </p>
          )}
        </section>
        <Profile user={user} />
        <Password email={user.email} />
        <Devices />
        <Notifications who={rolesOf(user)} />
        <Organisations user={user} />
      </div>
    </OpsLayout>
  )
}
