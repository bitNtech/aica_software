import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { createHttpAuthClient } from './auth/httpClient'
import { createMockAuthClient } from './auth/mockClient'
import { ConsoleProvider } from './console/ConsoleProvider'
import { createDemoConsoleClient } from './console/demoClient'
import { ErrorBoundary } from './pages/SystemPage'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

// The FastAPI backend by default. VITE_AUTH_MODE=demo (npm run dev:demo) runs
// every page against the in-browser mock instead, labelled "Demo mode".
const client = import.meta.env.VITE_AUTH_MODE === 'demo' ? createMockAuthClient() : createHttpAuthClient()
// Organisation pages run on sample data until their API exists; every page
// labels it "Demo data".
const consoleClient = createDemoConsoleClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider client={client}>
        <ConsoleProvider client={consoleClient}>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ConsoleProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
