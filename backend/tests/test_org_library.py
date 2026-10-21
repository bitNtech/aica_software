"""Phase 5: phone numbers, tools and their tests, secrets, knowledge and call uploads."""
from __future__ import annotations

from datetime import timedelta

import httpx
import pytest

from .orgkit import SLUG, api, env, err, login, master, post, seed, seed_library  # noqa: F401


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


def texts(store):
    return [e.text for e in store.activity.get(SLUG, [])]


# ---------------------------------------------------------------- numbers


def test_moving_an_agent_between_lines(env):
    client, fb, store, people, svc = setup(env)
    r = post(client, api("/numbers/num_2"), {"agentId": "agt_1"})
    assert r.status_code == 200 and r.json()["agentId"] == "agt_1"
    # An agent answers one line: its old one is freed.
    assert store.get_record(SLUG, "number", "num_1").agentId is None
    assert store.get_record(SLUG, "agent", "agt_1").numberId == "num_2"
    # Taking the line away pauses it.
    post(client, api("/numbers/num_2"), {"agentId": None})
    a = store.get_record(SLUG, "agent", "agt_1")
    assert a.numberId is None and a.status == "paused"


@pytest.mark.parametrize("body, message", [
    ({"label": "X"}, "Give the number a label, e.g. “Main reception”."),
    ({"hours": " "}, "Say when the agent answers, e.g. “8 AM to 8 PM”."),
    ({"afterHours": "transfer", "transferTo": ""}, "Say where calls go after hours, or choose another option."),
    ({"afterHours": "ringing"}, "Choose what happens after hours."),
])
def test_line_changes_are_checked(env, body, message):
    client, *_ = setup(env)
    assert err(post(client, api("/numbers/num_2"), body))[2] == message
    assert err(post(client, api("/numbers/num_2"), {"agentId": "nobody"}))[:2] == (404, "invalid_input")


def test_bitntech_adds_and_removes_lines(env):
    client, fb, store, people, svc = setup(env)
    assert err(post(client, api("/numbers"), {"number": "+91 422 400 3000", "label": "Billing"}))[0] == 403
    as_master(client, fb, store)
    assert post(client, api("/numbers"), {"number": "+91 422 400 3000", "label": "Billing"}).json()["number"] == "+91 422 400 3000"
    assert "already has that number" in err(post(client, api("/numbers"), {"number": "+914224003000", "label": "Again"}))[2]
    assert "area code" in err(post(client, api("/numbers"), {"number": "12", "label": "Short"}))[2]
    assert "Move the agent" in err(post(client, api("/numbers/num_1/delete")))[2]
    assert post(client, api("/numbers/num_2/delete")).status_code == 204
    assert texts(store)[-1] == "Removed the phone number +91 422 400 2000"


# ---------------------------------------------------------------- tools


TOOL = {"name": "Check a report", "kind": "http", "description": "Looks up whether a lab report is ready.", "acts": False, "method": "GET",
        "url": "https://his.example.in/api/report", "credentialName": "his_key", "timeoutMs": 5000, "retries": 2,
        "params": [{"name": "patient_id", "type": "string", "required": True, "description": "The patient's ID."}], "enabled": True}


def test_tools_are_bitntechs_to_set_up(env):
    client, fb, store, people, svc = setup(env)
    tools = {t["id"]: t for t in client.get(api("/tools")).json()}
    assert {"tool_transfer", "tool_end", "tool_sms", "tool_whatsapp", "tool_1"} <= set(tools)
    assert tools["tool_1"]["usedBy"] == ["Main reception"] and "credentialName" in tools["tool_1"]
    assert "Only bitNtech can set up tools" in err(post(client, api("/tools"), TOOL))[2]
    as_master(client, fb, store)
    t = post(client, api("/tools"), TOOL).json()
    assert t["credentialName"] == "HIS_KEY" and t["retries"] == 2 and t["lastTestedAt"] is None
    assert texts(store)[-1] == "Added the tool “Check a report”"
    # Something that acts is never retried.
    assert post(client, api("/tools"), {**TOOL, "name": "Book a test", "acts": True}).json()["retries"] == 0


