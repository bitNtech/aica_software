/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "demo" runs against the in-browser mock; anything else uses the API. */
  readonly VITE_AUTH_MODE?: string
  /** The backend's public origin when it has its own host, e.g. https://api.aica.bitntech.in. Empty: same origin (dev proxy). */
  readonly VITE_API_URL?: string
  /** "live": organisation pages use the API where it exists (Team, Settings, Activity). Anything else: sample data. */
  readonly VITE_CONSOLE_MODE?: string
  /** With VITE_CONSOLE_MODE=live: the live sections, comma-separated, e.g. "team,settings,activity,requests,calls". Empty: team, settings, activity, requests. */
  readonly VITE_CONSOLE_LIVE?: string
}
