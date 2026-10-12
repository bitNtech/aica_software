import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Demo from '../landing/sections/Demo'

afterEach(() => vi.unstubAllGlobals())

async function fillAndSend() {
  const user = userEvent.setup()
  render(<Demo />)
  await user.type(screen.getByLabelText('Name'), 'Priya Raman')
  await user.type(screen.getByLabelText('Company'), 'Priya Dental')
  await user.type(screen.getByLabelText('Phone number'), '+91 98765 43210')
  await user.click(screen.getByRole('radio', { name: 'Hospital / clinic' }))
  await user.click(screen.getByRole('radio', { name: '50–200' }))
  await user.click(screen.getByRole('button', { name: /book my demo/i }))
}

describe('Demo form', () => {
  it('sends the request to the backend, which emails the team', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await fillAndSend()
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks, Priya. We’ll call you to fix a time.')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/leads/demo')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse(init.body)).toMatchObject({
      name: 'Priya Raman', company: 'Priya Dental', phone: '9876543210', industry: 'Hospital / clinic', calls_per_day: '50–200', website: '',
    })
  })

  it('points to WhatsApp when the backend cannot send it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'unknown' } }), { status: 503 })))
    await fillAndSend()
    expect(await screen.findByRole('alert')).toHaveTextContent(/didn’t go through.*WhatsApp/)
    expect(screen.getByRole('button', { name: /book my demo/i })).toBeEnabled()
  })

  it('explains the rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429 })))
    await fillAndSend()
    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a minute/i)
  })

  it('reports the backend being unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await fillAndSend()
    expect(await screen.findByRole('alert')).toHaveTextContent(/didn’t go through/)
  })

  it('keeps the honeypot out of reach', () => {
    render(<Demo />)
    const hp = document.querySelector<HTMLInputElement>('input[name="website"]')!
    expect(hp.tabIndex).toBe(-1)
    expect(hp.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