@pytest.mark.parametrize("over, message", [
    ({"name": "Hi"}, "Give it a name of at least 3 characters, e.g. “Book an appointment”."),
    ({"name": "book an appointment"}, "Another tool has that name."),
    ({"description": "Short"}, "Say what it does in a sentence: agents use this to decide when to call it."),
    ({"url": "http://his.example.in/x"}, "Give the full address, starting with https://."),
    ({"params": [{"name": "Patient ID", "type": "string", "required": True, "description": ""}]}, "Use lower-case letters, digits and underscores, starting with a letter, e.g. patient_id."),
    ({"params": [{"name": "a", "type": "string"}, {"name": "a", "type": "string"}]}, "“a” is used twice."),
    ({"credentialName": "NOPE_KEY"}, "There's no secret called NOPE_KEY. Add it under Secrets first."),
    ({"credentialHeader": "Cookie"}, "Give a plain header name for the secret, e.g. X-Api-Key."),
    ({"timeoutMs": 999}, "Choose how long to wait for a reply."),
])
def test_tool_rules(env, over, message):
    client, fb, store, *_ = setup(env)
    as_master(client, fb, store)
    assert err(post(client, api("/tools"), {**TOOL, **over}))[2] == message


def test_built_in_tools_are_only_switched(env):
    client, fb, store, *_ = setup(env)
    as_master(client, fb, store)
    r = post(client, api("/tools"), {"id": "tool_whatsapp", "name": "Renamed?", "enabled": True}).json()
    assert r["enabled"] is True and r["name"] == "Send a WhatsApp message"
    assert err(post(client, api("/tools/tool_sms/delete")))[2] == "Built-in tools can be switched off, not deleted."
    assert err(post(client, api("/tools/tool_1/delete")))[2] == "Main reception uses “Book an appointment”. Take it out of that agent first."
    post(client, api("/tools"), TOOL)
    new = next(t for t in client.get(api("/tools")).json() if t["name"] == "Check a report")
    assert post(client, api(f"/tools/{new['id']}/delete")).status_code == 204


def _transport(handler):
    return httpx.MockTransport(handler)


def test_a_tool_test_goes_to_the_checked_address_with_the_secret(env):
    client, fb, store, people, svc = setup(env)
    as_master(client, fb, store)
    seen = {}

    def handler(req: httpx.Request):
        seen.update(url=str(req.url), host=req.headers["host"], auth=req.headers.get("authorization"), sni=req.extensions.get("sni_hostname"), body=req.content)
        return httpx.Response(200, json={"booked": True, "echo": "value-of-HIS_KEY"})

    svc.tool_transport = _transport(handler)
    r = post(client, api("/tools/tool_1/test"), {"inputs": {"patient_id": "P-1"}}).json()
    assert r["ok"] is True and r["status"] == 200
    assert seen["url"].startswith("https://93.184.216.34/api/book") and seen["host"] == "his.example.in" and seen["sni"] == "his.example.in"
    assert seen["auth"] == "Bearer value-of-HIS_KEY" and b"P-1" in seen["body"]
    assert "value-of-HIS_KEY" not in r["summary"] and "••••" in r["summary"]
    assert store.get_record(SLUG, "tool", "tool_1").lastTestedAt is not None


def test_a_custom_header_carries_the_secret(env):
    client, fb, store, people, svc = setup(env)
    t = store.get_record(SLUG, "tool", "tool_1")
    t.credentialHeader = "X-Api-Key"
    store.save_record(SLUG, "tool", t)
    as_master(client, fb, store)
    got = {}
    svc.tool_transport = _transport(lambda req: (got.update(key=req.headers.get("x-api-key"), auth=req.headers.get("authorization")), httpx.Response(204))[1])
    post(client, api("/tools/tool_1/test"), {"inputs": {"patient_id": "P-1"}})
    assert got == {"key": "value-of-HIS_KEY", "auth": None}


@pytest.mark.parametrize("address", ["10.0.0.5", "127.0.0.1", "169.254.169.254", "100.64.1.1", "::1", "fd00::1", "192.168.1.1"])
def test_private_addresses_are_refused(env, address):
    client, fb, store, people, svc = setup(env)
    as_master(client, fb, store)
    svc.resolve = lambda host, port: ["93.184.216.34", address]  # any private one is enough
    called = []
    svc.tool_transport = _transport(lambda req: (called.append(1), httpx.Response(200))[1])
    r = post(client, api("/tools/tool_1/test"), {"inputs": {"patient_id": "P-1"}}).json()
    assert r["ok"] is False and "private network" in r["summary"] and not called


