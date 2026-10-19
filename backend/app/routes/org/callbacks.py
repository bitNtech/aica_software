"""/api/orgs/{slug}/callbacks — people to call back (Phase 3).

- `callbacks.assign`: every callback, given to anyone who takes calls.
- `calls.take` without it: their own and unassigned ones, taken only for
  themselves.
- Callbacks carry the caller's full number: whoever calls back needs it.
- Someone who can no longer take calls (removed, made a viewer, lost
  `calls.take`) has their open callbacks unassigned, in the same transaction
  as that change (`unassign_open`, called from routes/org/team.py).
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends

from ...access import member_access
from ...accounts import iso
from ...errors import ApiError, bad_input, forbidden
from ...models import AssigneeOut, CallbackOut, CallbackPatchIn, CallNoteOut
from ...orgs import OrgContext, org_permission
from ...ratelimit import limit_caller
from ...redact import format_phone, without_name
from ...store import CallbackDoc, Tx, new_id, now

router = APIRouter(prefix="/api/orgs/{slug}/callbacks", tags=["org"])

# Done and unreachable callbacks stay listed this long.
KEEP_CLOSED = timedelta(days=30)
UNREACHABLE_AFTER = 3


def callback_out(c: CallbackDoc, personal: bool) -> CallbackOut:
    """The full number always (whoever calls back needs it); the caller's
    name, and the reason's mention of it, only with calls.personal."""
    return CallbackOut(
        id=c.id, caller_name=c.callerName if personal else None, caller_phone=format_phone(c.callerPhone),
        reason=c.reason if personal else without_name(c.reason, c.callerName),
        requested_at=iso(c.requestedAt), due_by=iso(c.dueBy),
        assigned_to=AssigneeOut(id=c.assignedToId, name=c.assignedToName or "") if c.assignedToId else None,
        status=c.status, attempts=c.attempts,
        notes=[CallNoteOut(id=n["id"], by=n["by"], at=iso(n["at"]), text=n["text"]) for n in c.notes],
        call_id=c.callId,
    )


def unassign_open(tx: Tx, slug: str, member_id: str) -> list[CallbackDoc]:
    """Reads the member's open callbacks; returns them unassigned, for the
    caller to save after its other reads (transactions read before writing)."""
    out = []
    for c in tx.open_callbacks_of(slug, member_id):
        c.assignedToId, c.assignedToName = None, None
        out.append(c)
    return out


@router.get("", response_model=list[CallbackOut], response_model_by_alias=True)
def list_callbacks(ctx: OrgContext = Depends(org_permission("calls.take", "callbacks.assign", what="see callbacks"))):
    rows = ctx.svc.store.list_callbacks(ctx.slug, now() - KEEP_CLOSED)
    if not ctx.access.has("callbacks.assign"):
        rows = [c for c in rows if c.assignedToId in (None, ctx.caller.uid)]
    personal = ctx.access.has("calls.personal")
    return [callback_out(c, personal) for c in sorted(rows, key=lambda c: c.dueBy)]


@router.post("/{callback_id}", response_model=CallbackOut, response_model_by_alias=True, dependencies=[Depends(limit_caller("org-callbacks", 60))])
def update_callback(callback_id: str, body: CallbackPatchIn, ctx: OrgContext = Depends(org_permission("calls.take", "callbacks.assign", what="change callbacks"))):
    assigning = "assigned_to" in body.model_fields_set
    assign_all = ctx.access.has("callbacks.assign")
    target = None
    if assigning and body.assigned_to:
        target = ctx.svc.store.get_member(ctx.slug, body.assigned_to)
        if not target or target.status != "active":
            raise ApiError(404, "invalid_input", "That team member doesn't exist any more. They may have been removed.")
        if target.role == "viewer":
            raise bad_input(f"{target.name} is a viewer and can’t make calls for the team.")
        if not member_access(target.role, target.permissions).has("calls.take"):
            raise bad_input(f"{target.name} can’t take calls, so they can’t be given callbacks.")
    note = body.note.strip() if body.note is not None else None
    if body.note is not None and not note and not body.attempt:
        raise bad_input("Write the note first.")
    if note and len(note) > 1000:
        raise bad_input("Keep notes under 1,000 characters.")
    by, _, _ = ctx.actor()

    def run(tx: Tx) -> CallbackDoc:
        # Checked again here: a removal or role change committed since the
        # check above would otherwise miss this assignment.
        if target:
            now_target = tx.get_member(ctx.slug, target.id)
            if not now_target or now_target.status != "active" or not member_access(now_target.role, now_target.permissions).has("calls.take"):
                raise bad_input(f"{target.name} can’t take calls any more.")
        c = tx.get_record(ctx.slug, "callback", callback_id)
        if not c:
            raise ApiError(404, "invalid_input", "That callback doesn't exist any more. It may have been deleted.")
        if not assign_all and c.assignedToId and c.assignedToId != ctx.caller.uid:
            raise forbidden(f"This callback is {c.assignedToName}’s. Ask a supervisor to move it.")
        if not assign_all and assigning and body.assigned_to not in (None, ctx.caller.uid):
            raise forbidden("You can take callbacks for yourself, not assign them to others.")
        if assigning:
            c.assignedToId, c.assignedToName = (target.id, target.name) if target else (None, None)
        if body.reopen:
            c.status = "open"
        if body.attempt == "reached":
            c.status = "done"
        elif body.attempt == "no_answer":
            c.attempts += 1
            if c.attempts >= UNREACHABLE_AFTER:
                c.status = "unreachable"
        if note:
            c.notes.append({"id": new_id("note"), "by": by, "at": now(), "text": note})
        tx.save_record(ctx.slug, "callback", c)
        return c

    return callback_out(ctx.svc.store.transact(run), ctx.access.has("calls.personal"))
