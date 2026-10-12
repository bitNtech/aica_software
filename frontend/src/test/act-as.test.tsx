import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, signIn } from './renderApp'

const WHY = 'Owner reported the dashboard is blank.'

describe('acting as a client user', () => {
  it('acts as a client from People, shows the banner, and comes back', async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /^people$/i }))
    await user.click(await screen.findByRole('button', { name: /act as meena s/i }))
    await user.click(screen.getByRole('button', { name: /^act as meena s$/i }))
    expect(screen.getByText(/write at least a short sentence/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/why act as meena s/i), WHY)
    await user.click(screen.getByRole('button', { name: /^act as meena s$/i }))

    // Lands where Meena lands, with the banner on top.
    expect(await screen.findByRole('heading', { name: /you're in/i })).toBeInTheDocument()
    const banner = screen.getByRole('region', { name: /acting as another user/i })
    expect(within(banner).getByText('Meena S')).toBeInTheDocument()
    expect(within(banner).getByText(/30 min left/i)).toBeInTheDocument()

    await user.click(within(banner).getByRole('button', { name: /end and return to ops/i }))
    expect(await screen.findByText(/you’re back as yourself/i)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /acting as another user/i })).not.toBeInTheDocument()

    // Both ends are in the audit log.
    await user.click(screen.getByRole('link', { name: /audit log/i }))
    expect(await screen.findByText(/started acting as/i)).toBeInTheDocument()
    expect(screen.getByText(/stopped acting as/i)).toBeInTheDocument()
    expect(screen.getByText(WHY)).toBeInTheDocument()
  })

  it("acts as an organisation's owner from the Overview", async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('button', { name: /act as the owner of nila eye clinic/i }))
    await user.type(screen.getByLabelText(/why act as the owner/i), WHY)
    await user.click(screen.getByRole('button', { name: /^act as owner$/i }))
    // Karthik owns Nila and is admin at Arogya: the chooser.
    const banner = await screen.findByRole('region', { name: /acting as another user/i })
    expect(within(banner).getByText('Karthik R')).toBeInTheDocument()
  })

  it('keeps Ops closed while acting', async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /^people$/i }))
    await user.click(await screen.findByRole('button', { name: /act as meena s/i }))
    await user.type(screen.getByLabelText(/why act as meena s/i), WHY)
    await user.click(screen.getByRole('button', { name: /^act as meena s$/i }))
    await screen.findByRole('heading', { name: /you're in/i })

    // Same browser, typed URL.
    const second = renderApp('/ops')
    expect(await within(second.container).findByRole('heading', { name: /not on your team/i })).toBeInTheDocument()
  })

  it('drops an acting session that has run out', async () => {
    const { user } = renderApp()
    await signIn(user, 'master@example.com')
    await user.click(await screen.findByRole('link', { name: /^people$/i }))
    await user.click(await screen.findByRole('button', { name: /act as meena s/i }))
    await user.type(screen.getByLabelText(/why act as meena s/i), WHY)
    await user.click(screen.getByRole('button', { name: /^act as meena s$/i }))
    await screen.findByRole('heading', { name: /you're in/i })

    const saved = JSON.parse(sessionStorage.getItem('aica.demo.acting')!)
    sessionStorage.setItem('aica.demo.acting', JSON.stringify({ ...saved, expiresAt: new Date(Date.now() - 1000).toISOString() }))
    const second = renderApp('/ops')
    expect(await within(second.container).findByRole('heading', { name: /every client/i })).toBeInTheDocument()
  })
})