def test_tool_test_outcomes(env):
    client, fb, store, people, svc = setup(env)
    as_master(client, fb, store)
    url = api("/tools/tool_1/test")
    assert post(client, url, {"inputs": {}}).json()["summary"] == "Fill in patient_id to run a test."
    svc.tool_transport = _transport(lambda req: httpx.Response(302, headers={"location": "http://10.0.0.1/"}))
    assert "doesn't follow redirects" in post(client, url, {"inputs": {"patient_id": "P"}}).json()["summary"]

    def slow(req):
        raise httpx.ReadTimeout("slow", request=req)

    svc.tool_transport = _transport(slow)
    assert post(client, url, {"inputs": {"patient_id": "P"}}).json()["summary"] == "No reply within 5 seconds."
    svc.tool_transport = _transport(lambda req: httpx.Response(200, content=b"x" * 500_000))
    r = post(client, url, {"inputs": {"patient_id": "P"}}).json()
    assert r["ok"] and len(r["summary"]) <= 301
    assert post(client, api("/tools/tool_end/test"), {"inputs": {}}).json()["summary"] == "Works. In a test nothing is sent to anyone."
    # Five tests a minute: the sixth waits.
    assert post(client, url, {"inputs": {"patient_id": "P"}}).status_code == 429
    store.clock_offset = 61
    post(client, api("/tools"), {"id": "tool_whatsapp", "name": "x", "enabled": False})
    assert "switched off" in post(client, api("/tools/tool_whatsapp/test"), {"inputs": {"message": "Hi"}}).json()["summary"]
    store.delete_record(SLUG, "credential", "HIS_KEY")
    r = post(client, url, {"inputs": {"patient_id": "P"}}).json()
    assert r["status"] == 401 and "HIS_KEY isn't set" in r["summary"]


# ---------------------------------------------------------------- secrets


def test_secrets_are_write_only_and_encrypted(env):
    client, fb, store, people, svc = setup(env)
    r = post(client, api("/credentials"), {"name": " lab_key ", "value": "  sk-123  "}).json()
    assert r["name"] == "LAB_KEY" and r["setBy"] == "Owner" and "value" not in r
    doc = store.get_record(SLUG, "credential", "LAB_KEY")
    assert "sk-123" not in doc.ciphertext and svc.secrets.open(SLUG, "LAB_KEY", doc.ciphertext, doc.keyId) == "sk-123"
    assert all(set(c) == {"name", "setAt", "setBy"} for c in client.get(api("/credentials")).json())
    e = store.activity[SLUG][-1]
    assert e.text == "Set the secret LAB_KEY" and e.detail == "The value isn’t shown here or anywhere else."
    post(client, api("/credentials"), {"name": "LAB_KEY", "value": "sk-456"})
    assert texts(store)[-1] == "Changed the secret LAB_KEY"
    assert err(post(client, api("/credentials"), {"name": "x", "value": "v"}))[2].startswith("Use 3 to 40 capital letters")
    assert err(post(client, api("/credentials"), {"name": "GOOD_KEY", "value": "  "}))[2] == "Paste the secret’s value."
    assert err(post(client, api("/credentials/HIS_KEY/delete")))[2] == "“Book an appointment” uses HIS_KEY. Change that tool first."
    assert post(client, api("/credentials/OTHER_KEY/delete")).status_code == 204
    assert err(post(client, api("/credentials/NOPE_KEY/delete")))[:2] == (404, "invalid_input")


def test_no_key_no_secrets(env):
    client, fb, store, people, svc = setup(env)
    svc.secrets = None
    code, _, msg = err(post(client, api("/credentials"), {"name": "LAB_KEY", "value": "x"}))
    assert code == 503 and "SECRETS_KEY" in msg


# ---------------------------------------------------------------- knowledge


