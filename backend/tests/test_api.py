from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import ratelimit
from app.main import create_app
from app.sessions import COOKIE
from app.store import OrgDoc, UserDoc

from .fakes import make_services

ORIGIN = {"Origin": "http://localhost:5173"}
PW = "river-lamp-2026-blue"


@pytest.fixture()
def env():
    ratelimit.reset()
    svc, fb, store, mailer = make_services()
    client = TestClient(create_app(svc.settings, svc), base_url="http://localhost:5173")
    with client:
        yield client, fb, store, mailer


def post(client, path, json=None, **kw):
    return client.post(path, json=json, headers=ORIGIN, **kw)


def signup_body(email="owner@clinic.in", **over):
    body = {
        "name": "Dr. Lakshmi K",
        "email": email,
        "phone": "+91 98400 12345",
        "password": PW,
        "business": {"name": "Lakshmi Skin Clinic", "type": "clinic", "city": "Chennai", "languages": ["tamil"]},
        "acceptedTerms": True,
    }
    body.update(over)
    return body


def seed_master(fb, store, email="support@bitntech.in"):
    uid = fb.add(email, PW, claims={"platform_role": "master_admin"})
    store.save_user(UserDoc(uid=uid, name="Support", email=email, platformRole="master_admin"))
    return uid


def seed_org(fb, store, slug="arogya", status="active", verified=True):
    uid = fb.add(f"owner@{slug}.in", PW, verified=verified)
    store.save_org(OrgDoc(slug=slug, name=slug.title(), city="Coimbatore", type="hospital", languages=["tamil"], status=status, ownerUid=uid))
    store.save_user(UserDoc(uid=uid, name="Owner", email=f"owner@{slug}.in", memberships=[__import__("app.store", fromlist=["Membership"]).Membership(slug, "owner")]))
    return uid


def login(client, email, password=PW, remember=False):
    return post(client, "/api/auth/login", {"email": email, "password": password, "remember": remember})


# ---------------------------------------------------------------- sessions


def test_session_requires_cookie(env):
    client, *_ = env
    r = client.get("/api/auth/session")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


def test_login_sets_httponly_cookie_and_returns_session(env):
    client, fb, store, _ = env
    seed_org(fb, store)
    r = login(client, "owner@arogya.in")
    assert r.status_code == 200, r.text
    set_cookie = r.headers["set-cookie"]
    assert COOKIE in set_cookie and "HttpOnly" in set_cookie and "SameSite=lax" in set_cookie
    assert "Max-Age" not in set_cookie  # browser-session cookie without "keep me signed in"
    body = r.json()
    assert body["user"]["memberships"][0] == {
        "orgSlug": "arogya", "orgName": "Arogya", "city": "Coimbatore", "role": "owner", "orgStatus": "active", "statusReason": None,
    }
    assert client.get("/api/auth/session").json()["user"]["email"] == "owner@arogya.in"


def test_remember_me_sets_persistent_cookie(env):
    client, fb, store, _ = env
    seed_org(fb, store)
    r = login(client, "owner@arogya.in", remember=True)
    assert "Max-Age=1209600" in r.headers["set-cookie"]
    assert r.json()["remember"] is True


def test_logout_clears_cookie(env):
    client, fb, store, _ = env
    seed_org(fb, store)
    login(client, "owner@arogya.in")
    assert post(client, "/api/auth/logout").status_code == 204
    assert client.get("/api/auth/session").status_code == 401


