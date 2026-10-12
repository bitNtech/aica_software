import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router'
import { OrgPage, RedirectIfSignedIn, RequireAuth, RequireOrg, RequireStaff } from './auth/guards'
import { ConsoleShell } from './components/console/ConsoleShell'
import type { PageKey } from './console/access'
import { ActingAsBanner } from './components/ops/ActingAsBanner'
import { PendingPage, SessionExpiredPage, SignedOutPage, SuspendedPage } from './pages/AccountStatusPages'
import ChooseOrgPage from './pages/ChooseOrgPage'
import ConsoleHomePage from './pages/ConsoleHomePage'
import AgentsPage from './pages/console/AgentsPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import InvitePage from './pages/InvitePage'
import LoginPage from './pages/LoginPage'
import OpsAuditPage from './pages/ops/OpsAuditPage'
import OpsOverviewPage from './pages/ops/OpsOverviewPage'
import OpsPeoplePage from './pages/ops/OpsPeoplePage'
import OpsRequestsPage from './pages/ops/OpsRequestsPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SignupPage from './pages/SignupPage'
import { ForbiddenPage, NotFoundPage } from './pages/SystemPage'
import { VerifyEmailPage, VerifyEmailSentPage } from './pages/VerifyEmailPages'

const guest = (page: ReactNode) => <RedirectIfSignedIn>{page}</RedirectIfSignedIn>
const member = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>
const staff = (page: ReactNode) => <RequireStaff>{page}</RequireStaff>
const org = (page: PageKey, element: ReactNode) => <OrgPage page={page}>{element}</OrgPage>

export default function App() {
  return (
    <>
      <ActingAsBanner />
      <Routes>
      {/* "/" is the landing page: index.html and src/landing/, not this app (see vite.config.ts). */}

      {/* Signed out */}
      <Route path="/login" element={guest(<LoginPage />)} />
      <Route path="/signup" element={guest(<SignupPage />)} />
      <Route path="/signup/verify" element={guest(<VerifyEmailSentPage />)} />
      <Route path="/signed-out" element={guest(<SignedOutPage />)} />
      <Route path="/session-expired" element={guest(<SessionExpiredPage />)} />

      {/* Either: links that arrive by email */}
      <Route path="/verify/:token" element={<VerifyEmailPage />} />
      <Route path="/reset" element={<ForgotPasswordPage />} />
      <Route path="/reset/:token" element={<ResetPasswordPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />

      {/* Client accounts */}
      <Route path="/signup/business" element={member(<SignupPage businessOnly />)} />
      <Route path="/choose" element={member(<ChooseOrgPage />)} />
      <Route path="/pending" element={member(<PendingPage />)} />
      <Route path="/suspended" element={member(<SuspendedPage />)} />

      {/* An organisation's console: one frame, access per page from console/access.ts */}
      <Route
        path="/o/:slug"
        element={
          <RequireOrg>
            <ConsoleShell />
          </RequireOrg>
        }
      >
        <Route index element={org('home', <ConsoleHomePage />)} />
        <Route path="agents" element={org('agents', <AgentsPage />)} />
      </Route>

      {/* bitNtech: master admin and staff */}
      <Route path="/ops" element={staff(<OpsOverviewPage />)} />
      <Route path="/ops/requests" element={staff(<OpsRequestsPage />)} />
      <Route path="/ops/people" element={staff(<OpsPeoplePage />)} />
      <Route path="/ops/audit" element={staff(<OpsAuditPage />)} />

      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}
