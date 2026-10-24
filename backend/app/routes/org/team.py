"""/api/orgs/{slug}/members — the Team page.

Rules, checked here on every request (the console only hides buttons):
- Changing the team needs `team.manage`. Only owners invite, change or
  remove owners, or make someone an owner.
- Nobody changes their own role or permissions, or removes themselves.
- The organisation always keeps at least one active owner. That check and
  the change it guards run in one transaction, so two owners demoting
  each other at the same moment can't both succeed.
- Someone who isn't an owner can only hand out permissions they hold
  themselves, whether by role or one at a time.
- Every change is written to the organisation's activity in the same
  transaction. Someone who can no longer take calls has their open
  callbacks unassigned in it too.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from ...access.orgs import OrgContext, org_member, org_permission
from ...access.permissions import ROLE_LABEL, ROLES, beyond_own, can_manage_owners, default_permissions, permissions_for, stored_permissions
from ...auth.accounts import iso, sync_members
from ...auth.sessions import PLATFORM_CLAIM
from ...core.errors import ApiError, forbidden
from ...core.ratelimit import limit_caller
from ...core.services import Services, get_services
from ...data.store import MemberDoc, Tx, new_id, now
from ...models import InviteMemberIn, MemberOut, MemberPermissionsIn, MemberRoleIn
from ..invites import new_invite, send_invite
from .callbacks import unassign_open

router = APIRouter(prefix="/api/orgs/{slug}/members", tags=["org"])

MANAGE = org_permission("team.manage", what="manage the team")
WRITE_LIMIT = Depends(limit_caller("org-team", 30))
GRANT = "You can only give permissions you have yourself. Ask an owner."


def _not_found() -> ApiError:
    return ApiError(404, "invalid_input", "That person isn't in the team any more. They may have been removed.")


def _find(members: list[MemberDoc], member_id: str) -> MemberDoc:
    m = next((x for x in members if x.id == member_id), None)
    if not m:
        raise _not_found()
    return m


def _members_out(svc: Services, members: list[MemberDoc]) -> list[MemberOut]:
    uids = [m.uid for m in members if m.status == "active" and m.uid]
    profiles = svc.store.get_users(uids) if uids else {}
    accounts = svc.admin.get_users(uids) if uids else {}
    out = []
    for m in members:
        p = profiles.get(m.uid or "")
        a = accounts.get(m.uid or "")
        invited = m.status == "invited"
        out.append(
            MemberOut(
                id=m.id,
                name=(p.name if p and p.name else "") or m.name,
                email=m.email,
                role=m.role,
                permissions=m.permissions,
                last_active_at=iso(p.lastActiveAt) if p and p.lastActiveAt else None,
                status="disabled" if a and a.disabled else m.status,
                invited_at=iso(m.invitedAt) if invited and m.invitedAt else None,
                invited_by=m.invitedBy if invited else None,
            )
        )
    rank = {r: i for i, r in enumerate(ROLES)}
    return sorted(out, key=lambda o: (o.status == "invited", rank.get(o.role, 99), o.name.lower()))


def _disabled_owners(svc: Services, slug: str) -> set[str]:
    """Owners whose accounts are disabled don't count towards keeping one.
    Read before the transaction: Firebase Auth isn't part of it."""
    uids = [m.uid for m in svc.store.list_members(slug) if m.role == "owner" and m.status == "active" and m.uid]
    return {u for u, a in svc.admin.get_users(uids).items() if a.disabled} if uids else set()


def _owners_left(members: list[MemberDoc], without: str, disabled: set[str]) -> int:
    return sum(1 for m in members if m.role == "owner" and m.status == "active" and m.id != without and m.uid not in disabled)


def _by(ctx: OrgContext) -> str:
    return ctx.actor()[0]


@router.get("", response_model=list[MemberOut], response_model_by_alias=True)
def list_members(ctx: OrgContext = Depends(org_member), svc: Services = Depends(get_services)):
    """Everyone in the organisation can see who's in it: work is assigned to people."""
    sync_members(svc, ctx.slug)  # brings older accounts' records across
    return _members_out(svc, svc.store.list_members(ctx.slug))


