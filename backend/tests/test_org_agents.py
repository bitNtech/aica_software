"""Phase 6: agents, versions, drafts, scenarios and the catalogue."""
from __future__ import annotations

import copy
from datetime import timedelta

import pytest

from app.reports import record_call
from app.store import CallDoc, now

from .orgkit import SLUG, api, env, err, login, master, post, sample_spec, seed, seed_library  # noqa: F401


def setup(env, role="owner"):
    client, fb, store, mailer = env
    people = seed(fb, store)
    svc = client.app.state.services
    seed_library(svc, store)
    login(client, people[role][1])
    return client, fb, store, people, svc


def as_master(client, fb, store):
    master(fb, store)
    login(client, "support@bitntech.in")


def detail(client):
    return client.get(api("/agents/agt_1")).json()


def edited(d, **behaviour):
    w = copy.deepcopy(d["working"])
    w["behaviour"].update(behaviour)
    return w


def test_listing_agents_and_drafts(env):
    client, fb, store, people, svc = setup(env, "front_desk")
    record_call(svc, SLUG, CallDoc(id="c1", agentId="agt_1", agentName="Main reception", line="x", callerPhone="9840212345", startedAt=now() - timedelta(minutes=3), durationSec=40, language="tamil", intent="Timings", outcome="resolved"))
    rows = client.get(api("/agents")).json()
    a, d = rows
    assert a["id"] == "agt_1" and a["phoneNumber"] == "+91 422 400 1000" and a["callsThisWeek"] == 1 and a["version"] == 1 and a["hasChanges"] is False
    assert d == {**d, "id": "draft_1", "status": "draft", "name": "Lab reports", "setupStep": "type", "useCase": "Use case not chosen", "callsThisWeek": 0}
    # Opening one needs more than being in the organisation.
    assert err(client.get(api("/agents/agt_1")))[2] == "You don’t have permission to see agents."


def test_everyday_edits_and_the_locked_structure(env):
    client, fb, store, people, svc = setup(env)
    d = detail(client)
    assert d["revision"] == 0 and len(d["versions"]) == 1
    r = post(client, api("/agents/agt_1"), {"working": edited(d, greeting="Vanakkam! Arogya here."), "revision": 0}).json()
    assert r["agent"]["hasChanges"] is True and r["revision"] == 1
    # Structure is bitNtech's.
    w = copy.deepcopy(r["working"])
    w["flow"] = []
    assert err(post(client, api("/agents/agt_1"), {"working": w, "revision": 1}))[2] == "The flow, tools and voice pipeline are set up by bitNtech. Send them a request to change these."
    w = copy.deepcopy(r["working"])
    w["context"]["toolIds"] = []
    assert err(post(client, api("/agents/agt_1"), {"working": w, "revision": 1}))[0] == 403
    # Knowledge isn't structure.
    w = copy.deepcopy(r["working"])
    w["context"]["knowledgeSourceIds"] = []
    assert post(client, api("/agents/agt_1"), {"working": w, "revision": 1}).status_code == 200
    # Saving the published setup again: no unpublished changes.
    v1 = d["versions"][0]["spec"]
    assert post(client, api("/agents/agt_1"), {"working": v1, "revision": 2}).json()["agent"]["hasChanges"] is False
    as_master(client, fb, store)
    w = copy.deepcopy(v1)
    w["flow"] = []
    assert post(client, api("/agents/agt_1"), {"working": w}).status_code == 200


def test_a_save_from_an_older_copy_is_refused(env):
    client, fb, store, people, svc = setup(env)
    d = detail(client)
    post(client, api("/agents/agt_1"), {"working": edited(d, greeting="First tab"), "revision": 0})
    code, kind, msg = err(post(client, api("/agents/agt_1"), {"working": edited(d, greeting="Second tab"), "revision": 0}))
    assert (code, kind) == (409, "conflict") and "Reload" in msg
    assert detail(client)["working"]["behaviour"]["greeting"] == "First tab"


@pytest.mark.parametrize("mangle", [
    lambda w: w["behaviour"].update(voiceId="robot"),
    lambda w: w["behaviour"].update(startLanguage="english", languages=["tamil"]),
    lambda w: w["behaviour"].update(greeting="x" * 5000),
    lambda w: w.pop("guardrails"),
    lambda w: w["context"].update(minScore=3),
])
def test_invalid_setups_are_refused(env, mangle):
    client, *_ = setup(env)
    w = detail(client)["working"]
    mangle(w)
    assert err(post(client, api("/agents/agt_1"), {"working": w}))[:2] == (422, "invalid_input")


