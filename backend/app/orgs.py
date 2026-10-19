"""The guard on every /api/orgs/{slug} route.

`org_member` works out who is asking and what they may do in the
organisation in the path; `org_permission(...)` also requires a permission.
The browser's idea of a role or permission is never used: the member record
in Firestore decides, on every request.

- Members: the organisation must be active, and they must have an active
  member record. Anyone else, including for organisations that don't exist,
  gets the same 403, so the API doesn't say which organisations exist.
- bitNtech: the master admin may do everything, staff only look
  (access.platform_access). They see organisations in any state.
- Acting as someone: the person acted as is the caller, with their
  permissions. Changes are shown in the organisation's activity as made by
  bitNtech, and also written to the platform audit log with the master
  admin as the actor.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Path, Request

from .access import Access, member_access, platform_access
from .accounts import ensure_member
from .errors import ApiError, forbidden
from .logs import note
from .services import Services, get_services
from .sessions import Caller, current_caller
from .store import ActivityDoc, MemberDoc, OrgDoc, Tx, now

SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{0,59}$"
NO_ACCESS = "You don't have access to that organisation."
STATUS_MESSAGE = {
    "pending_review": "This organisation is still being reviewed by bitNtech.",
    "declined": "This organisation's sign-up was declined.",
    "suspended": "This organisation is suspended.",
}


@dataclass
class OrgContext:
    org: OrgDoc
    caller: Caller
    access: Access
    # None for bitNtech accounts, who aren't members.
    member: MemberDoc | None
    svc: Services

    @property
    def slug(self) -> str:
        return self.org.slug

    @property
    def member_id(self) -> str | None:
        """The member doing this: the person acted as while acting, None for bitNtech.
        For records that say whose something is (handled by, asked by)."""
        return self.member.id if self.member else None

    def is_self(self, member: MemberDoc) -> bool:
        return self.member is not None and member.id == self.member.id

    def actor(self) -> tuple[str, str, str | None]:
        """(label, kind, member id) for an activity entry."""
        imp = self.caller.impersonator
        if imp:
            me = self.svc.store.get_user(imp.uid)
            who = (me.name if me else "") or "Support"
            them = self.member.name if self.member else ""
            return f"{who} (bitNtech, as {them})" if them else f"{who} (bitNtech)", "bitntech", None
        if self.access.platform:
            me = self.svc.store.get_user(self.caller.uid)
            return f"{(me.name if me else '') or 'Support'} (bitNtech)", "bitntech", None
        return (self.member.name if self.member else "") or "Someone", "member", self.caller.uid

    def log(self, tx: Tx, area: str, text: str, detail: str = "", *, owner_only: bool = False) -> None:
        """Writes an activity entry in the transaction that made the change."""
        label, kind, actor_id = self.actor()
        tx.add_activity(self.slug, ActivityDoc(at=now(), actor=label, actorKind=kind, actorId=actor_id, area=area, text=text, detail=detail, ownerOnly=owner_only))

    def audit_acting(self, action: str, detail: str = "") -> None:
        """A change made while acting as someone, in the platform audit log."""
        if self.caller.impersonator:
            self.svc.store.audit(self.caller.impersonator.uid, action, self.slug, detail)


def org_member(
    request: Request,
    slug: str = Path(pattern=SLUG_PATTERN),
    caller: Caller = Depends(current_caller),
    svc: Services = Depends(get_services),
) -> OrgContext:
    note(request, org=slug)
    org = svc.store.get_org(slug)
    if caller.platform_role:
        if not org:
            raise ApiError(404, "invalid_input", "That organisation doesn't exist.")
        return OrgContext(org=org, caller=caller, access=platform_access(caller.platform_role), member=None, svc=svc)
    member = ensure_member(svc, slug, caller.uid) if org else None
    if not org or not member:
        raise forbidden(NO_ACCESS)
    if org.status != "active":
        reason = f" {org.statusReason}" if org.status == "suspended" and org.statusReason else ""
        raise forbidden(STATUS_MESSAGE.get(org.status, NO_ACCESS) + reason)
    return OrgContext(org=org, caller=caller, access=member_access(member.role, member.permissions), member=member, svc=svc)


def org_permission(*permissions: str, what: str = "do that"):
    """Requires one of `permissions`."""

    def dep(ctx: OrgContext = Depends(org_member)) -> OrgContext:
        if not any(ctx.access.has(p) for p in permissions):
            raise forbidden(f"You don't have permission to {what}.")
        return ctx

    return dep
