"""In-memory stand-ins for Firebase Auth, the Auth REST API, Firestore,
Resend and Google, so route logic is tested without a network."""
from __future__ import annotations

import copy
import time
from dataclasses import dataclass, field
from datetime import timedelta

from app.errors import ApiError
from app.identity import AuthUser, EmailExists, InvalidSession
from app.services import Services
from app.settings import Settings
from app.store import ActivityDoc, AuditEntry, InviteDoc, MemberDoc, OrgDoc, SlugTaken, UserDoc, new_id, now, window_of


@dataclass
class FakeAccount:
    user: AuthUser
    password: str | None
    revoked_at: float = 0.0


class FakeFirebase:
    """Plays both the Admin SDK and the Auth REST API over one user table."""

    def __init__(self):
        self.accounts: dict[str, FakeAccount] = {}
        self.codes: dict[str, tuple[str, str]] = {}  # code → (kind, email)
        self.google_users: dict[str, dict] = {}  # google id token → {email, name}
        self._n = 0

    # ---- helpers
    def _uid(self) -> str:
        self._n += 1
        return f"uid{self._n}"

    def by_email(self, email: str) -> FakeAccount | None:
        return next((a for a in self.accounts.values() if a.user.email == email.lower()), None)

    def add(self, email: str, password: str | None, *, verified=True, claims=None, disabled=False, name="Test") -> str:
        uid = self._uid()
        self.accounts[uid] = FakeAccount(AuthUser(uid, email.lower(), verified, disabled, name, dict(claims or {})), password)
        return uid

    def _token(self, acct: FakeAccount) -> str:
        return f"idtok:{acct.user.uid}:{time.time()}"

    # ---- Admin SDK surface
    def get_user(self, uid):
        a = self.accounts.get(uid)
        return copy.deepcopy(a.user) if a else None

    def list_users(self):
        return [copy.deepcopy(a.user) for a in self.accounts.values()]

    def get_users(self, uids):
        return {u: copy.deepcopy(self.accounts[u].user) for u in uids if u in self.accounts}

    def get_user_by_email(self, email):
        a = self.by_email(email)
        return copy.deepcopy(a.user) if a else None

    def create_user(self, email, password, name, email_verified=False):
        if self.by_email(email):
            raise EmailExists()
        return self.add(email, password, verified=email_verified, name=name)

    def delete_user(self, uid):
        self.accounts.pop(uid, None)

    def update_user(self, uid, **fields):
        a = self.accounts[uid]
        if "email_verified" in fields:
            a.user.email_verified = fields["email_verified"]
        if "password" in fields:
            a.password = fields["password"]
        if "disabled" in fields:
            a.user.disabled = fields["disabled"]

    def set_claims(self, uid, claims):
        self.accounts[uid].user.claims = dict(claims or {})

    def revoke_sessions(self, uid):
        self.accounts[uid].revoked_at = time.time() + 0.001

    def create_session_cookie(self, id_token, expires_in: timedelta):
        _, uid, _ = id_token.split(":")
        a = self.accounts[uid]
        iat = time.time()
        return f"sess|{uid}|{iat}|{iat + expires_in.total_seconds()}|{a.user.claims.get('platform_role', '')}"

    def verify_session_cookie(self, cookie):
        try:
            _, uid, iat, exp, role = cookie.split("|")
        except ValueError as e:
            raise InvalidSession() from e
        a = self.accounts.get(uid)
        if not a or a.user.disabled or float(exp) < time.time() or float(iat) < a.revoked_at:
            raise InvalidSession()
        claims = {"uid": uid, "email": a.user.email, "iat": float(iat), "exp": float(exp)}
        if role:
            claims["platform_role"] = role
        return claims

    def email_verification_code(self, email):
        code = f"verify-code-{len(self.codes)}-xxxxxxxx"
        self.codes[code] = ("verify", email.lower())
        return code

    def password_reset_code(self, email):
        code = f"reset-code-{len(self.codes)}-xxxxxxxx"
        self.codes[code] = ("reset", email.lower())
        return code

    # ---- Auth REST surface
    def sign_in_with_password(self, email, password):
        a = self.by_email(email)
        if not a or a.password is None or a.password != password:
            raise ApiError(401, "invalid_credentials", "That email and password don't match.")
        if a.user.disabled:
            raise ApiError(403, "account_locked", "This account is locked.")
        return {"idToken": self._token(a), "localId": a.user.uid, "email": a.user.email}

    def create_custom_token(self, uid):
        return f"custom:{uid}"

    def sign_in_with_custom_token(self, token):
        uid = token.split(":", 1)[1]
        return {"idToken": self._token(self.accounts[uid]), "localId": uid}

    def apply_email_verification(self, code):
        kind, email = self.codes.pop(code, (None, None))
        if kind != "verify":
            raise ApiError(400, "invalid_token", "This link isn't valid.")
        self.by_email(email).user.email_verified = True
        return email

    def check_reset_code(self, code):
        kind, email = self.codes.get(code, (None, None))
        if kind != "reset":
            raise ApiError(400, "invalid_token", "This link isn't valid.")
        return email

    def reset_password(self, code, new_password):
        email = self.check_reset_code(code)
        self.codes.pop(code)
        self.by_email(email).password = new_password
        return email


