import { Spinner } from '../ui/Spinner'
import { Wordmark } from '../ui/Wordmark'

/** Shown for the moment it takes to restore a saved session. */
export function FullScreenStatus({ label = 'Loading AICA' }: { label?: string }) {
  return (
    <div className="fullscreen stage">
      <Wordmark by={false} />
      <Spinner label={label} />
    </div>
  )
}
