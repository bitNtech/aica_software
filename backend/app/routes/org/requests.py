"""/api/orgs/{slug}/requests — what a hospital asks bitNtech for (Phase 2).

- Members with `requests.create` ask and reply; anyone with `agents.view`
  reads. bitNtech never asks: requests come from the organisation.
- Only bitNtech's master admin moves a request on (`/update`), with a reply
  the hospital sees. Other bitNtech staff read.
- The person who asked, or anyone who manages the team, withdraws an open
  request.
- Asking and status changes go in the organisation's activity (area
  "agents"), as the demo does; replies are in the thread itself.
- Email is best-effort and holds only the title and a link.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ...access.orgs import OrgContext, org_member, org_permission
from ...auth.accounts import iso, link
from ...core.errors import ApiError, bad_input, forbidden
from ...core.ratelimit import limit_caller
from ...core.services import Services, get_services
from ...data.store import ChangeRequestDoc, Tx, new_id, now
from ...models import ChangeReplyOut, ChangeRequestOut, ChangeRequestPatchIn, NewChangeRequestIn, NumberRequestIn, ReplyIn

router = APIRouter(prefix="/api/orgs/{slug}/requests", tags=["org"])

KIND_WORD = {"new_agent": "a new agent", "flow_change": "a flow change", "integration": "an integration", "number": "a phone number", "other": "a change"}
URGENCIES = ("normal", "soon", "urgent")
STATUS_WORD = {"open": "reopened", "in_progress": "started on", "done": "finished", "declined": "declined"}
WRITE_LIMIT = Depends(limit_caller("org-requests", 30))


def request_out(slug: str, r: ChangeRequestDoc) -> ChangeRequestOut:
    return ChangeRequestOut(
        id=r.id, org_slug=slug, kind=r.kind, agent_id=r.agentId, agent_name=r.agentName, title=r.title, detail=r.detail,
        urgency=r.urgency, status=r.status, created_at=iso(r.createdAt), created_by=r.createdBy, created_by_id=r.createdById,
        updated_at=iso(r.updatedAt),
        replies=[ChangeReplyOut(id=x["id"], by=x["by"], by_kind=x["byKind"], at=iso(x["at"]), text=x["text"]) for x in r.replies],
    )


def _not_found() -> ApiError:
    return ApiError(404, "invalid_input", "That request doesn't exist any more. It may have been deleted.")


def _get(tx: Tx, slug: str, request_id: str) -> ChangeRequestDoc:
    r = tx.get_record(slug, "request", request_id)
    if not r:
        raise _not_found()
    return r


def _is_master(ctx: OrgContext) -> bool:
    return ctx.access.platform == "master_admin"


def _notify_bitntech(ctx: OrgContext, r: ChangeRequestDoc, event: str, by: str) -> None:
    to = ctx.svc.settings.change_request_recipients
    if to:
        ctx.svc.mailer.change_request(to, ctx.org.name, r.title, event, by, link(ctx.svc, f"/ops/orgs/{ctx.slug}/requests#{r.id}"))


def _notify_asker(ctx: OrgContext, r: ChangeRequestDoc, event: str) -> None:
    """bitNtech replied or moved it on: tell the person who asked, if they're still in the team."""
    member = ctx.svc.store.get_member(ctx.slug, r.createdById) if r.createdById else None
    if member and member.status == "active":
        ctx.svc.mailer.change_request(member.email, ctx.org.name, r.title, event, "bitNtech", link(ctx.svc, f"/o/{ctx.slug}/requests#{r.id}"))


def _create(ctx: OrgContext, kind: str, agent_id: str | None, agent_name: str | None, title: str, detail: str, urgency: str) -> ChangeRequestDoc:
    by, by_id = ctx.actor()[0], ctx.member_id
    t = now()
    r = ChangeRequestDoc(
        id=new_id("cr"), kind=kind, agentId=agent_id, agentName=agent_name, title=title, detail=detail, urgency=urgency,
        status="open", createdAt=t, createdBy=by, createdById=by_id, updatedAt=t,
    )

    def run(tx: Tx) -> ChangeRequestDoc:
        tx.save_record(ctx.slug, "request", r)
        ctx.log(tx, "agents", f"Asked bitNtech for {KIND_WORD[kind]}: “{title}”")
        return r

    ctx.svc.store.transact(run)
    _notify_bitntech(ctx, r, "created", by)
    ctx.audit_acting("change_request_created", r.id)
    return r


@router.get("", response_model=list[ChangeRequestOut], response_model_by_alias=True)
def list_requests(ctx: OrgContext = Depends(org_member), svc: Services = Depends(get_services)):
    if not ctx.access.platform and not (ctx.access.has("requests.create") or ctx.access.has("agents.view")):
        raise forbidden("You don’t have permission to see requests to bitNtech.")
    return [request_out(ctx.slug, r) for r in svc.store.list_requests(ctx.slug)]


