from __future__ import annotations

from app.data.store import IndexMissing

from .test_api import env, login, post, seed_org  # noqa: F401 — env is a fixture
from .test_people import add_staff, as_master


def test_audit_is_master_only(env):
    client, fb, store, _ = env
    assert client.get("/api/ops/audit").status_code == 401
    add_staff(fb, store)
    login(client, "ops@bitntech.in")
    assert client.get("/api/ops/audit").status_code == 403


def test_newest_first_with_labels_and_pages(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    me = as_master(client, fb, store)
    for i in range(5):
        store.audit(me, "sessions_revoked", owner, f"n{i}")
    store.audit("seed", "master_admin_set", me, "support@bitntech.in")

    page = client.get("/api/ops/audit", params={"limit": 4}).json()
    assert [e["detail"] for e in page["entries"]] == ["support@bitntech.in", "n4", "n3", "n2"]
    first = page["entries"][1]
    assert first["actorLabel"] == "support@bitntech.in" and first["targetLabel"] == "owner@arogya.in"
    assert page["entries"][0]["actorLabel"] == "seed"
    assert page["nextBefore"]

    rest = client.get("/api/ops/audit", params={"limit": 4, "before": page["nextBefore"]}).json()
    assert [e["detail"] for e in rest["entries"]] == ["n1", "n0"]
    assert rest["nextBefore"] is None


def test_filters(env):
    client, fb, store, _ = env
    owner = seed_org(fb, store)
    me = as_master(client, fb, store)
    store.audit(me, "user_disabled", owner, "Left.")
    store.audit(me, "staff_invited", "new@bitntech.in", "staff")
    store.audit(owner, "signup", "arogya")

    def get(**params):
        r = client.get("/api/ops/audit", params=params)
        assert r.status_code == 200, r.text
        return [e["action"] for e in r.json()["entries"]]

    assert get(action="user_disabled") == ["user_disabled"]
    assert get(actor="owner@arogya.in") == ["signup"]
    assert get(actor="nobody@x.in") == []
    assert get(target="owner@arogya.in") == ["user_disabled"]
    assert get(target="new@bitntech.in") == ["staff_invited"]
    assert get(target="arogya") == ["signup"]
    r = client.get("/api/ops/audit", params={"action": "signup", "actor": me})
    assert r.status_code == 422
    assert client.get("/api/ops/audit", params={"limit": 500}).status_code == 422


def test_missing_index_is_explained(env, monkeypatch):
    client, fb, store, _ = env
    as_master(client, fb, store)

    def boom(*a, **k):
        raise IndexMissing()

    monkeypatch.setattr(store, "list_audit", boom)
    r = client.get("/api/ops/audit", params={"action": "signup"})
    assert r.status_code == 503 and "index" in r.json()["error"]["message"]
