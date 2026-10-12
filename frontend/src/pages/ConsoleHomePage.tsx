import { Link, useLocation } from 'react-router'
import { ROLE_LABEL } from '../auth/roles'
import { navFor, PAGE_LABEL, type ConsolePage } from '../console/access'
import { useOrg } from '../console/useOrg'
import { ConsoleLayout } from '../components/console/ConsoleLayout'
import { Alert } from '../components/ui/Alert'

/** /o/:slug — where sign-in lands. For now: who you are here, and the pages
 * your role can open. The dashboard (today's calls, live activity) comes
 * with the Operate pages. */
export default function ConsoleHomePage() {
  const { user, org } = useOrg()
  // Set by RequireOrgPage when this role can't open the page asked for.
  const denied = (useLocation().state as { deniedPage?: ConsolePage } | null)?.deniedPage
  const pages = navFor(org.role)
    .flatMap((s) => s.items)
    .filter((i) => i.page !== 'home')

  return (
    <ConsoleLayout
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

      {pages.length > 0 && (
        <section className="ops-section" aria-labelledby="home-pages-h">
          <div className="ops-section__head">
            <h2 id="home-pages-h" className="ops-section__title">
              Your pages
            </h2>
          </div>
          <ul className="home-links">
            {pages.map((p) => (
              <li key={p.page}>
                <Link to={`/o/${org.orgSlug}/${p.path}`} className="home-link">
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

      <p className="empty-note home-soon">
        Today's calls, live activity and the handoff queue arrive here as the console is built out.
      </p>
    </ConsoleLayout>
  )
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
