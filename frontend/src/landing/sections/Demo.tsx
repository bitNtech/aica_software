import { useRef, useState } from 'react'
import { CONTACT, INDUSTRIES, VOLUMES, WA_DEMO, whatsappHref } from '../content'
import { track } from '../lib/analytics'
import { ATTR_KEYS, attribution } from '../lib/attribution'
import './Demo.css'

/**
 * The page's one goal. Five fields, the last two as tap targets rather than
 * dropdowns — faster on a phone, which is where the ads send people.
 *
 * Where requests go: set VITE_DEMO_ENDPOINT to any URL that accepts a JSON
 * POST (a Sheets Apps Script, a CRM webhook, Formspree…). Until it is set,
 * the request is handed to WhatsApp with the details filled in — the channel
 * bitntech.in already uses for AICA demo requests.
 */
const ENDPOINT = (import.meta.env.VITE_DEMO_ENDPOINT as string | undefined) ?? ''

type Field = 'name' | 'company' | 'phone' | 'industry' | 'calls_per_day'
type Values = Record<Field, string>
const EMPTY: Values = { name: '', company: '', phone: '', industry: '', calls_per_day: '' }

/* Indian numbers: an optional +91 or 0, then ten digits. */
const normalisePhone = (raw: string) => raw.replace(/[\s\-().]/g, '').replace(/^(\+?91|0)(?=\d{10}$)/, '')
const validPhone = (p: string) => /^\d{10}$/.test(p)

function check(v: Values): [Field, string] | null {
  if (!v.name.trim()) return ['name', 'Please tell us your name.']
  if (!v.company.trim()) return ['company', 'Which business are the calls for?']
  if (!validPhone(normalisePhone(v.phone))) return ['phone', 'That number looks incomplete — 10 digits, like 98765 43210.']
  if (!v.industry) return ['industry', 'Pick the industry closest to yours.']
  if (!v.calls_per_day) return ['calls_per_day', 'A rough number of calls a day is enough.']
  return null
}

