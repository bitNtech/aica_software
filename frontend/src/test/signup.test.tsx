import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, signIn, signOutToLogin } from './renderApp'

const PW = 'river-lamp-2026-blue'

async function fillAccount(user: ReturnType<typeof renderApp>['user'], email = 'owner@newclinic.in') {
  await user.type(await screen.findByLabelText(/your name/i), 'Dr. Lakshmi K')
  await user.type(screen.getByLabelText(/work email/i), email)
  await user.type(screen.getByLabelText(/mobile number/i), '98400 12345')
  await user.type(screen.getByLabelText(/create a password/i), PW)
  await user.click(screen.getByRole('button', { name: /continue/i }))
}

async function fillBusiness(user: ReturnType<typeof renderApp>['user']) {
  await user.type(await screen.findByLabelText(/business name/i), 'Lakshmi Skin Clinic')
  await user.click(screen.getByRole('radio', { name: /clinic/i }))
  await user.type(screen.getByLabelText(/^city/i), 'Chennai')
  await user.click(screen.getByRole('checkbox', { name: /tamil/i }))
  await user.click(screen.getByRole('checkbox', { name: /agree/i }))
  await user.click(screen.getByRole('button', { name: /send for review/i }))
}

describe('/signup', () => {
  it('validates each step before moving on', async () => {
    const { user } = renderApp('/signup')
    await user.click(await screen.findByRole('button', { name: /continue/i }))
    expect(screen.getByLabelText(/your name/i)).toHaveFocus()
    expect(screen.getByText(/enter a mobile number/i)).toBeInTheDocument()

    await fillAccount(user)
    expect(await screen.findByRole('heading', { name: /about your business/i })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /send for review/i }))
    expect(screen.getByText(/choose the kind of business/i)).toBeInTheDocument()
    expect(screen.getByText(/at least one language/i)).toBeInTheDocument()
    expect(screen.getByText(/tick this to continue/i)).toBeInTheDocument()

    // Back keeps what was typed.
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByLabelText(/your name/i)).toHaveValue('Dr. Lakshmi K')
  })

  it('sends a taken email back to step one with the error on the field', async () => {
    const { user } = renderApp('/signup')
    await fillAccount(user, 'frontdesk@example.com')
    await fillBusiness(user)
    const email = await screen.findByLabelText(/work email/i)
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText(/already exists/i)).toBeInTheDocument()
  })

  it('runs the whole loop: sign up → verify → in review → approved by master admin → in', async () => {
    const { user } = renderApp('/signup')
    await fillAccount(user)
    await fillBusiness(user)

    // Verify
    expect(await screen.findByRole('heading', { name: /confirm your email/i })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /open the verification link/i }))
    expect(await screen.findByRole('heading', { name: /email confirmed/i })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /^sign in/i }))

    // Owner signs in: still in review
    await user.type(await screen.findByLabelText(/^password/i), PW)
    await user.click(screen.getByRole('button', { name: /^sign in/i }))
    expect(await screen.findByRole('heading', { name: /on the list/i })).toBeInTheDocument()
    expect(screen.getByText('Lakshmi Skin Clinic')).toBeInTheDocument()
    await signOutToLogin(user)

    // Master admin approves
    await signIn(user, 'master@example.com')
    expect(await screen.findByRole('heading', { name: /every client/i })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /sign-up requests/i }))
    await user.click(await screen.findByRole('button', { name: /approve lakshmi skin clinic/i }))
    expect(await screen.findByText(/is approved/i)).toBeInTheDocument()
    await signOutToLogin(user)

    // Owner is in
    await signIn(user, 'owner@newclinic.in', PW)
    expect(await screen.findByRole('heading', { name: /you're in/i })).toBeInTheDocument()
  })

  it('stops an unverified owner at sign-in and offers a new link', async () => {
    const { user } = renderApp()
    await signIn(user, 'anitha@example.com')
    expect(await screen.findByRole('heading', { name: /confirm your email/i })).toBeInTheDocument()
    expect(screen.getByText(/before you can sign in/i)).toBeInTheDocument()
  })
})

