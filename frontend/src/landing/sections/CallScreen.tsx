import type { CapabilityKey } from '../content'
import './CallScreen.css'

/**
 * One call, drawn the way AICA's film draws it: the AICA card with its orb,
 * and whatever is happening on the call at that moment. Pure: give it a
 * capability and it draws that beat. Example values only — a fictional
 * hospital's front desk.
 */

function Check() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9" /></svg>
}

function Head({ timer, sub = 'Hospital front desk' }: { timer: string; sub?: string }) {
  return (
    <div className="cs__head">
      <span className="cs__orb" />
      <span className="cs__who"><b>AICA</b><small>{sub}</small></span>
      <span className="cs__timer"><i />{timer}</span>
    </div>
  )
}

function Bubble({ who, children, lang }: { who: 'caller' | 'aica'; children: React.ReactNode; lang?: string }) {
  return (
    <p className={`cs__bubble cs__bubble--${who}`} lang={lang}>
      <small>{who === 'aica' ? 'AICA' : 'Caller'}</small>
      {children}
    </p>
  )
}

function Wave() {
  return (
    <span className="cs__wave" aria-hidden="true">
      {[0.35, 0.7, 1, 0.55, 0.85, 0.4, 0.95, 0.6, 0.3, 0.75, 0.5, 0.9, 0.45, 0.65, 0.35, 0.8].map((h, i) => (
        <i key={i} style={{ '--h': h, '--i': i } as React.CSSProperties} />
      ))}
    </span>
  )
}

export default function CallScreen({ beat }: { beat: CapabilityKey }) {
  return (
    <div className={`cs cs--${beat}`}>
      {beat === 'answer' && (
        <>
          <Head timer="00:01" />
          <div className="cs__body">
            <Bubble who="caller" lang="ta">OP timing என்ன?</Bubble>
            <Bubble who="aica">OP is open 8 AM to 2 PM, Monday to Saturday. Shall I book you a slot?</Bubble>
          </div>
          <p className="cs__foot"><Check />Answered on the first ring · no hold music</p>
        </>
      )}

      {beat === 'speak' && (
        <>
          <Head timer="00:04" />
          <div className="cs__body">
            <Wave />
            <p className="cs__said" lang="ta">வணக்கம், appointment book பண்ணணும்…</p>
            <p className="cs__heard">Hello, I need to book an appointment…</p>
            <p className="cs__langs"><span>Tamil</span><i>+</i><span>English</span><em>understood</em></p>
          </div>
        </>
      )}

      {beat === 'workflow' && (
        <>
          <Head timer="00:09" sub="Appointment · booked on the call" />
          <ol className="cs__steps">
            {['Understood', 'Slot found', 'Booked', 'Confirmed'].map((s, i) => (
              <li key={s} style={{ '--i': i } as React.CSSProperties}><span><Check /></span>{s}</li>
            ))}
          </ol>
          <dl className="cs__rows">
            <div><dt>Department</dt><dd>General Medicine</dd></div>
            <div><dt>Date</dt><dd>Tomorrow</dd></div>
            <div><dt>Time</dt><dd>10:30 AM</dd></div>
          </dl>
          <p className="cs__foot"><Check />Booked in your system, on the call</p>
        </>
      )}

      {beat === 'transfer' && (
        <div className="cs__handoff">
          <div className="cs__node">
            <span className="cs__orb" />
            <b>Complex call</b>
            <small>Needs a person</small>
            <em className="cs__flag"><i />Handing over</em>
          </div>
          <span className="cs__wire" aria-hidden="true"><i /></span>
          <div className="cs__node cs__node--team">
            <span className="cs__people" aria-hidden="true"><i /><i /><i /></span>
            <b>Your team</b>
            <small>Front desk</small>
            <em className="cs__done">Call transferred</em>
          </div>
        </div>
      )}

      {beat === 'always' && (
        <>
          <p className="cs__time">11:48<small>PM</small></p>
          <ul className="cs__log">
            {['Line 04 · 11:47 PM', 'Line 02 · 11:46 PM', 'Line 01 · 11:44 PM'].map((l, i) => (
              <li key={l} style={{ '--i': i } as React.CSSProperties}>
                <span><Check /></span>
                <b>Answered by AICA</b>
                <small>{l}</small>
              </li>
            ))}
          </ul>
          <p className="cs__foot">Same calls, after hours. Picked up.</p>
        </>
      )}

      {beat === 'deploy' && (
        <div className="cs__deploy">
          <div className="cs__opt">
            <span className="cs__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01M8 17h.01" /></svg>
            </span>
            <b>On-premise</b>
            <small>On infrastructure you own</small>
          </div>
          <div className="cs__opt">
            <span className="cs__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-.5 9.5z" /></svg>
            </span>
            <b>Managed cloud</b>
            <small>We run it for you</small>
          </div>
          <p className="cs__foot">Same AICA either way.</p>
        </div>
      )}
    </div>
  )
}
