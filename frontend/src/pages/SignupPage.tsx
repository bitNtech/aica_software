import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { homeFor, useAuth } from '../auth/AuthProvider'
import { BUSINESS_LABEL, LANGUAGE_LABEL } from '../auth/roles'
import { asAuthError, type AuthError, type BusinessType, type Language } from '../auth/types'
import {
  validateBusinessName,
  validateCity,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePhone,
} from '../auth/validation'
import { AuthLayout } from '../components/auth/AuthLayout'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { ChoiceGroup } from '../components/ui/Choice'
import { Checkbox, PasswordField, TextField } from '../components/ui/Field'
import { PasswordStrength } from '../components/ui/PasswordStrength'
import { Stepper } from '../components/ui/Stepper'
import { GoogleButton, OrDivider } from '../components/auth/GoogleButton'
import { useFormErrors } from '../lib/useFormErrors'

const CITIES = ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore', 'Thanjavur', 'Tiruppur']
const TYPES: BusinessType[] = ['hospital', 'clinic', 'diagnostics', 'other']
const LANGS: Language[] = ['tamil', 'english', 'tanglish']

/**
 * /signup — a business asks for AICA. Two steps in one card: the owner's
 * account, then the business. It ends in review: the owner verifies their
 * email, and bitNtech approves the organisation before anyone can use it.
 */
