"""Phase 2: requests to bitNtech."""
from __future__ import annotations

import pytest

from .orgkit import SLUG, add_member, api, env, err, login, master, post, seed, seed_ops, staff  # noqa: F401

NEW = {"kind": "new_agent", "agentId": None, "title": "An agent for the lab", "detail": "Answer calls about lab reports and timings.", "urgency": "soon"}


def body(**over):
    return {**NEW, **over}


def texts(store):
    return [e.text for e in store.activity.get(SLUG, [])]


def test_asking_bitntech(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    login(client, people["admin"][1])
    r = post(client, api("/requests"), body())
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["status"] == "open" and got["createdBy"] == "Admin" and got["createdById"] == people["admin"][0] and got["replies"] == []
    assert got["orgSlug"] == SLUG and got["kind"] == "new_agent" and got["agentId"] is None
    assert texts(store)[-1] == "Asked bitNtech for a new agent: “An agent for the lab”"
    kind, to, url = mailer.sent[-1]
    assert kind == "request-created" and to == "support@bitntech.in" and url.endswith(f"/ops/orgs/{SLUG}/requests#{got['id']}")
    assert client.get(api("/requests")).json()[0]["id"] == got["id"]


def test_agent_name_is_kept_only_with_an_agent(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    r = post(client, api("/requests"), body(kind="flow_change", agentId="ag_1", agentName="Main reception")).json()
    assert r["agentId"] == "ag_1" and r["agentName"] == "Main reception"
    r = post(client, api("/requests"), body(agentName="Ignored")).json()
    assert r["agentName"] is None


@pytest.mark.parametrize("over, message", [
    ({"kind": "pizza"}, "Choose what you need."),
    ({"title": "Hi"}, "Give the request a title of 5 to 120 characters."),
    ({"title": "x" * 121}, "Give the request a title of 5 to 120 characters."),
    ({"detail": "Short"}, "Describe what you need in 10 to 2,000 characters."),
    ({"detail": "x" * 2001}, "Describe what you need in 10 to 2,000 characters."),
    ({"kind": "flow_change", "agentId": None}, "Choose the agent whose flow should change."),
    ({"urgency": "yesterday"}, "Choose how soon you need it."),
])
def test_asking_is_checked(env, over, message):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    assert err(post(client, api("/requests"), body(**over))) == (422, "invalid_input", message)
    assert store.list_requests(SLUG) == []


def test_bitntech_doesnt_ask(env):
    client, fb, store, _ = env
    seed(fb, store)
    master(fb, store)
    login(client, "support@bitntech.in")
    assert err(post(client, api("/requests"), body()))[2] == "Requests come from the organisation. bitNtech replies to them."
    assert client.get(api("/requests")).status_code == 200


def test_asking_for_a_number(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    login(client, people["owner"][1])
    assert post(client, api("/requests/number"), {"note": ""}).status_code == 204
    r = store.list_requests(SLUG)[0]
    assert (r.kind, r.title, r.detail) == ("number", "Another phone number", "No note.")
    assert err(post(client, api("/requests/number"), {"note": "x" * 501}))[2] == "Keep the note under 500 characters."


def test_replies_from_both_sides_email_the_other(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    seed_ops(store, people)
    master(fb, store)
    login(client, people["admin"][1])
    r = post(client, api("/requests/cr_1/reply"), {"text": "  Any update?  "}).json()
    assert r["replies"][-1]["text"] == "Any update?" and r["replies"][-1]["byKind"] == "member" and r["replies"][-1]["by"] == "Admin"
    assert mailer.sent[-1][0] == "request-replied" and mailer.sent[-1][1] == "support@bitntech.in"
    assert err(post(client, api("/requests/cr_1/reply"), {"text": "  "}))[2] == "Write the reply first."
    assert err(post(client, api("/requests/cr_1/reply"), {"text": "x" * 1001}))[2] == "Keep replies under 1,000 characters."
    login(client, "support@bitntech.in")
    r = post(client, api("/requests/cr_1/reply"), {"text": "Working on it."}).json()
    assert r["replies"][-1]["byKind"] == "bitntech" and r["replies"][-1]["by"] == "Support (bitNtech)"
    # The owner asked: they hear about it, at their member address, with the hospital-side link.
    kind, to, url = mailer.sent[-1]
    assert (kind, to) == ("request-replied", "owner@arogya.in") and url.endswith(f"/o/{SLUG}/requests#cr_1")
    assert r["status"] == "open"  # a reply doesn't move it on


def test_bitntech_staff_read_but_dont_reply(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    seed_ops(store, people)
    staff(fb, store)
    login(client, "staff@bitntech.in")
    assert client.get(api("/requests")).status_code == 200
    assert err(post(client, api("/requests/cr_1/reply"), {"text": "Hello"}))[2] == "Only bitNtech’s master admin replies to requests."


def test_withdrawing(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    seed_ops(store, people)
    asker = add_member(fb, store, "supervisor", email="asker@arogya.in", name="Asker", permissions=["requests.create", "agents.view"])
    login(client, "asker@arogya.in")
    mine = post(client, api("/requests"), body()).json()
    # Someone else's, without managing the team: refused, naming who asked.
    assert err(post(client, api("/requests/cr_1/withdraw")))[2] == "Only Owner or someone who manages the team can withdraw this."
    r = post(client, api(f"/requests/{mine['id']}/withdraw")).json()
    assert r["status"] == "withdrawn"
    assert texts(store)[-1] == "Withdrew the request “An agent for the lab”"
    assert err(post(client, api(f"/requests/{mine['id']}/withdraw")))[2] == "Only open requests can be withdrawn."
    assert err(post(client, api(f"/requests/{mine['id']}/reply"), {"text": "Hello"}))[2] == "This request was withdrawn."
    assert asker


def test_the_master_admin_moves_requests_on(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    seed_ops(store, people)
    master(fb, store)
    login(client, people["owner"][1])
    assert err(post(client, api("/requests/cr_1/update"), {"status": "done"}))[2] == "Only bitNtech’s master admin can move requests on."
    login(client, "support@bitntech.in")
    assert err(post(client, api("/requests/cr_1/update"), {"status": "declined"}))[2] == "Say why it’s declined. The organisation sees your reply."
    r = post(client, api("/requests/cr_1/update"), {"status": "in_progress", "reply": "Starting this week."}).json()
    assert r["status"] == "in_progress" and r["replies"][-1]["text"] == "Starting this week."
    entry = store.activity[SLUG][-1]
    assert entry.text == "bitNtech started on the request “Add Saturday hours”" and entry.detail == "Starting this week." and entry.actorKind == "bitntech"
    assert mailer.sent[-1][:2] == ("request-updated", "owner@arogya.in")
    # The same status again: no new entry.
    n = len(store.activity[SLUG])
    post(client, api("/requests/cr_1/update"), {"status": "in_progress"})
    assert len(store.activity[SLUG]) == n
    assert err(post(client, api("/requests/nope/update"), {"status": "done"}))[:2] == (404, "invalid_input")


def test_ops_sees_every_organisations_requests(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    seed_ops(store, people)
    staff(fb, store)
    login(client, people["owner"][1])
    assert client.get("/api/ops/change-requests").status_code == 403
    login(client, "staff@bitntech.in")
    rows = client.get("/api/ops/change-requests").json()
    assert [(r["id"], r["orgName"], r["orgSlug"]) for r in rows] == [("cr_1", "Arogya", SLUG)]


def test_ops_list_leaves_out_inactive_organisations(env):
    client, fb, store, _ = env
    people = seed(fb, store)
    seed_ops(store, people)
    staff(fb, store)
    org = store.get_org(SLUG)
    org.status = "suspended"
    store.save_org(org)
    login(client, "staff@bitntech.in")
    assert client.get("/api/ops/change-requests").json() == []


def test_a_request_made_while_acting_is_the_members(env):
    client, fb, store, mailer = env
    people = seed(fb, store)
    master(fb, store)
    login(client, "support@bitntech.in")
    post(client, f"/api/ops/people/{people['admin'][0]}/act-as", {"reason": "Raising it on their behalf"})
    r = post(client, api("/requests"), body()).json()
    assert r["createdById"] == people["admin"][0] and r["createdBy"].endswith("(bitNtech, as Admin)")
