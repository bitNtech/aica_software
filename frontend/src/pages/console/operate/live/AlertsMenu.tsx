import { useEffect, useId, useRef, useState } from 'react'
import { Switch } from '../../../../components/ui/Switch'
import { askForNotifications, canPlaySound, loadPrefs, notificationSupport, primeSound, savePrefs, type AlertPrefs } from './alerts'

/**
 * Remembers one person's alert choices on this browser (opt-in: both start
 * off), and says why one can't be turned on.
 */
export function useAlertPrefs(who: string) {
  const [prefs, setPrefs] = useState<AlertPrefs>(() => loadPrefs(who))
  useEffect(() => setPrefs(loadPrefs(who)), [who])
  const [note, setNote] = useState<string | null>(null)

  const set = (patch: Partial<AlertPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(who, next)
      return next
    })

  function setSound(on: boolean) {
    setNote(null)
    if (on && !canPlaySound()) {
      setNote('This browser can’t play the tone.')
      return
    }
    if (on) primeSound()
    set({ sound: on })
  }

  async function setDesktop(on: boolean) {
    setNote(null)
    if (!on) return set({ desktop: false })
    const asked = notificationSupport() === 'default'
    const result = await askForNotifications()
    if (result === 'granted') return set({ desktop: true })
    if (result === 'unsupported') setNote('This browser can’t show desktop notifications.')
    else if (result === 'denied' && !asked) setNote('Notifications are blocked for this site. Allow them in the browser’s site settings, then turn this on.')
    else setNote('Permission wasn’t given, so desktop notifications stay off.')
    set({ desktop: false })
  }

  return { prefs, note, setSound, setDesktop }
}

/**
 * "Alerts" in the page header: a button that opens a small panel with the
 * two opt-in alerts for new callers waiting. Escape or a click outside
 * closes it; focus stays on the button.
 */
export function AlertsMenu({ alerts }: { alerts: ReturnType<typeof useAlertPrefs> }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const { prefs, note } = alerts
  const on = (prefs.sound ? 1 : 0) + (prefs.desktop ? 1 : 0)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
      button.current?.focus()
    }
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <div className="live-alerts" ref={root}>
      <button ref={button} type="button" className="live-alerts__btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.5 14.5V9a4.5 4.5 0 0 1 9 0v5.5M4 14.5h12M8.5 17a1.6 1.6 0 0 0 3 0" />
        </svg>
        <span>Alerts</span>
        <span className="live-alerts__state">{on ? `${on} on` : 'off'}</span>
      </button>
      {open && (
        <div className="live-alerts__panel" id={id} role="group" aria-label="Alerts for new callers">
          <p className="live-alerts__lede">Told when someone new asks for a person. Only on this browser, and off until you turn them on.</p>
          <Switch label="Sound for new requests" hint="A short tone. An emergency sounds different." checked={prefs.sound} onChange={(v) => alerts.setSound(v)} />
          <Switch label="Desktop notification" hint="When this tab is in the background. Shows the agent, never the caller." checked={prefs.desktop} onChange={(v) => void alerts.setDesktop(v)} />
          {note && (
            <p className="live-alerts__note" role="status">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
