/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "demo" runs against the in-browser mock; anything else uses the API. */
  readonly VITE_AUTH_MODE?: string
  /** The backend's public origin when it has its own host, e.g. https://api.aica.bitntech.in. Empty: same origin (dev proxy). */
  readonly VITE_API_URL?: string
}
