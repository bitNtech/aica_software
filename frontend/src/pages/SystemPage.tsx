import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { homeFor, useAuth } from '../auth/AuthProvider'
import { AuthLayout } from '../components/auth/AuthLayout'

/** System states: one plain sentence and one action, never a bare code. */

export function NotFoundPage() {
  return (
    <AuthLayout
      kicker="404"
      docTitle="Page not found"
      voice="error"
      title={
        <>
          Nothing on this <em>line.</em>
        </>
      }
      lede={<p>That address doesn't lead anywhere in AICA. It may have moved, or the link was cut short.</p>}
    >
      <div className="form">
        <Link className="btn btn--orange btn--block" to="/login">
          <span>Go to sign in</span>
          <span className="arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>
    </AuthLayout>
  )
}

export function ForbiddenPage() {
  const { user } = useAuth()
  return (
    <AuthLayout
      kicker="403"
      docTitle="No access"
      voice="error"
      title={
        <>
          That's not on your <em>team.</em>
        </>
      }
      lede={<p>Your account can't open this page. If you need it, ask an admin to invite you.</p>}
    >
      <div className="form">
        <Link className="btn btn--orange btn--block" to={user ? homeFor(user) : '/login'}>
          <span>{user ? 'Back to my home' : 'Go to sign in'}</span>
        </Link>
      </div>
    </AuthLayout>
  )
}

function CrashPage() {
  return (
    <AuthLayout
      kicker="Error"
      docTitle="Something went wrong"
      voice="error"
      title={
        <>
          Something went wrong on <em>our side.</em>
        </>
      }
      lede={<p>The page stopped unexpectedly. Reloading usually fixes it. If it keeps happening, tell support@bitntech.in.</p>}
    >
      <div className="form">
        <button type="button" className="btn btn--orange btn--block" onClick={() => window.location.reload()}>
          <span>Reload the page</span>
        </button>
      </div>
    </AuthLayout>
  )
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No reporting service yet; keep the stack in the console for now.
    console.error(error, info.componentStack)
  }

  render() {
    return this.state.failed ? <CrashPage /> : this.props.children
  }
}
