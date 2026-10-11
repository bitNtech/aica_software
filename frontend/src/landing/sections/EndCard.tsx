import { CONSOLE } from '../content'
import { track } from '../lib/analytics'
import { useSignedIn } from '../lib/session'
import './EndCard.css'

/**
 * The page signs off the way the film does: its light end card — the mark,
 * the line, the address. It also gives the footer what it pours into on
 * bitntech.in: cream, not black, so the pink reads as liquid rising, not as
 * loose balls floating in the dark. The last thing on the page is the two
 * ways forward: a demo for the new, the console for those ready to set up.
 */
export default function EndCard() {
  const signedIn = useSignedIn()

  return (
    <section className="end paper" aria-label="AICA by BitNTech">
      <div className="end__rings" aria-hidden="true"><i /><i /><i /></div>
      <div className="wrap end__inner rise">
        <p className="end__mark display">AICA<em>.</em></p>
        <p className="end__line">Answer. Understand. Resolve. <b>24/7.</b></p>
        <p className="end__sub">AI voice agent for business calls in Tamil, English and Tanglish.</p>
        <div className="end__ctas">
          <a className="btn btn--orange" href="#demo" onClick={() => track('cta_book_demo_click', { location: 'end' })}>
            Book a demo <span className="arrow" aria-hidden="true">↗</span>
          </a>
          {signedIn ? (
            <a className="btn end__console" href={CONSOLE.home} onClick={() => track('console_click', { location: 'end', action: 'open' })}>
              Open console
            </a>
          ) : (
            <a className="btn end__console" href={CONSOLE.signUp} onClick={() => track('console_click', { location: 'end', action: 'sign_up' })}>
              Create an account
            </a>
          )}
        </div>
        {!signedIn && (
          <p className="end__signin">
            Already with us? <a href={CONSOLE.signIn} onClick={() => track('console_click', { location: 'end', action: 'sign_in' })}>Sign in</a>
          </p>
        )}
        <p className="end__url">aica.bitntech.in <i>·</i> by BitN<em>Tech</em></p>
      </div>
    </section>
  )
}
