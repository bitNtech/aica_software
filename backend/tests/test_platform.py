"""Foundations: the permission table, the shared rate limiter, structured
logs that carry no personal data, and the member backfill."""
from __future__ import annotations

import json
import logging

from fastapi.testclient import TestClient

from app.access import permissions as access
from app.core.logs import JsonFormatter
from app.main import create_app
from app.scripts.backfill_members import backfill
from app.data.store import Membership, UserDoc

from .fakes import make_services
from .orgkit import PW, SLUG, api, env, login, make_org, post, seed, token_of  # noqa: F401


def _settings(**kw):
    from app.core.config import Settings

    return Settings(_env_file=None, app_url="https://aica.example", firebase_web_api_key="x", **kw)


# ---------------------------------------------------------------- permission table


def test_permission_table_is_consistent():
    assert access.ROLES == ("owner", "admin", "supervisor", "front_desk", "viewer")
    assert len(access.ALL_PERMISSIONS) == len(set(access.ALL_PERMISSIONS)) == 22
    for p in access.ALL_PERMISSIONS:
        for role in access.default_permissions.__globals__["_DEFAULTS"][p]:
            # Every default can be held by its role.
            assert access.can_grant(role, p), (p, role)
    assert set(access.PLATFORM_STAFF) <= set(access.ALL_PERMISSIONS)
    # Viewers only ever look.
    assert not {"team.manage", "settings.manage", "calls.take", "agents.configure"} & set(access.permissions_for("viewer", list(access.ALL_PERMISSIONS)))


def test_permissions_for_matches_the_frontend_rules():
    assert access.permissions_for("viewer") == ["agents.view", "calls.viewAll", "reports.view"]
    assert access.permissions_for("front_desk", ["calls.take", "team.manage"]) == ["calls.take"]
    assert access.stored_permissions("viewer", access.default_permissions("viewer")) is None
    assert access.stored_permissions("viewer", None) is None
    assert access.platform_access("staff").perms == frozenset(access.PLATFORM_STAFF)
    assert access.platform_access("master_admin").perms == frozenset(access.ALL_PERMISSIONS)


# ---------------------------------------------------------------- rate limits


