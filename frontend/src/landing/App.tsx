import { useEffect } from 'react'
import { Analytics } from '@vercel/analytics/react'
import Nav from './components/Nav'
import Footer from './components/Footer'
import StickyCta from './components/StickyCta'
import Hero from './sections/Hero'
import Film from './sections/Film'
import Problem from './sections/Problem'
import Capabilities from './sections/Capabilities'
import Languages from './sections/Languages'
import Steps from './sections/Steps'
import UseCases from './sections/UseCases'
import Demo from './sections/Demo'
import EndCard from './sections/EndCard'

/**
 * One page, one goal: book a demo. The story: what AICA is and the problem
 * it solves, the film, how it handles a call, the languages it speaks, who
 * it's for, how it's set up — then the demo. Dark cinematic sections and
 * warm-white editorial ones (.paper) alternate.
 */
export default function App() {
  /* Section headings rise in as they arrive. Everything is visible in the
     prerendered HTML; only once this runs is anything held back. */
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const els = [...document.querySelectorAll<HTMLElement>('.rise')].filter((el) => el.getBoundingClientRect().top > window.innerHeight)
    els.forEach((el) => el.classList.add('is-waiting'))
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.remove('is-waiting')
        io.unobserve(e.target)
      }
    }, { rootMargin: '0px 0px -10% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Nav />
      <main id="main">
        <Hero />
        <Problem />
        <Film />
        <Capabilities />
        <Languages />
        <UseCases />
        <Steps />
        <Demo />
        <EndCard />
      </main>
      <Footer />
      <StickyCta />
      <Analytics />
    </>
  )
}
