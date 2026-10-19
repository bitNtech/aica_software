"""Firestore data. Only this backend touches Firestore (via the Admin SDK),
so the database's security rules should deny all client access.

Collections
  users/{uid}            name, email, phone, memberships[{orgSlug, role}], platformRole?, createdAt, lastActiveAt?
  orgs/{slug}            name, city, type, languages[], status, statusReason?, ownerUid, createdAt, reviewedBy?,
                         hours[]?, closed[], settingsUpdatedAt?, settingsUpdatedBy?
  orgs/{slug}/members/{id}   the source of truth for who is in an organisation and what they may do:
                         email, name, role, status (active | invited), permissions[]?, uid?, invitedAt?,
                         invitedBy?, inviteHash?, joinedAt?. `id` is the uid once they join, "inv_…" while
                         invited. users/{uid}.memberships is the reverse index, written in the same transaction.
  orgs/{slug}/activity/{auto}  at, actor, actorKind, actorId?, area, text, detail, ownerOnly
  invites/{sha256(tok)}  email, orgSlug?, orgName, role, invitedBy, expiresAt, usedAt?, memberId?, revokedAt?
  login_attempts/{sha256(email)}  count, until
  audit/{auto}           at, actor, action, target, detail
  impersonations/{sha256(tok)}  actorUid, targetUid, reason, startedAt, expiresAt, endedAt?
  ratelimits/{sha256(key|window)}  count, expiresAt (a Firestore TTL policy on expiresAt deletes old ones)
  orgs/{slug}/changeRequests/{id}  a request to bitNtech, with its replies[] (Phase 2)
  orgs/{slug}/calls/{id}         one finished call (written by the voice pipeline; seeded for now), with
                                 searchTokens[] for the call log's search; notes in calls/{id}/notes/{id}
  orgs/{slug}/callbacks/{id}     people to call back, with notes[]
  orgs/{slug}/appointments/{id}  bookings made on calls or by staff
  orgs/{slug}/handoffs/{id}      callers the agent passed to a person
"""
from __future__ import annotations

import dataclasses
import hashlib
import secrets
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable, Protocol, TypeVar

T = TypeVar("T")


def now() -> datetime:
    return datetime.now(timezone.utc)


def hash_key(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode()).hexdigest()


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(12)}"


def _known(cls, d: dict) -> dict:
    """Only the fields `cls` has, so an extra field in a document never
    breaks reading it."""
    names = {f.name for f in dataclasses.fields(cls)}
    return {k: v for k, v in d.items() if k in names}


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
    lastActiveAt: datetime | None = None


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
    # Organisation settings. None: never set (the API serves defaults).
    hours: list[dict] | None = None
    closed: list[dict] = field(default_factory=list)
    settingsUpdatedAt: datetime | None = None
    settingsUpdatedBy: str | None = None


@dataclass
class InviteDoc:
    email: str
    orgName: str
    role: str
    invitedBy: str
    expiresAt: datetime
    orgSlug: str | None = None
    usedAt: datetime | None = None
    # Organisation invitations: the member record it belongs to. Resending
    # or cancelling revokes the old link.
    memberId: str | None = None
    revokedAt: datetime | None = None


@dataclass
class MemberDoc:
    id: str
    email: str
    name: str
    role: str
    status: str = "active"  # active | invited
    permissions: list[str] | None = None
    uid: str | None = None
    invitedAt: datetime | None = None
    invitedBy: str | None = None
    inviteHash: str | None = None
    joinedAt: datetime | None = None


@dataclass
class ActivityDoc:
    at: datetime
    actor: str
    actorKind: str  # member | bitntech | aica
    area: str  # team | agents | library | settings | billing | access
    text: str
    detail: str = ""
    actorId: str | None = None
    # Billing entries are for owners only.
    ownerOnly: bool = False
    id: str = ""


@dataclass
class ChangeRequestDoc:
    id: str
    kind: str
    title: str
    detail: str
    urgency: str
    status: str
    createdAt: datetime
    createdBy: str
    updatedAt: datetime
    createdById: str | None = None
    agentId: str | None = None
    agentName: str | None = None
    replies: list[dict] = field(default_factory=list)  # {id, by, byKind, at, text}


