import { ConsolePage } from '../../../components/console/ConsolePage'
import { useOrg } from '../../../console/useOrg'
import { ReportDashboard } from '../home/ReportDashboard'
import '../operate/Operate.css'
import '../home/Home.css'

/** /o/:slug/analytics: the report dashboard as a page of its own, for reading
 * a period closely and exporting it. Home shows the same dashboard. */
export default function AnalyticsPage() {
  const { org } = useOrg()
  return (
    <ConsolePage
      section="reports"
      kicker="Operate"
      title="Analytics and reports"
      docTitle="Analytics and reports"
      lede={<p>How calls to {org.orgName} went over a period: how they ended, what callers wanted, when they called, languages, quality and each agent. Choose a period or one agent, then download the figures as CSV.</p>}
    >
      <ReportDashboard />
    </ConsolePage>
  )
}
