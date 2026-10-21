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


def sample_spec(**over) -> dict:
    """A valid AgentSpec from the catalogue's defaults."""
    from app import catalogue as c

    spec = {
        "typeId": "hospital", "subTypeId": "appointments", "redact": True, "behaviour": c.default_behaviour("Arogya"), "speech": c.default_speech(),
        "flow": [{"id": "n1", "kind": "intent", "label": "Book a visit", "sourceCallIds": ["up_1"], "children": [{"id": "n2", "kind": "step", "label": "Ask the date", "say": "Which day?", "sourceCallIds": [], "children": []}]}],
        "attributes": [{"id": "a1", "label": "Patient name", "type": "name", "required": True, "personal": True, "confirm": True, "ask": "May I have the patient's name?"}],
        "globalFlows": [{"kind": "handoff", "enabled": True, "trigger": "Caller asks for a person", "response": "Let me put you through."}],
        "context": {**c.default_context(), "knowledgeSourceIds": ["kn_1"], "toolIds": ["tool_1"]},
        "guardrails": c.default_guardrails(), "pipeline": c.default_pipeline(), "analysis": c.default_analysis("appointments"),
    }
    spec.update(over)
    return spec


def seed_library(svc, store, slug=SLUG):
    """One of each Phase 5/6 record, with fixed ids: agent agt_1 (version 1)
    answers num_1; num_2 is free; tool_1 sends secret HIS_KEY; OTHER_KEY is
    unused; kn_1 (ready FAQ) is used by agt_1, kn_2 (web) isn't, kn_3 is a
    document waiting for its upload; up_1 is uploaded, up_2 waiting;
    draft_1 is being built; scn_1 tests agt_1."""
    from app.store import (AgentDoc, CredentialDoc, DraftDoc, KnowledgeDoc, NumberDoc, ScenarioDoc, ToolDoc, UploadDoc, VersionDoc, now)
    from app import catalogue as c

    t = now()
    spec = sample_spec()
    store.save_record(slug, "agent", AgentDoc(id="agt_1", name="Main reception", useCase="Appointments", status="live", working=spec, updatedAt=t, languages=["tamil", "english", "tanglish"], numberId="num_1", version=1, lastPublishedAt=t))
    store.save_record(slug, "version", VersionDoc(id="agt_1_000001", agentId="agt_1", version=1, publishedAt=t, publishedBy="Support (bitNtech)", note="First version.", spec=spec))
    store.save_record(slug, "number", NumberDoc(id="num_1", number="+91 422 400 1000", label="Main reception", hours="8 AM to 8 PM", agentId="agt_1"))
    store.save_record(slug, "number", NumberDoc(id="num_2", number="+91 422 400 2000", label="Lab", hours="8 AM to 8 PM"))
    for name in ("HIS_KEY", "OTHER_KEY"):
        ct, kid = svc.secrets.seal(slug, name, f"value-of-{name}")
        store.save_record(slug, "credential", CredentialDoc(id=name, ciphertext=ct, keyId=kid, setAt=t, setBy="Owner"))
    store.save_record(slug, "tool", ToolDoc(id="tool_1", name="Book an appointment", kind="http", description="Books a slot in the hospital system.", acts=True, enabled=True,
                                            params=[{"name": "patient_id", "type": "string", "required": True, "description": "The patient's ID."}], method="POST",
                                            url="https://his.example.in/api/book", credentialName="HIS_KEY", timeoutMs=5000, retries=0))
    store.save_record(slug, "knowledge", KnowledgeDoc(id="kn_1", name="OPD timings", kind="faq", origin="1 questions", description="When the OPD is open.", status="ready", passages=1, refreshedAt=t, faq=[{"q": "When is OPD open?", "a": "8 AM to 8 PM."}]))
    store.save_record(slug, "knowledge", KnowledgeDoc(id="kn_2", name="Price list", kind="web", origin="https://arogya.example.in/prices", description="Prices.", status="indexing", passages=0, refreshedAt=t, url="https://arogya.example.in/prices"))
    store.save_record(slug, "knowledge", KnowledgeDoc(id="kn_3", name="Doctor list", kind="document", origin="doctors.pdf", description="", status="indexing", passages=0, refreshedAt=t, fileName="doctors.pdf", size=1000, contentType="application/pdf", objectPath=f"orgs/{slug}/knowledge/kn_3.pdf"))
    svc.blobs.put(f"orgs/{slug}/knowledge/kn_3.pdf", 1000)
    store.save_record(slug, "upload", UploadDoc(id="up_1", name="call-1.mp3", size=2000, contentType="audio/mpeg", objectPath=f"orgs/{slug}/uploads/up_1.mp3", addedAt=t, uploaded=True))
    store.save_record(slug, "upload", UploadDoc(id="up_2", name="call-2.mp3", size=3000, contentType="audio/mpeg", objectPath=f"orgs/{slug}/uploads/up_2.mp3", addedAt=t))
    svc.blobs.put(f"orgs/{slug}/uploads/up_2.mp3", 3000)
    draft = {"reached": "type", "sourceCallIds": ["up_1"], "consent": True, "redact": True, "typeId": None, "subTypeId": None, "name": "Lab reports",
             "behaviour": c.default_behaviour("Arogya"), "flow": [], "attributes": [], "globalFlows": [], "context": c.default_context(), "pipeline": c.default_pipeline()}
    store.save_record(slug, "draft", DraftDoc(id="draft_1", data=draft, updatedAt=t, createdBy="Support (bitNtech)"))
    store.save_record(slug, "scenario", ScenarioDoc(id="scn_1", agentId="agt_1", name="Books a first visit", callerSays=["I want to see a doctor"], expect={"intent": "", "mustSay": [], "handover": None}))
