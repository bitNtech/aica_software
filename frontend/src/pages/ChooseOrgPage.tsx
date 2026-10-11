import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { homeFor, useAuth } from '../auth/AuthProvider'
import { ROLE_LABEL } from '../auth/roles'
import { AuthLayout } from '../components/auth/AuthLayout'

/** /choose — only for people in more than one active organisation. */
export default function ChooseOrgPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)

  if (!user) return null
  const active = user.memberships.filter((m) => m.orgStatus === 'active')
  if (active.length < 2) return <Navigate to={homeFor(user)} replace />

  return (
    <AuthLayout
      kicker="Organisation"
      docTitle="Choose an organisation"
      voice="ok"
      title={
        <>
          Where to, <em>{user.name.split(' ')[0]}?</em>
        </>
      }
      lede={<p>You're on more than one team. Pick where to start — you can switch later.</p>}
      footer={
        <p>
          Signed in as <strong className="auth__em">{user.email}</strong>.{' '}
          <button
            type="button"
            className="btn-text"
            disabled={leaving}
            onClick={() => {
              setLeaving(true)
              void signOut()
            }}
          >
            {leaving ? 'Signing out…' : 'Sign out'}
          </button>
        </p>
      }
    >
      <ul className="orgs">
        {active.map((m) => (
          <li key={m.orgSlug}>
            <button type="button" className="org" onClick={() => navigate(`/o/${m.orgSlug}`)}>
              <span className="org__mark" aria-hidden="true">
                {initials(m.orgName)}
              </span>
              <span className="org__text">
                <span className="org__name">{m.orgName}</span>
                <span className="org__meta">
                  {m.city} <i aria-hidden="true">·</i> {ROLE_LABEL[m.role]}
                </span>
              </span>
              <span className="org__go" aria-hidden="true">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </AuthLayout>
  )
}

export function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}