def test_publishing_discarding_and_rolling_back(env):
    client, fb, store, people, svc = setup(env)
    url = api("/agents/agt_1")
    assert err(post(client, f"{url}/publish", {"note": ""}))[2] == "There are no unpublished changes to publish."
    d = detail(client)
    post(client, url, {"working": edited(d, greeting="Version two greeting")})
    r = post(client, f"{url}/publish", {"note": " Friendlier greeting "}).json()
    assert r["agent"]["version"] == 2 and r["agent"]["hasChanges"] is False and r["versions"][0]["note"] == "Friendlier greeting"
    assert store.activity[SLUG][-1].text == "Published Main reception, version 2"
    post(client, url, {"working": edited(r, greeting="Never mind")})
    r = post(client, f"{url}/discard").json()
    assert r["working"]["behaviour"]["greeting"] == "Version two greeting" and r["agent"]["hasChanges"] is False
    r = post(client, f"{url}/rollback", {"version": 1}).json()
    assert r["agent"]["version"] == 3 and r["versions"][0]["note"] == "Went back to version 1."
    assert r["working"]["behaviour"]["greeting"] == d["versions"][0]["spec"]["behaviour"]["greeting"]
    assert [e.text for e in store.activity[SLUG]][-1] == "Rolled Main reception back to version 1"
    assert err(post(client, f"{url}/rollback", {"version": 9}))[:2] == (404, "invalid_input")
    # Versions are never rewritten.
    assert store.get_record(SLUG, "version", "agt_1_000002").spec["behaviour"]["greeting"] == "Version two greeting"


def test_name_number_and_live(env):
    client, fb, store, people, svc = setup(env)
    url = api("/agents/agt_1/settings")
    assert err(post(client, url, {"name": "AB"}))[2] == "Give the agent a name of 3 to 60 characters."
    r = post(client, url, {"name": "Front reception"}).json()
    assert r["agent"]["name"] == "Front reception" and store.activity[SLUG][-1].text == "Renamed Main reception to Front reception"
    r = post(client, url, {"numberId": None}).json()
    assert r["agent"]["status"] == "paused" and r["agent"]["phoneNumber"] is None
    assert store.get_record(SLUG, "number", "num_1").agentId is None
    assert err(post(client, url, {"status": "live"}))[2] == "Give the agent a phone number before turning it on."
    r = post(client, url, {"numberId": "num_2", "status": "live"}).json()
    assert r["agent"]["status"] == "live" and r["agent"]["phoneNumber"] == "+91 422 400 2000"
    # Someone else's line.
    from app.store import AgentDoc

    store.save_record(SLUG, "agent", AgentDoc(id="agt_2", name="Lab line", useCase="Reports", status="live", working=sample_spec(), updatedAt=now(), numberId="num_1"))
    n = store.get_record(SLUG, "number", "num_1")
    n.agentId = "agt_2"
    store.save_record(SLUG, "number", n)
    assert err(post(client, url, {"numberId": "num_1"}))[2] == "+91 422 400 1000 already has an agent. Choose a free number."
    assert err(post(client, url, {"name": "lab line"}))[2] == "Another agent is already called “lab line”."


def test_only_bitntech_deletes_and_it_cleans_up(env):
    client, fb, store, people, svc = setup(env)
    assert err(post(client, api("/agents/agt_1/delete")))[2] == "Only bitNtech can delete agents. Send them a request instead."
    as_master(client, fb, store)
    assert post(client, api("/agents/agt_1/delete")).status_code == 204
    assert store.get_record(SLUG, "agent", "agt_1") is None and store.get_record(SLUG, "number", "num_1").agentId is None
    assert not store.all_records(SLUG, "version") and not store.all_records(SLUG, "scenario")
    # Nothing uses its knowledge any more.
    assert post(client, api("/knowledge/kn_1/delete")).status_code == 204


# ---------------------------------------------------------------- drafts


def test_building_and_publishing_a_draft(env):
    client, fb, store, people, svc = setup(env)
    assert err(post(client, api("/drafts"), {"orgName": "Arogya"}))[2] == "Only bitNtech can create agents. Send them a request instead."
    as_master(client, fb, store)
    d = post(client, api("/drafts"), {"orgName": "Arogya Hospital"}).json()
    assert d["reached"] == "calls" and "Arogya Hospital" in d["behaviour"]["greeting"] and d["revision"] == 0
    d2 = post(client, api(f"/drafts/{d['id']}"), {"draft": {**d, "name": "Appointments", "typeId": "hospital", "subTypeId": "appointments", "reached": "review"}, "revision": 0}).json()
    assert d2["revision"] == 1 and d2["name"] == "Appointments"
    assert err(post(client, api(f"/drafts/{d['id']}"), {"draft": d, "revision": 0}))[:2] == (409, "conflict")
    assert err(post(client, api(f"/drafts/{d['id']}/publish"), {"numberId": "num_1"}))[2] == "+91 422 400 1000 already has an agent. Choose a free number."
    a = post(client, api(f"/drafts/{d['id']}/publish"), {"numberId": "num_2"}).json()
    assert a["status"] == "live" and a["version"] == 1 and a["useCase"] == "Appointments" and a["builtBy"] == "bitNtech (Support)"
    assert store.get_record(SLUG, "number", "num_2").agentId == a["id"]
    # Safe to retry: the same agent, not a second one.
    again = post(client, api(f"/drafts/{d['id']}/publish"), {"numberId": "num_2"}).json()
    assert again["id"] == a["id"] and len(store.all_records(SLUG, "agent")) == 2
    spec = store.get_record(SLUG, "agent", a["id"]).working
    assert spec["analysis"]["successCriteria"].startswith("The caller booked") and spec["guardrails"]["maxCallMinutes"] == 10
    assert err(client.get(api(f"/drafts/{d['id']}")))[:2] == (404, "invalid_input")
    assert all(r["id"] != d["id"] for r in client.get(api("/agents")).json())


