"""/api/invites — open and accept an invitation. Tokens are random and stored
only as their SHA-256, so a database read doesn't hand out working links."""
from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Response

from ..accounts import iso, link
from ..errors import ApiError
from ..identity import EmailExists
from ..models import AcceptInviteIn, InviteOut, SessionOut
from ..passwords import password_problem
from ..ratelimit import limit
from ..services import Services, get_services
from ..sessions import PLATFORM_CLAIM, PLATFORM_ROLES, Caller, start_session
from ..accounts import session_out
from ..store import InviteDoc, Membership, UserDoc, hash_key, now

router = APIRouter(prefix="/api/invites", tags=["invites"])


def issue_invite(svc: Services, *, email: str, role: str, org_name: str, invited_by: str, org_slug: str | None = None) -> str:
    """Creates an invitation and emails it. Returns the token (for the CLI)."""
    token = secrets.token_urlsafe(32)
    svc.store.save_invite(
        hash_key(token),
        InviteDoc(
            email=email.lower(),
            orgName=org_name,
            orgSlug=org_slug,
            role=role,
            invitedBy=invited_by,
            expiresAt=now() + timedelta(days=svc.settings.invite_days),
        ),
    )
    svc.mailer.invite(email, org_name, invited_by, link(svc, f"/invite/{token}"))
    return token


def _usable(svc: Services, token: str) -> InviteDoc:
    inv = svc.store.get_invite(hash_key(token))
    if not inv:
        raise ApiError(404, "invalid_token", "This invitation link isn't valid.")
    if inv.usedAt:
        raise ApiError(410, "used_token", "This invitation has already been accepted.")
    if inv.expiresAt < now():
        raise ApiError(410, "expired_token", "This invitation has expired.")
    return inv


@router.get("/{token}", response_model=InviteOut, response_model_by_alias=True)
def get_invite(token: str, svc: Services = Depends(get_services)):
    inv = _usable(svc, token)
    return InviteOut(email=inv.email, org_name=inv.orgName, role=inv.role, invited_by=inv.invitedBy, expires_at=iso(inv.expiresAt))


@router.post("/{token}/accept", response_model=SessionOut, response_model_by_alias=True, dependencies=[Depends(limit("invite", 10))])
def accept_invite(token: str, body: AcceptInviteIn, response: Response, svc: Services = Depends(get_services)):
    inv = _usable(svc, token)
    problem = password_problem(body.password, inv.email)
    if problem:
        raise ApiError(422, "weak_password", problem)
    try:
        # Opening the emailed link proves the inbox.
        uid = svc.admin.create_user(inv.email, body.password, body.name, email_verified=True)
    except EmailExists:
        raise ApiError(409, "email_taken", "An account with this email already exists. Sign in instead, or ask for the invitation to go to another address.")

    staff = inv.role in PLATFORM_ROLES
    if staff:
        svc.admin.set_claims(uid, {PLATFORM_CLAIM: inv.role})
    svc.store.save_user(
        UserDoc(
            uid=uid,
            name=body.name,
            email=inv.email,
            platformRole=inv.role if staff else None,
            memberships=[] if staff or not inv.orgSlug else [Membership(orgSlug=inv.orgSlug, role=inv.role)],
        )
    )
    inv.usedAt = now()
    svc.store.save_invite(hash_key(token), inv)
    svc.store.audit(uid, "invite_accepted", inv.orgSlug or "bitntech", inv.role)

    # Sign in after the claims are set, so the session carries the role.
    result = svc.identity.sign_in_with_password(inv.email, body.password)
    start_session(svc, response, result["idToken"], remember=False)
    s = svc.settings
    return session_out(
        svc,
        Caller(uid=uid, email=inv.email, platform_role=inv.role if staff else None, remember=False,
               expires_at=int((now() + timedelta(hours=s.session_hours)).timestamp())),
    )
