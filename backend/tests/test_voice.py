"""The voice stack through the orchestrator: compiling an agent, syncing its
copies on publish, test calls, live calls and their controls, Call history
from finished calls, signed events, scenarios, and the Ops control plane.
The orchestrator is tests/fakeorch.py."""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import time

from app.domain import agentcompile as ac
from app.domain import voicecalls as vc
from app.integrations import voicesync

from .orgkit import SLUG, api, env, err, login, master, post, sample_spec, seed, seed_library, staff  # noqa: F401

TENANT = "ten_test123456"


def setup(env, role="owner"):
    client, fb, store, mailer = env
    people = seed(fb, store)
    svc = client.app.state.services
    seed_library(svc, store)
    login(client, people[role][1])
    return client, fb, store, people, svc, svc.fake_orch


def publish_changes(client, greeting="Vanakkam! Arogya here."):
    d = client.get(api("/agents/agt_1")).json()
    w = copy.deepcopy(d["working"])
    w["behaviour"]["greeting"] = greeting
    r = post(client, api("/agents/agt_1"), {"working": w, "revision": d["revision"]}).json()
    return post(client, api("/agents/agt_1/publish"), {"note": "New greeting", "revision": r["revision"]})


# ---------------------------------------------------------------- compiling


def test_instructions_carry_the_whole_setup():
    spec = sample_spec()
    spec["flow"][0]["children"][0]["children"] = [
        {"id": "b1", "kind": "branch", "label": "First visit", "condition": "they haven't been before", "children": [], "joinsAt": "n3"},
        {"id": "n3", "kind": "step", "label": "Confirm the booking", "say": "Shall I book it?", "children": []},
    ]
    spec["guardrails"]["refuseTopics"] = ["Medicine doses"]
    text = ac.instructions(spec, org_name="Arogya", use_case="Appointments", faq=[{"q": "When is OPD open?", "a": "8 AM to 8 PM."}], tool_names=["book_an_appointment"])
    assert "You are Kavya" in text or "You are" in text
    assert "Intent 1: Book a visit" in text and "1.1. Ask the date" in text and 'Say: "Which day?"' in text
    assert "1.1.1. If they haven't been before: First visit" in text and "After this, carry on at step 1.1.2." in text
    assert "Patient name (required, name)" in text and "read it back to confirm" in text
    assert "Never discuss Medicine doses" in text and "Q: When is OPD open?" in text
    assert "transfer_to_human" in text and "end_conversation" in text and "book_an_appointment" in text


def test_voice_agent_body_clamps_and_maps():
    spec = sample_spec()
    spec["pipeline"].update({"minEndpointMs": 10, "maxEndpointMs": 99999, "turnDetection": "vad", "interruptMinMs": 400, "fillerPhrases": [], "backchannel": True})
    spec["behaviour"]["languages"] = ["tamil"]
    spec["behaviour"]["startLanguage"] = "tamil"
    body = ac.voice_agent(spec, name="Main", llm_agent_id="agent_1", status="active", webhook_url=None, metadata={}, reference_id="kavya")
    assert body["vad"] == {"semantic_turn": False, "turn_check_ms": 40, "end_silence_ms": 5000}
    assert body["asr"]["language"] == "ta" and body["voice"] == {"reference_id": "kavya", "use_active_voice": False}
    assert body["pipeline"]["barge_in"]["min_speech_ms"] == 400 and body["pipeline"]["fillers"]["enabled"] is False
    assert body["pipeline"]["acknowledgement"] == {"enabled": True}
    assert body["prompts"]["handoff_message"] == "Let me put you through."
    assert "webhook_url" not in body
    spec["pipeline"].update({"keypadInput": True, "ambience": "office"})
    assert any("Keypad" in w for w in ac.unmapped(spec)) and any("ambience" in w for w in ac.unmapped(spec))


def test_transcripts_mark_what_callers_say_as_personal():
    events = [
        {"ts": "2026-10-27T10:00:05Z", "type": "transcript", "data": {"role": "user", "text": "I am {Lakshmi}"}},
        {"ts": "2026-10-27T10:00:07Z", "type": "transcript", "data": {"role": "assistant", "text": "Hello Lakshmi, which day?", "response_id": "r1"}},
        {"ts": "2026-10-27T10:00:08Z", "type": "response.interrupted", "data": {"response_id": "r1", "spoken_text": "Hello Lakshmi"}},
    ]
    turns = vc.turns_from_events(events, vc.parse_ts("2026-10-27T10:00:00Z"), redact_agent=True)
    assert turns[0] == {"speaker": "caller", "at": 5, "text": "{{caller_words:I am (Lakshmi)}}"}
    assert turns[1]["interrupted"] is True and turns[1]["text"] == "{{agent_words:Hello Lakshmi}}"
    assert vc.for_viewer(turns, False)[0]["text"] == "[caller words]"


