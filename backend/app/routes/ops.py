"""/api/ops — bitNtech only. Staff review sign-ups. Only master admins
suspend or restore organisations, manage people (roles, disabling, signing
out), read the audit log, and act as client users. Every decision is written
to the audit collection."""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Response

from ..accounts import iso, link, session_out
from ..errors import ApiError, bad_input
from ..identity import AuthUser
from ..models import (
    AuditEntryOut,
    AuditPageOut,
    OpsChangeRequestOut,
    OrgSummaryOut,
    OwnerOut,
    PersonMembershipOut,
    PersonOut,
    ReasonIn,
    RoleChangeIn,
    SessionOut,
    SignupRequestOut,
    StaffInviteIn,
)
from ..ratelimit import limit
from ..services import Services, get_services
from ..sessions import PLATFORM_CLAIM, PLATFORM_ROLES, Caller, Impersonator, master_caller, set_act_cookie, staff_caller
from ..store import ImpersonationDoc, IndexMissing, OrgDoc, UserDoc, hash_key, now
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
                status_reason=o.statusReason, owner_id=o.ownerUid, owner_email=owner.email if owner else "—", created_at=iso(o.createdAt),
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
    by = me.name if me else caller.email
    issue_invite(svc, email=body.email, role=body.role, org_name="BitNTech", invited_by=by)
    svc.store.audit(caller.uid, "staff_invited", body.email.lower(), body.role)
    if body.role == "master_admin":
        _alert_masters(svc, body.email.lower(), by, invited=True)


# ---------------------------------------------------------------- people


def _role(user: AuthUser) -> str | None:
    r = user.claims.get(PLATFORM_CLAIM)
    return r if r in PLATFORM_ROLES else None


def _other_active_masters(svc: Services, uid: str) -> list[AuthUser]:
    return [u for u in svc.admin.list_users() if _role(u) == "master_admin" and not u.disabled and u.uid != uid]


def _keep_a_master(svc: Services, target: AuthUser) -> None:
    if _role(target) == "master_admin" and not _other_active_masters(svc, target.uid):
        raise ApiError(409, "invalid_input", "AICA needs at least one active master admin. Make someone else a master admin first.")


def _person(svc: Services, uid: str, caller: Caller, self_message: str = "You can't change your own account here.") -> tuple[AuthUser, UserDoc | None]:
    if uid == caller.uid:
        raise ApiError(409, "invalid_input", self_message)
    user = svc.admin.get_user(uid)
    if not user:
        raise ApiError(404, "invalid_input", "That account doesn't exist.")
    return user, svc.store.get_user(uid)


def _alert_masters(svc: Services, who: str, by: str, invited: bool) -> None:
    to = sorted({u.email for u in svc.admin.list_users() if _role(u) == "master_admin" and not u.disabled and u.email and u.email != who})
    if to:
        svc.mailer.master_admin_added(to, who, by, invited, link(svc, "/ops/audit"))


