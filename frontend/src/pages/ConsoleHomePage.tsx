import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { homeFor, useAuth } from '../auth/AuthProvider'
import { ROLE_LABEL } from '../auth/roles'
import { AuthLayout } from '../components/auth/AuthLayout'
import { Button } from '../components/ui/Button'

/** /o/:slug — where sign-in lands. Placeholder until the portal is built;
 * it proves the redirect, the session and sign-out work end to end. */
export default function ConsoleHomePage() {
  const { slug } = useParams()
  const { user, signOut } = useAuth()
  const [leaving, setLeaving] = useState(false)

  if (!user) return null
  const org = user.memberships.find((m) => m.orgSlug === slug)
  if (!org) return <Navigate to="/403" replace />
  // In review, declined or suspended: the status pages explain why.
  if (org.orgStatus !== 'active') return <Navigate to={homeFor(user)} replace />

  return (
    <AuthLayout
      kicker={org.orgName}
      docTitle={org.orgName}
      voice="ok"
      title={
        <>
          You're <em>in.</em>
        </>
      }
      lede={
        <p>
          Signed in to <strong className="auth__em">{org.orgName}</strong> as {ROLE_LABEL[org.role].toLowerCase()}. The console
          dashboard lands here next.
        </p>
      }
    >
      <div className="form">
        <Button
          variant="plum"
          block
          busy={leaving}
          busyLabel="Signing out…"
          onClick={() => {
            setLeaving(true)
            void signOut()
          }}
        >
          Sign out
        </Button>
      </div>
      {user.memberships.filter((m) => m.orgStatus === 'active').length > 1 && (
        <p className="form__after">
          <Link className="link" to="/choose">
            Switch organisation
          </Link>
        </p>
      )}
    </AuthLayout>
  )
}
