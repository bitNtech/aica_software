"""Every organisation route against every role with its default permissions:
allowed exactly when app/access.py says so. A new route belongs here
(test_every_org_route_is_in_the_matrix fails until it is)."""
from __future__ import annotations

import pytest

from app.access import ROLES, default_permissions

from .orgkit import api, env, login, post, sample_spec, seed, seed_library, seed_ops  # noqa: F401

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
    # Phase 4
    ("GET", "/reports", None, perm("reports.view")),
    ("GET", "/reports/calls.csv", None, perm("reports.export")),
    # Phase 5
    ("GET", "/numbers", None, lambda r: "library.numbers" in default_permissions(r) or ("agents.view" in default_permissions(r) and r != "viewer")),
    ("POST", "/numbers", {"number": "+91 422 400 3000", "label": "Billing"}, NOBODY),
    ("POST", "/numbers/num_2", {"label": "Lab desk"}, perm("library.numbers")),
    ("POST", "/numbers/num_2/delete", None, NOBODY),
    ("GET", "/tools", None, lambda r: "library.secrets" in default_permissions(r) or ("agents.view" in default_permissions(r) and r != "viewer")),
    ("POST", "/tools", {"id": "tool_sms", "name": "Send an SMS", "enabled": False}, NOBODY),
    ("POST", "/tools/tool_1/delete", None, NOBODY),
    ("POST", "/tools/tool_1/test", {"inputs": {"patient_id": "P1"}}, NOBODY),
    ("GET", "/credentials", None, lambda r: "library.secrets" in default_permissions(r) or ("agents.view" in default_permissions(r) and r != "viewer")),
    ("POST", "/credentials", {"name": "NEW_KEY", "value": "abc"}, perm("library.secrets")),
    ("POST", "/credentials/OTHER_KEY/delete", None, perm("library.secrets")),
    ("GET", "/knowledge", None, perm("library.knowledge", "agents.view")),
    ("POST", "/knowledge", {"kind": "faq", "name": "Parking", "description": "", "faq": [{"q": "Is there parking?", "a": "Yes, at the back."}]}, perm("library.knowledge")),
    ("POST", "/knowledge/search", {"sourceIds": ["kn_1"], "question": "When is OPD open?"}, perm("library.knowledge", "agents.view")),
    ("GET", "/knowledge/kn_1/passages", None, perm("library.knowledge", "agents.view")),
    ("POST", "/knowledge/kn_2", {"description": "Our prices."}, perm("library.knowledge")),
    ("POST", "/knowledge/kn_2/refresh", None, perm("library.knowledge")),
    ("POST", "/knowledge/kn_2/delete", None, perm("library.knowledge")),
    ("POST", "/knowledge/kn_3/uploaded", None, perm("library.knowledge")),
    ("GET", "/uploads", None, lambda r: "library.uploads" in default_permissions(r) or {"agents.view", "calls.personal"} <= set(default_permissions(r))),
    ("POST", "/uploads", {"files": [{"name": "call.mp3", "size": 1000, "type": "audio/mpeg"}]}, perm("library.uploads")),
    ("POST", "/uploads/up_2/uploaded", None, perm("library.uploads")),
    ("GET", "/uploads/up_1/transcript", None, lambda r: "library.uploads" in default_permissions(r) or {"agents.view", "calls.personal"} <= set(default_permissions(r))),
    ("POST", "/uploads/up_1/delete", None, perm("library.uploads")),
    # Phase 6
    ("GET", "/agents", None, ANY),
    ("GET", "/agents/agt_1", None, perm("agents.view", "agents.test", "agents.configure")),
    ("POST", "/agents/agt_1", {"working": sample_spec()}, perm("agents.configure")),
    ("POST", "/agents/agt_1/publish", {"note": ""}, perm("agents.publish")),
    ("POST", "/agents/agt_1/discard", None, perm("agents.publish", "agents.configure")),
    ("POST", "/agents/agt_1/rollback", {"version": 1}, perm("agents.publish")),
    ("POST", "/agents/agt_1/settings", {"name": "Front reception"}, perm("agents.configure")),
    ("POST", "/agents/agt_1/delete", None, NOBODY),
    ("GET", "/agents/agt_1/scenarios", None, perm("agents.test", "agents.view")),
    ("POST", "/agents/agt_1/scenarios", {"name": "Asks for timings", "callerSays": ["When are you open?"], "expect": {}}, perm("agents.test")),
    ("POST", "/agents/agt_1/scenarios/scn_1/delete", None, perm("agents.test")),
    ("POST", "/drafts", {"orgName": "Arogya"}, NOBODY),
    ("GET", "/drafts/draft_1", None, NOBODY),
    ("POST", "/drafts/draft_1", {"draft": {}}, NOBODY),
    ("POST", "/drafts/draft_1/discard", None, NOBODY),
    ("POST", "/drafts/draft_1/publish", {"numberId": None}, NOBODY),
]


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("method, path, body, may", ROUTES, ids=[f"{m} {p}" for m, p, *_ in ROUTES])
def test_route_follows_the_permission_table(env, role, method, path, body, may):
    client, fb, store, _ = env
    people = seed(fb, store)
    seed_ops(store, people)
    seed_library(client.app.state.services, store)
    if role == "viewer" and "{viewer}" in path:
        pytest.skip("nobody changes themselves; covered in test_org_team")
    login(client, people[role][1])
    url = api(path.format(viewer=people["viewer"][0]))
    r = client.get(url) if method == "GET" else post(client, url, body)
    if may(role):
        # Allowed: past the permission check (some answer 4xx for other reasons, e.g. no transcript yet).
        assert r.status_code != 403 and r.status_code < 500, r.text
    else:
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", r.text


def test_every_org_route_is_in_the_matrix(env):
    client, *_ = env
    def template(p: str) -> str:
        p = p.split("?")[0].replace("{viewer}", "{member_id}")
        if p.startswith("/uploads/"):
            p = p.replace("up_1", "{call_id}").replace("up_2", "{call_id}")
        for concrete, name in (("cr_1", "{request_id}"), ("call_1", "{call_id}"), ("cb_1", "{callback_id}"), ("apt_1", "{appointment_id}"), ("ho_1", "{handoff_id}"),
                               ("num_2", "{number_id}"), ("tool_1", "{tool_id}"), ("OTHER_KEY", "{name}"), ("kn_1", "{source_id}"), ("kn_2", "{source_id}"), ("kn_3", "{source_id}"),
                               ("scn_1", "{scenario_id}"), ("agt_1", "{agent_id}"), ("draft_1", "{draft_id}")):
            p = p.replace(concrete, name)
        return "/api/orgs/{slug}" + p
    listed = {(m, template(p)) for m, p, *_ in ROUTES}
    listed.add(("POST", "/api/orgs/{slug}/members/{member_id}/resend"))  # needs an invitation; test_org_team covers it
    paths = client.app.openapi()["paths"]
    found = {(m.upper(), p) for p, ops in paths.items() if p.startswith("/api/orgs/") for m in ops}
    assert found == listed
