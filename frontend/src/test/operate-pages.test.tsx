import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'

// A fixed moment, when all three sample live calls are in progress: the
// demo's live calls and call log follow the clock.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(1_700_000_000_000))
})
afterEach(() => vi.useRealTimers())

async function open(email: string, path: string) {
  const view = renderApp(path)
  await signIn(view.user, email)
  return view
}

describe('Home', () => {
  it('shows managers what needs a person and today so far', async () => {
    await open('admin@example.com', O)
    // The heading is there while today loads; the cards arrive with the data.
    const waiting = await screen.findByRole('link', { name: /3 waiting for a person/i })
    const cards = screen.getByRole('heading', { name: /needs a person/i }).closest('section')!
    // The waiting callers are on Live calls now (the handoff queue was folded into it).
    expect(within(cards).getByRole('link', { name: /3 waiting for a person/i })).toHaveAttribute('href', `${O}/live`)
    expect(waiting).toBe(within(cards).getByRole('link', { name: /3 waiting for a person/i }))
    expect(within(cards).getByRole('link', { name: /calls in progress/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /^reports$/i })).toBeInTheDocument()
    // Appears twice now Reports is embedded in Home: the stat tile and the
    // trend chart's legend share the label.
    expect(screen.getAllByText('Answered by the agents').length).toBeGreaterThan(0)
  })

  it('shows the front desk their work, without the numbers', async () => {
    await open('frontdesk@example.com', O)
    // Their shift: who is waiting and their callbacks, not the summary cards.
    expect(await screen.findByRole('heading', { name: /callers waiting for a person/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /my next callbacks/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /today so far/i })).not.toBeInTheDocument()
  })

  it('shows viewers the numbers, appointments and who is waiting', async () => {
    await open('viewer@example.com', O)
    // The "Needs a person" cards and the Reports section load independently;
    // wait for the one each assertion actually needs, not an unrelated one.
    expect(await screen.findByRole('link', { name: /appointment requests to review/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /^reports$/i })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /waiting for a person/i })).toBeInTheDocument()
  })
})

// Live calls, with the waiting callers: see live-calls.test.tsx.
