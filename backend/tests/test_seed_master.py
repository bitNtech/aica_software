from __future__ import annotations

from app.scripts.seed_master import seed

from .fakes import make_services

PW = "river-lamp-2026-blue"


def test_promotes_existing_account_without_email_and_keeps_password():
    svc, fb, store, mailer = make_services()
    uid = fb.add("Admin@bitntech.in", PW, verified=False, claims={"other": 1})

    out = seed(svc, " ADMIN@bitntech.in ", send_email=False)

    acct = fb.accounts[uid]
    assert acct.user.claims == {"other": 1, "platform_role": "master_admin"}
    assert acct.user.email_verified
    assert acct.password == PW
    assert store.get_user(uid).platformRole == "master_admin"
    assert ("seed", "master_admin_set", uid, "admin@bitntech.in") in store.audits
    assert mailer.sent == []
    assert "existing" in out and "no email sent" in out


def test_existing_account_gets_email_by_default():
    svc, fb, _, mailer = make_services()
    fb.add("admin@bitntech.in", PW)
    seed(svc, "admin@bitntech.in")
    assert [k for k, *_ in mailer.sent] == ["set-password"]


def test_new_account_always_gets_email_even_with_no_email():
    svc, fb, store, mailer = make_services()
    out = seed(svc, "new@bitntech.in", send_email=False)
    acct = fb.by_email("new@bitntech.in")
    assert acct.user.claims["platform_role"] == "master_admin"
    assert store.get_user(acct.user.uid).platformRole == "master_admin"
    assert [(k, to) for k, to, _ in mailer.sent] == [("set-password", "new@bitntech.in")]
    assert "created" in out


def test_promoted_account_can_sign_in_to_ops():
    from fastapi.testclient import TestClient

    from app.main import create_app

    svc, fb, _, _ = make_services()
    fb.add("admin@bitntech.in", PW)
    seed(svc, "admin@bitntech.in", send_email=False)
    with TestClient(create_app(svc.settings, svc), base_url="http://localhost:5173") as client:
        r = client.post("/api/auth/login", json={"email": "admin@bitntech.in", "password": PW, "remember": False}, headers={"Origin": "http://localhost:5173"})
        assert r.status_code == 200
        assert r.json()["user"]["platformRole"] == "master_admin"
        assert client.get("/api/ops/orgs").status_code == 200
