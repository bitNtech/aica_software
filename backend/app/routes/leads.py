"""/api/leads — the public landing page's "Book a demo" form. Nothing is
stored: the request is emailed to the team (DEMO_REQUEST_TO) through Resend.
Names and phone numbers never reach the logs."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response

from ..errors import ApiError
from ..models import DemoRequestIn
from ..ratelimit import limit
from ..services import Services, get_services
from ..store import now

log = logging.getLogger("aica.leads")
router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.post("/demo", status_code=204, dependencies=[Depends(limit("demo", 5))])
def demo(body: DemoRequestIn, svc: Services = Depends(get_services)):
    if body.website:
        # A bot filled in the hidden field: look successful, send nothing.
        log.info("demo request dropped (honeypot)")
        return Response(status_code=204)
    lead = body.model_dump(exclude={"website", "submitted_at"}, exclude_none=True)
    lead["received_at"] = now().strftime("%Y-%m-%d %H:%M UTC")
    if not svc.mailer.demo_request(svc.settings.demo_recipients, lead):
        log.error("demo request not delivered")
        raise ApiError(503, "unknown", "We couldn't send your request just now. Please try again, or message us on WhatsApp.")
    log.info("demo request sent (industry=%s, calls_per_day=%s)", body.industry, body.calls_per_day)
    return Response(status_code=204)