@router.post("/invite", response_model=MemberOut, response_model_by_alias=True, dependencies=[Depends(limit_caller("org-invite", 20))])
def invite_member(body: InviteMemberIn, ctx: OrgContext = Depends(MANAGE), svc: Services = Depends(get_services)):
    email, role = body.email.lower(), body.role
    if role == "owner" and not can_manage_owners(ctx.access):
        raise forbidden("Only an owner can invite another owner.")
    if beyond_own(ctx.access, default_permissions(role)):
        raise forbidden(GRANT)
    sync_members(svc, ctx.slug)
    account = svc.admin.get_user_by_email(email)
    if account and account.claims.get(PLATFORM_CLAIM):
        raise ApiError(409, "invalid_input", "That's a bitNtech account. Invite another address.")
    by = _by(ctx)
    member_id = new_id("inv")
    token, token_hash, inv = new_invite(svc, email=email, role=role, org_name=ctx.org.name, invited_by=by, org_slug=ctx.slug, member_id=member_id)

    def run(tx: Tx) -> MemberDoc:
        there = next((m for m in tx.list_members(ctx.slug) if m.email.lower() == email), None)
        if there:
            raise ApiError(
                409, "invalid_input",
                f"{email} is already invited. Send the invitation again from their row." if there.status == "invited" else f"{there.name} is already in the team.",
            )
        m = MemberDoc(id=member_id, email=email, name=email, role=role, status="invited", invitedAt=now(), invitedBy=by, inviteHash=token_hash)
        tx.save_member(ctx.slug, m)
        tx.save_invite(token_hash, inv)
        ctx.log(tx, "team", f"Invited {email} as {ROLE_LABEL[role]}")
        return m

    m = svc.store.transact(run)
    send_invite(svc, email, ctx.org.name, by, token)
    ctx.audit_acting("org_member_invited", f"{email} as {role}")
    return _members_out(svc, [m])[0]


@router.post("/{member_id}/resend", response_model=MemberOut, response_model_by_alias=True, dependencies=[WRITE_LIMIT])
def resend_invite(member_id: str, ctx: OrgContext = Depends(MANAGE), svc: Services = Depends(get_services)):
    sync_members(svc, ctx.slug)
    by = _by(ctx)

    def run(tx: Tx) -> tuple[MemberDoc, str]:
        m = tx.get_member(ctx.slug, member_id)
        if not m:
            raise _not_found()
        if m.status != "invited":
            raise ApiError(409, "invalid_input", f"{m.name} has already joined.")
        if m.role == "owner" and not can_manage_owners(ctx.access):
            raise forbidden("Only an owner can send an owner's invitation.")
        old = tx.get_invite(m.inviteHash) if m.inviteHash else None
        if old:  # the old link stops working
            old.revokedAt = now()
            tx.save_invite(m.inviteHash, old)
        token, token_hash, inv = new_invite(svc, email=m.email, role=m.role, org_name=ctx.org.name, invited_by=by, org_slug=ctx.slug, member_id=m.id)
        m.inviteHash, m.invitedAt, m.invitedBy = token_hash, now(), by
        tx.save_member(ctx.slug, m)
        tx.save_invite(token_hash, inv)
        ctx.log(tx, "team", f"Sent the invitation to {m.email} again")
        return m, token

    m, token = svc.store.transact(run)
    send_invite(svc, m.email, ctx.org.name, by, token)
    return _members_out(svc, [m])[0]


@router.post("/{member_id}/role", response_model=MemberOut, response_model_by_alias=True, dependencies=[WRITE_LIMIT])
def change_role(member_id: str, body: MemberRoleIn, ctx: OrgContext = Depends(MANAGE), svc: Services = Depends(get_services)):
    role = body.role
    sync_members(svc, ctx.slug)
    disabled = _disabled_owners(svc, ctx.slug)

    def run(tx: Tx) -> MemberDoc:
        members = tx.list_members(ctx.slug)
        m = _find(members, member_id)
        if ctx.is_self(m):
            raise forbidden("You can't change your own role. Ask another owner.")
        if (m.role == "owner" or role == "owner") and not can_manage_owners(ctx.access):
            raise forbidden("Only an owner can change an owner, or make someone an owner.")
        if m.role == role:
            return m
        if m.role == "owner" and m.status == "active" and _owners_left(members, m.id, disabled) == 0:
            raise ApiError(409, "invalid_input", "The organisation needs at least one owner. Make someone else an owner first.")
        if beyond_own(ctx.access, set(default_permissions(role)) - set(permissions_for(m.role, m.permissions))):
            raise forbidden(GRANT)
        user = tx.get_user(m.uid) if m.status == "active" and m.uid else None
        # Callbacks they can no longer take go back to nobody.
        freed = unassign_open(tx, ctx.slug, m.id) if m.status == "active" and "calls.take" not in default_permissions(role) else []
        was = m.role
        # A new role starts from its own defaults.
        m.role, m.permissions = role, None
        tx.save_member(ctx.slug, m)
        for c in freed:
            tx.save_record(ctx.slug, "callback", c)
        if user:
            for x in user.memberships:
                if x.orgSlug == ctx.slug:
                    x.role = role
            tx.save_user(user)
        ctx.log(
            tx, "team",
            f"Changed {m.email}'s invitation from {ROLE_LABEL[was]} to {ROLE_LABEL[role]}" if m.status == "invited" else f"Changed {m.name}'s role from {ROLE_LABEL[was]} to {ROLE_LABEL[role]}",
        )
        return m

    m = svc.store.transact(run)
    ctx.audit_acting("org_member_role_changed", f"{member_id} → {role}")
    return _members_out(svc, [m])[0]


