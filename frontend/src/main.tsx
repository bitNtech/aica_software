import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { createHttpAuthClient } from './auth/httpClient'
import { createMockAuthClient } from './auth/mockClient'
import { ConsoleProvider } from './console/ConsoleProvider'
import { createDemoConsoleClient } from './console/demoClient'
import { createHttpConsoleClient, liveSections } from './console/httpConsoleClient'
import { createDemoOpsClient } from './ops/demoOpsClient'
import { OpsDataProvider } from './ops/OpsDataProvider'
import { ErrorBoundary } from './pages/SystemPage'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

// The FastAPI backend by default. VITE_AUTH_MODE=demo (npm run dev:demo) runs
// every page against the in-browser mock instead, labelled "Demo mode".
const client = import.meta.env.VITE_AUTH_MODE === 'demo' ? createMockAuthClient() : createHttpAuthClient()
// Organisation pages: VITE_CONSOLE_MODE=live serves sections from the API
// and the rest from sample data, each page labelled "Demo data" until its
// section is live. VITE_CONSOLE_LIVE lists the live sections (default: team,
// settings, activity, requests). Anything else, or the auth demo, keeps every
// page on sample data. Set both per environment.
const liveConsole = import.meta.env.VITE_CONSOLE_MODE === 'live' && import.meta.env.VITE_AUTH_MODE !== 'demo'
const consoleClient = liveConsole
  ? createHttpConsoleClient(undefined, undefined, liveSections(import.meta.env.VITE_CONSOLE_LIVE))
  : createDemoConsoleClient()
// The same for the Ops pages that have no API yet.
const opsClient = createDemoOpsClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider client={client}>
        <ConsoleProvider client={consoleClient}>
          <OpsDataProvider client={opsClient}>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </OpsDataProvider>
        </ConsoleProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