# ---------------------------------------------------------------- syncing on publish


def test_publishing_makes_both_copies_and_its_tool(env):
    client, fb, store, people, svc, orch = setup(env)
    r = publish_changes(client)
    assert r.status_code == 200, r.text
    v = r.json()["voice"]
    assert v["status"] == "synced" and v["syncedVersion"] == 2 and v["voiceAgentId"] == voicesync.voice_agent_id(SLUG, "agt_1", "live")
    llm = orch.llm_agents[(TENANT, v["llmAgentId"])]
    assert llm["greeting"].startswith("Vanakkam! Arogya here.") and "This call may be recorded" in llm["greeting"]
    assert {"type": "builtin", "name": "end_conversation"} in llm["tools"]
    (tool,) = orch.tools.values()
    assert tool["name"] == "book_an_appointment" and tool["secret_headers"] == {"Authorization": "Bearer value-of-HIS_KEY"} and tool["side_effects"] is True
    assert store.get_record(SLUG, "tool", "tool_1").llm["id"] == tool["id"]
    voice = orch.voice_agents[(TENANT, v["voiceAgentId"])]
    assert voice["llm_agent_id"] == v["llmAgentId"] and voice["status"] == "active" and voice["voice"]["reference_id"] == "kavya"
    assert voice["metadata"]["aica_org"] == SLUG and "webhook_url" not in voice
    # Nothing secret on the agent record.
    assert "value-of-HIS_KEY" not in json.dumps(store.get_record(SLUG, "agent", "agt_1").voice)

    # Publishing again updates in place: no second copy, the tool isn't rewritten.
    tool_version = tool["version"]
    assert publish_changes(client, "Hello again.").json()["voice"]["syncedVersion"] == 3
    assert len(orch.llm_agents) == 1 and len(orch.voice_agents) == 1 and orch.llm_agents[(TENANT, v["llmAgentId"])]["version"] == 2
    assert next(iter(orch.tools.values()))["version"] == tool_version


def test_a_failed_sync_is_shown_and_retried(env):
    client, fb, store, people, svc, orch = setup(env)
    orch.fail_next.append(("/v1/voice-agents", 503, "capacity"))
    r = publish_changes(client)
    assert r.status_code == 200 and r.json()["agent"]["version"] == 2
    v = r.json()["voice"]
    assert v["status"] == "failed" and "isn't answering" in v["error"]
    r = post(client, api("/agents/agt_1/voice/sync"))
    assert r.json()["status"] == "synced" and r.json()["syncedVersion"] == 2


def test_someone_editing_our_copy_on_the_server_is_overwritten(env):
    client, fb, store, people, svc, orch = setup(env)
    vid = publish_changes(client).json()["voice"]["voiceAgentId"]
    orch.voice_agents[(TENANT, vid)]["version"] = 9  # changed outside AICA
    assert publish_changes(client, "Third.").json()["voice"]["status"] == "synced"
    assert orch.voice_agents[(TENANT, vid)]["version"] == 10


def test_pausing_renaming_and_deleting_follow_the_agent(env):
    client, fb, store, people, svc, orch = setup(env)
    vid = publish_changes(client).json()["voice"]["voiceAgentId"]
    post(client, api("/agents/agt_1/settings"), {"status": "paused"})
    assert orch.voice_agents[(TENANT, vid)]["status"] == "disabled"
    post(client, api("/agents/agt_1/settings"), {"status": "live"})
    assert orch.voice_agents[(TENANT, vid)]["status"] == "active"
    post(client, api("/agents/agt_1/settings"), {"name": "Front reception"})
    assert orch.voice_agents[(TENANT, vid)]["name"] == "Front reception"
    master(fb, store)
    login(client, "support@bitntech.in")
    assert post(client, api("/agents/agt_1/delete")).status_code == 204
    assert not orch.voice_agents and not orch.llm_agents


def test_an_unlinked_organisation_publishes_without_the_voice_stack(env):
    client, fb, store, people, svc, orch = setup(env)
    store.save_org(__import__("dataclasses").replace(store.get_org(SLUG), orchTenantId=None))
    r = publish_changes(client)
    assert r.status_code == 200 and r.json()["voice"]["status"] == "not_synced" and not orch.voice_agents
    code, kind, msg = err(post(client, api("/agents/agt_1/voice-token"), {"target": "test"}))
    assert code == 409 and "isn't linked to the voice server" in msg