@dataclass
class CallDoc:
    """A finished call. Phone numbers are stored in full and masked on the
    way out. Everything but notes and handledBy comes from the pipeline."""

    id: str
    agentId: str
    agentName: str
    line: str
    callerPhone: str
    startedAt: datetime
    durationSec: int
    language: str
    intent: str
    outcome: str
    callerName: str | None = None
    handledBy: str | None = None
    handledById: str | None = None
    summary: str = ""
    path: list[str] = field(default_factory=list)
    details: list[dict] = field(default_factory=list)  # {label, value, personal}
    toolCalls: list[dict] = field(default_factory=list)
    knowledgeUsed: list[str] = field(default_factory=list)
    transcript: list[dict] = field(default_factory=list)
    hasRecording: bool = False
    analysis: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    searchTokens: list[str] = field(default_factory=list)
    seeded: bool = False


@dataclass
class NoteDoc:
    id: str
    by: str
    at: datetime
    text: str
    byId: str | None = None


@dataclass
class CallbackDoc:
    id: str
    callerPhone: str
    reason: str
    requestedAt: datetime
    dueBy: datetime
    status: str = "open"  # open | done | unreachable
    callerName: str | None = None
    assignedToId: str | None = None
    assignedToName: str | None = None
    attempts: int = 0
    notes: list[dict] = field(default_factory=list)  # {id, by, at, text}
    callId: str | None = None
    seeded: bool = False


@dataclass
class AppointmentDoc:
    id: str
    patientName: str
    phone: str
    department: str
    doctor: str
    date: str  # yyyy-mm-dd, the hospital's local date
    time: str  # HH:mm
    status: str
    bookedBy: str
    createdAt: datetime
    agentName: str | None = None
    callId: str | None = None
    checkReason: str | None = None
    note: str | None = None
    seeded: bool = False


@dataclass
class HandoffDoc:
    id: str
    callId: str
    agentName: str
    line: str
    callerPhone: str
    reason: str
    summary: str
    language: str
    waitingSince: datetime
    status: str = "waiting"  # waiting | taken | missed
    details: list[dict] = field(default_factory=list)
    takenBy: str | None = None
    takenById: str | None = None
    takenAt: datetime | None = None
    emergency: bool = False
    seeded: bool = False


# Records kept per organisation: kind → (subcollection, type).
RECORDS: dict[str, tuple[str, type]] = {
    "request": ("changeRequests", ChangeRequestDoc),
    "call": ("calls", CallDoc),
    "callback": ("callbacks", CallbackDoc),
    "appointment": ("appointments", AppointmentDoc),
    "handoff": ("handoffs", HandoffDoc),
}


def record_from(kind: str, record_id: str, d: dict):
    cls = RECORDS[kind][1]
    return cls(**{**_known(cls, d), "id": record_id})


def record_data(rec) -> dict:
    d = asdict(rec)
    d.pop("id")
    return d


@dataclass
class CallFilter:
    since: datetime
    agent_id: str | None = None
    outcome: str | None = None
    handled_by_id: str | None = None
    # One search token, any of which matches (array-contains-any).
    tokens: list[str] | None = None


@dataclass
class AuditEntry:
    at: datetime
    actor: str
    action: str
    target: str
    detail: str = ""


@dataclass
class ImpersonationDoc:
    """A master admin acting as a client user, for a limited time."""

    actorUid: str
    targetUid: str
    reason: str
    startedAt: datetime
    expiresAt: datetime
    endedAt: datetime | None = None


# The audit log can be filtered on one of these at a time; each needs a
# composite index with `at` (backend/firestore.indexes.json).
AUDIT_FILTERS = ("action", "actor", "target")


class SlugTaken(Exception):
    pass


class IndexMissing(Exception):
    """A Firestore query needs a composite index that hasn't been created."""


