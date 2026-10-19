"""Shared set-up for the organisation route tests."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.store import MemberDoc, Membership, OrgDoc, UserDoc

from .fakes import make_services

ORIGIN = {"Origin": "http://localhost:5173"}
PW = "river-lamp-2026-blue"
SLUG = "arogya"


@pytest.fixture()
def env():
    svc, fb, store, mailer = make_services()
    client = TestClient(create_app(svc.settings, svc), base_url="http://localhost:5173")
    with client:
        yield client, fb, store, mailer


def post(client, path, json=None):
    return client.post(path, json=json, headers=ORIGIN)


def login(client, email, password=PW):
    client.cookies.clear()
    r = post(client, "/api/auth/login", {"email": email, "password": password, "remember": False})
    assert r.status_code == 200, r.text
    return r


def make_org(store, slug=SLUG, status="active", owner_uid="nobody"):
    store.save_org(OrgDoc(slug=slug, name=slug.title(), city="Coimbatore", type="hospital", languages=["tamil"], status=status, ownerUid=owner_uid))


def add_member(fb, store, role, *, slug=SLUG, email=None, name=None, permissions=None, disabled=False) -> str:
    """A person who has joined `slug` with `role`."""
    email = email or f"{role}-{len(fb.accounts)}@{slug}.in"
    name = name or role.replace("_", " ").title()
    uid = fb.add(email, PW, name=name, disabled=disabled)
    user = store.get_user(uid) or UserDoc(uid=uid, name=name, email=email)
    user.memberships.append(Membership(slug, role))
    store.save_user(user)
    store.save_member(slug, MemberDoc(id=uid, uid=uid, email=email, name=name, role=role, permissions=permissions))
    return uid


def seed(fb, store, status="active"):
    """An organisation with an owner, an admin and one of each other role.
    Returns {role: (uid, email)}."""
    out = {}
    for role in ("owner", "admin", "supervisor", "front_desk", "viewer"):
        email = f"{role}@{SLUG}.in"
        out[role] = (add_member(fb, store, role, email=email), email)
    make_org(store, status=status, owner_uid=out["owner"][0])
    return out


def master(fb, store, email="support@bitntech.in") -> str:
    uid = fb.add(email, PW, claims={"platform_role": "master_admin"}, name="Support")
    store.save_user(UserDoc(uid=uid, name="Support", email=email, platformRole="master_admin"))
    return uid


def staff(fb, store, email="staff@bitntech.in") -> str:
    uid = fb.add(email, PW, claims={"platform_role": "staff"}, name="Staffer")
    store.save_user(UserDoc(uid=uid, name="Staffer", email=email, platformRole="staff"))
    return uid


def api(path: str) -> str:
    return f"/api/orgs/{SLUG}{path}"


def token_of(url: str) -> str:
    return url.rsplit("/", 1)[1]


def err(r) -> tuple[int, str, str]:
    e = r.json().get("error", {})
    return r.status_code, e.get("code", ""), e.get("message", "")
