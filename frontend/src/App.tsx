import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { OrgPage, RedirectIfSignedIn, RequireAuth, RequireOrg, RequireStaff } from './auth/guards'
import { ConsoleShell } from './components/console/ConsoleShell'
import type { PageKey } from './console/access'
import { ActingAsBanner } from './components/ops/ActingAsBanner'
import { OpsOrgPage, OpsOrgShell } from './components/ops/OpsOrgShell'
import { PendingPage, SessionExpiredPage, SignedOutPage, SuspendedPage } from './pages/AccountStatusPages'
import AccountPage from './pages/AccountPage'
import ChooseOrgPage from './pages/ChooseOrgPage'
import ConsoleHomePage from './pages/ConsoleHomePage'
import AgentsPage from './pages/console/AgentsPage'
import BuilderRoute from './pages/console/builder/BuilderPage'
import AgentWorkspaceRoute from './pages/console/agent/AgentWorkspacePage'
import KnowledgePage from './pages/console/library/KnowledgePage'
import NumbersPage from './pages/console/library/NumbersPage'
import ToolsPage from './pages/console/library/ToolsPage'
import UploadsPage from './pages/console/library/UploadsPage'
import AppointmentsPage from './pages/console/operate/AppointmentsPage'
import CallDetailPage from './pages/console/operate/CallDetailPage'
import CallHistoryPage from './pages/console/operate/CallHistoryPage'
import TeamPage from './pages/console/manage/TeamPage'
import ActivityPage from './pages/console/manage/ActivityPage'
import OrgSettingsPage from './pages/console/manage/OrgSettingsPage'
import BillingPage from './pages/console/manage/BillingPage'
import CallbacksPage from './pages/console/operate/CallbacksPage'
import LiveCallsPage from './pages/console/operate/LiveCallsPage'
import BotDeskPage from './pages/console/operate/BotDeskPage'
import RequestsPage from './pages/console/RequestsPage'
import OpsChangesPage from './pages/ops/OpsChangesPage'
import NewAgentPage from './pages/console/builder/NewAgentPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import InvitePage from './pages/InvitePage'
import LoginPage from './pages/LoginPage'
import OpsAuditPage from './pages/ops/OpsAuditPage'
import OpsOverviewPage from './pages/ops/OpsOverviewPage'
import OpsPeoplePage from './pages/ops/OpsPeoplePage'
import OpsRequestsPage from './pages/ops/OpsRequestsPage'
import OpsOrgDetailPage from './pages/ops/OpsOrgDetailPage'
import OpsTemplatesPage from './pages/ops/OpsTemplatesPage'
import OpsUsagePage from './pages/ops/OpsUsagePage'
import OpsPlatformPage from './pages/ops/OpsPlatformPage'
import OpsStatusPage from './pages/ops/OpsStatusPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SignupPage from './pages/SignupPage'
import { ForbiddenPage, NotFoundPage } from './pages/SystemPage'
import { VerifyEmailPage, VerifyEmailSentPage } from './pages/VerifyEmailPages'

// The component gallery exists only in development: the dead branch is
// removed from a production build, chunk and all.
const UiKitPage = import.meta.env.DEV ? lazy(() => import('./pages/console/dev/UiKitPage')) : null

const guest = (page: ReactNode) => <RedirectIfSignedIn>{page}</RedirectIfSignedIn>
const member = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>
const staff = (page: ReactNode) => <RequireStaff>{page}</RequireStaff>
const org = (page: PageKey, element: ReactNode) => <OrgPage page={page}>{element}</OrgPage>
const opsOrg = (page: PageKey, element: ReactNode) => <OpsOrgPage page={page}>{element}</OpsOrgPage>

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
      <Route path="/account" element={member(<AccountPage />)} />
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
        {/* Only bitNtech builds agents (from Ops); these explain that to anyone with an old link. */}
        <Route path="agents/new" element={org('agentBuilder', <NewAgentPage />)} />
        <Route path="agents/drafts/:draftId/:step?" element={org('agentBuilder', <BuilderRoute />)} />
        <Route path="agents/:agentId/:tab?" element={org('agentWorkspace', <AgentWorkspaceRoute />)} />
        <Route path="requests" element={org('requests', <RequestsPage />)} />
        <Route path="desk" element={org('desk', <BotDeskPage />)} />
        <Route path="uploads" element={org('uploads', <UploadsPage />)} />
        <Route path="knowledge" element={org('knowledge', <KnowledgePage />)} />
        <Route path="integrations" element={org('integrations', <ToolsPage />)} />
        <Route path="numbers" element={org('numbers', <NumbersPage />)} />
        <Route path="live" element={org('live', <LiveCallsPage />)} />
        {/* The handoff queue is part of Live calls now; old links and bookmarks land there. */}
        <Route path="handoffs" element={<Navigate to="../live" replace />} />
        <Route path="callbacks" element={org('callbacks', <CallbacksPage />)} />
        <Route path="appointments" element={org('appointments', <AppointmentsPage />)} />
        <Route path="calls" element={org('calls', <CallHistoryPage />)} />
        <Route path="calls/:callId" element={org('calls', <CallDetailPage />)} />
        <Route path="reports" element={<Navigate to="../" replace />} />
        <Route path="team" element={org('team', <TeamPage />)} />
        <Route path="activity" element={org('activity', <ActivityPage />)} />
        <Route path="settings" element={org('settings', <OrgSettingsPage />)} />
        <Route path="billing" element={org('billing', <BillingPage />)} />
        {UiKitPage && (
          <Route
            path="dev/ui"
            element={org(
              'home',
              <Suspense fallback={null}>
                <UiKitPage />
              </Suspense>,
            )}
          />
        )}
      </Route>

      {/* bitNtech: master admin and staff */}
      <Route path="/ops" element={staff(<OpsOverviewPage />)} />
      <Route path="/ops/requests" element={staff(<OpsRequestsPage />)} />
      <Route path="/ops/people" element={staff(<OpsPeoplePage />)} />
      <Route path="/ops/audit" element={staff(<OpsAuditPage />)} />
      <Route path="/ops/orgs/:slug" element={staff(<OpsOrgDetailPage />)} />
      <Route path="/ops/changes" element={staff(<OpsChangesPage />)} />
      {/* One organisation's agents, worked on by bitNtech: the console's agent pages in an Ops frame. */}
      <Route element={staff(<OpsOrgShell />)}>
        <Route path="/ops/orgs/:slug/agents" element={opsOrg('agents', <AgentsPage />)} />
        <Route path="/ops/orgs/:slug/agents/new" element={opsOrg('agentBuilder', <NewAgentPage />)} />
        <Route path="/ops/orgs/:slug/agents/drafts/:draftId/:step?" element={opsOrg('agentBuilder', <BuilderRoute />)} />
        <Route path="/ops/orgs/:slug/agents/:agentId/:tab?" element={opsOrg('agentWorkspace', <AgentWorkspaceRoute />)} />
        <Route path="/ops/orgs/:slug/integrations" element={opsOrg('integrations', <ToolsPage />)} />
        <Route path="/ops/orgs/:slug/uploads" element={opsOrg('uploads', <UploadsPage />)} />
        <Route path="/ops/orgs/:slug/requests" element={<RequestsPage />} />
      </Route>
      <Route path="/ops/templates" element={staff(<OpsTemplatesPage />)} />
      <Route path="/ops/usage" element={staff(<OpsUsagePage />)} />
      <Route path="/ops/platform" element={staff(<OpsPlatformPage />)} />
      <Route path="/ops/status" element={staff(<OpsStatusPage />)} />

      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Analytics />
      <SpeedInsights />
    </>
  )
}
