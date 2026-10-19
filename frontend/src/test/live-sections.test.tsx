import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createDemoConsoleClient } from '../console/demoClient'
import type { ConsoleClient } from '../console/types'
import { renderApp, signIn } from './renderApp'

const O = '/o/arogya-demo'

/** The demo client, but saying Team is live, as the HTTP client does. */
const mixed = (): ConsoleClient => ({ ...createDemoConsoleClient({ latency: 0 }), isLive: (s) => s === 'team' })

describe('the "Demo data" note while some sections are live', () => {
  it('is gone from a live section', async () => {
    const view = renderApp(`${O}/team`, { consoleClient: mixed() })
    await signIn(view.user, 'owner@example.com')
    expect(await screen.findByRole('heading', { name: /^team$/i })).toBeInTheDocument()
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument()
  })

  it('stays on sections that are still sample data', async () => {
    const view = renderApp(`${O}/settings`, { consoleClient: mixed() })
    await signIn(view.user, 'owner@example.com')
    expect(await screen.findByRole('heading', { name: /organisation settings/i })).toBeInTheDocument()
    expect(screen.getByText('Demo data')).toBeInTheDocument()
  })
})