class Tx(Protocol):
    """One transaction: every read comes before every write, and the whole
    function may run again if another write got there first, so it must
    not have side effects of its own (send email after it returns)."""

    def get_org(self, slug: str) -> OrgDoc | None: ...
    def get_user(self, uid: str) -> UserDoc | None: ...
    def get_invite(self, token_hash: str) -> InviteDoc | None: ...
    def get_member(self, slug: str, member_id: str) -> MemberDoc | None: ...
    def list_members(self, slug: str) -> list[MemberDoc]: ...
    def save_org(self, org: OrgDoc) -> None: ...
    def update_org(self, slug: str, fields: dict) -> None: ...  # only these fields
    def save_user(self, user: UserDoc) -> None: ...
    def save_invite(self, token_hash: str, invite: InviteDoc) -> None: ...
    def save_member(self, slug: str, member: MemberDoc) -> None: ...
    def delete_member(self, slug: str, member_id: str) -> None: ...
    def add_activity(self, slug: str, entry: ActivityDoc) -> None: ...
    def get_record(self, slug: str, kind: str, record_id: str): ...  # a RECORDS type, or None
    def save_record(self, slug: str, kind: str, rec) -> None: ...
    def open_callbacks_of(self, slug: str, member_id: str) -> list[CallbackDoc]: ...


class Store(Protocol):
    def get_user(self, uid: str) -> UserDoc | None: ...
    def get_users(self, uids: list[str]) -> dict[str, UserDoc]: ...
    def users_in_org(self, slug: str, roles: tuple[str, ...]) -> list[str]: ...  # uids with a memberships entry
    def save_user(self, user: UserDoc) -> None: ...
    def set_last_active(self, uid: str, at: datetime) -> None: ...
    def get_org(self, slug: str) -> OrgDoc | None: ...
    def create_org(self, org: OrgDoc) -> None: ...  # raises SlugTaken
    def save_org(self, org: OrgDoc) -> None: ...
    def list_orgs(self) -> list[OrgDoc]: ...
    def get_invite(self, token_hash: str) -> InviteDoc | None: ...
    def save_invite(self, token_hash: str, invite: InviteDoc) -> None: ...
    def get_member(self, slug: str, member_id: str) -> MemberDoc | None: ...
    def list_members(self, slug: str) -> list[MemberDoc]: ...
    def list_activity(
        self, slug: str, limit: int, after_id: str | None = None, area: str | None = None, actor_id: str | None = None, include_owner_only: bool = False
    ) -> list[ActivityDoc]: ...  # raises IndexMissing
    def transact(self, fn: Callable[[Tx], T]) -> T: ...
    # ---- Phase 2 and 3 records
    def get_record(self, slug: str, kind: str, record_id: str): ...
    def save_record(self, slug: str, kind: str, rec) -> None: ...
    def list_requests(self, slug: str, limit: int = 200) -> list[ChangeRequestDoc]: ...  # newest first
    def list_requests_everywhere(self, since: datetime, limit: int = 500) -> list[tuple[str, ChangeRequestDoc]]: ...  # open, or updated since
    def list_callbacks(self, slug: str, closed_since: datetime) -> list[CallbackDoc]: ...  # open ones, and closed ones requested since
    def list_appointments(self, slug: str, date_from: str, date_to: str, limit: int = 1000) -> list[AppointmentDoc]: ...
    def list_handoffs(self, slug: str, since: datetime) -> list[HandoffDoc]: ...  # waiting ones, and any since
    def list_calls(self, slug: str, f: CallFilter, limit: int) -> tuple[list[CallDoc], int]: ...  # newest first, and the total; raises IndexMissing
    def list_notes(self, slug: str, call_id: str) -> list[NoteDoc]: ...
    def add_note(self, slug: str, call_id: str, note: NoteDoc) -> None: ...
    def get_attempts(self, key: str) -> tuple[int, datetime | None]: ...
    def set_attempts(self, key: str, count: int, until: datetime | None) -> None: ...
    def clear_attempts(self, key: str) -> None: ...
    def hit(self, key: str, limit: int, window_seconds: int) -> int | None: ...  # seconds to wait, or None
    def audit(self, actor: str, action: str, target: str, detail: str = "") -> None: ...
    def list_users(self) -> list[UserDoc]: ...
    def list_audit(self, limit: int, before: datetime | None = None, field: str | None = None, value: str | None = None) -> list[AuditEntry]: ...  # raises IndexMissing
    def get_impersonation(self, key: str) -> ImpersonationDoc | None: ...
    def save_impersonation(self, key: str, doc: ImpersonationDoc) -> None: ...