# ---------------------------------------------------------------- test calls


def test_a_test_call_uses_its_own_copy_and_a_token(env):
    client, fb, store, people, svc, orch = setup(env)
    r = post(client, api("/agents/agt_1/voice-token"), {"target": "test"})
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["token"] == "tok_1" and t["wsBase"] == "wss://orc.test" and t["voiceAgentId"] == voicesync.voice_agent_id(SLUG, "agt_1", "test")
    assert t["metadata"] == {"aica_org": SLUG, "aica_agent_id": "agt_1", "aica_target": "test"}
    assert orch.tokens[0] == {"ttl_s": 600, "kind": "voice", "voice_agent_id": t["voiceAgentId"], "tenant": TENANT}
    assert orch.voice_agents[(TENANT, t["voiceAgentId"])]["name"] == "Main reception (test)"
    # Nothing changed: no rewrite on the next test.
    writes = len([c for c in orch.calls if c[0] in ("POST", "PATCH")])
    post(client, api("/agents/agt_1/voice-token"), {"target": "test"})
    assert len([c for c in orch.calls if c[0] in ("POST", "PATCH")]) == writes + 1  # only the token
    # The live version isn't synced yet.
    assert "isn't on the voice server yet" in err(post(client, api("/agents/agt_1/voice-token"), {"target": "live"}))[2]
    publish_changes(client)
    assert post(client, api("/agents/agt_1/voice-token"), {"target": "live"}).json()["voiceAgentId"] == voicesync.voice_agent_id(SLUG, "agt_1", "live")


def test_a_voice_the_server_lacks_falls_back_with_a_warning(env):
    client, fb, store, people, svc, orch = setup(env)
    orch.tts_voices = ["nila"]
    t = post(client, api("/agents/agt_1/voice-token"), {"target": "test"}).json()
    assert any("isn't on the voice server yet" in w for w in t["warnings"])
    assert orch.voice_agents[(TENANT, t["voiceAgentId"])]["voice"] == {"reference_id": None, "use_active_voice": True}


def test_staff_can_look_but_not_start_test_calls(env):
    client, fb, store, people, svc, orch = setup(env)
    staff(fb, store)
    login(client, "staff@bitntech.in")
    assert client.get(api("/agents/agt_1/voice")).status_code == 200
    assert err(post(client, api("/agents/agt_1/voice-token"), {"target": "test"}))[0] == 403


