"""Firestore data. Only this backend touches Firestore (via the Admin SDK),
so the database's security rules should deny all client access.

Collections
  users/{uid}            name, email, phone, memberships[{orgSlug, role}], platformRole?, createdAt
  orgs/{slug}            name, city, type, languages[], status, statusReason?, ownerUid, createdAt, reviewedBy?
  invites/{sha256(tok)}  email, orgSlug?, orgName, role, invitedBy, expiresAt, usedAt?
  login_attempts/{sha256(email)}  count, until
  audit/{auto}           at, actor, action, target, detail
"""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Protocol


def now() -> datetime:
    return datetime.now(timezone.utc)


def hash_key(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode()).hexdigest()


@dataclass
class Membership:
    orgSlug: str
    role: str


@dataclass
class UserDoc:
    uid: str
    name: str
    email: str
    phone: str = ""
    memberships: list[Membership] = field(default_factory=list)
    platformRole: str | None = None
    createdAt: datetime = field(default_factory=now)


@dataclass
class OrgDoc:
    slug: str
    name: str
    city: str
    type: str
    languages: list[str]
    status: str
    ownerUid: str
    createdAt: datetime = field(default_factory=now)
    statusReason: str | None = None
    reviewedBy: str | None = None


@dataclass
class InviteDoc:
    email: str
    orgName: str
    role: str
    invitedBy: str
    expiresAt: datetime
    orgSlug: str | None = None
    usedAt: datetime | None = None


class SlugTaken(Exception):
    pass


class Store(Protocol):
    def get_user(self, uid: str) -> UserDoc | None: ...
    def save_user(self, user: UserDoc) -> None: ...
    def get_org(self, slug: str) -> OrgDoc | None: ...
    def create_org(self, org: OrgDoc) -> None: ...  # raises SlugTaken
    def save_org(self, org: OrgDoc) -> None: ...
    def list_orgs(self) -> list[OrgDoc]: ...
    def get_invite(self, token_hash: str) -> InviteDoc | None: ...
    def save_invite(self, token_hash: str, invite: InviteDoc) -> None: ...
    def get_attempts(self, key: str) -> tuple[int, datetime | None]: ...
    def set_attempts(self, key: str, count: int, until: datetime | None) -> None: ...
    def clear_attempts(self, key: str) -> None: ...
    def audit(self, actor: str, action: str, target: str, detail: str = "") -> None: ...


def _user_from(uid: str, d: dict) -> UserDoc:
    return UserDoc(
        uid=uid,
        name=d.get("name", ""),
        email=d.get("email", ""),
        phone=d.get("phone", ""),
        memberships=[Membership(**m) for m in d.get("memberships", [])],
        platformRole=d.get("platformRole"),
        createdAt=d.get("createdAt") or now(),
    )


class FirestoreStore:
    def __init__(self, db):  # google.cloud.firestore.Client
        self.db = db

    def get_user(self, uid: str) -> UserDoc | None:
        snap = self.db.collection("users").document(uid).get()
        return _user_from(uid, snap.to_dict()) if snap.exists else None

    def save_user(self, user: UserDoc) -> None:
        d = asdict(user)
        d.pop("uid")
        self.db.collection("users").document(user.uid).set(d)

    def get_org(self, slug: str) -> OrgDoc | None:
        snap = self.db.collection("orgs").document(slug).get()
        return OrgDoc(slug=slug, **snap.to_dict()) if snap.exists else None

    def create_org(self, org: OrgDoc) -> None:
        from google.api_core.exceptions import AlreadyExists

        d = asdict(org)
        d.pop("slug")
        try:
            self.db.collection("orgs").document(org.slug).create(d)
        except AlreadyExists as e:
            raise SlugTaken() from e

    def save_org(self, org: OrgDoc) -> None:
        d = asdict(org)
        d.pop("slug")
        self.db.collection("orgs").document(org.slug).set(d)

    def list_orgs(self) -> list[OrgDoc]:
        return [OrgDoc(slug=s.id, **s.to_dict()) for s in self.db.collection("orgs").stream()]

    def get_invite(self, token_hash: str) -> InviteDoc | None:
        snap = self.db.collection("invites").document(token_hash).get()
        return InviteDoc(**snap.to_dict()) if snap.exists else None

    def save_invite(self, token_hash: str, invite: InviteDoc) -> None:
        self.db.collection("invites").document(token_hash).set(asdict(invite))

    def get_attempts(self, key: str) -> tuple[int, datetime | None]:
        snap = self.db.collection("login_attempts").document(key).get()
        if not snap.exists:
            return 0, None
        d = snap.to_dict()
        return int(d.get("count", 0)), d.get("until")

    def set_attempts(self, key: str, count: int, until: datetime | None) -> None:
        self.db.collection("login_attempts").document(key).set({"count": count, "until": until, "at": now()})

    def clear_attempts(self, key: str) -> None:
        self.db.collection("login_attempts").document(key).delete()

    def audit(self, actor: str, action: str, target: str, detail: str = "") -> None:
        self.db.collection("audit").add({"at": now(), "actor": actor, "action": action, "target": target, "detail": detail})