class MemoryStore:
    def __init__(self):
        self.users: dict[str, UserDoc] = {}
        self.orgs: dict[str, OrgDoc] = {}
        self.invites: dict[str, InviteDoc] = {}
        self.attempts: dict[str, tuple[int, object]] = {}
        self.audits: list[tuple] = []
        self.audit_log: list[AuditEntry] = []
        self.impersonations: dict = {}
        self.members: dict[str, dict[str, MemberDoc]] = {}  # slug → id → member
        self.activity: dict[str, list[ActivityDoc]] = {}
        self.hits: dict[str, int] = {}
        # Seconds the fake clock is moved on, for rate-limit windows.
        self.clock_offset = 0.0

    def get_user(self, uid):
        return copy.deepcopy(self.users.get(uid))

    def get_users(self, uids):
        return {u: copy.deepcopy(self.users[u]) for u in uids if u in self.users}

    def users_in_org(self, slug, roles):
        return [u.uid for u in self.users.values() if any(m.orgSlug == slug and m.role in roles for m in u.memberships)]

    def set_last_active(self, uid, at):
        if uid in self.users:
            self.users[uid].lastActiveAt = at

    def get_member(self, slug, member_id):
        return copy.deepcopy(self.members.get(slug, {}).get(member_id))

    def list_members(self, slug):
        return [copy.deepcopy(m) for m in self.members.get(slug, {}).values()]

    def save_member(self, slug, member):
        self.members.setdefault(slug, {})[member.id] = copy.deepcopy(member)

    def list_activity(self, slug, limit, after_id=None, area=None, actor_id=None, include_owner_only=False):
        rows = sorted(self.activity.get(slug, []), key=lambda e: (e.at, e.id), reverse=True)
        rows = [e for e in rows if (include_owner_only or not e.ownerOnly) and (not area or e.area == area) and (not actor_id or e.actorId == actor_id)]
        if after_id:
            ids = [e.id for e in rows]
            if after_id not in ids:
                return []
            rows = rows[ids.index(after_id) + 1 :]
        return copy.deepcopy(rows[:limit])

    def add_activity(self, slug, entry):
        entry = copy.deepcopy(entry)
        entry.id = entry.id or new_id("act")
        log = self.activity.setdefault(slug, [])
        # Strictly increasing, as with the audit log.
        if log and entry.at <= max(e.at for e in log):
            entry.at = max(e.at for e in log) + timedelta(microseconds=1)
        log.append(entry)

    def transact(self, fn):
        tx = MemoryTx(self)
        result = fn(tx)
        tx.commit()
        return result

    def hit(self, key, limit, window_seconds):
        start, left = window_of(now() + timedelta(seconds=self.clock_offset), window_seconds)
        k = f"{key}|{start}"
        self.hits[k] = self.hits.get(k, 0) + 1
        return left if self.hits[k] > limit else None

    def save_user(self, user):
        self.users[user.uid] = copy.deepcopy(user)

    def get_org(self, slug):
        return copy.deepcopy(self.orgs.get(slug))

    def create_org(self, org):
        if org.slug in self.orgs:
            raise SlugTaken()
        self.orgs[org.slug] = copy.deepcopy(org)

    def save_org(self, org):
        self.orgs[org.slug] = copy.deepcopy(org)

    def list_orgs(self):
        return [copy.deepcopy(o) for o in self.orgs.values()]

    def get_invite(self, h):
        return copy.deepcopy(self.invites.get(h))

    def save_invite(self, h, inv):
        self.invites[h] = copy.deepcopy(inv)

    def get_attempts(self, key):
        return self.attempts.get(key, (0, None))

    def set_attempts(self, key, count, until):
        self.attempts[key] = (count, until)

    def clear_attempts(self, key):
        self.attempts.pop(key, None)

    def audit(self, actor, action, target, detail=""):
        self.audits.append((actor, action, target, detail))
        # Strictly increasing, so paging by time never skips a tie.
        at = now()
        if self.audit_log and at <= self.audit_log[-1].at:
            at = self.audit_log[-1].at + timedelta(microseconds=1)
        self.audit_log.append(AuditEntry(at, actor, action, target, detail))

    def list_users(self):
        return [copy.deepcopy(u) for u in self.users.values()]

    def list_audit(self, limit, before=None, field=None, value=None):
        rows = sorted(self.audit_log, key=lambda e: e.at, reverse=True)
        if field:
            rows = [e for e in rows if getattr(e, field) == value]
        if before:
            rows = [e for e in rows if e.at < before]
        return copy.deepcopy(rows[:limit])

    def get_impersonation(self, key):
        return copy.deepcopy(self.impersonations.get(key))

    def save_impersonation(self, key, doc):
        self.impersonations[key] = copy.deepcopy(doc)


