/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "demo" runs against the in-browser mock; anything else uses the API. */
  readonly VITE_AUTH_MODE?: string
  /** Landing page: URL that accepts a demo request as a JSON POST. Empty: hand it to WhatsApp. */
  readonly VITE_DEMO_ENDPOINT?: string
}
