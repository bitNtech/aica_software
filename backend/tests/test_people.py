from __future__ import annotations

from app.data.store import Membership, UserDoc

from .test_api import PW, env, login, post, seed_master, seed_org  # noqa: F401 — env is a fixture

REASON = "Joining the bitNtech support rota."


def add_staff(fb, store, email="ops@bitntech.in", role="staff"):
    uid = fb.add(email, PW, claims={"platform_role": role})
    store.save_user(UserDoc(uid=uid, name=email.split("@")[0], email=email, platformRole=role))
    return uid


def as_master(client, fb, store, email="support@bitntech.in"):
    uid = seed_master(fb, store, email)
    assert login(client, email).status_code == 200
    return uid


def test_people_is_master_only(env):
    client, fb, store, _ = env
    assert client.get("/api/ops/people").status_code == 401
    add_staff(fb, store)
    login(client, "ops@bitntech.in")
    r = client.get("/api/ops/people")
    assert r.status_code == 403
    uid = seed_org(fb, store)
    assert post(client, f"/api/ops/people/{uid}/sign-out").status_code == 403


def test_lists_everyone_bitntech_first(env):
    client, fb, store, _ = env
    seed_org(fb, store)
    add_staff(fb, store)
    as_master(client, fb, store)
    people = client.get("/api/ops/people").json()
    assert [(p["email"], p["platformRole"]) for p in people] == [
        ("support@bitntech.in", "master_admin"),
        ("ops@bitntech.in", "staff"),
        ("owner@arogya.in", None),
    ]
    owner = people[2]
    assert owner["memberships"] == [{"orgSlug": "arogya", "orgName": "Arogya", "role": "owner"}]
    assert owner["disabled"] is False and owner["emailVerified"] is True


def test_promote_to_master_signs_them_out_and_alerts_masters(env):
    client, fb, store, mailer = env
    other = seed_master(fb, store, "admin@bitntech.in")
    staff = add_staff(fb, store)
    me = as_master(client, fb, store)

    # The staff member is signed in elsewhere.
    from fastapi.testclient import TestClient

    elsewhere = TestClient(client.app, base_url="http://localhost:5173")
    assert login(elsewhere, "ops@bitntech.in").status_code == 200

    r = post(client, f"/api/ops/people/{staff}/role", {"role": "master_admin", "reason": REASON})
    assert r.status_code == 204, r.text
    assert fb.accounts[staff].user.claims["platform_role"] == "master_admin"
    assert store.get_user(staff).platformRole == "master_admin"
    assert elsewhere.get("/api/auth/session").status_code == 401
    assert (me, "role_changed", staff, f"staff → master_admin: {REASON}") in store.audits
    alert = [(k, to) for k, to, _ in mailer.sent if k == "master-alert"]
    assert alert == [("master-alert", "admin@bitntech.in,support@bitntech.in")]
    assert other  # still a master

    # Signing in again picks up the new role.
    assert login(elsewhere, "ops@bitntech.in").json()["user"]["platformRole"] == "master_admin"


def test_demote_and_remove_role(env):
    client, fb, store, mailer = env
    staff = add_staff(fb, store, role="master_admin")
    as_master(client, fb, store)
    assert post(client, f"/api/ops/people/{staff}/role", {"role": "staff", "reason": REASON}).status_code == 204
    assert fb.accounts[staff].user.claims == {"platform_role": "staff"}
    assert post(client, f"/api/ops/people/{staff}/role", {"role": None, "reason": REASON}).status_code == 204
    assert fb.accounts[staff].user.claims == {}
    assert store.get_user(staff).platformRole is None
    assert not [k for k, *_ in mailer.sent if k == "master-alert"]


