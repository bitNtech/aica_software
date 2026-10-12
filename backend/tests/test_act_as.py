from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient

from app.sessions import ACT_COOKIE
from app.store import now

from .test_api import PW, env, login, post, seed_master, seed_org  # noqa: F401 — env is a fixture
from .test_people import add_staff, as_master

WHY = "Owner reported the dashboard is blank."


def start(client, uid, reason=WHY):
    return post(client, f"/api/ops/people/{uid}/act-as", {"reason": reason})


def test_master_acts_as_a_client_and_comes_back(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    me = as_master(client, fb, store)

    r = start(client, owner)
    assert r.status_code == 200, r.text
    assert ACT_COOKIE in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]
    body = r.json()
    assert body["user"]["email"] == "owner@arogya.in" and body["user"]["platformRole"] is None
    assert body["impersonator"]["email"] == "support@bitntech.in"
    assert body["impersonator"]["reason"] == WHY

    s = client.get("/api/auth/session").json()
    assert s["user"]["id"] == owner and s["impersonator"]["name"] == "Support"
    assert s["user"]["memberships"][0]["orgSlug"] == "arogya"

    # Ops is closed while acting, and so is creating a business.
    r = client.get("/api/ops/orgs")
    assert r.status_code == 403 and "acting as someone" in r.json()["error"]["message"]
    assert start(client, owner).status_code == 403
    r = post(client, "/api/auth/business", {"name": "Another Clinic", "type": "clinic", "city": "Chennai", "languages": ["tamil"]})
    assert r.status_code == 403

    r = post(client, "/api/auth/act-as/end")
    assert r.status_code == 200
    assert r.json()["user"]["platformRole"] == "master_admin" and r.json()["impersonator"] is None
    s = client.get("/api/auth/session").json()
    assert s["user"]["id"] == me and s["impersonator"] is None
    assert client.get("/api/ops/orgs").status_code == 200

    actions = [(a, t, d) for actor, a, t, d in store.audits if actor == me and a.startswith("act_as")]
    assert actions == [("act_as_started", owner, WHY), ("act_as_ended", owner, "")]
    rec = next(iter(store.impersonations.values()))
    assert rec.endedAt is not None and rec.actorUid == me


def test_who_can_be_acted_as(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    staff = add_staff(fb, store)
    other_master = add_staff(fb, store, "admin@bitntech.in", role="master_admin")
    me = as_master(client, fb, store)

    assert start(client, staff).status_code == 409
    assert start(client, other_master).status_code == 409
    assert start(client, me).status_code == 409
    assert start(client, owner, reason="short").status_code == 422
    assert start(client, "nobody").status_code == 404
    fb.accounts[owner].user.disabled = True
    assert start(client, owner).status_code == 409


def test_staff_cannot_act_as(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    add_staff(fb, store)
    login(client, "ops@bitntech.in")
    assert start(client, owner).status_code == 403


def test_acting_expires(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    me = as_master(client, fb, store)
    assert start(client, owner).status_code == 200
    key, rec = next(iter(store.impersonations.items()))
    rec.expiresAt = now() - timedelta(seconds=1)
    store.impersonations[key] = rec
    s = client.get("/api/auth/session").json()
    assert s["user"]["id"] == me and s["impersonator"] is None


def test_acting_stops_when_the_target_changes(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    me = as_master(client, fb, store)
    assert start(client, owner).status_code == 200
    fb.accounts[owner].user.disabled = True
    assert client.get("/api/auth/session").json()["user"]["id"] == me
    fb.accounts[owner].user.disabled = False
    fb.accounts[owner].user.claims = {"platform_role": "staff"}
    assert client.get("/api/auth/session").json()["user"]["id"] == me


def test_acting_stops_when_the_master_is_signed_out(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    me = as_master(client, fb, store)
    assert start(client, owner).status_code == 200
    fb.revoke_sessions(me)
    assert client.get("/api/auth/session").status_code == 401


def test_cookie_only_works_for_the_master_who_started_it(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    as_master(client, fb, store)
    assert start(client, owner).status_code == 200
    token = client.cookies.get(ACT_COOKIE)

    # Another master admin's browser with the same cookie.
    seed_master(fb, store, "admin@bitntech.in")
    other = TestClient(client.app, base_url="http://localhost:5173")
    login(other, "admin@bitntech.in")
    other.cookies.set(ACT_COOKIE, token)
    assert other.get("/api/auth/session").json()["user"]["email"] == "admin@bitntech.in"

    # A client's browser with it.
    third = TestClient(client.app, base_url="http://localhost:5173")
    login(third, "owner@arogya.in")
    third.cookies.set(ACT_COOKIE, token)
    s = third.get("/api/auth/session").json()
    assert s["user"]["id"] == owner and s["impersonator"] is None


def test_sign_out_ends_acting(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    me = as_master(client, fb, store)
    assert start(client, owner).status_code == 200
    r = post(client, "/api/auth/logout")
    assert r.status_code == 204
    assert ACT_COOKIE in r.headers.get("set-cookie", "")
    assert next(iter(store.impersonations.values())).endedAt is not None
    assert ("act_as_ended" in [a for actor, a, *_ in store.audits if actor == me])


def test_signing_in_again_drops_the_acting_cookie(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    as_master(client, fb, store)
    assert start(client, owner).status_code == 200
    r = login(client, "support@bitntech.in")
    assert r.status_code == 200
    assert f'{ACT_COOKIE}=""' in r.headers["set-cookie"] or f"{ACT_COOKIE}=;" in r.headers["set-cookie"]
    assert r.json()["impersonator"] is None


def test_end_without_session(env):
    client, *_ = env
    assert post(client, "/api/auth/act-as/end").status_code == 401