class MemoryTx:
    """Reads see the store; writes wait for commit, and a function that
    raises leaves the store as it was, as in a Firestore transaction. Reads
    after a write are refused, as Firestore refuses them."""

    def __init__(self, store: "MemoryStore"):
        self.s = store
        self.writes: list = []

    def _read(self):
        if self.writes:
            raise AssertionError("Firestore transactions must read before they write")

    def get_org(self, slug):
        self._read()
        return self.s.get_org(slug)

    def get_user(self, uid):
        self._read()
        return self.s.get_user(uid)

    def get_invite(self, h):
        self._read()
        return self.s.get_invite(h)

    def get_member(self, slug, member_id):
        self._read()
        return self.s.get_member(slug, member_id)

    def list_members(self, slug):
        self._read()
        return self.s.list_members(slug)

    def save_org(self, org):
        self.writes.append(lambda o=copy.deepcopy(org): self.s.save_org(o))

    def update_org(self, slug, fields):
        def apply(f=copy.deepcopy(fields)):
            for k, v in f.items():
                setattr(self.s.orgs[slug], k, v)

        self.writes.append(apply)

    def save_user(self, user):
        self.writes.append(lambda u=copy.deepcopy(user): self.s.save_user(u))

    def save_invite(self, h, inv):
        self.writes.append(lambda i=copy.deepcopy(inv): self.s.save_invite(h, i))

    def save_member(self, slug, member):
        self.writes.append(lambda m=copy.deepcopy(member): self.s.save_member(slug, m))

    def delete_member(self, slug, member_id):
        self.writes.append(lambda: self.s.members.get(slug, {}).pop(member_id, None))

    def add_activity(self, slug, entry):
        self.writes.append(lambda e=copy.deepcopy(entry): self.s.add_activity(slug, e))

    def commit(self):
        for w in self.writes:
            w()


@dataclass
class FakeMailer:
    sent: list[tuple[str, str, str]] = field(default_factory=list)  # (kind, to, url)

    def _rec(self, kind, to, url):
        self.sent.append((kind, to, url))
        return True

    def verify_email(self, to, name, url):
        return self._rec("verify", to, url)

    def reset_password(self, to, url):
        return self._rec("reset", to, url)

    def set_password(self, to, url):
        return self._rec("set-password", to, url)

    def invite(self, to, org_name, invited_by, url):
        return self._rec("invite", to, url)

    def signup_decided(self, to, org_name, approved, reason, url):
        return self._rec("approved" if approved else "declined", to, url)

    def master_admin_added(self, to, who, by, invited, url):
        return self._rec("master-alert", ",".join(to), url)

    leads: list[tuple[list[str], dict]] = field(default_factory=list)
    fail_leads: bool = False

    def demo_request(self, to, lead):
        if self.fail_leads:
            return False
        self.leads.append((to, lead))
        return True

    def last(self, kind):
        return next(u for k, _, u in reversed(self.sent) if k == kind)


class FakeGoogle:
    """The code is a key into `users`, standing in for Google's verified ID token."""

    redirect_uri = "http://localhost:5173/api/auth/google/callback"

    def __init__(self, users: dict):
        self.users = users

    def authorize_url(self, state, challenge):
        return f"https://accounts.google.com/o/oauth2/v2/auth?state={state}&code_challenge={challenge}"

    def exchange_code(self, code, verifier):
        if not verifier or code not in self.users:
            raise ApiError(400, "invalid_input", "Google sign-in didn't complete. Try again.")
        g = self.users[code]
        return {"email": g["email"].lower(), "email_verified": True, "name": g["name"], "sub": code}


def make_services(**overrides) -> tuple[Services, FakeFirebase, MemoryStore, FakeMailer]:
    fb, store, mailer = FakeFirebase(), MemoryStore(), FakeMailer()
    settings = Settings(_env_file=None, app_url="http://localhost:5173", allowed_origins="http://localhost:5173", firebase_web_api_key="x", **overrides)
    svc = Services(settings=settings, admin=fb, identity=fb, store=store, mailer=mailer, google=FakeGoogle(fb.google_users))
    return svc, fb, store, mailer