def test_signed_in_limits_count_per_person(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    for i in range(20):
        assert post(client, api("/members/invite"), {"email": f"p{i}@arogya.in", "role": "viewer"}).status_code == 200
    r = post(client, api("/members/invite"), {"email": "p21@arogya.in", "role": "viewer"})
    assert r.status_code == 429 and r.json()["error"]["retryAfter"] >= 1 and r.headers["Retry-After"]
    # Someone else at the same address isn't held up.
    login(client, people["admin"][1])
    assert post(client, api("/members/invite"), {"email": "p22@arogya.in", "role": "viewer"}).status_code == 200


def test_limits_reset_with_the_window(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    for i in range(20):
        post(client, api("/members/invite"), {"email": f"p{i}@arogya.in", "role": "viewer"})
    assert post(client, api("/members/invite"), {"email": "late@arogya.in", "role": "viewer"}).status_code == 429
    store.clock_offset = 61
    assert post(client, api("/members/invite"), {"email": "late@arogya.in", "role": "viewer"}).status_code == 200


def test_the_limiter_fails_open(env, caplog):
    client, fb, store, _ = env
    people = seed(fb, store)

    def broken(*_):
        raise RuntimeError("firestore down")

    store.hit = broken
    with caplog.at_level(logging.WARNING, logger="aica.ratelimit"):
        login(client, people["owner"][1])
    assert "rate limiter unavailable" in caplog.text


def test_client_ip_is_trusted_from_vercel_only():
    from types import SimpleNamespace

    from app.core.ratelimit import client_ip

    req = SimpleNamespace(headers={"x-real-ip": "203.0.113.9"}, client=SimpleNamespace(host="10.0.0.1"))
    local = SimpleNamespace(settings=_settings())
    on_vercel = SimpleNamespace(settings=_settings(vercel_url="api.example.vercel.app"))
    assert client_ip(req, local) == "10.0.0.1"
    assert client_ip(req, on_vercel) == "203.0.113.9"


# ---------------------------------------------------------------- logs


def test_request_logs_carry_ids_and_no_personal_data(caplog):
    from app.core.logs import configure

    configure("json")
    svc, fb, store, mailer = make_services()
    people = seed(fb, store)
    with TestClient(create_app(svc.settings, svc), base_url="http://localhost:5173") as client, caplog.at_level(logging.INFO):
        login(client, people["owner"][1])
        r = post(client, api("/members/invite"), {"email": "secret.person@arogya.in", "role": "viewer"})
        assert r.headers["X-Request-Id"]
        token = token_of(mailer.last("invite"))
        client.cookies.clear()
        client.get(f"/api/invites/{token}")
        post(client, f"/api/invites/{token}/accept", {"name": "Dr. Hidden Name", "password": PW})
    lines = [JsonFormatter().format(rec) for rec in caplog.records]
    text = "\n".join(lines)
    for secret in ("secret.person", "owner@arogya.in", "Dr. Hidden Name", token, PW, "sess|"):
        assert secret not in text, secret
    requests = [json.loads(line) for line in lines if json.loads(line)["msg"] == "request"]
    routes = {(x["method"], x["route"]) for x in requests}
    assert ("POST", "/api/orgs/{slug}/members/invite") in routes and ("GET", "/api/invites/{token}") in routes
    invite_line = next(x for x in requests if x["route"] == "/api/orgs/{slug}/members/invite")
    assert invite_line["org"] == SLUG and invite_line["uid"] == people["owner"][0] and invite_line["status"] == 200 and invite_line["request_id"]


def test_json_log_lines_are_single_json_objects():
    rec = logging.LogRecord("aica", logging.ERROR, __file__, 1, "boom %s", ("x",), None)
    rec.route = "/api/x"
    out = json.loads(JsonFormatter().format(rec))
    assert out["msg"] == "boom x" and out["route"] == "/api/x" and out["level"] == "ERROR"


def test_vercel_defaults_to_json_logs():
    assert _settings(vercel_url="api.example.vercel.app").log_format == "json"
    assert _settings().log_format == "text"
    assert _settings(vercel_url="api.example.vercel.app", log_format="text").log_format == "text"


def test_httpx_request_urls_are_not_logged():
    """The Identity Toolkit's URLs carry the web API key."""
    from app.core.logs import configure

    configure("text")
    assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)


# ---------------------------------------------------------------- backfill


def test_backfill_lists_then_creates_missing_member_records():
    svc, fb, store, _ = make_services()
    make_org(store)
    uid = fb.add("old@arogya.in", PW)
    store.save_user(UserDoc(uid=uid, name="Old", email="old@arogya.in", memberships=[Membership(SLUG, "admin"), Membership("gone", "owner")]))
    assert backfill(svc, apply=False) == [(SLUG, uid)]
    assert store.get_member(SLUG, uid) is None
    assert backfill(svc, apply=True) == [(SLUG, uid)]
    assert store.get_member(SLUG, uid).role == "admin"
    assert backfill(svc, apply=True) == []


def test_signup_writes_the_owner_member_record(env):
    client, fb, store, _ = env
    r = post(client, "/api/auth/signup", {
        "name": "Dr. Lakshmi K", "email": "owner@clinic.in", "phone": "+91 98400 12345", "password": PW,
        "business": {"name": "Lakshmi Skin Clinic", "type": "clinic", "city": "Chennai", "languages": ["tamil"]}, "acceptedTerms": True,
    })
    assert r.status_code == 200, r.text
    uid = fb.by_email("owner@clinic.in").user.uid
    assert store.get_member("lakshmi-skin-clinic", uid).role == "owner"
    assert store.get_user(uid).memberships == [Membership("lakshmi-skin-clinic", "owner")]


def test_seed_operations_writes_marked_records_only_when_asked():
    from app.scripts.seed_operations import seed as seed_ops_script

    from .orgkit import seed as seed_people

    svc, fb, store, _ = make_services()
    seed_people(fb, store)
    dry = seed_ops_script(svc, SLUG, calls=40, write=False)
    assert dry["calls"] == 40 and not store.all_records(SLUG, "call")
    seed_ops_script(svc, SLUG, calls=40, write=True)
    calls = store.all_records(SLUG, "call")
    assert len(calls) == 40 and all(c.seeded for c in calls)
    assert all(r.seeded for k in ("handoff", "callback", "appointment") for r in store.all_records(SLUG, k))
