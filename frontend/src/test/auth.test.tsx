import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DEMO_PASSWORD } from '../auth/mockClient'
import { renderApp } from './renderApp'

describe('/login', () => {
  it('shows field errors on submit and focuses the first invalid field', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: /^sign in/i }))
    const email = screen.getByLabelText(/work email/i)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveFocus()
    expect(screen.getByText(/enter your work email/i)).toBeInTheDocument()
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument()
  })

  it('signs a one-org user straight into their organisation', async () => {
    const { user } = renderApp()
    await user.type(await screen.findByLabelText(/work email/i), 'frontdesk@example.com')
    await user.type(screen.getByLabelText(/^password/i), DEMO_PASSWORD)
    await user.click(screen.getByRole('button', { name: /^sign in/i }))
    expect(await screen.findByRole('heading', { name: /you're in/i })).toBeInTheDocument()
    expect(screen.getAllByText(/arogya demo hospital/i).length).toBeGreaterThan(0)
  })

  it('sends a multi-org user to the chooser', async () => {
    const { user } = renderApp()
    await user.type(await screen.findByLabelText(/work email/i), 'admin@example.com')
    await user.type(screen.getByLabelText(/^password/i), DEMO_PASSWORD)
    await user.click(screen.getByRole('button', { name: /^sign in/i }))
    expect(await screen.findByRole('heading', { name: /where to/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /nila eye clinic/i }))
    expect(await screen.findByRole('heading', { name: /you're in/i })).toBeInTheDocument()
  })

  it('shows one generic error for a wrong password and clears the field', async () => {
    const { user } = renderApp()
    await user.type(await screen.findByLabelText(/work email/i), 'frontdesk@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /^sign in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/don't match/i)
    expect(screen.getByLabelText(/^password/i)).toHaveValue('')
  })

  it('pauses sign-in after five failed attempts', async () => {
    const { user } = renderApp()
    const email = await screen.findByLabelText(/work email/i)
    await user.type(email, 'frontdesk@example.com')
    for (let i = 0; i < 5; i++) {
      await user.type(screen.getByLabelText(/^password/i), `wrong-${i}`)
      await user.click(screen.getByRole('button', { name: /^sign in/i }))
      await screen.findByRole('alert')
    }
    expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i)
    expect(screen.getByRole('button', { name: /try again in/i })).toBeDisabled()
  })

  it('explains a locked account', async () => {
    const { user } = renderApp()
    await user.type(await screen.findByLabelText(/work email/i), 'locked@example.com')
    await user.type(screen.getByLabelText(/^password/i), DEMO_PASSWORD)
    await user.click(screen.getByRole('button', { name: /^sign in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/locked/i)
  })

  it('toggles password visibility', async () => {
    const { user } = renderApp()
    const pw = await screen.findByLabelText(/^password/i)
    expect(pw).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: /show password/i }))
    expect(pw).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: /hide password/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('labels demo mode', async () => {
    renderApp()
    expect(await screen.findByText(/demo mode/i)).toBeInTheDocument()
  })
})

describe('guards', () => {
  it('sends a signed-out visitor to /login, then back where they were going', async () => {
    const { user } = renderApp('/o/nila-eye-demo')
    await user.type(await screen.findByLabelText(/work email/i), 'admin@example.com')
    await user.type(screen.getByLabelText(/^password/i), DEMO_PASSWORD)
    await user.click(screen.getByRole('button', { name: /^sign in/i }))
    expect(await screen.findByText(/signed in to/i)).toHaveTextContent(/nila eye clinic/i)
  })

  it('shows the not-found page for unknown routes', async () => {
    renderApp('/nope')
    expect(await screen.findByRole('heading', { name: /nothing on this line/i })).toBeInTheDocument()
  })
})

describe('password reset', () => {
  it('requests a link, then sets a new password and signs in with it', async () => {
    const { user } = renderApp('/reset')
    await user.type(await screen.findByLabelText(/work email/i), 'frontdesk@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))
    expect(await screen.findByRole('heading', { name: /check your inbox/i })).toHaveFocus()

    await user.click(screen.getByRole('link', { name: /open the reset link/i }))
    const pw = await screen.findByLabelText(/new password/i)
    await user.type(pw, 'river-lamp-2026-blue')
    await user.type(screen.getByLabelText(/type it again/i), 'river-lamp-2026-blue')
    await user.click(screen.getByRole('button', { name: /save new password/i }))

    expect(await screen.findByText(/password changed/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/work email/i)).toHaveValue('frontdesk@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'river-lamp-2026-blue')
    await user.click(screen.getByRole('button', { name: /^sign in/i }))
    expect(await screen.findByRole('heading', { name: /you're in/i })).toBeInTheDocument()
  })

  it('explains an expired link', async () => {
    renderApp('/reset/expired')
    expect(await screen.findByRole('heading', { name: /expired/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /send a new link/i })).toHaveAttribute('href', '/reset')
  })
})

describe('/invite/:token', () => {
  it('states the role in plain words, then creates the account', async () => {
    const { user } = renderApp('/invite/demo')
    expect(await screen.findByText(/take over live ones, but not change the agent/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/your name/i), 'Priya N')
    await user.type(screen.getByLabelText(/create a password/i), 'river-lamp-2026-blue')
    await user.type(screen.getByLabelText(/type it again/i), 'river-lamp-2026-blue')
    await user.click(screen.getByRole('button', { name: /accept and join/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /you're in/i })).toBeInTheDocument())
  })

  it('handles expired and used invitations', async () => {
    renderApp('/invite/expired')
    expect(await screen.findByRole('heading', { name: /expired/i })).toBeInTheDocument()
  })
})