def test_writes_from_other_origins_are_refused(env):
    client, fb, store, _ = env
    seed_org(fb, store)
    r = client.post("/api/auth/login", json={"email": "owner@arogya.in", "password": PW}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    r = client.post("/api/auth/login", json={"email": "owner@arogya.in", "password": PW})  # no Origin at all
    assert r.status_code == 403


def test_wrong_password_is_generic_and_locks_after_five(env):
    client, fb, store, _ = env
    seed_org(fb, store)
    for _ in range(4):
        r = login(client, "owner@arogya.in", "nope")
        assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"
    r = login(client, "owner@arogya.in", "nope")
    assert r.status_code == 429
    assert r.json()["error"]["retryAfter"] == 15 * 60
    # Even the right password waits out the pause.
    assert login(client, "owner@arogya.in").status_code == 429


def test_unknown_email_looks_like_wrong_password(env):
    client, *_ = env
    r = login(client, "nobody@nowhere.in")
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"


def test_unverified_and_disabled_accounts(env):
    client, fb, store, _ = env
    seed_org(fb, store, verified=False)
    assert login(client, "owner@arogya.in").json()["error"]["code"] == "email_unverified"
    fb.add("off@x.in", PW, disabled=True)
    assert login(client, "off@x.in").json()["error"]["code"] == "account_locked"


def test_disabling_a_user_kills_their_session(env):
    client, fb, store, _ = env
    uid = seed_org(fb, store)
    login(client, "owner@arogya.in")
    fb.update_user(uid, disabled=True)
    assert client.get("/api/auth/session").status_code == 401


# ---------------------------------------------------------------- sign-up, verify, reset


def test_signup_creates_pending_org_and_sends_verification(env):
    client, fb, store, mailer = env
    r = post(client, "/api/auth/signup", signup_body())
    assert r.status_code == 200, r.text
    assert r.json() == {"email": "owner@clinic.in"}
    org = store.orgs["lakshmi-skin-clinic"]
    assert org.status == "pending_review"
    assert store.users[org.ownerUid].phone == "9840012345"
    url = mailer.last("verify")
    assert url.startswith("http://localhost:5173/verify/")

    # Can't sign in until verified
    assert login(client, "owner@clinic.in").json()["error"]["code"] == "email_unverified"
    code = url.rsplit("/", 1)[1]
    assert post(client, "/api/auth/verify-email", {"code": code}).json() == {"email": "owner@clinic.in"}
    s = login(client, "owner@clinic.in").json()
    assert s["user"]["memberships"][0]["orgStatus"] == "pending_review"


def test_signup_rules(env):
    client, fb, store, _ = env
    assert post(client, "/api/auth/signup", signup_body(password="short")).status_code == 422
    assert post(client, "/api/auth/signup", signup_body(password="aaaaaaaaaaaaaa")).json()["error"]["code"] == "weak_password"
    assert post(client, "/api/auth/signup", signup_body(phone="12345")).status_code == 422
    assert post(client, "/api/auth/signup", signup_body(acceptedTerms=False)).json()["error"]["code"] == "invalid_input"
    fb.add("taken@x.in", PW)
    assert post(client, "/api/auth/signup", signup_body(email="taken@x.in")).json()["error"]["code"] == "email_taken"


def test_slug_collision_gets_a_suffix(env):
    client, *_ = env
    post(client, "/api/auth/signup", signup_body())
    post(client, "/api/auth/signup", signup_body(email="two@clinic.in"))
    _, _, store, _ = env
    assert {"lakshmi-skin-clinic", "lakshmi-skin-clinic-2"} <= set(store.orgs)


def test_forgot_password_never_reveals_accounts(env):
    client, fb, store, mailer = env
    assert post(client, "/api/auth/password/forgot", {"email": "nobody@x.in"}).status_code == 204
    assert mailer.sent == []
    seed_org(fb, store)
    assert post(client, "/api/auth/password/forgot", {"email": "owner@arogya.in"}).status_code == 204
    assert mailer.last("reset").startswith("http://localhost:5173/reset/")


def test_reset_password_flow_revokes_old_sessions(env):
    client, fb, store, mailer = env
    seed_org(fb, store)
    login(client, "owner@arogya.in")
    post(client, "/api/auth/password/forgot", {"email": "owner@arogya.in"})
    code = mailer.last("reset").rsplit("/", 1)[1]
    assert post(client, "/api/auth/password/verify", {"code": code}).json() == {"email": "owner@arogya.in"}
    assert post(client, "/api/auth/password/reset", {"code": code, "password": "weak"}).json()["error"]["code"] == "weak_password"
    assert post(client, "/api/auth/password/reset", {"code": code, "password": "new-river-lamp-2026"}).status_code == 204
    assert client.get("/api/auth/session").status_code == 401  # old session revoked
    assert login(client, "owner@arogya.in", "new-river-lamp-2026").status_code == 200
    assert post(client, "/api/auth/password/verify", {"code": code}).json()["error"]["code"] == "invalid_token"


# ---------------------------------------------------------------- ops


def test_ops_requires_bitntech_account(env):
    client, fb, store, _ = env
    seed_org(fb, store)
    assert client.get("/api/ops/orgs").status_code == 401
    login(client, "owner@arogya.in")
    assert client.get("/api/ops/orgs").json()["error"]["code"] == "forbidden"


def test_master_admin_reviews_and_suspends(env):
    client, fb, store, mailer = env
    seed_master(fb, store)
    seed_org(fb, store, "kaveri", status="pending_review")
    seed_org(fb, store, "thendral", status="pending_review", verified=False)
    login(client, "support@bitntech.in")

    reqs = client.get("/api/ops/signup-requests").json()
    assert [r["orgSlug"] for r in reqs] == ["kaveri", "thendral"]
    assert reqs[1]["owner"]["emailVerified"] is False

    r = post(client, "/api/ops/signup-requests/thendral/approve")
    assert r.status_code == 409 and "verified" in r.json()["error"]["message"]
    assert post(client, "/api/ops/signup-requests/kaveri/approve").status_code == 204
    assert store.orgs["kaveri"].status == "active"
    assert mailer.sent[-1][0] == "approved"
    assert post(client, "/api/ops/signup-requests/kaveri/approve").status_code == 409

    assert post(client, "/api/ops/signup-requests/thendral/decline", {"reason": "short"}).status_code == 422
    assert post(client, "/api/ops/signup-requests/thendral/decline", {"reason": "We can't serve Salem yet, sorry."}).status_code == 204
    assert store.orgs["thendral"].statusReason == "We can't serve Salem yet, sorry."

    assert post(client, "/api/ops/orgs/kaveri/suspend", {"reason": "Invoice 30 days overdue."}).status_code == 204
    assert store.orgs["kaveri"].status == "suspended"
    assert post(client, "/api/ops/orgs/kaveri/restore").status_code == 204
    actions = [a[1] for a in store.audits]
    assert {"signup_approved", "signup_declined", "org_suspended", "org_restored"} <= set(actions)


def test_staff_can_review_but_not_suspend(env):
    client, fb, store, _ = env
    uid = fb.add("ops@bitntech.in", PW, claims={"platform_role": "staff"})
    store.save_user(UserDoc(uid=uid, name="Ops", email="ops@bitntech.in", platformRole="staff"))
    seed_org(fb, store, "kaveri")
    login(client, "ops@bitntech.in")
    assert client.get("/api/ops/orgs").status_code == 200
    r = post(client, "/api/ops/orgs/kaveri/suspend", {"reason": "Invoice 30 days overdue."})
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    assert post(client, "/api/ops/staff-invites", {"email": "x@bitntech.in"}).status_code == 403


# ---------------------------------------------------------------- invites


def test_staff_invite_round_trip(env):
    client, fb, store, mailer = env
    seed_master(fb, store)
    login(client, "support@bitntech.in")
    assert post(client, "/api/ops/staff-invites", {"email": "new@bitntech.in"}).status_code == 204
    token = mailer.last("invite").rsplit("/", 1)[1]
    assert token not in store.invites  # stored hashed
    post(client, "/api/auth/logout")

    inv = client.get(f"/api/invites/{token}").json()
    assert inv["role"] == "staff" and inv["orgName"] == "BitNTech"
    r = post(client, f"/api/invites/{token}/accept", {"name": "Arun T", "password": PW})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["platformRole"] == "staff"
    assert client.get("/api/auth/session").json()["user"]["platformRole"] == "staff"
    assert client.get(f"/api/invites/{token}").json()["error"]["code"] == "used_token"


def test_unknown_invite(env):
    client, *_ = env
    assert client.get("/api/invites/nope").json()["error"]["code"] == "invalid_token"


# ---------------------------------------------------------------- google


def test_google_flow_new_user_then_business(env):
    client, fb, store, _ = env
    fb.google_users["gtok"] = {"email": "doc@gmail.com", "name": "Dr. Priya"}
    r = client.get("/api/auth/google/start", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("https://accounts.google.com/")
    state = r.headers["location"].split("state=")[1].split("&")[0]

    r = client.get(f"/api/auth/google/callback?state={state}&code=gtok", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "http://localhost:5173/login"
    s = client.get("/api/auth/session").json()
    assert s["user"]["email"] == "doc@gmail.com" and s["user"]["memberships"] == []

    r = post(client, "/api/auth/business", {"name": "Priya Dental", "type": "clinic", "city": "Madurai", "languages": ["tamil", "english"]})
    assert r.status_code == 200
    assert r.json()["user"]["memberships"][0]["orgStatus"] == "pending_review"
    assert post(client, "/api/auth/business", {"name": "Second", "type": "clinic", "city": "Madurai", "languages": ["tamil"]}).status_code == 422


def test_google_callback_rejects_bad_state(env):
    client, fb, *_ = env
    fb.google_users["gtok"] = {"email": "doc@gmail.com", "name": "Dr. Priya"}
    client.get("/api/auth/google/start", follow_redirects=False)
    r = client.get("/api/auth/google/callback?state=forged&code=gtok", follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=google_failed")
    assert client.get("/api/auth/session").status_code == 401


def test_google_cancel(env):
    client, *_ = env
    r = client.get("/api/auth/google/callback?error=access_denied", follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=google_cancelled")


def _google_login(client, code="gtok"):
    r = client.get("/api/auth/google/start", follow_redirects=False)
    state = r.headers["location"].split("state=")[1].split("&")[0]
    return client.get(f"/api/auth/google/callback?state={state}&code={code}", follow_redirects=False)


def test_google_signs_into_existing_master_admin_with_role(env):
    client, fb, store, _ = env
    seed_master(fb, store, "support@bitntech.in")
    fb.google_users["gtok"] = {"email": "Support@BitNTech.in", "name": "Support"}
    assert _google_login(client).headers["location"] == "http://localhost:5173/login"
    s = client.get("/api/auth/session").json()
    assert s["user"]["platformRole"] == "master_admin"
    assert len(fb.accounts) == 1  # same account, not a duplicate


def test_google_takes_over_unverified_password_account_safely(env):
    client, fb, store, _ = env
    # Someone pre-registered the victim's address with their own password, unverified.
    uid = fb.add("victim@gmail.com", "attacker-pass-2026!", verified=False)
    fb.google_users["gtok"] = {"email": "victim@gmail.com", "name": "Victim"}
    _google_login(client)
    assert client.get("/api/auth/session").json()["user"]["id"] == uid
    assert fb.accounts[uid].user.email_verified is True
    assert fb.accounts[uid].password != "attacker-pass-2026!"  # attacker's password no longer works


def test_google_blocks_disabled_account(env):
    client, fb, *_ = env
    fb.add("off@gmail.com", None, disabled=True)
    fb.google_users["gtok"] = {"email": "off@gmail.com", "name": "Off"}
    assert _google_login(client).headers["location"].endswith("/login?error=account_locked")
    assert client.get("/api/auth/session").status_code == 401


def test_google_rejected_token(env):
    client, *_ = env
    assert _google_login(client, "unknown").headers["location"].endswith("/login?error=google_failed")