export default function Demo() {
  const formRef = useRef<HTMLFormElement>(null)
  const [v, setV] = useState<Values>(EMPTY)
  const [error, setError] = useState<{ field: Field; message: string } | null>(null)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'handed'>('idle')

  const set = (field: Field, value: string) => {
    setV((old) => ({ ...old, [field]: value }))
    if (error?.field === field) setError(null)
  }

  const focus = (field: Field) =>
    formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (state === 'sending') return
    const bad = check(v)
    if (bad) {
      setError({ field: bad[0], message: bad[1] })
      focus(bad[0])
      return
    }
    setError(null)
    const phone = normalisePhone(v.phone)
    const attr = attribution()
    const lead = {
      name: v.name.trim(),
      company: v.company.trim(),
      phone,
      industry: v.industry,
      calls_per_day: v.calls_per_day,
      ...attr,
      page: window.location.origin + window.location.pathname,
      submitted_at: new Date().toISOString(),
    }

    if (!ENDPOINT) {
      /* Opened synchronously inside the submit, so no popup blocker stops it. */
      const tags = ATTR_KEYS.filter((k) => attr[k]).map((k) => `${k}=${attr[k]}`).join(', ')
      const text = [
        'Hi BitNTech, I would like to book a demo of AICA.',
        '',
        `Name: ${lead.name}`,
        `Company: ${lead.company}`,
        `Phone: ${phone}`,
        `Industry: ${lead.industry}`,
        `Calls per day: ${lead.calls_per_day}`,
        tags ? `\n(${tags})` : '',
      ].join('\n').trim()
      window.open(whatsappHref(text), '_blank', 'noopener')
      track('form_submit', { industry: lead.industry, calls_per_day: lead.calls_per_day, channel: 'whatsapp' })
      setState('handed')
      return
    }

    setState('sending')
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(lead),
      })
      if (!res.ok) throw new Error(String(res.status))
      track('form_submit', { industry: lead.industry, calls_per_day: lead.calls_per_day, channel: 'endpoint' })
      setState('sent')
    } catch {
      setState('idle')
      setError({ field: 'name', message: 'That didn’t go through. Please try again, or message us on WhatsApp.' })
    }
  }

  const invalid = (f: Field) => (error?.field === f ? { 'aria-invalid': true, 'aria-describedby': 'demo-error' } : {})
  const done = state === 'sent' || state === 'handed'

  return (
    <section className="demo" id="demo" aria-labelledby="demo-title">
      <div className="demo__glow" aria-hidden="true" />
      <div className="demo__inner wrap">
        <div className="demo__copy rise">
          <p className="label">06 <i>/</i> Book a demo</p>
          <h2 className="display demo__title" id="demo-title">
            Hear what AICA can do <em>for your calls.</em>
          </h2>
          <p className="demo__lede">Book a short demo. We’ll show you AICA handling calls for a business like yours.</p>

          <ul className="demo__reach">
            <li>
              <a href={whatsappHref(WA_DEMO)} target="_blank" rel="noopener" onClick={() => track('contact_click', { channel: 'whatsapp' })}>
                <small>WhatsApp</small>
                <span>Message us</span>
                <i aria-hidden="true">↗</i>
              </a>
            </li>
            <li>
              <a href={CONTACT.phoneHref} onClick={() => track('contact_click', { channel: 'phone' })}>
                <small>Phone</small>
                <span>{CONTACT.phone}</span>
                <i aria-hidden="true">↗</i>
              </a>
            </li>
            <li>
              <a href={CONTACT.emailHref} onClick={() => track('contact_click', { channel: 'email' })}>
                <small>Email</small>
                <span>{CONTACT.email}</span>
                <i aria-hidden="true">↗</i>
              </a>
            </li>
          </ul>
        </div>

        <form className="form rise" style={{ '--d': 2 } as React.CSSProperties} ref={formRef} onSubmit={onSubmit} noValidate aria-describedby={error ? 'demo-error' : undefined}>
          <fieldset className="form__group" disabled={done}>
            <legend className="form__legend"><b>01</b> Who you are</legend>
            <div className="form__grid">
              <label className="field">
                <span>Name</span>
                <input data-field="name" name="name" autoComplete="name" value={v.name} onChange={(e) => set('name', e.target.value)} {...invalid('name')} />
              </label>
              <label className="field">
                <span>Company</span>
                <input data-field="company" name="company" autoComplete="organization" value={v.company} onChange={(e) => set('company', e.target.value)} {...invalid('company')} />
              </label>
              <label className="field field--full">
                <span>Phone number</span>
                <input data-field="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={v.phone} onChange={(e) => set('phone', e.target.value)} {...invalid('phone')} />
              </label>
            </div>
          </fieldset>

          <fieldset className="form__group" disabled={done}>
            <legend className="form__legend"><b>02</b> Your calls</legend>
            <div className="choice" role="radiogroup" aria-label="Industry" {...invalid('industry')}>
              <span className="choice__label">Industry</span>
              <div className="choice__opts">
                {INDUSTRIES.map((x, k) => (
                  <label key={x} className={`chip${v.industry === x ? ' is-on' : ''}`}>
                    <input type="radio" name="industry" value={x} checked={v.industry === x} onChange={() => set('industry', x)} {...(k === 0 ? { 'data-field': 'industry' } : {})} />
                    {x}
                  </label>
                ))}
              </div>
            </div>
            <div className="choice" role="radiogroup" aria-label="Calls per day, roughly" {...invalid('calls_per_day')}>
              <span className="choice__label">Calls per day, roughly</span>
              <div className="choice__opts choice__opts--row">
                {VOLUMES.map((x, k) => (
                  <label key={x} className={`chip chip--vol${v.calls_per_day === x ? ' is-on' : ''}`}>
                    <input type="radio" name="calls_per_day" value={x} checked={v.calls_per_day === x} onChange={() => set('calls_per_day', x)} {...(k === 0 ? { 'data-field': 'calls_per_day' } : {})} />
                    {x}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>

          <p className="form__error" id="demo-error" role="alert">{error?.message ?? ''}</p>

          <button className="btn btn--orange form__submit" type="submit" disabled={state === 'sending' || done}>
            {state === 'sending' ? 'Sending…' : 'Book my demo'} <span className="arrow" aria-hidden="true">↗</span>
          </button>
          <p className="form__fine">We use these details only to arrange your demo.</p>

          {done && (
            <div className="form__done" role="status">
              <span className="form__tick" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9" /></svg>
              </span>
              {state === 'sent' ? (
                <>
                  <h3>Thanks, {v.name.trim().split(' ')[0]}. We’ll call you to fix a time.</h3>
                  <p>Our team will reach you on {normalisePhone(v.phone).replace(/(\d{5})(\d{5})/, '$1 $2')}.</p>
                </>
              ) : (
                <>
                  <h3>Almost there — press Send in WhatsApp.</h3>
                  <p>Your details are filled in. If WhatsApp didn’t open, call us on {CONTACT.phone}.</p>
                </>
              )}
            </div>
          )}
        </form>
      </div>
    </section>
  )
}