export default function SignupPage({ businessOnly = false }: { businessOnly?: boolean }) {
  const { client, user, setSession, signOut } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<0 | 1>(businessOnly ? 1 : 0)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')

  const [bizName, setBizName] = useState('')
  const [bizType, setBizType] = useState<BusinessType[]>([])
  const [city, setCity] = useState('')
  const [langs, setLangs] = useState<Language[]>([])
  const [terms, setTerms] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const [emailTaken, setEmailTaken] = useState<string | null>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  const account = useFormErrors({
    name: validateName(name),
    email: emailTaken && emailTaken === email.trim().toLowerCase() ? 'An account with this email already exists.' : validateEmail(email),
    phone: validatePhone(phone),
    password: validateNewPassword(password, email),
  })
  const business = useFormErrors({
    bizName: validateBusinessName(bizName),
    bizType: bizType.length ? null : 'Choose the kind of business.',
    city: validateCity(city),
    langs: langs.length ? null : 'Choose at least one language.',
    terms: terms ? null : 'Tick this to continue.',
  })

  useEffect(() => {
    if (error) alertRef.current?.focus()
  }, [error])

  function next(e: FormEvent) {
    e.preventDefault()
    if (!account.check()) return
    setError(null)
    setStep(1)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !business.check()) return
    setBusy(true)
    setError(null)
    if (businessOnly) {
      try {
        const s = await client.completeBusiness({ name: bizName, type: bizType[0], city, languages: langs })
        setSession(s)
        navigate(homeFor(s.user), { replace: true })
      } catch (err) {
        setBusy(false)
        setError(asAuthError(err))
      }
      return
    }
    try {
      const { email: sent } = await client.signUp({
        name,
        email,
        phone,
        password,
        business: { name: bizName, type: bizType[0], city, languages: langs },
        acceptedTerms: terms,
      })
      navigate('/signup/verify', { replace: true, state: { email: sent } })
    } catch (err) {
      const ae = asAuthError(err)
      setBusy(false)
      if (ae.code === 'email_taken') {
        // Back to the field that needs changing, with the error on it.
        setEmailTaken(email.trim().toLowerCase())
        setStep(0)
        requestAnimationFrame(() => account.focus('email'))
        return
      }
      setError(ae)
    }
  }

  const voice = busy ? 'busy' : error ? 'error' : undefined
  const steps = ['Your account', 'Your business']

  return (
    <AuthLayout
      kicker="Get started"
      docTitle={step === 0 ? 'Sign up' : 'Sign up · your business'}
      step={step}
      voice={voice}
      title={
        step === 0 ? (
          <>
            Bring AICA to your <em>front desk.</em>
          </>
        ) : (
          <>
            Tell us about your <em>business.</em>
          </>
        )
      }
      lede={
        <p>
          {step === 0
            ? 'Create the owner account. You can invite your team once your business is approved.'
            : businessOnly
              ? `Signed in as ${user?.email ?? ''}. One more step: a bitNtech team member reviews every new business before it goes live.`
              : 'A bitNtech team member reviews every new business before it goes live.'}
        </p>
      }
    >
      {!businessOnly && <Stepper steps={steps} current={step} />}

      {step === 0 && client.googleSignInUrl && (
        <>
          <GoogleButton href={client.googleSignInUrl()} label="Sign up with Google" />
          <OrDivider />
        </>
      )}

      {error && (
        <Alert tone="error" ref={alertRef} className="form__alert" title="We couldn't send your request">
          <p>{error.message}</p>
        </Alert>
      )}

      {step === 0 ? (
        <form className="form" noValidate onSubmit={next}>
          <TextField
            ref={account.ref('name')}
            label="Your name"
            name="name"
            autoComplete="name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={account.blur('name')}
            error={account.shown('name')}
          />
          <TextField
            ref={account.ref('email')}
            label="Work email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@hospital.in"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={account.blur('email')}
            error={account.shown('email')}
            hint={
              emailTaken && emailTaken === email.trim().toLowerCase() ? (
                <>
                  <Link className="link" to="/login" state={{ email: email.trim() }}>
                    Sign in
                  </Link>{' '}
                  or{' '}
                  <Link className="link" to="/reset" state={{ email: email.trim() }}>
                    reset the password
                  </Link>
                  .
                </>
              ) : (
                "We'll send a link to confirm it."
              )
            }
          />
          <TextField
            ref={account.ref('phone')}
            label="Mobile number"
            type="tel"
            name="phone"
            autoComplete="tel-national"
            inputMode="tel"
            leading="+91"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={account.blur('phone')}
            error={account.shown('phone')}
            hint="For bitNtech to reach you about setup."
          />
          <PasswordField
            ref={account.ref('password')}
            label="Create a password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={account.blur('password')}
            error={account.shown('password')}
            below={<PasswordStrength password={password} email={email} />}
          />
          <Button type="submit" block arrow>
            Continue
          </Button>
        </form>
      ) : (
        <form className="form" noValidate onSubmit={submit}>
          <TextField
            ref={business.ref('bizName')}
            label="Business name"
            name="organization"
            autoComplete="organization"
            autoFocus
            placeholder="As callers know you"
            value={bizName}
            onChange={(e) => setBizName(e.target.value)}
            onBlur={business.blur('bizName')}
            error={business.shown('bizName')}
          />
          <ChoiceGroup
            legend="Type of business"
            type="radio"
            options={TYPES.map((t) => ({ value: t, label: BUSINESS_LABEL[t] }))}
            value={bizType}
            onChange={setBizType}
            onBlur={business.blur('bizType')}
            firstRef={business.ref('bizType')}
            error={business.shown('bizType')}
          />
          <TextField
            ref={business.ref('city')}
            label="City"
            name="city"
            autoComplete="address-level2"
            list="signup-cities"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onBlur={business.blur('city')}
            error={business.shown('city')}
          />
          <datalist id="signup-cities">
            {CITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <ChoiceGroup
            legend="Languages your callers use"
            hint="Choose all that apply."
            type="checkbox"
            columns={3}
            options={LANGS.map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
            value={langs}
            onChange={setLangs}
            onBlur={business.blur('langs')}
            firstRef={business.ref('langs')}
            error={business.shown('langs')}
          />
          <div>
            <Checkbox
              ref={business.ref('terms')}
              label="I agree to BitNTech's terms of service and privacy policy"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              onBlur={business.blur('terms')}
              aria-invalid={business.shown('terms') ? true : undefined}
            />
            {business.shown('terms') && <p className="field__error check__error">{business.shown('terms')}</p>}
          </div>
          <div className="form__actions">
            {!businessOnly && (
              <Button variant="line" onClick={() => setStep(0)} disabled={busy}>
                <span aria-hidden="true">←</span> Back
              </Button>
            )}
            <Button type="submit" arrow busy={busy} busyLabel="Sending…" className="form__grow">
              Send for review
            </Button>
          </div>
        </form>
      )}

      {businessOnly ? (
        <p className="form__after">
          Joining a team that already uses AICA? Ask its admin for an invite instead.{' '}
          <button type="button" className="btn-text" onClick={() => void signOut()}>
            Sign out
          </button>
        </p>
      ) : (
        <p className="form__after">
          Already have an account?{' '}
          <Link className="link" to="/login">
            Sign in
          </Link>
          . Joining a team that already uses AICA? Ask its admin for an invite instead.
        </p>
      )}
    </AuthLayout>
  )
}
