"""/api/orgs/{slug}/numbers — the organisation's phone lines (Phase 5).

- Reading: `library.numbers`, or anyone who sees agents and isn't a viewer;
  bitNtech too.
- Changing a line (label, hours, which agent answers, after hours):
  `library.numbers`. An agent answers one line: giving it this line frees
  its other one, and the agent that loses a line is paused.
- Adding and removing lines: bitNtech's master admin (lines are provisioned
  with the telephony provider by bitNtech; hospitals ask for one through a
  request).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from pydantic import Field

from ...access.orgs import OrgContext, org_member, org_permission
from ...core.errors import ApiError, bad_input, forbidden
from ...core.ratelimit import limit_caller
from ...data.store import NumberDoc, Tx, new_id, now
from ...models import Camel

router = APIRouter(prefix="/api/orgs/{slug}/numbers", tags=["org"])
WRITE_LIMIT = Depends(limit_caller("org-numbers", 30))
AFTER_HOURS = ("agent", "voicemail", "transfer")


class NumberIn(Camel):
    number: str = Field(max_length=40)
    label: str = Field(max_length=200)
    hours: str = Field("Every day, all day", max_length=200)


class NumberPatchIn(Camel):
    label: str | None = Field(None, max_length=200)
    agent_id: str | None = Field(None, max_length=128)
    hours: str | None = Field(None, max_length=200)
    after_hours: str | None = Field(None, max_length=20)
    transfer_to: str | None = Field(None, max_length=200)


def number_out(n: NumberDoc) -> dict:
    return {"id": n.id, "number": n.number, "label": n.label, "agentId": n.agentId, "hours": n.hours, "afterHours": n.afterHours, "transferTo": n.transferTo}


def can_read(ctx: OrgContext) -> bool:
    a = ctx.access
    return bool(a.platform) or a.has("library.numbers") or (a.has("agents.view") and a.role != "viewer")


def _not_found(what: str) -> ApiError:
    return ApiError(404, "invalid_input", f"That {what} doesn't exist any more. It may have been deleted.")


@router.get("")
def list_numbers(ctx: OrgContext = Depends(org_member)):
    if not can_read(ctx):
        raise forbidden("You don't have permission to see phone numbers.")
    return [number_out(n) for n in sorted(ctx.svc.store.list_records(ctx.slug, "number"), key=lambda n: n.createdAt)]


@router.post("", dependencies=[WRITE_LIMIT])
def add_number(body: NumberIn, ctx: OrgContext = Depends(org_member)):
    if ctx.access.platform != "master_admin":
        raise forbidden("Only bitNtech can add phone numbers. Ask them for one from the Phone numbers page.")
    digits = re.sub(r"\D", "", body.number)
    if not 6 <= len(digits) <= 15:
        raise bad_input("Give the number with its area code, e.g. +91 422 400 1000.")
    label = body.label.strip()
    if not 2 <= len(label) <= 40:
        raise bad_input("Give the number a label, e.g. “Main reception”.")

    def run(tx: Tx) -> NumberDoc:
        if any(re.sub(r"\D", "", n.number) == digits for n in tx.list_records(ctx.slug, "number")):
            raise bad_input("This organisation already has that number.")
        n = NumberDoc(id=new_id("num"), number=body.number.strip(), label=label, hours=body.hours.strip() or "Every day, all day")
        tx.save_record(ctx.slug, "number", n)
        ctx.log(tx, "library", f"Added the phone number {n.number} ({label})")
        return n

    return number_out(ctx.svc.store.transact(run))


@router.post("/{number_id}", dependencies=[WRITE_LIMIT])
def update_number(number_id: str, body: NumberPatchIn, ctx: OrgContext = Depends(org_permission("library.numbers", what="change phone lines"))):
    """The page sends the whole line; an absent field is left as it is."""
    sent = body.model_fields_set
    label = body.label.strip() if body.label is not None else None
    if label is not None and not 2 <= len(label) <= 40:
        raise bad_input("Give the number a label, e.g. “Main reception”.")
    hours = body.hours.strip() if body.hours is not None else None
    if hours is not None and not 1 <= len(hours) <= 80:
        raise bad_input("Say when the agent answers, e.g. “8 AM to 8 PM”.")
    if body.after_hours is not None and body.after_hours not in AFTER_HOURS:
        raise bad_input("Choose what happens after hours.")
    transfer = (body.transfer_to or "").strip() or None
    if transfer and len(transfer) > 80:
        raise bad_input("Keep where calls go under 80 characters.")

    def run(tx: Tx) -> NumberDoc:
        n = tx.get_record(ctx.slug, "number", number_id)
        if not n:
            raise _not_found("phone number")
        after = body.after_hours if body.after_hours is not None else n.afterHours
        if after == "transfer" and not (transfer if "transfer_to" in sent else n.transferTo):
            raise bad_input("Say where calls go after hours, or choose another option.")
        new_agent_id = body.agent_id if "agent_id" in sent else n.agentId
        new_agent = tx.get_record(ctx.slug, "agent", new_agent_id) if new_agent_id else None
        if new_agent_id and not new_agent:
            raise _not_found("agent")
        old_agent = tx.get_record(ctx.slug, "agent", n.agentId) if n.agentId and n.agentId != new_agent_id else None
        others = tx.list_records(ctx.slug, "number", (("agentId", "==", new_agent_id),)) if new_agent_id and new_agent_id != n.agentId else []
        # ---- writes
        t = now()
        if old_agent:  # it loses its line: nothing to answer, so it stops
            old_agent.numberId, old_agent.status, old_agent.updatedAt = None, "paused", t
            tx.save_record(ctx.slug, "agent", old_agent)
        for o in others:  # an agent answers one line
            if o.id != n.id:
                o.agentId = None
                tx.save_record(ctx.slug, "number", o)
        if new_agent and new_agent.numberId != n.id:
            new_agent.numberId, new_agent.updatedAt = n.id, t
            tx.save_record(ctx.slug, "agent", new_agent)
        n.agentId = new_agent_id
        if label is not None:
            n.label = label
        if hours is not None:
            n.hours = hours
        n.afterHours = after
        if "transfer_to" in sent:
            n.transferTo = transfer
        tx.save_record(ctx.slug, "number", n)
        return n

    return number_out(ctx.svc.store.transact(run))


@router.post("/{number_id}/delete", status_code=204, dependencies=[WRITE_LIMIT])
def delete_number(number_id: str, ctx: OrgContext = Depends(org_member)):
    if ctx.access.platform != "master_admin":
        raise forbidden("Only bitNtech can remove phone numbers.")

    def run(tx: Tx) -> None:
        n = tx.get_record(ctx.slug, "number", number_id)
        if not n:
            raise _not_found("phone number")
        if n.agentId:
            raise bad_input("An agent answers this number. Move the agent to another number first.")
        tx.delete_record(ctx.slug, "number", n.id)
        ctx.log(tx, "library", f"Removed the phone number {n.number}")

    ctx.svc.store.transact(run)
