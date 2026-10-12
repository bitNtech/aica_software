"""Account logic shared by several routes."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from .models import ImpersonatorOut, MembershipOut, SessionOut, UserOut
from .services import Services
from .sessions import Caller
from .store import OrgDoc, SlugTaken, UserDoc


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def user_out(svc: Services, uid: str, email: str, platform_role: str | None) -> UserOut:
    doc = svc.store.get_user(uid)
    memberships: list[MembershipOut] = []
    for m in doc.memberships if doc else []:
        org = svc.store.get_org(m.orgSlug)
        if org:
            memberships.append(
                MembershipOut(
                    org_slug=org.slug,
                    org_name=org.name,
                    city=org.city,
                    role=m.role,
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
        from .store import Membership

        owner.memberships.append(Membership(orgSlug=slug, role="owner"))
        svc.store.save_user(owner)
        return org
    raise RuntimeError("could not find a free organisation slug")


def link(svc: Services, path: str) -> str:
    return f"{svc.settings.app_url.rstrip('/')}{path}"
