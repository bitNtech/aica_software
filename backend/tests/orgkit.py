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


def seed_ops(store, people, slug=SLUG):
    """One of each Phase 2/3 record, with fixed ids. The call was handled by
    front desk; the request was made by the owner."""
    from datetime import timedelta

    from app.redact import search_tokens
    from app.store import AppointmentDoc, CallbackDoc, CallDoc, ChangeRequestDoc, HandoffDoc, now

    t = now()
    fd_uid = people["front_desk"][0]
    store.save_record(slug, "request", ChangeRequestDoc(
        id="cr_1", kind="other", title="Add Saturday hours", detail="Please add our Saturday OPD hours.", urgency="normal",
        status="open", createdAt=t, createdBy="Owner", createdById=people["owner"][0], updatedAt=t,
    ))
    store.save_record(slug, "call", CallDoc(
        id="call_1", agentId="ag_1", agentName="Main reception", line="+91 422 400 1000", callerPhone="9840243210",
        startedAt=t - timedelta(minutes=30), durationSec=184, language="tamil", intent="Book OPD visit", outcome="handed_over",
        callerName="Lakshmi K", handledBy="Front Desk", handledById=fd_uid,
        summary="Lakshmi K wants an OPD visit on Friday.", details=[{"label": "Patient name", "value": "Lakshmi K", "personal": True}, {"label": "Department", "value": "OPD", "personal": False}],
        transcript=[{"speaker": "caller", "at": 1, "text": "I am {{name:Lakshmi K}}, my number is {{phone:98402 43210}}"}],
        analysis={"sentiment": "neutral", "success": True, "successReason": "Booked", "fields": [{"label": "Patient name", "value": "Lakshmi K"}]},
        searchTokens=search_tokens("9840243210", "Book OPD visit", "Main reception", "Lakshmi K"),
    ))
    store.save_record(slug, "callback", CallbackDoc(id="cb_1", callerPhone="9840211111", reason="Wants test results", requestedAt=t, dueBy=t + timedelta(hours=2), callerName="Ravi"))
    store.save_record(slug, "appointment", AppointmentDoc(
        id="apt_1", patientName="Meena R", phone="9840222222", department="Cardiology", doctor="Dr. Arvind", date=t.date().isoformat(), time="10:30",
        status="needs_check", bookedBy="agent", createdAt=t, agentName="Main reception", callId="call_1", checkReason="The caller wasn't sure of the date.",
    ))
    store.save_record(slug, "handoff", HandoffDoc(
        id="ho_1", callId="call_1", agentName="Main reception", line="+91 422 400 1000", callerPhone="9840243210", reason="Asked for a person",
        summary="Lakshmi K is asking about her scan report.", language="tamil", waitingSince=t - timedelta(minutes=2),
        details=[{"label": "Patient name", "value": "Lakshmi K", "personal": True}],
    ))
