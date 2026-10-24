import { Link } from 'react-router'
import { Sparkline } from '../../../components/console/Sparkline'
import { StatusPill } from '../../../components/console/StatusPill'
import { useNow } from '../../../lib/useNow'
import type { LiveOps, PlatformServiceId } from '../../../ops/types'
import { HEALTH_LABEL, HEALTH_TONE, ms, Panel, PanelState, pct, since } from './bits'

/** What each service's latency measures, so the figures aren't compared across them. */
const MEASURES: Record<PlatformServiceId, string> = {
  speech: 'ASR · speech to text',
  language: 'LLM · deciding the reply',
  voice: 'TTS · speaking the reply',
  telephony: 'Phone lines · connecting a call',
}
const ORDER: PlatformServiceId[] = ['speech', 'language', 'voice', 'telephony']

/** The external services AICA depends on, at a glance, and any open incident. */
export function PlatformHealth({ live, error, reload, demo }: { live: LiveOps | null; error: unknown; reload(): void; demo: boolean }) {
  const now = useNow(60_000)
  if (!live)
    return (
      <div className="ov-grid">
        <Panel title="Services" demo={demo} wide>
          <PanelState error={error} onRetry={reload} />
        </Panel>
      </div>
    )

  const services = [...live.services].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
  const troubled = services.filter((s) => s.health !== 'ok')
  return (
    <div className="ov-grid ov-grid--health">
      <Panel
        title="Services"
        demo={demo}
        note={troubled.length === 0 ? 'Everything is working' : `${troubled.map((s) => s.name).join(' and ')} ${troubled.length === 1 ? 'is' : 'are'} having problems`}
        action={<Link to="/ops/status">Service status</Link>}
      >
        <ul className="ov-services">
          {services.map((s) => (
            <li key={s.id} className={`ov-service${s.health !== 'ok' ? ' ov-service--flag' : ''}`}>
              <div className="ov-service__head">
                <span className="ov-item__title">{s.name}</span>
                <StatusPill tone={HEALTH_TONE[s.health]}>{HEALTH_LABEL[s.health]}</StatusPill>
              </div>
              <span className="ov-item__meta">{MEASURES[s.id]}</span>
              <dl className="ov-facts ov-facts--3">
                <div>
                  <dt>Errors, 1 h</dt>
                  <dd className="num">{pct(s.errorRate, s.errorRate < 0.01 ? 2 : 1)}</dd>
                </div>
                <div>
                  <dt>Typical</dt>
                  <dd className="num">{ms(s.p50)}</dd>
                </div>
                <div>
                  <dt>Slowest 5%</dt>
                  <dd className="num">{ms(s.p95)}</dd>
                </div>
              </dl>
              <Sparkline series={s.p95ByMinute} label={`${s.name}, slowest 5% each minute, last 30 minutes`} format={(n) => ms(Math.round(n))} width={200} height={28} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Active incidents" demo={demo}>
        {live.incidents.length === 0 ? (
          <p className="ov-empty">No active incidents.</p>
        ) : (
          <ul className="ov-list">
            {live.incidents.map((i) => (
              <li key={i.id} className="ov-item ov-item--warning">
                <div className="ov-item__main">
                  <span className="ov-item__title">
                    <StatusPill tone="warn">{i.status === 'investigating' ? 'Investigating' : 'Monitoring'}</StatusPill> {i.title}
                  </span>
                  <span className="ov-item__meta">
                    {MEASURES[i.service]} · for {since(i.startedAt, now)}
                  </span>
                  <span className="ov-item__body">{i.update}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
