/**
 * Opt-in alerts for new callers waiting for a person: a short tone (Web
 * Audio, no audio files) and a desktop notification. Each person chooses,
 * on this browser: the choice is remembered in localStorage, and everything
 * here fails quietly when storage, audio or notifications aren't there.
 * Nothing about the caller goes into a notification: only the agent's name.
 */

export interface AlertPrefs {
  sound: boolean
  desktop: boolean
}
export const NO_ALERTS: AlertPrefs = { sound: false, desktop: false }

const storageKey = (who: string) => `aica.live.alerts.${who}`

export function loadPrefs(who: string): AlertPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(who)) ?? 'null') as Partial<AlertPrefs> | null
    return { sound: raw?.sound === true, desktop: raw?.desktop === true }
  } catch {
    return NO_ALERTS
  }
}

export function savePrefs(who: string, prefs: AlertPrefs) {
  try {
    localStorage.setItem(storageKey(who), JSON.stringify(prefs))
  } catch {
    // Private mode or storage off: the choice lasts until the page closes.
  }
}

/** One audio context for the page. Browsers only let it start after a
 * gesture, so it is made (and resumed) when someone turns the sound on. */
let audio: AudioContext | null = null

function context(): AudioContext | null {
  try {
    if (!audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      audio = new Ctor()
    }
    if (audio.state === 'suspended') void audio.resume()
    return audio
  } catch {
    return null
  }
}

/** Whether this browser can play the tone at all. */
export const canPlaySound = () => typeof window !== 'undefined' && !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)

/** A soft beep: `notes` are [Hz, seconds] pairs one after another. */
function beep(notes: [number, number][], volume = 0.08) {
  const ctx = context()
  if (!ctx) return
  try {
    let at = ctx.currentTime + 0.01
    for (const [hz, len] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      // A short fade each side, so it never clicks.
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(volume, at + 0.02)
      gain.gain.linearRampToValueAtTime(0, at + len)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + len + 0.02)
      at += len + 0.06
    }
  } catch {
    // No sound is not worth an error.
  }
}

/** A caller is waiting: two gentle notes. */
export const playRequestTone = () => beep([[660, 0.14], [880, 0.18]])
/** An emergency: three higher, more insistent notes. */
export const playEmergencyTone = () => beep([[988, 0.14], [988, 0.14], [988, 0.22]], 0.12)

export type NotificationSupport = 'unsupported' | 'denied' | 'default' | 'granted'

export function notificationSupport(): NotificationSupport {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** Asks the browser, only when called (from turning the switch on). */
export async function askForNotifications(): Promise<NotificationSupport> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

/** Shows a desktop notification, if allowed and the tab isn't in front
 * (an open page already shows it). `tag` replaces an earlier one. */
export function showNotification(title: string, body: string, tag: string, onClick?: () => void) {
  if (notificationSupport() !== 'granted') return
  if (!document.hidden && document.hasFocus()) return
  try {
    const n = new Notification(title, { body, tag })
    n.onclick = () => {
      window.focus()
      onClick?.()
      n.close()
    }
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

/** Primes the audio context (and plays a quiet confirmation) from the click that turned sound on. */
export function primeSound() {
  beep([[740, 0.1]], 0.05)
}