def test_adding_knowledge(env):
    client, fb, store, people, svc = setup(env)
    faq = post(client, api("/knowledge"), {"kind": "faq", "name": "Parking", "faq": [{"q": "Parking?", "a": "At the back."}]}).json()
    assert faq["upload"] is None and faq["source"]["origin"] == "1 questions" and faq["source"]["status"] == "indexing"
    web = post(client, api("/knowledge"), {"kind": "web", "name": "Doctors page", "url": "https://arogya.example.in/doctors", "refreshEvery": "weekly"}).json()["source"]
    assert web["refreshEvery"] == "weekly"
    doc = post(client, api("/knowledge"), {"kind": "document", "name": "Visitor rules", "fileName": "rules.PDF", "size": 1234}).json()
    up = doc["upload"]
    assert up["method"] == "PUT" and up["headers"] == {"Content-Type": "application/pdf", "x-goog-content-length-range": "1234,1234"}
    sid = doc["source"]["id"]
    assert err(post(client, api(f"/knowledge/{sid}/uploaded")))[0] == 409  # nothing arrived
    svc.blobs.put(f"orgs/{SLUG}/knowledge/{sid}.pdf", 1234)
    assert post(client, api(f"/knowledge/{sid}/uploaded")).json()["status"] == "indexing"
    assert texts(store)[-1] == "Added the knowledge source “Visitor rules”"


@pytest.mark.parametrize("body, message", [
    ({"kind": "faq", "name": "OP", "faq": [{"q": "a", "a": "b"}]}, "Give the source a name of at least 3 characters."),
    ({"kind": "faq", "name": "opd timings", "faq": [{"q": "a", "a": "b"}]}, "There's already a source called “opd timings”."),
    ({"kind": "web", "name": "Site", "url": "http://x.in"}, "Give a full web address starting with https://."),
    ({"kind": "faq", "name": "Empty", "faq": []}, "Add at least one question with its answer."),
    ({"kind": "document", "name": "Big", "fileName": "a.pdf", "size": 60 * 1024 * 1024}, "Choose a file of 50 MB or less."),
    ({"kind": "table", "name": "Sheet", "fileName": "a.pdf", "size": 10}, "Choose a .xlsx, .csv file."),
])
def test_knowledge_is_checked(env, body, message):
    client, *_ = setup(env)
    assert err(post(client, api("/knowledge"), body))[2] == message


def test_knowledge_in_use_and_reading(env):
    client, fb, store, people, svc = setup(env)
    k = {x["id"]: x for x in client.get(api("/knowledge")).json()}
    assert k["kn_1"]["usedBy"] == ["Main reception"] and k["kn_1"]["usedByAgentIds"] == ["agt_1"]
    assert err(post(client, api("/knowledge/kn_1/delete")))[2] == "Main reception uses “OPD timings”. Take it out of that agent first."
    assert post(client, api("/knowledge/kn_2/delete")).status_code == 204
    assert err(post(client, api("/knowledge/kn_1/refresh")))[2] == "An FAQ written here is always up to date."
    assert client.get(api("/knowledge/kn_1/passages")).json() == []
    assert "still being read" in err(client.get(api("/knowledge/kn_3/passages")))[2]
    assert post(client, api("/knowledge/search"), {"sourceIds": ["kn_1"], "question": "OPD?"}).json() == []
    r = post(client, api("/knowledge/kn_1"), {"faq": [{"q": "When is OPD open?", "a": "8 AM to 9 PM."}]}).json()
    assert r["status"] == "indexing" and r["faq"][0]["a"] == "8 AM to 9 PM."
    assert err(post(client, api("/knowledge/kn_1"), {"faq": []}))[2] == "Keep at least one question with its answer."


def test_an_unfinished_upload_shows_as_failed(env):
    client, fb, store, people, svc = setup(env)
    k = store.get_record(SLUG, "knowledge", "kn_3")
    k.createdAt -= timedelta(hours=2)
    store.save_record(SLUG, "knowledge", k)
    row = next(x for x in client.get(api("/knowledge")).json() if x["id"] == "kn_3")
    assert row["status"] == "failed" and "didn't finish uploading" in row["error"]


def test_no_bucket_no_files(env):
    client, fb, store, people, svc = setup(env)
    svc.blobs = None
    code, _, msg = err(post(client, api("/knowledge"), {"kind": "document", "name": "Rules", "fileName": "r.pdf", "size": 10}))
    assert code == 503 and "STORAGE_BUCKET" in msg
    assert err(post(client, api("/uploads"), {"files": [{"name": "a.mp3", "size": 10, "type": "audio/mpeg"}]}))[0] == 503


# ---------------------------------------------------------------- call uploads


