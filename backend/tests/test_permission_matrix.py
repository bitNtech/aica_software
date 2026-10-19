"""Every organisation route against every role with its default permissions:
allowed exactly when app/access.py says so. A new route belongs here."""
from __future__ import annotations

import pytest

from app.access import ROLES, default_permissions

from .orgkit import SLUG, api, env, login, post, seed  # noqa: F401

SETTINGS = {"name": "Arogya", "city": "Coimbatore", "languages": ["tamil"], "hours": [{"open": True, "from": "09:00", "to": "18:00"}] * 7, "closed": []}

# (method, path, body, permission needed; None: any member). The target of
# member routes is the viewer, whom every manager may change.
ROUTES = [
    ("GET", "/members", None, None),
    ("POST", "/members/invite", {"email": "new@arogya.in", "role": "viewer"}, "team.manage"),
    ("POST", "/members/{viewer}/role", {"role": "front_desk"}, "team.manage"),
    ("POST", "/members/{viewer}/permissions", {"permissions": ["reports.view"]}, "team.manage"),
    ("POST", "/members/{viewer}/remove", None, "team.manage"),
    ("GET", "/settings", None, "settings.manage"),
    ("POST", "/settings", SETTINGS, "settings.manage"),
    ("GET", "/activity", None, "activity.view"),
]


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("method, path, body, permission", ROUTES, ids=[f"{m} {p}" for m, p, *_ in ROUTES])
def test_route_follows_the_permission_table(env, role, method, path, body, permission):
    client, fb, store, _ = env
    people = seed(fb, store)
    if role == "viewer" and "{viewer}" in path:
        pytest.skip("nobody changes themselves; covered in test_org_team")
    login(client, people[role][1])
    url = api(path.format(viewer=people["viewer"][0]))
    r = client.get(url) if method == "GET" else post(client, url, body)
    allowed = permission is None or permission in default_permissions(role)
    if allowed:
        assert r.status_code in (200, 204), r.text
    else:
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", r.text


def test_every_org_route_is_in_the_matrix(env):
    client, *_ = env
    listed = {(m, "/api/orgs/{slug}" + p.replace("{viewer}", "{member_id}")) for m, p, *_ in ROUTES}
    listed.add(("POST", "/api/orgs/{slug}/members/{member_id}/resend"))  # needs an invitation; test_org_team covers it
    paths = client.app.openapi()["paths"]
    found = {(m.upper(), p) for p, ops in paths.items() if p.startswith("/api/orgs/") for m in ops}
    assert found == listed