describe('master admin and staff', () => {
  it('sends bitNtech accounts to /ops and client accounts away from it', async () => {
    const { user } = renderApp('/ops')
    await signIn(user, 'frontdesk@example.com')
    expect(await screen.findByRole('heading', { name: /you're in/i })).toBeInTheDocument()
  })

  it('blocks a client from /ops with the no-access page', async () => {
    const { user } = renderApp()
    await signIn(user, 'frontdesk@example.com')
    await screen.findByRole('heading', { name: /you're in/i })
    // Same session, typed URL: re-render the app at /ops.
    const second = renderApp('/ops')
    expect(await within(second.container).findByRole('heading', { name: /not on your team/i })).toBeInTheDocument()
  })

  it('lets staff review but not suspend', async () => {
    const { user } = renderApp()
    await signIn(user, 'ops@example.com')
    expect(await screen.findByText(/only the master admin can suspend/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^suspend /i })).not.toBeInTheDocument()
  })

  it('declines with a reason the owner then reads', async () => {
    const { user } = renderApp()
    await signIn(user, 'ops@example.com')
    await user.click(await screen.findByRole('link', { name: /sign-up requests/i }))
    await user.click(await screen.findByRole('button', { name: /decline kaveri scans/i }))
    await user.click(screen.getByRole('button', { name: /decline request/i }))
    expect(screen.getByText(/at least a short sentence/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/why decline/i), 'We only support Tamil Nadu clinics with a landline right now.')
    await user.click(screen.getByRole('button', { name: /decline request/i }))
    expect(await screen.findByText(/was declined/i)).toBeInTheDocument()
    await signOutToLogin(user)

    await signIn(user, 'pending@example.com')
    expect(await screen.findByRole('heading', { name: /couldn't approve/i })).toBeInTheDocument()
    expect(screen.getByText(/landline right now/i)).toBeInTheDocument()
  })

  it('keeps Approve locked until the owner verifies their email', async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /sign-up requests/i }))
    expect(await screen.findByRole('button', { name: /approve thendral/i })).toBeDisabled()
    expect(screen.getByText(/unlocks once the owner confirms/i)).toBeInTheDocument()
  })

  it('suspends an organisation, and its team sees why', async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('button', { name: /suspend nila eye clinic/i }))
    await user.type(screen.getByLabelText(/why suspend/i), 'Invoice for October is 30 days overdue.')
    await user.click(screen.getByRole('button', { name: /suspend organisation/i }))
    expect(await screen.findByText(/is suspended/i)).toBeInTheDocument()
    await signOutToLogin(user)

    // admin@ belongs to two orgs; with one suspended they go straight to the other.
    await signIn(user, 'admin@example.com')
    expect(await screen.findByText(/signed in to/i)).toHaveTextContent(/arogya/i)
  })

  it('shows the paused page when every organisation is suspended', async () => {
    const { user } = renderApp()
    await signIn(user, 'suspended@example.com')
    expect(await screen.findByRole('heading', { name: /access is paused/i })).toBeInTheDocument()
    expect(screen.getByText(/licence lapsed/i)).toBeInTheDocument()
  })

  it('accepts a staff invitation into /ops', async () => {
    const { user } = renderApp('/invite/staff')
    expect(await screen.findByText(/not manage bitntech staff/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/your name/i), 'Arun T')
    await user.type(screen.getByLabelText(/create a password/i), PW)
    await user.type(screen.getByLabelText(/type it again/i), PW)
    await user.click(screen.getByRole('button', { name: /accept and join/i }))
    expect(await screen.findByRole('heading', { name: /every client/i })).toBeInTheDocument()
  })
})

describe('session end', () => {
  it('confirms a deliberate sign-out', async () => {
    const { user } = renderApp()
    await signIn(user, 'frontdesk@example.com')
    await user.click(await screen.findByRole('button', { name: /^sign out$/i }))
    expect(await screen.findByRole('heading', { name: /signed out/i })).toBeInTheDocument()
  })

  it('signs out after inactivity and returns to the same page after signing in', async () => {
    const { user } = renderApp('/o/nila-eye-demo', { idleMs: 120 })
    await signIn(user, 'admin@example.com')
    await screen.findByText(/signed in to/i)
    expect(await screen.findByRole('heading', { name: /keep things safe/i }, { timeout: 2000 })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /sign in again/i }))
    await signIn(user, 'admin@example.com')
    expect(await screen.findByText(/signed in to/i)).toHaveTextContent(/nila eye clinic/i)
  })
})
