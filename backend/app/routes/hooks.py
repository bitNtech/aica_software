"""/api/hooks/orchestrator — call and handoff events from the voice
orchestrator (docs/orchestrator-contract.md §Webhooks).

No session: the request is trusted only by its signature,
`X-AICA-Signature: t=<unix>,v1=<hex HMAC-SHA256(ORCH_WEBHOOK_SECRET, "<t>.<body>")>`,
checked in constant time, with at most five minutes' clock difference. The
event only says what happened; the call itself is read back from the
orchestrator before anything is written.

Every write is idempotent (a call is recorded once by its id, a handoff is
updated in place), so a retried delivery (same X-AICA-Delivery) changes
nothing. Events for tenants or voice agents that aren't ours are accepted
and dropped, so the orchestrator doesn't retry them.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time

from fastapi import APIRouter, Depends, Request, Response

from ..core.errors import ApiError
from ..core.services import Services, get_services
from ..integrations.orchestrator import OrchestratorError
from .org.voice import ours, record_session, upsert_handoff

log = logging.getLogger("aica.hooks")
router = APIRouter(prefix="/api/hooks", tags=["hooks"])
MAX_SKEW_S = 300
MAX_BODY = 512 * 1024


def verify(secret: str, body: bytes, header: str, at: float | None = None) -> bool:
    try:
        parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
        t = int(parts["t"])
        sig = parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs((at or time.time()) - t) > MAX_SKEW_S:
        return False
    mac = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, sig)


@router.post("/orchestrator", status_code=204)
async def orchestrator_event(request: Request, svc: Services = Depends(get_services)):
    secret = svc.settings.orch_webhook_secret
    if not secret or svc.orch is None:
        raise ApiError(503, "unknown", "Voice events aren't set up on this server.")
    body = await request.body()
    if len(body) > MAX_BODY:
        raise ApiError(413, "invalid_input", "Too large.")
    if not verify(secret, body, request.headers.get("x-aica-signature", "")):
        log.warning("orchestrator event with a bad signature")
        raise ApiError(401, "unauthenticated", "Bad signature.")
    try:
        event = json.loads(body)
    except ValueError:
        raise ApiError(400, "invalid_input", "Not JSON.")
    kind = str(event.get("event") or request.headers.get("x-aica-event") or "")
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    tenant = data.get("tenant_id")
    org = next((o for o in svc.store.list_orgs() if tenant and o.orchTenantId == tenant), None)
    log.info("orchestrator event", extra={"event": kind, "delivery": request.headers.get("x-aica-delivery"), "org": org.slug if org else None})
    if not org:
        return Response(status_code=204)
    by_voice, numbers = ours(svc, org.slug)
    try:
        if kind == "call.ended" and data.get("session_id"):
            s = svc.orch.get(f"/v1/voice/sessions/{data['session_id']}", tenant=tenant).data or {}
            if s.get("voice_agent_id") in by_voice:
                record_session(svc, org, s, by_voice, numbers)
        elif kind.startswith("handoff.") and isinstance(data.get("handoff"), dict):
            h = {**data["handoff"], "voice_agent_id": data["handoff"].get("voice_agent_id") or data.get("voice_agent_id"), "session_id": data["handoff"].get("session_id") or data.get("session_id")}
            if kind == "handoff.timeout":
                h["status"] = "timeout"
            upsert_handoff(svc, org, h, by_voice, numbers, recent=data.get("recent_transcript") if isinstance(data.get("recent_transcript"), list) else None)
    except OrchestratorError as e:
        # The orchestrator retries 5xx: worth it, it may be back in a moment.
        log.warning("orchestrator event not applied", extra={"event": kind, "status": e.status})
        raise ApiError(503, "unknown", "Couldn't read the call back. Retry later.")
    return Response(status_code=204)
