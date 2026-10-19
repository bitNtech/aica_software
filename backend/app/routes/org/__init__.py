"""/api/orgs/{slug}/… — routes for one client organisation. Every route
depends on orgs.org_member or orgs.org_permission."""
from . import activity, settings, team

routers = (team.router, settings.router, activity.router)