def window_of(at: datetime, window_seconds: int) -> tuple[int, int]:
    """The fixed rate-limit window `at` falls in: (start, seconds left)."""
    t = int(at.timestamp())
    start = t - t % window_seconds
    return start, start + window_seconds - t


def _user_from(uid: str, d: dict) -> UserDoc:
    return UserDoc(
        uid=uid,
        name=d.get("name", ""),
        email=d.get("email", ""),
        phone=d.get("phone", ""),
        memberships=[Membership(**m) for m in d.get("memberships", [])],
        platformRole=d.get("platformRole"),
        createdAt=d.get("createdAt") or now(),
        lastActiveAt=d.get("lastActiveAt"),
    )


def _user_data(user: UserDoc) -> dict:
    d = asdict(user)
    d.pop("uid")
    return d


def _org_from(slug: str, d: dict) -> OrgDoc:
    return OrgDoc(slug=slug, **_known(OrgDoc, d))


def _org_data(org: OrgDoc) -> dict:
    d = asdict(org)
    d.pop("slug")
    return d


def _member_from(member_id: str, d: dict) -> MemberDoc:
    return MemberDoc(**{**_known(MemberDoc, d), "id": member_id})


def _member_data(member: MemberDoc) -> dict:
    d = asdict(member)
    d.pop("id")
    return d


def _activity_from(entry_id: str, d: dict) -> ActivityDoc:
    return ActivityDoc(**{**_known(ActivityDoc, d), "id": entry_id})


def _activity_data(entry: ActivityDoc) -> dict:
    d = asdict(entry)
    d.pop("id")
    return d


class _FirestoreTx:
    def __init__(self, db, t):
        self.db, self.t = db, t

    def _org_ref(self, slug: str):
        return self.db.collection("orgs").document(slug)

    def get_org(self, slug):
        snap = self._org_ref(slug).get(transaction=self.t)
        return _org_from(slug, snap.to_dict()) if snap.exists else None

    def get_user(self, uid):
        snap = self.db.collection("users").document(uid).get(transaction=self.t)
        return _user_from(uid, snap.to_dict()) if snap.exists else None

    def get_invite(self, token_hash):
        snap = self.db.collection("invites").document(token_hash).get(transaction=self.t)
        return InviteDoc(**_known(InviteDoc, snap.to_dict())) if snap.exists else None

    def get_member(self, slug, member_id):
        snap = self._org_ref(slug).collection("members").document(member_id).get(transaction=self.t)
        return _member_from(snap.id, snap.to_dict()) if snap.exists else None

    def list_members(self, slug):
        return [_member_from(s.id, s.to_dict()) for s in self._org_ref(slug).collection("members").stream(transaction=self.t)]

    def save_org(self, org):
        self.t.set(self._org_ref(org.slug), _org_data(org))

    def update_org(self, slug, fields):
        self.t.update(self._org_ref(slug), fields)

    def save_user(self, user):
        self.t.set(self.db.collection("users").document(user.uid), _user_data(user))

    def save_invite(self, token_hash, invite):
        self.t.set(self.db.collection("invites").document(token_hash), asdict(invite))

    def save_member(self, slug, member):
        self.t.set(self._org_ref(slug).collection("members").document(member.id), _member_data(member))

    def delete_member(self, slug, member_id):
        self.t.delete(self._org_ref(slug).collection("members").document(member_id))

    def add_activity(self, slug, entry):
        ref = self._org_ref(slug).collection("activity").document()  # id made client-side
        self.t.set(ref, _activity_data(entry))

    def _rec_ref(self, slug, kind, record_id):
        return self._org_ref(slug).collection(RECORDS[kind][0]).document(record_id)

    def get_record(self, slug, kind, record_id):
        snap = self._rec_ref(slug, kind, record_id).get(transaction=self.t)
        return record_from(kind, snap.id, snap.to_dict()) if snap.exists else None

    def save_record(self, slug, kind, rec):
        self.t.set(self._rec_ref(slug, kind, rec.id), record_data(rec))

    def open_callbacks_of(self, slug, member_id):
        from google.cloud.firestore_v1.base_query import FieldFilter

        q = (
            self._org_ref(slug).collection("callbacks")
            .where(filter=FieldFilter("status", "==", "open"))
            .where(filter=FieldFilter("assignedToId", "==", member_id))
        )
        return [record_from("callback", s.id, s.to_dict()) for s in q.stream(transaction=self.t)]


