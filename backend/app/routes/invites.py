"""/api/invites — open and accept an invitation. Tokens are random and stored
only as their SHA-256, so a database read doesn't hand out working links.

Two kinds: bitNtech staff invitations (from Ops or the CLI) and organisation
invitations (from the Team page). An organisation invitation belongs to an
"invited" member record; the role and permissions come from that record
when it's accepted, so changes made while it waits apply. Resending or
cancelling it revokes the old link.

A new person accepts with a name and password. Someone who already has an
AICA account signs in and joins (POST /{token}/join), with the same email.
"""
from __future__ import annotations

import logging
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Response

from ..access.permissions import ROLE_LABEL
from ..auth.accounts import ensure_profile, iso, link, mark_active, session_out
from ..auth.identity import EmailExists
from ..auth.passwords import password_problem
from ..auth.sessions import PLATFORM_CLAIM, PLATFORM_ROLES, Caller, not_acting, start_session
from ..core.errors import ApiError, forbidden
from ..core.ratelimit import limit, limit_caller
from ..core.services import Services, get_services
from ..data.store import ActivityDoc, InviteDoc, MemberDoc, Membership, OrgDoc, Tx, UserDoc, hash_key, now
from ..models import AcceptInviteIn, InviteOut, SessionOut

log = logging.getLogger("aica.invites")
router = APIRouter(prefix="/api/invites", tags=["invites"])

GONE = "This invitation was cancelled or replaced by a newer one. Ask for a new link."


def new_invite(svc: Services, *, email: str, role: str, org_name: str, invited_by: str, org_slug: str | None = None, member_id: str | None = None) -> tuple[str, str, InviteDoc]:
    """A fresh invitation: (token for the link, its hash, the record). Not saved."""
    token = secrets.token_urlsafe(32)
    return token, hash_key(token), InviteDoc(
        email=email.lower(),
        orgName=org_name,
        orgSlug=org_slug,
        role=role,
        invitedBy=invited_by,
        expiresAt=now() + timedelta(days=svc.settings.invite_days),
        memberId=member_id,
    )


def send_invite(svc: Services, email: str, org_name: str, invited_by: str, token: str) -> None:
    if not svc.mailer.invite(email, org_name, invited_by, link(svc, f"/invite/{token}")):
        log.warning("invitation email not sent")  # the link still works once the mailer is fixed: resend


def issue_invite(svc: Services, *, email: str, role: str, org_name: str, invited_by: str) -> str:
    """A bitNtech staff invitation, saved and emailed. Returns the token (for the CLI)."""
    token, token_hash, inv = new_invite(svc, email=email, role=role, org_name=org_name, invited_by=invited_by)
    svc.store.save_invite(token_hash, inv)
    send_invite(svc, email, org_name, invited_by, token)
    return token


def _usable(svc: Services, token: str) -> tuple[str, InviteDoc, MemberDoc | None, OrgDoc | None]:
    token_hash = hash_key(token)
    inv = svc.store.get_invite(token_hash)
    if not inv:
        raise ApiError(404, "invalid_token", "This invitation link isn't valid.")
    if inv.usedAt:
        raise ApiError(410, "used_token", "This invitation has already been accepted.")
    if inv.revokedAt:
        raise ApiError(410, "invalid_token", GONE)
    if inv.expiresAt < now():
        raise ApiError(410, "expired_token", "This invitation has expired.")
    if not inv.orgSlug:
        return token_hash, inv, None, None
    member = svc.store.get_member(inv.orgSlug, inv.memberId) if inv.memberId else None
    org = svc.store.get_org(inv.orgSlug)
    if not org or not member or member.status != "invited" or member.inviteHash != token_hash:
        raise ApiError(410, "invalid_token", GONE)
    return token_hash, inv, member, org