@router.post("", response_model=ChangeRequestOut, response_model_by_alias=True, dependencies=[WRITE_LIMIT])
def create_request(body: NewChangeRequestIn, ctx: OrgContext = Depends(org_member)):
    if ctx.access.platform:
        raise forbidden("Requests come from the organisation. bitNtech replies to them.")
    if not ctx.access.has("requests.create"):
        raise forbidden("You don’t have permission to ask bitNtech for changes.")
    title, detail = body.title.strip(), body.detail.strip()
    if body.kind not in KIND_WORD:
        raise bad_input("Choose what you need.")
    if not 5 <= len(title) <= 120:
        raise bad_input("Give the request a title of 5 to 120 characters.")
    if not 10 <= len(detail) <= 2000:
        raise bad_input("Describe what you need in 10 to 2,000 characters.")
    agent_id = (body.agent_id or "").strip() or None
    if body.kind == "flow_change" and not agent_id:
        raise bad_input("Choose the agent whose flow should change.")
    if body.urgency not in URGENCIES:
        raise bad_input("Choose how soon you need it.")
    agent_name = ((body.agent_name or "").strip() or None) if agent_id else None
    return request_out(ctx.slug, _create(ctx, body.kind, agent_id, agent_name, title, detail, body.urgency))


@router.post("/number", status_code=204, dependencies=[WRITE_LIMIT])
def request_number(body: NumberRequestIn, ctx: OrgContext = Depends(org_permission("library.numbers", "requests.create", what="ask for numbers"))):
    if ctx.access.platform:
        raise forbidden("Requests come from the organisation. bitNtech replies to them.")
    note = body.note.strip()
    if len(note) > 500:
        raise bad_input("Keep the note under 500 characters.")
    _create(ctx, "number", None, None, "Another phone number", note or "No note.", "normal")


@router.post("/{request_id}/reply", response_model=ChangeRequestOut, response_model_by_alias=True, dependencies=[WRITE_LIMIT])
def reply(request_id: str, body: ReplyIn, ctx: OrgContext = Depends(org_member)):
    master = _is_master(ctx)
    if ctx.access.platform and not master:
        raise forbidden("Only bitNtech’s master admin replies to requests.")
    if not master and not ctx.access.has("requests.create"):
        raise forbidden("You don’t have permission to reply to requests.")
    text = body.text.strip()
    if not text:
        raise bad_input("Write the reply first.")
    if len(text) > 1000:
        raise bad_input("Keep replies under 1,000 characters.")
    by, kind, _ = ctx.actor()

    def run(tx: Tx) -> ChangeRequestDoc:
        r = _get(tx, ctx.slug, request_id)
        if r.status == "withdrawn":
            raise bad_input("This request was withdrawn.")
        r.replies.append({"id": new_id("crr"), "by": by, "byKind": kind, "at": now(), "text": text})
        r.updatedAt = now()
        tx.save_record(ctx.slug, "request", r)
        return r

    r = ctx.svc.store.transact(run)
    if kind == "bitntech":
        _notify_asker(ctx, r, "replied")
    else:
        _notify_bitntech(ctx, r, "replied", by)
    return request_out(ctx.slug, r)


@router.post("/{request_id}/withdraw", response_model=ChangeRequestOut, response_model_by_alias=True, dependencies=[WRITE_LIMIT])
def withdraw(request_id: str, ctx: OrgContext = Depends(org_member)):
    if ctx.access.platform:
        raise forbidden("Only the organisation can withdraw its requests.")

    def run(tx: Tx) -> ChangeRequestDoc:
        r = _get(tx, ctx.slug, request_id)
        if r.createdById != ctx.caller.uid and not ctx.access.has("team.manage"):
            raise forbidden(f"Only {r.createdBy} or someone who manages the team can withdraw this.")
        if r.status not in ("open", "in_progress"):
            raise bad_input("Only open requests can be withdrawn.")
        r.status, r.updatedAt = "withdrawn", now()
        tx.save_record(ctx.slug, "request", r)
        ctx.log(tx, "agents", f"Withdrew the request “{r.title}”")
        return r

    return request_out(ctx.slug, ctx.svc.store.transact(run))


@router.post("/{request_id}/update", response_model=ChangeRequestOut, response_model_by_alias=True, dependencies=[WRITE_LIMIT])
def update(request_id: str, body: ChangeRequestPatchIn, ctx: OrgContext = Depends(org_member)):
    if not _is_master(ctx):
        raise forbidden("Only bitNtech’s master admin can move requests on.")
    text = (body.reply or "").strip()
    if body.status == "declined" and not text:
        raise bad_input("Say why it’s declined. The organisation sees your reply.")
    if len(text) > 1000:
        raise bad_input("Keep replies under 1,000 characters.")
    by, _, _ = ctx.actor()

    def run(tx: Tx) -> tuple[ChangeRequestDoc, bool]:
        r = _get(tx, ctx.slug, request_id)
        if r.status == "withdrawn":
            raise bad_input("This request was withdrawn.")
        if text:
            r.replies.append({"id": new_id("crr"), "by": by, "byKind": "bitntech", "at": now(), "text": text})
        moved = body.status is not None and body.status != r.status
        if moved:
            r.status = body.status
            ctx.log(tx, "agents", f"bitNtech {STATUS_WORD[r.status]} the request “{r.title}”", text)
        r.updatedAt = now()
        tx.save_record(ctx.slug, "request", r)
        return r, moved

    r, moved = ctx.svc.store.transact(run)
    if moved or text:
        _notify_asker(ctx, r, "updated" if moved else "replied")
    return request_out(ctx.slug, r)