def test_voice_preview_is_wav(env):
    client, fb, store, people, svc, orch = setup(env)
    r = post(client, api("/voice/preview"), {"text": "Vanakkam", "voiceId": "kavya"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav" and r.headers["x-voice"] == "kavya"
    assert err(post(client, api("/voice/preview"), {"text": "  "}))[0] == 422


def test_scenarios_run_as_text_against_the_saved_setup(env):
    client, fb, store, people, svc, orch = setup(env)
    post(client, api("/agents/agt_1/scenarios"), {"name": "Wants a person", "callerSays": ["Can I speak to a person"], "expect": {"handover": True, "mustSay": []}})
    post(client, api("/agents/agt_1/scenarios"), {"name": "Asks the day", "callerSays": ["Book a visit"], "expect": {"mustSay": ["which day", "slot"], "handover": False, "intent": "Book a visit"}})
    rows = {s["name"]: s["lastRun"] for s in post(client, api("/agents/agt_1/scenarios/run")).json()}
    assert rows["Wants a person"]["passed"] is True
    assert rows["Asks the day"]["passed"] is False and rows["Asks the day"]["problems"] == ["It never said “slot”."]
    assert not orch.llm_sessions  # throwaway sessions are deleted


# ---------------------------------------------------------------- live calls


def test_live_calls_show_only_ours_and_hide_personal_words(env):
    client, fb, store, people, svc, orch = setup(env)
    vid = publish_changes(client).json()["voice"]["voiceAgentId"]
    orch.add_session(TENANT, "call_a", voice_agent_id=vid, live=True)
    orch.add_session(TENANT, "call_b", voice_agent_id="vagent_someone_else", live=True)
    rows = client.get(api("/live-calls")).json()
    assert [r["id"] for r in rows] == ["call_a"]
    a = rows[0]
    assert a["agentId"] == "agt_1" and a["line"] == "Web call" and a["turns"][1]["text"] == "{{caller_words:I am Lakshmi, I want to book a visit}}"
    assert a["turns"][2]["interrupted"] is True
    login(client, people["viewer"][1])
    assert client.get(api("/live-calls")).json()[0]["turns"][1]["text"] == "[caller words]"
    assert err(client.get(api("/live-calls/call_b")))[0] == 404


def test_live_call_controls_reach_the_orchestrator(env):
    client, fb, store, people, svc, orch = setup(env, "front_desk")
    orch.add_session(TENANT, "call_a", voice_agent_id=None, live=True, metadata={"aica_org": SLUG})
    assert post(client, api("/live-calls/call_a/say"), {"text": "One moment please."}).status_code == 200
    assert post(client, api("/live-calls/call_a/handoff"), {"reason": ""}).json()["step"] == "Waiting for a person"
    t = post(client, api("/live-calls/call_a/operator-token"), {"mode": "takeover"}).json()
    assert t["path"] == "/v1/voice/sessions/call_a/operator" and t["mode"] == "takeover" and orch.tokens[-1]["kind"] == "operator"
    assert post(client, api("/live-calls/call_a/end"), {"reason": ""}).json() == {"id": "call_a", "ended": True}
    assert [c[1] for c in orch.controls] == ["say", "handoff", "end"]
    assert orch.controls[1][2]["reason"] == "Front Desk is taking the call"
    assert err(post(client, api("/live-calls/call_a/interrupt")))[:3:2] == (409, "That call has ended.")


# ---------------------------------------------------------------- finished calls and events


def test_finished_calls_come_into_call_history_once(env):
    client, fb, store, people, svc, orch = setup(env)
    vid = publish_changes(client).json()["voice"]["voiceAgentId"]
    orch.add_session(TENANT, "call_done", voice_agent_id=vid, live=False)
    orch.add_session(TENANT, "call_test", voice_agent_id=vid, live=False, metadata={"aica_target": "test"})
    orch.add_session(TENANT, "call_short", voice_agent_id=vid, live=False, stats={"turns": 1, "handoffs": 0, "duration_s": 4})
    assert post(client, api("/calls/sync")).json() == {"added": 2}
    assert post(client, api("/calls/sync")).json() == {"added": 0}
    c = client.get(api("/calls/call_done")).json()
    assert c["agentId"] == "agt_1" and c["durationSec"] == 90 and c["outcome"] == "resolved" and c["line"] == "Web call"
    assert c["transcript"][1]["text"].startswith("{{caller_words:")
    assert client.get(api("/calls/call_short")).json()["outcome"] == "dropped"
    assert client.get(api("/reports?days=1")).json()["totals"]["calls"] == 2


def _signed(body: dict, secret="whsec_test", at=None):
    raw = json.dumps(body).encode()
    t = int(at or time.time())
    sig = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return raw, {"X-AICA-Signature": f"t={t},v1={sig}", "X-AICA-Event": body["event"], "X-AICA-Delivery": "dlv_1", "Content-Type": "application/json"}


def test_signed_events_record_calls_and_handoffs(env):
    client, fb, store, people, svc, orch = setup(env)
    vid = publish_changes(client).json()["voice"]["voiceAgentId"]
    orch.add_session(TENANT, "call_hook", voice_agent_id=vid, live=False)
    raw, headers = _signed({"event": "call.ended", "data": {"session_id": "call_hook", "tenant_id": TENANT, "voice_agent_id": vid}})
    # No Origin: server to server.
    assert client.post("/api/hooks/orchestrator", content=raw, headers={**headers, "X-AICA-Signature": headers["X-AICA-Signature"][:-2] + "00"}).status_code == 401
    assert client.post("/api/hooks/orchestrator", content=raw, headers=headers).status_code == 204
    assert client.post("/api/hooks/orchestrator", content=raw, headers=headers).status_code == 204  # a retry changes nothing
    assert store.get_record(SLUG, "call", "call_hook").agentId == "agt_1"
    old, old_headers = _signed({"event": "call.ended", "data": {}}, at=time.time() - 3600)
    assert client.post("/api/hooks/orchestrator", content=old, headers=old_headers).status_code == 401

    h = {"id": "handoff_1", "session_id": "call_hook", "status": "pending", "reason": "Caller asked for a person", "requested_at": "2026-10-27T10:00:30Z", "voice_agent_id": vid}
    raw, headers = _signed({"event": "handoff.requested", "data": {"tenant_id": TENANT, "voice_agent_id": vid, "session_id": "call_hook", "handoff": h, "recent_transcript": [{"role": "user", "text": "I need a person"}]}})
    assert client.post("/api/hooks/orchestrator", content=raw, headers=headers).status_code == 204
    doc = store.get_record(SLUG, "handoff", "handoff_1")
    assert doc.status == "waiting" and doc.agentName == "Main reception" and "I need a person" in doc.summary
    raw, headers = _signed({"event": "handoff.accepted", "data": {"tenant_id": TENANT, "handoff": {**h, "status": "active", "operator": {"name": "Priya"}}}})
    client.post("/api/hooks/orchestrator", content=raw, headers=headers)
    assert store.get_record(SLUG, "handoff", "handoff_1").status == "taken" and store.get_record(SLUG, "handoff", "handoff_1").takenBy == "Priya"
    raw, headers = _signed({"event": "call.ended", "data": {"tenant_id": "ten_nobody"}})
    assert client.post("/api/hooks/orchestrator", content=raw, headers=headers).status_code == 204


def test_the_handoff_queue_pulls_from_the_voice_server(env):
    client, fb, store, people, svc, orch = setup(env)
    vid = publish_changes(client).json()["voice"]["voiceAgentId"]
    from app.data.store import now

    orch.handoffs[(TENANT, "handoff_9")] = {"id": "handoff_9", "session_id": "call_x", "status": "pending", "reason": "Emergency: chest pain", "requested_at": now().isoformat(), "voice_agent_id": vid}
    rows = client.get(api("/handoffs")).json()
    row = next(r for r in rows if r["id"] == "handoff_9")
    assert row["status"] == "waiting" and row["emergency"] is True


# ---------------------------------------------------------------- Ops


def test_ops_control_plane(env):
    client, fb, store, mailer = env
    svc = client.app.state.services
    orch = svc.fake_orch
    seed(fb, store)
    staff(fb, store)
    login(client, "staff@bitntech.in")
    assert client.get("/api/ops/voice/status").json()["sessions"]["max"] == 8
    assert err(client.get("/api/ops/voice/config"))[0] == 403
    assert err(post(client, "/api/ops/voice/admission", {"accepting": False}))[0] == 403
    master(fb, store)
    login(client, "support@bitntech.in")
    cfg = client.get("/api/ops/voice/config").json()
    assert cfg["version"] == 0
    dry = post(client, "/api/ops/voice/config", {"set": {"vad": {"end_silence_ms": 800}}, "version": 0, "dryRun": True})
    assert dry.status_code == 200 and orch.config["version"] == 0
    assert post(client, "/api/ops/voice/config", {"set": {"vad": {"end_silence_ms": 800}}, "version": 0}).json()["version"] == 1
    code, kind, msg = err(post(client, "/api/ops/voice/config", {"set": {"vad": {"end_silence_ms": 700}}, "version": 0}))
    assert code == 409 and kind == "conflict"
    assert "vad.end_silence_ms" in err(post(client, "/api/ops/voice/config", {"set": {"vad": {"end_silence_ms": 9000}}, "version": 1}))[2]
    assert post(client, "/api/ops/voice/config", {"reset": ["vad"], "version": 1}).json()["overrides"] == {}
    assert "in use" in err(post(client, "/api/ops/voice/models/asr/indicconformer/switch", {"enabled": False}))[2]
    assert post(client, "/api/ops/voice/models/llm/google/gemini-3.1-flash-lite/switch", {"enabled": False}).status_code == 200
    assert "google/gemini-3.1-flash-lite" in orch.models["disabled"]
    assert post(client, "/api/ops/voice/admission", {"accepting": False}).json() == {"accepting": False}
    actions = [a[1] for a in store.audits]
    assert {"voice_config_changed", "voice_model_switched", "voice_admission"} <= set(actions)
    assert all("9000" not in a[3] for a in store.audits)


def test_linking_an_organisation_to_its_tenant(env):
    client, fb, store, mailer = env
    seed(fb, store)
    master(fb, store)
    login(client, "support@bitntech.in")
    assert "looks like ten_" in err(post(client, f"/api/ops/orgs/{SLUG}/voice", {"tenantId": "nope"}))[2]
    assert err(post(client, f"/api/ops/orgs/{SLUG}/voice", {"tenantId": "ten_missing0000"}))[0] == 503
    assert post(client, f"/api/ops/orgs/{SLUG}/voice", {"tenantId": "ten_other99999"}).json()["tenantId"] == "ten_other99999"
    assert store.get_org(SLUG).orchTenantId == "ten_other99999"
    from .orgkit import make_org

    make_org(store, slug="second", tenant=None)
    assert "already uses that tenant" in err(post(client, "/api/ops/orgs/second/voice", {"tenantId": "ten_other99999"}))[2]
    assert post(client, f"/api/ops/orgs/{SLUG}/voice", {"tenantId": None}).json()["tenantId"] is None