class FirestoreStore:
    def __init__(self, db):  # google.cloud.firestore.Client
        self.db = db

    def get_user(self, uid: str) -> UserDoc | None:
        snap = self.db.collection("users").document(uid).get()
        return _user_from(uid, snap.to_dict()) if snap.exists else None

    def get_users(self, uids: list[str]) -> dict[str, UserDoc]:
        refs = [self.db.collection("users").document(u) for u in dict.fromkeys(uids)]
        return {s.id: _user_from(s.id, s.to_dict()) for s in self.db.get_all(refs) if s.exists} if refs else {}

    def save_user(self, user: UserDoc) -> None:
        self.db.collection("users").document(user.uid).set(_user_data(user))

    def users_in_org(self, slug: str, roles: tuple[str, ...]) -> list[str]:
        """Uids whose users/{uid}.memberships has an entry for `slug`. One
        array-contains query per role (the entry is a {orgSlug, role} map);
        none needs a composite index."""
        from google.cloud.firestore_v1.base_query import FieldFilter

        found: dict[str, None] = {}
        for role in roles:
            q = self.db.collection("users").where(filter=FieldFilter("memberships", "array_contains", {"orgSlug": slug, "role": role}))
            for s in q.stream():
                found[s.id] = None
        return list(found)

    def set_last_active(self, uid: str, at: datetime) -> None:
        """A one-field update, so it never overwrites memberships written
        meanwhile. Accounts without a profile yet are skipped: creating a
        half-empty one would stop ensure_profile filling it in."""
        from google.api_core.exceptions import NotFound

        try:
            self.db.collection("users").document(uid).update({"lastActiveAt": at})
        except NotFound:
            pass

    def get_org(self, slug: str) -> OrgDoc | None:
        snap = self.db.collection("orgs").document(slug).get()
        return _org_from(slug, snap.to_dict()) if snap.exists else None

    def create_org(self, org: OrgDoc) -> None:
        from google.api_core.exceptions import AlreadyExists

        try:
            self.db.collection("orgs").document(org.slug).create(_org_data(org))
        except AlreadyExists as e:
            raise SlugTaken() from e

    def save_org(self, org: OrgDoc) -> None:
        self.db.collection("orgs").document(org.slug).set(_org_data(org))

    def list_orgs(self) -> list[OrgDoc]:
        return [_org_from(s.id, s.to_dict()) for s in self.db.collection("orgs").stream()]

    def get_invite(self, token_hash: str) -> InviteDoc | None:
        snap = self.db.collection("invites").document(token_hash).get()
        return InviteDoc(**_known(InviteDoc, snap.to_dict())) if snap.exists else None

    def save_invite(self, token_hash: str, invite: InviteDoc) -> None:
        self.db.collection("invites").document(token_hash).set(asdict(invite))

    def _members(self, slug: str):
        return self.db.collection("orgs").document(slug).collection("members")

    def get_member(self, slug: str, member_id: str) -> MemberDoc | None:
        snap = self._members(slug).document(member_id).get()
        return _member_from(snap.id, snap.to_dict()) if snap.exists else None

    def list_members(self, slug: str) -> list[MemberDoc]:
        return [_member_from(s.id, s.to_dict()) for s in self._members(slug).stream()]

    def list_activity(self, slug, limit, after_id=None, area=None, actor_id=None, include_owner_only=False):
        from google.api_core.exceptions import FailedPrecondition
        from google.cloud.firestore_v1 import Query
        from google.cloud.firestore_v1.base_query import FieldFilter

        col = self.db.collection("orgs").document(slug).collection("activity")
        q = col
        if not include_owner_only:
            q = q.where(filter=FieldFilter("ownerOnly", "==", False))
        if area:
            q = q.where(filter=FieldFilter("area", "==", area))
        if actor_id:
            q = q.where(filter=FieldFilter("actorId", "==", actor_id))
        # Ties on `at` are broken by document id, so paging never skips one.
        q = q.order_by("at", direction=Query.DESCENDING)
        if after_id:
            cursor = col.document(after_id).get()
            if not cursor.exists:
                return []
            q = q.start_after(cursor)
        try:
            snaps = list(q.limit(limit).stream())
        except FailedPrecondition as e:
            raise IndexMissing() from e
        return [_activity_from(s.id, s.to_dict()) for s in snaps]

    def transact(self, fn):
        from google.cloud import firestore

        @firestore.transactional
        def run(t):
            return fn(_FirestoreTx(self.db, t))

        return run(self.db.transaction())

    def _records(self, slug: str, kind: str):
        return self.db.collection("orgs").document(slug).collection(RECORDS[kind][0])

    def get_record(self, slug, kind, record_id):
        snap = self._records(slug, kind).document(record_id).get()
        return record_from(kind, snap.id, snap.to_dict()) if snap.exists else None

    def save_record(self, slug, kind, rec):
        self._records(slug, kind).document(rec.id).set(record_data(rec))

    def list_requests(self, slug, limit=200):
        from google.cloud.firestore_v1 import Query

        q = self._records(slug, "request").order_by("createdAt", direction=Query.DESCENDING).limit(limit)
        return [record_from("request", s.id, s.to_dict()) for s in q.stream()]

    def list_requests_everywhere(self, since, limit=500):
        """A collection-group query, so the status and updatedAt fields need
        collection-group indexes (fieldOverrides in firestore.indexes.json)."""
        from google.api_core.exceptions import FailedPrecondition
        from google.cloud.firestore_v1.base_query import FieldFilter

        group = self.db.collection_group("changeRequests")
        found: dict[str, tuple[str, ChangeRequestDoc]] = {}
        try:
            for q in (
                group.where(filter=FieldFilter("status", "in", ["open", "in_progress"])).limit(limit),
                group.where(filter=FieldFilter("updatedAt", ">=", since)).limit(limit),
            ):
                for s in q.stream():
                    slug = s.reference.parent.parent.id
                    found[s.reference.path] = (slug, record_from("request", s.id, s.to_dict()))
        except FailedPrecondition as e:
            raise IndexMissing() from e
        return list(found.values())

    def list_callbacks(self, slug, closed_since):
        from google.cloud.firestore_v1.base_query import FieldFilter

        col = self._records(slug, "callback")
        found = {}
        for q in (col.where(filter=FieldFilter("status", "==", "open")), col.where(filter=FieldFilter("requestedAt", ">=", closed_since))):
            for s in q.limit(1000).stream():
                found[s.id] = record_from("callback", s.id, s.to_dict())
        return list(found.values())

    def list_appointments(self, slug, date_from, date_to, limit=1000):
        from google.cloud.firestore_v1.base_query import FieldFilter

        q = (
            self._records(slug, "appointment")
            .where(filter=FieldFilter("date", ">=", date_from))
            .where(filter=FieldFilter("date", "<=", date_to))
            .order_by("date")
            .limit(limit)
        )
        return [record_from("appointment", s.id, s.to_dict()) for s in q.stream()]

    def list_handoffs(self, slug, since):
        from google.cloud.firestore_v1.base_query import FieldFilter

        col = self._records(slug, "handoff")
        found = {}
        for q in (col.where(filter=FieldFilter("status", "==", "waiting")), col.where(filter=FieldFilter("waitingSince", ">=", since))):
            for s in q.limit(500).stream():
                found[s.id] = record_from("handoff", s.id, s.to_dict())
        return list(found.values())

    def list_calls(self, slug, f, limit):
        """Every filter is an equality (or one array-contains-any) plus the
        startedAt range, so each combination has a composite index."""
        from google.api_core.exceptions import FailedPrecondition
        from google.cloud.firestore_v1 import Query
        from google.cloud.firestore_v1.base_query import FieldFilter

        q = self._records(slug, "call").where(filter=FieldFilter("startedAt", ">=", f.since))
        for name, value in (("agentId", f.agent_id), ("outcome", f.outcome), ("handledById", f.handled_by_id)):
            if value:
                q = q.where(filter=FieldFilter(name, "==", value))
        if f.tokens:
            q = q.where(filter=FieldFilter("searchTokens", "array_contains_any", f.tokens[:30]))
        # Count and list the same ordered query: composite indexes are
        # direction-specific, and a bare range filter would order ascending.
        ordered = q.order_by("startedAt", direction=Query.DESCENDING)
        try:
            total = int(ordered.count().get()[0][0].value)
            snaps = list(ordered.limit(limit).stream())
        except FailedPrecondition as e:
            raise IndexMissing() from e
        return [record_from("call", s.id, s.to_dict()) for s in snaps], total

    def _notes(self, slug, call_id):
        return self._records(slug, "call").document(call_id).collection("notes")

    def list_notes(self, slug, call_id):
        return [NoteDoc(**{**_known(NoteDoc, s.to_dict()), "id": s.id}) for s in self._notes(slug, call_id).order_by("at").limit(500).stream()]

    def add_note(self, slug, call_id, note):
        d = asdict(note)
        d.pop("id")
        self._notes(slug, call_id).document(note.id).set(d)

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

    def hit(self, key: str, limit: int, window_seconds: int) -> int | None:
        """A fixed-window counter shared by every instance. An atomic
        increment, then a read: concurrent hits can only over-count, never
        let extra requests through."""
        from google.cloud import firestore

        start, left = window_of(now(), window_seconds)
        ref = self.db.collection("ratelimits").document(hash_key(f"{key}|{start}"))
        expires = datetime.fromtimestamp(start + window_seconds, timezone.utc) + timedelta(minutes=5)
        ref.set({"count": firestore.Increment(1), "expiresAt": expires}, merge=True)
        count = int(ref.get().get("count") or 0)
        return left if count > limit else None

    def audit(self, actor: str, action: str, target: str, detail: str = "") -> None:
        self.db.collection("audit").add({"at": now(), "actor": actor, "action": action, "target": target, "detail": detail})

    def list_users(self) -> list[UserDoc]:
        return [_user_from(s.id, s.to_dict()) for s in self.db.collection("users").stream()]

    def list_audit(self, limit: int, before: datetime | None = None, field: str | None = None, value: str | None = None) -> list[AuditEntry]:
        from google.api_core.exceptions import FailedPrecondition
        from google.cloud.firestore_v1 import Query
        from google.cloud.firestore_v1.base_query import FieldFilter

        q = self.db.collection("audit")
        if field:
            q = q.where(filter=FieldFilter(field, "==", value))
        if before:
            q = q.where(filter=FieldFilter("at", "<", before))
        q = q.order_by("at", direction=Query.DESCENDING).limit(limit)
        try:
            snaps = list(q.stream())
        except FailedPrecondition as e:
            raise IndexMissing() from e
        out = []
        for snap in snaps:
            d = snap.to_dict()
            out.append(AuditEntry(at=d.get("at") or now(), actor=str(d.get("actor", "")), action=str(d.get("action", "")), target=str(d.get("target", "")), detail=str(d.get("detail", ""))))
        return out

    def get_impersonation(self, key: str) -> ImpersonationDoc | None:
        snap = self.db.collection("impersonations").document(key).get()
        return ImpersonationDoc(**snap.to_dict()) if snap.exists else None

    def save_impersonation(self, key: str, doc: ImpersonationDoc) -> None:
        self.db.collection("impersonations").document(key).set(asdict(doc))
