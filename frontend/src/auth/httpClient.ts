import {
  AuthError,
  type AcceptInviteInput,
  type AuthClient,
  type AuditPage,
  type AuthErrorCode,
  type Invite,
  type OrgSummary,
  type Person,
  type Session,
  type SignInInput,
  type SignUpInput,
  type SignupRequest,
} from './types'
import { apiBase, apiCredentials, apiUrl } from '../lib/api'

/**
 * The real client: talks only to the AICA backend under /api. The session
 * lives in an HttpOnly cookie the backend sets, so nothing secret is ever
 * held in JavaScript or web storage. In dev, Vite proxies /api to the
 * FastAPI server, so requests stay same-origin; deployed, the backend has its
 * own host (VITE_API_URL, see lib/api.ts) and the cookie goes with every call.
 */

const NETWORK = () => new AuthError('network', "We couldn't reach AICA. Check your connection and try again.")

/** One call to the AICA API under /api, with the session cookie. Failures
 * become an AuthError whose message is written for the person using the
 * console. Shared with the console's HTTP client. */
export async function request<T>(base: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(`/api${path}`, base), {
      method,
      credentials: apiCredentials(base),
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw NETWORK()
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; retryAfter?: number } } | null)?.error
    // A gateway error page (backend down behind the proxy) has no JSON body.
    if (!err && res.status >= 500) throw NETWORK()
    throw new AuthError((err?.code as AuthErrorCode) ?? 'unknown', err?.message ?? 'Something went wrong on our side. Try again in a moment.', err?.retryAfter)
  }
  return data as T
}

export function createHttpAuthClient(base = apiBase()): AuthClient {
  const call = <T>(method: 'GET' | 'POST', path: string, body?: unknown) => request<T>(base, method, path, body)

  return {
    isDemo: false,

    async restore() {
      try {
        return await call<Session>('GET', '/auth/session')
      } catch (e) {
        if (e instanceof AuthError && (e.code as string) === 'unauthenticated') return null
        throw e
      }
    },

    signIn: (input: SignInInput) => call<Session>('POST', '/auth/login', input),
    signOut: () => call<void>('POST', '/auth/logout'),

    signUp: (input: SignUpInput) => call<{ email: string }>('POST', '/auth/signup', input),
    resendVerification: (email) => call<void>('POST', '/auth/verify-email/resend', { email }),
    verifyEmail: (code) => call<{ email: string }>('POST', '/auth/verify-email', { code }),
    completeBusiness: (business) => call<Session>('POST', '/auth/business', business),

    requestPasswordReset: (email) => call<void>('POST', '/auth/password/forgot', { email }),
    verifyResetToken: (code) => call<{ email: string }>('POST', '/auth/password/verify', { code }),
    resetPassword: (code, password) => call<void>('POST', '/auth/password/reset', { code, password }),

    getInvite: (token) => call<Invite>('GET', `/invites/${encodeURIComponent(token)}`),
    acceptInvite: (token, input: AcceptInviteInput) => call<Session>('POST', `/invites/${encodeURIComponent(token)}/accept`, input),
    joinInvite: (token) => call<Session>('POST', `/invites/${encodeURIComponent(token)}/join`),

    listSignupRequests: () => call<SignupRequest[]>('GET', '/ops/signup-requests'),
    reviewSignup: (slug, decision, reason) =>
      call<void>('POST', `/ops/signup-requests/${encodeURIComponent(slug)}/${decision}`, decision === 'decline' ? { reason } : undefined),
    listOrgs: () => call<OrgSummary[]>('GET', '/ops/orgs'),
    setOrgSuspended: (slug, suspended, reason) =>
      call<void>('POST', `/ops/orgs/${encodeURIComponent(slug)}/${suspended ? 'suspend' : 'restore'}`, suspended ? { reason } : undefined),

    // A top-level navigation to the backend, which sets the cookie on its own host.
    inviteStaff: (email, role) => call<void>('POST', '/ops/staff-invites', { email, role }),
    listPeople: () => call<Person[]>('GET', '/ops/people'),
    setPlatformRole: (id, role, reason) => call<void>('POST', `/ops/people/${encodeURIComponent(id)}/role`, { role, reason }),
    setDisabled: (id, disabled, reason) =>
      call<void>('POST', `/ops/people/${encodeURIComponent(id)}/${disabled ? 'disable' : 'enable'}`, disabled ? { reason } : undefined),
    signOutEverywhere: (id) => call<void>('POST', `/ops/people/${encodeURIComponent(id)}/sign-out`),
    actAs: (id, reason) => call<Session>('POST', `/ops/people/${encodeURIComponent(id)}/act-as`, { reason }),
    endActing: () => call<Session>('POST', '/auth/act-as/end'),
    listAudit: (query) => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(query)) if (v) params.set(k, v)
      const qs = params.toString()
      return call<AuditPage>('GET', `/ops/audit${qs ? `?${qs}` : ''}`)
    },

    googleSignInUrl: () => apiUrl('/api/auth/google/start', base),
  }
}
