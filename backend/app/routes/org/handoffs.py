"""/api/orgs/{slug}/handoffs — callers the agent passed to a person (Phase 3).

Handoffs are created by the voice pipeline once its contract is agreed;
until then they come from the seed script. Anyone who can see calls
(`calls.viewAll` or `calls.take`) may read the queue, so everyone watching
Live calls sees who is waiting; taking one or making it a callback needs
`calls.take`. Taking one marks the call as handled by that person, so it
shows in their own call history.
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends

from ...access.orgs import OrgContext, org_permission
from ...auth.accounts import iso
from ...core.errors import ApiError, bad_input
from ...core.ratelimit import limit_caller
from ...data.store import CallbackDoc, HandoffDoc, Tx, new_id, now
from ...domain.redact import details_out, mask_phone, without_name
from ...models import CallbackOut, CollectedDetailOut, HandoffOut
from .callbacks import callback_out

router = APIRouter(prefix="/api/orgs/{slug}/handoffs", tags=["org"])

# Taken and missed handoffs stay in the queue's "recent" list this long.
RECENT = timedelta(hours=24)
CALLBACK_DUE = timedelta(hours=2)
WRITE_LIMIT = Depends(limit_caller("org-handoffs", 60))


def _caller_name(h: HandoffDoc) -> str | None:
    return next((d.get("value") or None for d in h.details if d.get("label") == "Patient name"), None)


def handoff_out(h: HandoffDoc, personal: bool) -> HandoffOut:
    return HandoffOut(
        id=h.id, call_id=h.callId, agent_name=h.agentName, line=h.line, caller_phone=mask_phone(h.callerPhone), reason=h.reason,
        summary=h.summary if personal else without_name(h.summary, _caller_name(h)),
        details=[CollectedDetailOut(**d) for d in details_out(h.details, personal)],
        language=h.language, waiting_since=iso(h.waitingSince), status=h.status, taken_by=h.takenBy,
        taken_at=iso(h.takenAt) if h.takenAt else None, emergency=h.emergency,
    )


def _get(tx: Tx, slug: str, handoff_id: str) -> HandoffDoc:
    h = tx.get_record(slug, "handoff", handoff_id)
    if not h:
        raise ApiError(404, "invalid_input", "That handover doesn't exist any more. It may have been deleted.")
    if h.status == "taken":
        raise bad_input(f"{h.takenBy} has already taken this call.")
    return h


@router.get("", response_model=list[HandoffOut], response_model_by_alias=True)
def list_handoffs(ctx: OrgContext = Depends(org_permission("calls.viewAll", "calls.take", what="see who is waiting for a person"))):
    from .voice import pull_handoffs

    pull_handoffs(ctx)
    personal = ctx.access.has("calls.personal")
    rows = sorted(ctx.svc.store.list_handoffs(ctx.slug, now() - RECENT), key=lambda h: h.waitingSince)
    return [handoff_out(h, personal) for h in rows]


@router.post("/{handoff_id}/take", response_model=HandoffOut, response_model_by_alias=True, dependencies=[WRITE_LIMIT])
def take(handoff_id: str, ctx: OrgContext = Depends(org_permission("calls.take", what="take calls"))):
    by, by_id = ctx.actor()[0], ctx.member_id

    def run(tx: Tx) -> HandoffDoc:
        h = _get(tx, ctx.slug, handoff_id)
        if h.status == "missed":
            raise bad_input("The caller hung up. Make it a callback instead.")
        call = tx.get_record(ctx.slug, "call", h.callId) if h.callId else None
        h.status, h.takenBy, h.takenById, h.takenAt = "taken", by, by_id, now()
        tx.save_record(ctx.slug, "handoff", h)
        if call:
            call.handledBy, call.handledById = by, by_id
            tx.save_record(ctx.slug, "call", call)
        return h

    return handoff_out(ctx.svc.store.transact(run), ctx.access.has("calls.personal"))


@router.post("/{handoff_id}/to-callback", response_model=CallbackOut, response_model_by_alias=True, dependencies=[WRITE_LIMIT])
def to_callback(handoff_id: str, ctx: OrgContext = Depends(org_permission("calls.take", what="make callbacks"))):
    def run(tx: Tx) -> CallbackDoc:
        h = _get(tx, ctx.slug, handoff_id)
        if h.status == "missed":
            raise bad_input("This caller already has a callback. It’s on the Callbacks page.")
        h.status = "missed"
        tx.save_record(ctx.slug, "handoff", h)
        t = now()
        mine = ctx.member if ctx.member and ctx.access.has("calls.take") else None
        cb = CallbackDoc(
            id=new_id("cb"), callerName=_caller_name(h), callerPhone=h.callerPhone, reason=h.summary, requestedAt=t, dueBy=t + CALLBACK_DUE,
            assignedToId=mine.id if mine else None, assignedToName=mine.name if mine else None, callId=h.callId or None,
        )
        tx.save_record(ctx.slug, "callback", cb)
        return cb

    return callback_out(ctx.svc.store.transact(run), ctx.access.has("calls.personal"))
