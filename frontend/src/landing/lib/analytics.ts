/**
 * Provider-neutral analytics. Events go to `dataLayer` (GTM), and to gtag or
 * Plausible when either is on the page. Nothing leaves the browser until one
 * of them is added to index.html.
 */
import { attribution } from './attribution'

type Props = Record<string, string | number | boolean>

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
    gtag?: (...args: unknown[]) => void
    plausible?: (event: string, opts?: { props?: Props }) => void
  }
}

export type EventName =
  | 'cta_book_demo_click'
  | 'video_play'
  | 'video_complete'
  | 'audio_sample_play'
  | 'form_submit'
  | 'contact_click'
  | 'console_click'

export function track(event: EventName, props: Props = {}) {
  if (typeof window === 'undefined') return
  const payload: Props = { ...props, ...attribution() }
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ event, ...payload })
  window.gtag?.('event', event, payload)
  window.plausible?.(event, { props: payload })
}