@router.get("/people", response_model=list[PersonOut], response_model_by_alias=True)
def list_people(_: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    docs = {d.uid: d for d in svc.store.list_users()}
    orgs = {o.slug: o for o in svc.store.list_orgs()}
    out = []
    for u in svc.admin.list_users():
        d = docs.get(u.uid)
        out.append(
            PersonOut(
                id=u.uid,
                name=(d.name if d else "") or u.display_name or u.email.split("@")[0],
                email=u.email,
                platform_role=_role(u),
                disabled=u.disabled,
                email_verified=u.email_verified,
                memberships=[
                    PersonMembershipOut(org_slug=m.orgSlug, org_name=orgs[m.orgSlug].name if m.orgSlug in orgs else m.orgSlug, role=m.role)
                    for m in (d.memberships if d else [])
                ],
                created_at=iso(d.createdAt) if d else None,
            )
        )
    rank = {"master_admin": 0, "staff": 1, None: 2}
    return sorted(out, key=lambda p: (rank[p.platform_role], p.name.lower()))


@router.post("/people/{uid}/role", status_code=204, dependencies=[Depends(limit("people", 30))])
def change_role(uid: str, body: RoleChangeIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    user, doc = _person(svc, uid, caller)
    old, new = _role(user), body.role
    if old == new:
        raise ApiError(409, "invalid_input", "They already have that role.")
    if new and doc and doc.memberships:
        raise ApiError(409, "invalid_input", "This is a client account. Invite their bitNtech email address instead.")
    if new != "master_admin":
        _keep_a_master(svc, user)
    claims = dict(user.claims)
    if new:
        claims[PLATFORM_CLAIM] = new
    else:
        claims.pop(PLATFORM_CLAIM, None)
    svc.admin.set_claims(uid, claims)
    doc = doc or UserDoc(uid=uid, name=user.display_name or user.email.split("@")[0], email=user.email)
    doc.platformRole = new
    svc.store.save_user(doc)
    # The role is fixed in session cookies when they're made: sign them out
    # everywhere so the change applies at once.
    svc.admin.revoke_sessions(uid)
    svc.store.audit(caller.uid, "role_changed", uid, f"{old or 'none'} → {new or 'none'}: {body.reason}")
    if new == "master_admin":
        me = svc.store.get_user(caller.uid)
        _alert_masters(svc, user.email, me.name if me else caller.email, invited=False)


@router.post("/people/{uid}/disable", status_code=204, dependencies=[Depends(limit("people", 30))])
def disable_person(uid: str, body: ReasonIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    user, _ = _person(svc, uid, caller)
    if user.disabled:
        raise ApiError(409, "invalid_input", "This account is already disabled.")
    _keep_a_master(svc, user)
    svc.admin.update_user(uid, disabled=True)
    svc.admin.revoke_sessions(uid)
    svc.store.audit(caller.uid, "user_disabled", uid, body.reason)


@router.post("/people/{uid}/enable", status_code=204, dependencies=[Depends(limit("people", 30))])
def enable_person(uid: str, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    user, _ = _person(svc, uid, caller)
    if not user.disabled:
        raise ApiError(409, "invalid_input", "This account isn't disabled.")
    svc.admin.update_user(uid, disabled=False)
    svc.store.audit(caller.uid, "user_enabled", uid)


@router.post("/people/{uid}/sign-out", status_code=204, dependencies=[Depends(limit("people", 30))])
def sign_out_person(uid: str, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    _person(svc, uid, caller, "To sign yourself out, use Sign out.")
    svc.admin.revoke_sessions(uid)
    svc.store.audit(caller.uid, "sessions_revoked", uid)


@router.post("/people/{uid}/act-as", response_model=SessionOut, response_model_by_alias=True, dependencies=[Depends(limit("act-as", 10))])
def act_as(uid: str, body: ReasonIn, response: Response, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    user, _ = _person(svc, uid, caller, "You can't act as yourself.")
    if _role(user):
        raise ApiError(409, "invalid_input", "bitNtech accounts can't be acted as.")
    if user.disabled:
        raise ApiError(409, "invalid_input", "This account is disabled.")
    token = secrets.token_urlsafe(32)
    key = hash_key(token)
    doc = ImpersonationDoc(
        actorUid=caller.uid,
        targetUid=uid,
        reason=body.reason,
        startedAt=now(),
        expiresAt=now() + timedelta(minutes=svc.settings.act_as_minutes),
    )
    svc.store.save_impersonation(key, doc)
    set_act_cookie(response, svc, token)
    svc.store.audit(caller.uid, "act_as_started", uid, body.reason)
    log.info("act-as started")  # who and why are in the audit log, not the server log
    return session_out(
        svc,
        Caller(
            uid=user.uid,
            email=user.email,
            platform_role=None,
            remember=caller.remember,
            expires_at=caller.expires_at,
            impersonator=Impersonator(uid=caller.uid, email=caller.email, key=key, reason=body.reason, expires_at=doc.expiresAt),
        ),
    )


# ---------------------------------------------------------------- audit


@router.get("/audit", response_model=AuditPageOut, response_model_by_alias=True)
def audit_log(
    size: int = Query(50, ge=1, le=100, alias="limit"),
    before: datetime | None = None,
    action: str | None = Query(None, max_length=100),
    actor: str | None = Query(None, max_length=200),
    target: str | None = Query(None, max_length=200),
    _: Caller = Depends(master_caller),
    svc: Services = Depends(get_services),
):
    filters = [(k, v.strip()) for k, v in (("action", action), ("actor", actor), ("target", target)) if v and v.strip()]
    if len(filters) > 1:
        raise bad_input("Filter on one thing at a time.")
    field, value = filters[0] if filters else (None, None)
    if field in ("actor", "target") and value and "@" in value:
        # People are stored by ID; let the filter take an email.
        value = value.lower()
        found = svc.admin.get_user_by_email(value)
        if found:
            value = found.uid
        elif field == "actor":
            return AuditPageOut(entries=[])
    try:
        entries = svc.store.list_audit(size + 1, before, field, value)
    except IndexMissing:
        raise ApiError(503, "unknown", "This filter needs a Firestore index that hasn't been created yet. See backend/README.md.")
    more = len(entries) > size
    entries = entries[:size]

    labels: dict[str, str] = {}

    def label(v: str) -> str:
        if v not in labels:
            doc = svc.store.get_user(v) if v and "@" not in v and "/" not in v else None
            labels[v] = doc.email if doc else v
        return labels[v]

    return AuditPageOut(
        entries=[
            AuditEntryOut(at=iso(e.at), actor=e.actor, actor_label=label(e.actor), action=e.action, target=e.target, target_label=label(e.target), detail=e.detail)
            for e in entries
        ],
        next_before=iso(entries[-1].at) if more and entries else None,
    )


# ---------------------------------------------------------------- change requests


@router.get("/change-requests", response_model=list[OpsChangeRequestOut], response_model_by_alias=True)
def change_requests(_: Caller = Depends(staff_caller), svc: Services = Depends(get_services)):
    """Every organisation's open requests, and any updated in the last 90
    days, for /ops/changes. One query across organisations, not one per org."""
    from .org.requests import request_out

    names = {o.slug: o.name for o in svc.store.list_orgs() if o.status == "active"}
    try:
        rows = svc.store.list_requests_everywhere(now() - timedelta(days=90))
    except IndexMissing:
        raise ApiError(503, "unknown", "This list needs Firestore indexes that haven't been created yet. See backend/README.md.")
    out = [OpsChangeRequestOut(**request_out(slug, r).model_dump(), org_name=names.get(slug, slug)) for slug, r in rows if slug in names]
    return sorted(out, key=lambda r: r.created_at, reverse=True)
