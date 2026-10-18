import { CONTACT } from '../content'
import './Footer.css'

/**
 * AICA's own footer: a floating glass base with the product mark, the
 * company line, and the same two link columns as before — BitNTech (this
 * page lives on its subdomain) and the ways to reach us.
 */

const SITE = CONTACT.site
const NAV_COLUMNS = [
  {
    heading: 'BitNtech',
    links: [
      { label: 'About', href: `${SITE}/about` },
      { label: 'Products', href: `${SITE}/products` },
      { label: 'Solutions', href: `${SITE}/#solutions` },
      { label: 'Industries', href: `${SITE}/#industries` },
      { label: 'Contact', href: `${SITE}/contact` },
    ],
  },
  {
    heading: 'Connect',
    links: [
      { label: 'LinkedIn', href: CONTACT.linkedin },
      { label: 'Instagram', href: CONTACT.instagram },
      { label: 'GitHub', href: CONTACT.github },
      { label: 'Email', href: CONTACT.emailHref },
      { label: CONTACT.phone, href: CONTACT.phoneHref },
    ],
  },
] as const

const external = (href: string) => /^https?:/.test(href)

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="foot">
          <div className="foot__brand">
            <a href="#top" className="foot__mark" aria-label="AICA — back to the top">
              <span className="foot__orb" aria-hidden="true" />
              AICA
            </a>
            <p className="foot__line">AI voice agent for business calls in Tamil, English and Tanglish.</p>
            <p className="foot__by">
              A product of <a href={SITE}>BitNTech</a> <i>·</i> Engineering the Next Evolution.
            </p>
          </div>

          {NAV_COLUMNS.map((col) => (
            <nav className="foot__col" key={col.heading} aria-label={col.heading}>
              <b>{col.heading}</b>
              {col.links.map((link) => (
                <a key={link.label} href={link.href} {...(external(link.href) && !link.href.startsWith(SITE) ? { target: '_blank', rel: 'noreferrer' } : {})}>
                  {link.label}
                </a>
              ))}
            </nav>
          ))}
        </div>

        <p className="foot__legal">
          <span>© {new Date().getFullYear()} BitNTech</span>
          <span>aica.bitntech.in</span>
        </p>
      </div>
    </footer>
  )
}