@router.post("/{member_id}/permissions", response_model=MemberOut, response_model_by_alias=True, dependencies=[WRITE_LIMIT])
def set_permissions(member_id: str, body: MemberPermissionsIn, ctx: OrgContext = Depends(MANAGE), svc: Services = Depends(get_services)):
    sync_members(svc, ctx.slug)

    def run(tx: Tx) -> MemberDoc:
        m = tx.get_member(ctx.slug, member_id)
        if not m:
            raise _not_found()
        if ctx.is_self(m):
            raise forbidden("You can't change your own permissions. Ask another owner or admin.")
        if m.role == "owner" and not can_manage_owners(ctx.access):
            raise forbidden("Only an owner can change an owner's permissions.")
        stored = stored_permissions(m.role, body.permissions)
        before = permissions_for(m.role, m.permissions)
        after = permissions_for(m.role, stored)
        if set(before) == set(after) and (stored is None) == (m.permissions is None):
            return m
        if beyond_own(ctx.access, set(after) - set(before)):
            raise forbidden(GRANT)
        freed = unassign_open(tx, ctx.slug, m.id) if m.status == "active" and "calls.take" not in after else []
        m.permissions = stored
        tx.save_member(ctx.slug, m)
        for c in freed:
            tx.save_record(ctx.slug, "callback", c)
        who = m.email if m.status == "invited" else m.name
        ctx.log(tx, "team", f"Changed what {who} can do" if stored is not None else f"Gave {who} the {ROLE_LABEL[m.role].lower()} defaults again")
        return m

    m = svc.store.transact(run)
    ctx.audit_acting("org_member_permissions_changed", member_id)
    return _members_out(svc, [m])[0]


@router.post("/{member_id}/remove", status_code=204, dependencies=[WRITE_LIMIT])
def remove_member(member_id: str, ctx: OrgContext = Depends(MANAGE), svc: Services = Depends(get_services)):
    """Removes a member, or cancels an invitation. Their access ends with
    their next request: every request reads the member record."""
    sync_members(svc, ctx.slug)
    disabled = _disabled_owners(svc, ctx.slug)

    def run(tx: Tx) -> MemberDoc:
        members = tx.list_members(ctx.slug)
        m = _find(members, member_id)
        if ctx.is_self(m):
            raise forbidden("You can't remove yourself. Ask another owner.")
        if m.role == "owner" and not can_manage_owners(ctx.access):
            raise forbidden("Only an owner can remove an owner.")
        if m.role == "owner" and m.status == "active" and _owners_left(members, m.id, disabled) == 0:
            raise ApiError(409, "invalid_input", "The organisation needs at least one owner.")
        user = tx.get_user(m.uid) if m.uid else None
        inv = tx.get_invite(m.inviteHash) if m.status == "invited" and m.inviteHash else None
        freed = unassign_open(tx, ctx.slug, m.id) if m.status == "active" else []
        tx.delete_member(ctx.slug, m.id)
        for c in freed:
            tx.save_record(ctx.slug, "callback", c)
        if user:
            user.memberships = [x for x in user.memberships if x.orgSlug != ctx.slug]
            tx.save_user(user)
        if inv:
            inv.revokedAt = now()
            tx.save_invite(m.inviteHash, inv)
        ctx.log(tx, "team", f"Cancelled the invitation for {m.email}" if m.status == "invited" else f"Removed {m.name} ({ROLE_LABEL[m.role]})")
        return m

    svc.store.transact(run)
    ctx.audit_acting("org_member_removed", member_id)
    return Response(status_code=204)
