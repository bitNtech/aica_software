"""Every organisation route against every role with its default permissions:
allowed exactly when app/access.py says so. A new route belongs here
(test_every_org_route_is_in_the_matrix fails until it is)."""
from __future__ import annotations

import pytest

from app.access import ROLES, default_permissions

from .orgkit import api, env, login, post, seed, seed_ops  # noqa: F401

SETTINGS = {"name": "Arogya", "city": "Coimbatore", "languages": ["tamil"], "hours": [{"open": True, "from": "09:00", "to": "18:00"}] * 7, "closed": []}
TODAY = __import__("app.store", fromlist=["now"]).now().date().isoformat()
REQUEST = {"kind": "other", "agentId": None, "title": "Add Sunday hours", "detail": "Please add Sunday hours to the agent.", "urgency": "normal"}


def perm(*any_of):
    return lambda role: any(p in default_permissions(role) for p in any_of)


ANY = lambda role: True  # noqa: E731
NOBODY = lambda role: False  # noqa: E731
NOT_VIEWER = lambda role: role != "viewer"  # noqa: E731

# (method, path, body, who may). The member target is the viewer, whom every
# manager may change; the request was made by the owner; the call was
# handled by front desk.
ROUTES = [
    ("GET", "/members", None, ANY),
    ("POST", "/members/invite", {"email": "new@arogya.in", "role": "viewer"}, perm("team.manage")),
    ("POST", "/members/{viewer}/role", {"role": "front_desk"}, perm("team.manage")),
    ("POST", "/members/{viewer}/permissions", {"permissions": ["reports.view"]}, perm("team.manage")),
    ("POST", "/members/{viewer}/remove", None, perm("team.manage")),
    ("GET", "/settings", None, perm("settings.manage")),
    ("POST", "/settings", SETTINGS, perm("settings.manage")),
    ("GET", "/activity", None, perm("activity.view")),
    # Phase 2
    ("GET", "/requests", None, perm("requests.create", "agents.view")),
    ("POST", "/requests", REQUEST, perm("requests.create")),
    ("POST", "/requests/number", {"note": "For the new branch"}, perm("library.numbers", "requests.create")),
    ("POST", "/requests/cr_1/reply", {"text": "Any update?"}, perm("requests.create")),
    ("POST", "/requests/cr_1/withdraw", None, perm("team.manage")),  # or the person who asked
    ("POST", "/requests/cr_1/update", {"status": "in_progress"}, NOBODY),  # bitNtech's master admin only
    # Phase 3
    ("GET", "/calls", None, perm("calls.viewAll", "calls.take")),
    ("GET", "/calls/call_1", None, perm("calls.viewAll", "calls.take")),
    ("POST", "/calls/call_1/notes", {"text": "Called back, all sorted."}, NOT_VIEWER),
    ("GET", "/callbacks", None, perm("calls.take", "callbacks.assign")),
    ("POST", "/callbacks/cb_1", {"note": "Tried once"}, perm("calls.take", "callbacks.assign")),
    ("GET", f"/appointments?from={TODAY}&to={TODAY}", None, perm("appointments.manage", "calls.viewAll")),
    ("POST", "/appointments/apt_1", {"status": "confirmed"}, perm("appointments.manage")),
    ("GET", "/handoffs", None, perm("calls.take")),
    ("POST", "/handoffs/ho_1/take", None, perm("calls.take")),
    ("POST", "/handoffs/ho_1/to-callback", None, perm("calls.take")),
]


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("method, path, body, may", ROUTES, ids=[f"{m} {p}" for m, p, *_ in ROUTES])
def test_route_follows_the_permission_table(env, role, method, path, body, may):
    client, fb, store, _ = env
    people = seed(fb, store)
    seed_ops(store, people)
    if role == "viewer" and "{viewer}" in path:
        pytest.skip("nobody changes themselves; covered in test_org_team")
    login(client, people[role][1])
    url = api(path.format(viewer=people["viewer"][0]))
    r = client.get(url) if method == "GET" else post(client, url, body)
    if may(role):
        assert r.status_code in (200, 204), r.text
    else:
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", r.text


def test_every_org_route_is_in_the_matrix(env):
    client, *_ = env
    def template(p: str) -> str:
        p = p.split("?")[0].replace("{viewer}", "{member_id}")
        for concrete, name in (("cr_1", "{request_id}"), ("call_1", "{call_id}"), ("cb_1", "{callback_id}"), ("apt_1", "{appointment_id}"), ("ho_1", "{handoff_id}")):
            p = p.replace(concrete, name)
        return "/api/orgs/{slug}" + p
    listed = {(m, template(p)) for m, p, *_ in ROUTES}
    listed.add(("POST", "/api/orgs/{slug}/members/{member_id}/resend"))  # needs an invitation; test_org_team covers it
    paths = client.app.openapi()["paths"]
    found = {(m.upper(), p) for p, ops in paths.items() if p.startswith("/api/orgs/") for m in ops}
    assert found == listed
