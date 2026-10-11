import { useCallback, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { BUSINESS_LABEL, LANGUAGE_LABEL } from '../../auth/roles'
import { asAuthError, type SignupRequest } from '../../auth/types'
import { OpsLayout } from '../../components/ops/OpsLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { PulseLine } from '../../components/ui/PulseLine'
import { ReasonForm } from '../../components/ui/ReasonForm'
import { Spinner } from '../../components/ui/Spinner'
import { useAsync } from '../../lib/useAsync'
import { waited } from '../../lib/time'

/** /ops/requests — businesses that signed up, oldest first. */
export default function OpsRequestsPage() {
  const { client } = useAuth()
  const load = useCallback(() => client.listSignupRequests(), [client])
  const [requests, reload] = useAsync(load)
  const [declining, setDeclining] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function decide(r: SignupRequest, decision: 'approve' | 'decline', reason?: string) {
    setBusy(r.orgSlug)
    setNotice(null)
    try {
      await client.reviewSignup(r.orgSlug, decision, reason)
      setNotice({
        tone: 'ok',
        text:
          decision === 'approve'
            ? `${r.orgName} is approved. ${r.owner.name} can sign in now.`
            : `${r.orgName} was declined. ${r.owner.name} will see your reason when they sign in.`,
      })
      setDeclining(null)
      reload()
    } catch (err) {
      setNotice({ tone: 'error', text: asAuthError(err).message })
    } finally {
      setBusy(null)
    }
  }

  const list = requests.state === 'ready' ? requests.data : []

  return (
    <OpsLayout
      kicker="Sign-up requests"
      docTitle="Sign-up requests"
      pendingCount={requests.state === 'ready' ? list.length : undefined}
      title={
        <>
          Who wants <em>in.</em>
        </>
      }
      lede={<p>Approve a business to open its console to the owner. Declining needs a reason — they'll read it.</p>}
    >
      {notice && (
        <Alert tone={notice.tone} className="ops-section__notice">
          {notice.text}
        </Alert>
      )}

      {requests.state === 'loading' && (
        <div className="loading-row">
          <Spinner label="Loading requests" />
          <span>Loading requests…</span>
        </div>
      )}

      {requests.state === 'error' && (
        <Alert tone="error" title="Couldn't load requests">
          <p>{asAuthError(requests.error).message}</p>
          <button type="button" className="btn-text" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}

      {requests.state === 'ready' && list.length === 0 && (
        <div className="empty">
          <PulseLine mode="idle" className="empty__pulse" />
          <p className="empty__title">No one waiting.</p>
          <p className="empty__text">New sign-ups appear here, oldest first.</p>
        </div>
      )}

      {list.length > 0 && (
        <ul className="requests">
          {list.map((r) => (
            <li key={r.orgSlug} className="request">
              <div className="request__head">
                <div>
                  <h2 className="request__name">{r.orgName}</h2>
                  <p className="row__meta">
                    {BUSINESS_LABEL[r.businessType]} <i aria-hidden="true">·</i> {r.city}
                  </p>
                </div>
                <span className="request__wait">Waiting {waited(r.submittedAt)}</span>
              </div>

              <dl className="request__facts">
                <div>
                  <dt>Owner</dt>
                  <dd>{r.owner.name}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>
                    <span className="request__mail">{r.owner.email}</span>
                    <span className={`verify-tag ${r.owner.emailVerified ? 'is-ok' : 'is-wait'}`}>
                      {r.owner.emailVerified ? 'Verified' : 'Not verified'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Mobile</dt>
                  <dd>{r.owner.phone ? <a className="link" href={`tel:+91${r.owner.phone}`}>+91 {r.owner.phone.replace(/(\d{5})(\d{5})/, '$1 $2')}</a> : '—'}</dd>
                </div>
                <div>
                  <dt>Languages</dt>
                  <dd className="request__langs">
                    {r.languages.map((l) => (
                      <span key={l} className="lang-tag">
                        {LANGUAGE_LABEL[l]}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>

              {declining === r.orgSlug ? (
                <ReasonForm
                  label={`Why decline ${r.orgName}?`}
                  hint={`${r.owner.name} sees this word for word.`}
                  confirmLabel="Decline request"
                  busyLabel="Declining…"
                  busy={busy === r.orgSlug}
                  onConfirm={(reason) => void decide(r, 'decline', reason)}
                  onCancel={() => setDeclining(null)}
                />
              ) : (
                <div className="request__actions">
                  <Button
                    size="sm"
                    busy={busy === r.orgSlug}
                    busyLabel="Approving…"
                    disabled={!r.owner.emailVerified || (busy !== null && busy !== r.orgSlug)}
                    onClick={() => void decide(r, 'approve')}
                    aria-label={`Approve ${r.orgName}`}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="line"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => setDeclining(r.orgSlug)}
                    aria-label={`Decline ${r.orgName}`}
                  >
                    Decline
                  </Button>
                  {!r.owner.emailVerified && (
                    <p className="request__why">Approve unlocks once the owner confirms their email.</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </OpsLayout>
  )
}
