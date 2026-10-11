"""/api/ops — bitNtech only. Staff review sign-ups; only the master admin
suspends or restores organisations and invites staff. Every decision is
written to the audit collection."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from ..accounts import iso, link
from ..errors import ApiError
from ..models import OrgSummaryOut, OwnerOut, ReasonIn, SignupRequestOut, StaffInviteIn
from ..ratelimit import limit
from ..services import Services, get_services
from ..sessions import Caller, master_caller, staff_caller
from ..store import OrgDoc
from .invites import issue_invite

log = logging.getLogger("aica.ops")
router = APIRouter(prefix="/api/ops", tags=["ops"])


def _org(svc: Services, slug: str) -> OrgDoc:
    org = svc.store.get_org(slug)
    if not org:
        raise ApiError(404, "invalid_input", "Organisation not found.")
    return org


def _owner(svc: Services, org: OrgDoc):
    doc = svc.store.get_user(org.ownerUid)
    auth = svc.admin.get_user(org.ownerUid)
    return doc, auth


@router.get("/orgs", response_model=list[OrgSummaryOut], response_model_by_alias=True)
def list_orgs(_: Caller = Depends(staff_caller), svc: Services = Depends(get_services)):
    out = []
    for o in svc.store.list_orgs():
        owner = svc.store.get_user(o.ownerUid)
        out.append(
            OrgSummaryOut(
                slug=o.slug, name=o.name, city=o.city, business_type=o.type, status=o.status,
                status_reason=o.statusReason, owner_email=owner.email if owner else "—", created_at=iso(o.createdAt),
            )
        )
    return out


@router.get("/signup-requests", response_model=list[SignupRequestOut], response_model_by_alias=True)
def list_requests(_: Caller = Depends(staff_caller), svc: Services = Depends(get_services)):
    pending = sorted((o for o in svc.store.list_orgs() if o.status == "pending_review"), key=lambda o: o.createdAt)
    out = []
    for o in pending:
        doc, auth = _owner(svc, o)
        out.append(
            SignupRequestOut(
                org_slug=o.slug, org_name=o.name, business_type=o.type, city=o.city, languages=o.languages,
                owner=OwnerOut(
                    name=doc.name if doc else "—",
                    email=auth.email if auth else (doc.email if doc else "—"),
                    phone=doc.phone if doc else "",
                    email_verified=bool(auth and auth.email_verified),
                ),
                submitted_at=iso(o.createdAt),
            )
        )
    return out


def _pending(svc: Services, slug: str) -> OrgDoc:
    org = _org(svc, slug)
    if org.status != "pending_review":
        raise ApiError(409, "invalid_input", "This request was already handled.")
    return org


@router.post("/signup-requests/{slug}/approve", status_code=204)
def approve(slug: str, caller: Caller = Depends(staff_caller), svc: Services = Depends(get_services)):
    org = _pending(svc, slug)
    doc, auth = _owner(svc, org)
    if not auth or not auth.email_verified:
        raise ApiError(409, "invalid_input", "The owner hasn't verified their email yet.")
    org.status, org.statusReason, org.reviewedBy = "active", None, caller.uid
    svc.store.save_org(org)
    svc.store.audit(caller.uid, "signup_approved", slug)
    svc.mailer.signup_decided(auth.email, org.name, True, "", link(svc, "/login"))


@router.post("/signup-requests/{slug}/decline", status_code=204)
def decline(slug: str, body: ReasonIn, caller: Caller = Depends(staff_caller), svc: Services = Depends(get_services)):
    org = _pending(svc, slug)
    org.status, org.statusReason, org.reviewedBy = "declined", body.reason, caller.uid
    svc.store.save_org(org)
    svc.store.audit(caller.uid, "signup_declined", slug, body.reason)
    _, auth = _owner(svc, org)
    if auth:
        svc.mailer.signup_decided(auth.email, org.name, False, body.reason, link(svc, "/login"))


@router.post("/orgs/{slug}/suspend", status_code=204)
def suspend(slug: str, body: ReasonIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    org = _org(svc, slug)
    if org.status != "active":
        raise ApiError(409, "invalid_input", "Only an active organisation can be suspended.")
    org.status, org.statusReason = "suspended", body.reason
    svc.store.save_org(org)
    svc.store.audit(caller.uid, "org_suspended", slug, body.reason)


@router.post("/orgs/{slug}/restore", status_code=204)
def restore(slug: str, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    org = _org(svc, slug)
    if org.status != "suspended":
        raise ApiError(409, "invalid_input", "This organisation is not suspended.")
    org.status, org.statusReason = "active", None
    svc.store.save_org(org)
    svc.store.audit(caller.uid, "org_restored", slug)


@router.post("/staff-invites", status_code=204, dependencies=[Depends(limit("staff-invite", 20))])
def invite_staff(body: StaffInviteIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    if svc.admin.get_user_by_email(body.email.lower()):
        raise ApiError(409, "email_taken", "That email already has an AICA account.")
    me = svc.store.get_user(caller.uid)
    issue_invite(svc, email=body.email, role="staff", org_name="BitNTech", invited_by=me.name if me else caller.email)
    svc.store.audit(caller.uid, "staff_invited", body.email.lower())