def _join(svc: Services, token_hash: str, uid: str, name: str, email: str) -> tuple[str, str]:
    """Turns the invited member record into this person's, in one
    transaction with their profile and the invitation. Returns (slug, role)."""

    def run(tx: Tx) -> tuple[str, str]:
        inv = tx.get_invite(token_hash)
        if not inv or inv.usedAt or inv.revokedAt or inv.expiresAt < now() or not inv.orgSlug or not inv.memberId:
            raise ApiError(410, "invalid_token", GONE)
        slug = inv.orgSlug
        invited = tx.get_member(slug, inv.memberId)
        org = tx.get_org(slug)
        if not org or not invited or invited.status != "invited" or invited.inviteHash != token_hash:
            raise ApiError(410, "invalid_token", GONE)
        if tx.get_member(slug, uid):
            raise ApiError(409, "invalid_input", f"You're already in {org.name}.")
        user = tx.get_user(uid) or UserDoc(uid=uid, name=name, email=email)
        # An older member whose record hasn't been created yet is still a member.
        if any(m.orgSlug == slug for m in user.memberships):
            raise ApiError(409, "invalid_input", f"You're already in {org.name}.")

        joined = MemberDoc(
            id=uid, uid=uid, email=email, name=name, role=invited.role, permissions=invited.permissions,
            invitedAt=invited.invitedAt, invitedBy=invited.invitedBy, joinedAt=now(),
        )
        tx.delete_member(slug, invited.id)
        tx.save_member(slug, joined)
        user.memberships = [m for m in user.memberships if m.orgSlug != slug] + [Membership(orgSlug=slug, role=invited.role)]
        tx.save_user(user)
        inv.usedAt = now()
        tx.save_invite(token_hash, inv)
        tx.add_activity(slug, ActivityDoc(at=now(), actor=name, actorKind="member", actorId=uid, area="team", text=f"{name} joined as {ROLE_LABEL[invited.role]}"))
        return slug, invited.role

    return svc.store.transact(run)


@router.get("/{token}", response_model=InviteOut, response_model_by_alias=True, dependencies=[Depends(limit("invite-view", 30))])
def get_invite(token: str, svc: Services = Depends(get_services)):
    _, inv, member, org = _usable(svc, token)
    return InviteOut(
        email=inv.email,
        org_name=org.name if org else inv.orgName,
        role=member.role if member else inv.role,
        invited_by=inv.invitedBy,
        expires_at=iso(inv.expiresAt),
        has_account=svc.admin.get_user_by_email(inv.email) is not None,
    )


@router.post("/{token}/accept", response_model=SessionOut, response_model_by_alias=True, dependencies=[Depends(limit("invite", 10))])
def accept_invite(token: str, body: AcceptInviteIn, response: Response, svc: Services = Depends(get_services)):
    token_hash, inv, _, _ = _usable(svc, token)
    problem = password_problem(body.password, inv.email)
    if problem:
        raise ApiError(422, "weak_password", problem)
    try:
        # Opening the emailed link proves the inbox.
        uid = svc.admin.create_user(inv.email, body.password, body.name, email_verified=True)
    except EmailExists:
        raise ApiError(409, "email_taken", "An account with this email already exists. Sign in with it, then open this link again to join.")

    staff = not inv.orgSlug and inv.role in PLATFORM_ROLES
    if staff:
        svc.admin.set_claims(uid, {PLATFORM_CLAIM: inv.role})
        svc.store.save_user(UserDoc(uid=uid, name=body.name, email=inv.email, platformRole=inv.role))
        inv.usedAt = now()
        svc.store.save_invite(token_hash, inv)
        role, target = inv.role, "bitntech"
    else:
        try:
            target, role = _join(svc, token_hash, uid, body.name, inv.email)
        except Exception:
            # Cancelled while they filled in the form: don't leave an account
            # behind. But if the join did commit (a retry after a lost reply
            # reports it as cancelled), the account is theirs: keep it.
            if not (inv.orgSlug and svc.store.get_member(inv.orgSlug, uid)):
                svc.admin.delete_user(uid)
            raise
    svc.store.audit(uid, "invite_accepted", target, role)

    # Sign in after the claims are set, so the session carries the role.
    result = svc.identity.sign_in_with_password(inv.email, body.password)
    start_session(svc, response, result["idToken"], remember=False)
    mark_active(svc, uid, force=True)
    s = svc.settings
    return session_out(
        svc,
        Caller(uid=uid, email=inv.email, platform_role=inv.role if staff else None, remember=False,
               expires_at=int((now() + timedelta(hours=s.session_hours)).timestamp())),
    )


@router.post("/{token}/join", response_model=SessionOut, response_model_by_alias=True, dependencies=[Depends(limit_caller("invite-join", 10))])
def join_invite(token: str, caller: Caller = Depends(not_acting), svc: Services = Depends(get_services)):
    """For someone already signed in to AICA with the invited address."""
    if caller.platform_role:
        raise forbidden("bitNtech accounts can't join an organisation. Ask for the invitation to go to another address.")
    token_hash, inv, _, _ = _usable(svc, token)
    if not inv.orgSlug:
        raise forbidden("This is a bitNtech staff invitation. Ask for it to go to an address without an AICA account.")
    if inv.email != caller.email.lower():
        raise forbidden(f"This invitation is for {inv.email}. Sign in with that address to accept it.")
    profile = ensure_profile(svc, caller.uid, caller.email, "")
    slug, role = _join(svc, token_hash, caller.uid, profile.name, caller.email.lower())
    svc.store.audit(caller.uid, "invite_accepted", slug, role)
    mark_active(svc, caller.uid, force=True)
    return session_out(svc, caller)
