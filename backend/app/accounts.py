"""Account logic shared by several routes."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from .models import ImpersonatorOut, MembershipOut, SessionOut, UserOut
from .services import Services
from .sessions import Caller
from .store import MemberDoc, Membership, OrgDoc, SlugTaken, Tx, UserDoc, now

# How often an ordinary page load refreshes "last active".
ACTIVE_EVERY = timedelta(hours=1)


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_member(svc: Services, slug: str, uid: str) -> MemberDoc | None:
    """This person's member record in `slug`, or None if they aren't in it.

    Accounts made before member records existed only have the entry in
    users/{uid}.memberships; the first time one is needed it is created
    from that entry. Removing someone deletes both in one transaction, so
    this never brings a removed member back."""
    m = svc.store.get_member(slug, uid)
    if m:
        return m if m.status == "active" else None
    user = svc.store.get_user(uid)
    if not user or not any(x.orgSlug == slug for x in user.memberships):
        return None

    def backfill(tx: Tx) -> MemberDoc | None:
        existing = tx.get_member(slug, uid)
        if existing:
            return existing
        u = tx.get_user(uid)
        entry = next((x for x in u.memberships if x.orgSlug == slug), None) if u else None
        if not u or not entry:
            return None
        member = MemberDoc(id=uid, uid=uid, email=u.email, name=u.name, role=entry.role, joinedAt=u.createdAt)
        tx.save_member(slug, member)
        return member

    return svc.store.transact(backfill)


def sync_members(svc: Services, slug: str) -> None:
    """Creates the member record for everyone who only has the older
    users/{uid}.memberships entry, so the Team page, the duplicate check and
    the last-owner check all see the whole team. A no-op once everyone has one."""
    from .access import ROLES

    have = {m.id for m in svc.store.list_members(slug)}
    for uid in svc.store.users_in_org(slug, ROLES):
        if uid not in have:
            ensure_member(svc, slug, uid)


def mark_active(svc: Services, uid: str, last: datetime | None = None, *, force: bool = False) -> None:
    """Keeps "last active" on the Team page roughly current without a write
    on every request: on sign-in, then at most hourly."""
    t = now()
    if force or last is None or t - last >= ACTIVE_EVERY:
        svc.store.set_last_active(uid, t)


def user_out(svc: Services, uid: str, email: str, platform_role: str | None) -> UserOut:
    doc = svc.store.get_user(uid)
    memberships: list[MembershipOut] = []
    for m in doc.memberships if doc else []:
        org = svc.store.get_org(m.orgSlug)
        member = ensure_member(svc, m.orgSlug, uid) if org else None
        if org and member:
            memberships.append(
                MembershipOut(
                    org_slug=org.slug,
                    org_name=org.name,
                    city=org.city,
                    role=member.role,
                    permissions=member.permissions,
                    org_status=org.status,
                    status_reason=org.statusReason,
                )
            )
    return UserOut(
        id=uid,
        name=(doc.name if doc else "") or email.split("@")[0],
        email=email,
        platform_role=platform_role,
        memberships=memberships,
    )


def session_out(svc: Services, caller: Caller) -> SessionOut:
    imp = caller.impersonator
    acting = None
    if imp:
        doc = svc.store.get_user(imp.uid)
        acting = ImpersonatorOut(name=(doc.name if doc else "") or imp.email.split("@")[0], email=imp.email, reason=imp.reason, expires_at=iso(imp.expires_at))
    return SessionOut(
        user=user_out(svc, caller.uid, caller.email, caller.platform_role),
        remember=caller.remember,
        expires_at=iso(datetime.fromtimestamp(caller.expires_at, timezone.utc)),
        impersonator=acting,
    )


def ensure_profile(svc: Services, uid: str, email: str, name: str) -> UserDoc:
    doc = svc.store.get_user(uid)
    if doc is None:
        doc = UserDoc(uid=uid, name=name or email.split("@")[0], email=email)
        svc.store.save_user(doc)
    return doc


def slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "org"
    return base


def create_org_for(svc: Services, owner: UserDoc, business) -> OrgDoc:
    """New organisation in review, owned by `owner`. Picks a free slug."""
    base = slugify(business.name)
    for n in range(1, 50):
        slug = base if n == 1 else f"{base}-{n}"
        org = OrgDoc(
            slug=slug,
            name=business.name,
            city=business.city,
            type=business.type,
            languages=list(dict.fromkeys(business.languages)),
            status="pending_review",
            ownerUid=owner.uid,
        )
        try:
            svc.store.create_org(org)
        except SlugTaken:
            continue

        def join(tx: Tx) -> None:
            u = tx.get_user(owner.uid) or owner
            u.memberships = [x for x in u.memberships if x.orgSlug != slug] + [Membership(orgSlug=slug, role="owner")]
            tx.save_user(u)
            tx.save_member(slug, MemberDoc(id=owner.uid, uid=owner.uid, email=u.email, name=u.name, role="owner", joinedAt=now()))

        svc.store.transact(join)
        owner.memberships.append(Membership(orgSlug=slug, role="owner"))
        return org
    raise RuntimeError("could not find a free organisation slug")


def link(svc: Services, path: str) -> str:
    return f"{svc.settings.app_url.rstrip('/')}{path}"