def test_role_change_rules(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    staff = add_staff(fb, store)
    me = as_master(client, fb, store)

    def change(uid, role, reason=REASON):
        return post(client, f"/api/ops/people/{uid}/role", {"role": role, "reason": reason})

    r = change(me, "staff")
    assert r.status_code == 409 and "your own account" in r.json()["error"]["message"]
    r = change(owner, "staff")
    assert r.status_code == 409 and "client account" in r.json()["error"]["message"]
    assert change(staff, "staff").status_code == 409
    assert change(staff, "master_admin", reason="short").status_code == 422
    assert change(staff, "owner").status_code == 422
    assert change("nobody", "staff").status_code == 404


def test_never_leaves_aica_without_an_active_master(env):
    client, fb, store, _ = env
    other = add_staff(fb, store, "admin@bitntech.in", role="master_admin")
    me = as_master(client, fb, store)
    # A race: this master was demoted elsewhere but their cookie still says master.
    fb.accounts[me].user.claims = {}
    r = post(client, f"/api/ops/people/{other}/role", {"role": "staff", "reason": REASON})
    assert r.status_code == 409 and "at least one active master admin" in r.json()["error"]["message"]
    r = post(client, f"/api/ops/people/{other}/disable", {"reason": REASON})
    assert r.status_code == 409
    assert fb.accounts[other].user.claims["platform_role"] == "master_admin"


def test_disable_enable_and_sign_out(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    me = as_master(client, fb, store)

    assert post(client, f"/api/ops/people/{owner}/disable", {"reason": "short"}).status_code == 422
    assert post(client, f"/api/ops/people/{owner}/disable", {"reason": "Left the hospital in September."}).status_code == 204
    assert fb.accounts[owner].user.disabled
    assert post(client, f"/api/ops/people/{owner}/disable", {"reason": "Left the hospital in September."}).status_code == 409

    from fastapi.testclient import TestClient

    other = TestClient(client.app, base_url="http://localhost:5173")
    assert login(other, "owner@arogya.in").status_code == 403

    assert post(client, f"/api/ops/people/{owner}/enable").status_code == 204
    assert login(other, "owner@arogya.in").status_code == 200
    assert post(client, f"/api/ops/people/{owner}/enable").status_code == 409

    assert post(client, f"/api/ops/people/{owner}/sign-out").status_code == 204
    assert other.get("/api/auth/session").status_code == 401

    assert post(client, f"/api/ops/people/{me}/disable", {"reason": "Testing self-lockout."}).status_code == 409
    assert post(client, f"/api/ops/people/{me}/sign-out").status_code == 409
    actions = [a for _, a, t, _ in store.audits if t == owner]
    assert actions == ["user_disabled", "user_enabled", "sessions_revoked"]


def test_invite_a_master_admin(env):
    client, fb, store, mailer = env
    as_master(client, fb, store)
    r = post(client, "/api/ops/staff-invites", {"email": "cto@bitntech.in", "role": "master_admin"})
    assert r.status_code == 204, r.text
    assert [k for k, *_ in mailer.sent] == ["invite", "master-alert"]
    token = mailer.last("invite").rsplit("/", 1)[1]

    from fastapi.testclient import TestClient

    fresh = TestClient(client.app, base_url="http://localhost:5173")
    r = post(fresh, f"/api/invites/{token}/accept", {"name": "The CTO", "password": PW})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["platformRole"] == "master_admin"
    assert post(client, "/api/ops/staff-invites", {"email": "x@bitntech.in", "role": "owner"}).status_code == 422


def test_staff_invite_defaults_to_staff(env):
    client, fb, store, mailer = env
    as_master(client, fb, store)
    assert post(client, "/api/ops/staff-invites", {"email": "new@bitntech.in"}).status_code == 204
    inv = next(iter(store.invites.values()))
    assert inv.role == "staff"
    assert [k for k, *_ in mailer.sent] == ["invite"]


def test_people_without_a_profile_are_listed(env):
    client, fb, store, _ = env
    fb.add("google-only@clinic.in", None, name="G User")
    as_master(client, fb, store)
    people = client.get("/api/ops/people").json()
    g = next(p for p in people if p["email"] == "google-only@clinic.in")
    assert g["name"] == "G User" and g["memberships"] == [] and g["createdAt"] is None


def test_client_with_membership_kept_on_demotion(env):
    """Taking a bitNtech role away never touches organisation memberships."""
    client, fb, store, _ = env
    uid = add_staff(fb, store)
    doc = store.get_user(uid)
    doc.memberships = [Membership("arogya", "viewer")]
    store.save_user(doc)
    as_master(client, fb, store)
    assert post(client, f"/api/ops/people/{uid}/role", {"role": None, "reason": REASON}).status_code == 204
    assert store.get_user(uid).memberships == [Membership("arogya", "viewer")]