def test_discarding_a_draft(env):
    client, fb, store, people, svc = setup(env)
    as_master(client, fb, store)
    assert post(client, api("/drafts/draft_1/discard")).status_code == 204
    assert store.get_record(SLUG, "draft", "draft_1") is None


def test_invalid_drafts_are_refused(env):
    client, fb, store, people, svc = setup(env)
    as_master(client, fb, store)
    d = client.get(api("/drafts/draft_1")).json()
    assert err(post(client, api("/drafts/draft_1"), {"draft": {**d, "reached": "nowhere"}}))[0] == 422


# ---------------------------------------------------------------- scenarios


def test_scenarios(env):
    client, fb, store, people, svc = setup(env, "supervisor")
    url = api("/agents/agt_1/scenarios")
    assert [s["id"] for s in client.get(url).json()] == ["scn_1"]
    s = post(client, url, {"name": " Asks for timings ", "callerSays": ["When are you open?", " "], "expect": {"intent": " Timings ", "mustSay": ["8 AM", ""], "handover": "maybe"}}).json()
    assert s["name"] == "Asks for timings" and s["callerSays"] == ["When are you open?"] and s["expect"] == {"intent": "Timings", "mustSay": ["8 AM"], "handover": None}
    assert err(post(client, url, {"name": "asks for timings", "callerSays": ["Hi"], "expect": {}}))[2] == "There’s already a scenario called “asks for timings”."
    assert err(post(client, url, {"name": "No", "callerSays": ["Hi"], "expect": {}}))[2] == "Give the scenario a name of 3 to 80 characters."
    assert err(post(client, url, {"name": "Silent", "callerSays": [" "], "expect": {}}))[2] == "Add at least one thing the caller says."
    assert err(post(client, url, {"name": "Long", "callerSays": ["x"] * 11, "expect": {}}))[2] == "Keep scenarios to 10 lines or fewer."
    store.records[(SLUG, "scenario")]["scn_1"].lastRun = {"passed": True}
    r = post(client, url, {"id": "scn_1", "name": "Books a first visit", "callerSays": ["I want an appointment"], "expect": {}}).json()
    assert r["lastRun"] is None
    assert post(client, f"{url}/scn_1/delete").status_code == 204
    assert err(post(client, f"{url}/scn_1/delete"))[:2] == (404, "invalid_input")


def test_catalogue(env):
    client, fb, store, people, svc = setup(env)
    types = client.get("/api/catalogue/agent-types").json()
    assert types[0]["id"] == "hospital" and types[0]["subTypes"]
    assert {v["id"] for v in client.get("/api/catalogue/voices").json()} == {"kavya", "arun", "meera", "selvi"}
    client.cookies.clear()
    assert client.get("/api/catalogue/voices").status_code == 401


def test_every_setup_the_console_makes_passes_validation():
    """The demo client's own agents (all versions) and a new draft, exported
    from the frontend: the server must accept whatever the console sends."""
    import json
    from pathlib import Path

    from app.agentspec import SpecField

    data = json.loads((Path(__file__).parent / "fixtures" / "demo_agents.json").read_text())
    assert len(data["specs"]) >= 3
    for spec in data["specs"]:
        SpecField.spec(spec)
    SpecField.draft(data["draft"])


def test_bitntech_staff_only_look_at_scenarios(env):
    client, fb, store, people, svc = setup(env)
    from .orgkit import staff

    staff(fb, store)
    login(client, "staff@bitntech.in")
    assert client.get(api("/agents/agt_1/scenarios")).status_code == 200
    assert err(post(client, api("/agents/agt_1/scenarios"), {"name": "Staff test", "callerSays": ["Hi"], "expect": {}}))[0] == 403
    assert err(post(client, api("/agents/agt_1/scenarios/scn_1/delete")))[0] == 403


def test_publishing_what_someone_else_changed_is_refused(env):
    client, fb, store, people, svc = setup(env)
    d = detail(client)
    post(client, api("/agents/agt_1"), {"working": edited(d, greeting="Changed in another tab"), "revision": 0})
    # This tab still shows revision 0.
    assert err(post(client, api("/agents/agt_1/publish"), {"note": "", "revision": 0}))[:2] == (409, "conflict")
    assert err(post(client, api("/agents/agt_1/discard"), {"revision": 0}))[:2] == (409, "conflict")
    assert err(post(client, api("/agents/agt_1/rollback"), {"version": 1, "revision": 0}))[:2] == (409, "conflict")
    assert post(client, api("/agents/agt_1/publish"), {"note": "", "revision": 1}).status_code == 200