def test_call_uploads(env):
    client, fb, store, people, svc = setup(env)
    r = post(client, api("/uploads"), {"files": [{"name": "morning.mp3", "size": 2 * 1024 * 1024, "type": "audio/mpeg"}, {"name": "empty.wav", "size": 0, "type": "audio/wav"}]}).json()
    assert [c["status"] for c in r["calls"]] == ["queued", "failed"] and len(r["uploads"]) == 1
    assert r["calls"][1]["error"] == "The file is empty. Export the recording again and re-upload it."
    assert r["uploads"][0]["headers"]["x-goog-content-length-range"] == f"{2 * 1024 * 1024},{2 * 1024 * 1024}"
    assert err(post(client, api("/uploads"), {"files": [{"name": "notes.txt", "size": 5, "type": "text/plain"}]}))[2] == "notes.txt: not an audio file."
    assert err(post(client, api("/uploads"), {"files": [{"name": "long.mp3", "size": 300 * 1024 * 1024, "type": "audio/mpeg"}]}))[2] == "long.mp3: larger than 200 MB."
    assert post(client, api("/uploads/up_2/uploaded")).status_code == 200
    calls = {c["id"]: c for c in client.get(api("/uploads")).json()}
    assert calls["up_1"]["usedBy"] == ["Lab reports", "Main reception"]
    assert "still being processed" in err(client.get(api("/uploads/up_1/transcript")))[2]


def test_removing_an_upload_takes_it_out_of_drafts(env):
    client, fb, store, people, svc = setup(env)
    before = store.get_record(SLUG, "draft", "draft_1").revision
    assert post(client, api("/uploads/up_1/delete")).status_code == 204
    d = store.get_record(SLUG, "draft", "draft_1")
    # Not a new revision: an open builder keeps saving (it may put the id back, which is harmless).
    assert "up_1" not in d.data["sourceCallIds"] and d.revision == before
    assert store.get_record(SLUG, "upload", "up_1") is None


# ---------------------------------------------------------------- review follow-ups


def test_ipv4_is_tried_first_and_each_address_in_turn(env):
    client, fb, store, people, svc = setup(env)
    as_master(client, fb, store)
    svc.resolve = lambda host, port: ["2600:1f18::1", "93.184.216.34", "34.1.2.3"]
    tried = []

    def handler(req):
        tried.append(req.url.host)
        if req.url.host == "93.184.216.34":
            raise httpx.ConnectError("unreachable", request=req)
        return httpx.Response(200, json={"ok": True})

    svc.tool_transport = _transport(handler)
    r = post(client, api("/tools/tool_1/test"), {"inputs": {"patient_id": "P"}}).json()
    assert r["ok"] and tried == ["93.184.216.34", "34.1.2.3"]


def test_bad_ports_and_unreadable_secrets_are_explained(env):
    client, fb, store, people, svc = setup(env)
    as_master(client, fb, store)
    assert err(post(client, api("/tools"), {**TOOL, "url": "https://his.example.in:99999/x"}))[2] == "The address has a port number that isn't valid."
    c = store.get_record(SLUG, "credential", "HIS_KEY")
    c.ciphertext = c.ciphertext[:-4] + "AAAA"  # as after a key change without SECRETS_KEY_PREVIOUS
    store.save_record(SLUG, "credential", c)
    r = post(client, api("/tools/tool_1/test"), {"inputs": {"patient_id": "P"}})
    assert r.status_code == 200 and "can't be read with the server's current key" in r.json()["summary"]


def test_a_tool_moved_elsewhere_says_so(env):
    client, fb, store, *_ = setup(env)
    as_master(client, fb, store)
    t = next(x for x in client.get(api("/tools")).json() if x["id"] == "tool_1")
    post(client, api("/tools"), {**t, "url": "https://collector.example.com/book"})
    e = store.activity[SLUG][-1]
    assert e.text == "Changed the tool “Book an appointment”" and "his.example.in to collector.example.com" in e.detail and "HIS_KEY" in e.detail


def test_upload_paths_never_come_from_file_names(env):
    client, fb, store, people, svc = setup(env)
    r = post(client, api("/uploads"), {"files": [{"name": "x./../../other/z", "size": 10, "type": "audio/mpeg"}]}).json()
    path = svc.blobs.signed[-1][0]
    assert path == f"orgs/{SLUG}/uploads/{r['calls'][0]['id']}" and ".." not in path
    assert err(post(client, api("/uploads"), {"files": [{"name": "x", "size": 10, "type": "audio/<script>"}]}))[2] == "x: not an audio file."
