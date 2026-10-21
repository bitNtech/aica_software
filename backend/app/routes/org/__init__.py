"""/api/orgs/{slug}/… — routes for one client organisation. Every route
depends on orgs.org_member or orgs.org_permission."""
from . import activity, agents, appointments, callbacks, calls, handoffs, knowledge, numbers, reports, requests, settings, team, tools, uploads

routers = (team.router, settings.router, activity.router, requests.router, calls.router, callbacks.router, appointments.router, handoffs.router, reports.router,
           numbers.router, tools.router, knowledge.router, uploads.router, agents.router, agents.catalogue_router)
