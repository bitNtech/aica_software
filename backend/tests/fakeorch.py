"""An in-memory stand-in for the voice orchestrator (and its /v1/llm and
/v1/tts passthroughs), behind httpx.MockTransport, so the voice routes are
tested without a network. It keeps to the documented contract
(docs/orchestrator-contract.md): ETags and If-Match, the error envelope,
tenant isolation, list pages."""
from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field

import httpx

from app.integrations.orchestrator import Orchestrator

BASE = "https://orc.test"
KEY = "aica_admin_test"


def _err(status: int, code: str, message: str = "", **extra) -> httpx.Response:
    return httpx.Response(status, json={"error": {"type": "invalid_request_error", "code": code, "message": message or code, "request_id": "req_fake", **extra}})


def _ok(data, status: int = 200, version: int | None = None) -> httpx.Response:
    headers = {"ETag": f'"v{version}"'} if version is not None else {}
    return httpx.Response(status, json=data, headers=headers)


@dataclass
class FakeOrch:
    tenants: set = field(default_factory=lambda: {"ten_test123456", "ten_other99999"})
    llm_agents: dict = field(default_factory=dict)  # (tenant, id) → agent
    tools: dict = field(default_factory=dict)
    voice_agents: dict = field(default_factory=dict)
    sessions: dict = field(default_factory=dict)  # (tenant, id) → session
    events: dict = field(default_factory=dict)  # session id → [event]
    handoffs: dict = field(default_factory=dict)
    llm_sessions: dict = field(default_factory=dict)
    tokens: list = field(default_factory=list)
    calls: list = field(default_factory=list)  # (method, path, tenant)
    controls: list = field(default_factory=list)
    config: dict = field(default_factory=lambda: {"version": 0, "overrides": {}})
    models: dict = field(default_factory=lambda: {"version": 0, "disabled": set()})
    admission: bool = True
    tts_voices: list = field(default_factory=lambda: ["kavya"])
    fail_next: list = field(default_factory=list)  # (path prefix, status, code)
    reply: str = "Sure, which day suits you?"
    _n: int = 0

    def orchestrator(self) -> Orchestrator:
        return Orchestrator(BASE, KEY, transport=httpx.MockTransport(self))

    def _id(self, prefix: str) -> str:
        self._n += 1
        return f"{prefix}_{self._n:024d}"

    # ---- helpers for tests
    def add_session(self, tenant: str, sid: str, *, voice_agent_id: str | None, live: bool, metadata: dict | None = None, stats: dict | None = None, end_reason: str = "client_ended", events: list | None = None):
        s = {"object": "voice_session", "id": sid, "tenant_id": tenant, "voice_agent_id": voice_agent_id, "llm_agent_id": "agent_x", "status": "active" if live else "ended",
             "channel": "web", "started_at": "2026-10-27T10:00:00Z", "ended_at": None if live else "2026-10-27T10:01:30Z", "end_reason": None if live else end_reason,
             "metadata": metadata or {}, "stats": stats or {"turns": 3, "responses": 3, "barge_ins": 1, "handoffs": 0, "duration_s": 90.4, "first_audio_ms": {"p50": 900, "max": 1500, "count": 3}}, "mode": "ai"}
        self.sessions[(tenant, sid)] = s
        self.events[sid] = events if events is not None else [
            {"seq": 1, "ts": "2026-10-27T10:00:01Z", "type": "transcript", "data": {"role": "assistant", "text": "Vanakkam, Arogya hospital.", "response_id": "r1"}},
            {"seq": 2, "ts": "2026-10-27T10:00:05Z", "type": "transcript", "data": {"role": "user", "text": "I am Lakshmi, I want to book a visit", "source": "voice"}},
            {"seq": 3, "ts": "2026-10-27T10:00:07Z", "type": "transcript", "data": {"role": "assistant", "text": "Sure Lakshmi, which day suits you best for the visit?", "response_id": "r2"}},
            {"seq": 4, "ts": "2026-10-27T10:00:09Z", "type": "response.interrupted", "data": {"response_id": "r2", "reason": "barge_in", "spoken_text": "Sure Lakshmi, which day"}},
            {"seq": 5, "ts": "2026-10-27T10:00:10Z", "type": "tool_call", "data": {"name": "get_current_time", "kind": "builtin"}},
        ]
        return s

    # ---- the transport
    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        method = request.method
        tenant = request.headers.get("x-tenant-id")
        self.calls.append((method, path, tenant))
        if request.headers.get("authorization") != f"Bearer {KEY}":
            return _err(401, "invalid_api_key")
        for i, (prefix, status, code) in enumerate(self.fail_next):
            if path.startswith(prefix):
                self.fail_next.pop(i)
                return _err(status, code, "failed on purpose")
        body = json.loads(request.content) if request.content else None
        q = dict(request.url.params)
        if path.startswith("/v1/admin/") or path == "/health/ready":
            return self._admin(method, path, body, q, request)
        if path in ("/v1/models", "/v1/config", "/v1/tts/voices", "/v1/tts/tts"):
            return self._shared(method, path, body)
        if tenant not in self.tenants:
            return _err(403, "tenant_inactive")
        if path.startswith("/v1/llm/agents"):
            return self._crud(self.llm_agents, tenant, method, path, body, request, "/v1/llm/agents", "agent")
        if path.startswith("/v1/llm/tools"):
            return self._crud(self.tools, tenant, method, path, body, request, "/v1/llm/tools", "tool")
        if path.startswith("/v1/llm/sessions"):
            return self._llm_sessions(tenant, method, path, body)
        if path.startswith("/v1/voice-agents"):
            return self._voice_agents(tenant, method, path, body, request)
        if path == "/v1/voice/tokens":
            if body.get("kind") == "operator" and not body.get("session_id"):
                return _err(400, "validation_error")
            self.tokens.append({**body, "tenant": tenant})
            return _ok({"token": f"tok_{len(self.tokens)}", "kind": body.get("kind", "voice"), "expires_at": "2026-10-27T11:00:00Z"}, 201)
        if path.startswith("/v1/voice/sessions"):
            return self._sessions(tenant, method, path, body, q)
        if path == "/v1/handoffs":
            rows = [h for (t, _), h in self.handoffs.items() if t == tenant]
            return _ok({"object": "list", "data": rows, "next_cursor": None})
        return _err(404, "not_found")

    def _shared(self, method, path, body):
        if path == "/v1/models":
            items = lambda kind, ids: [{"id": i, "description": f"{i} model", "enabled": i not in self.models["disabled"], "default": n == 0, "in_use": []} for n, i in enumerate(ids)]  # noqa: E731
            return _ok({"object": "model_catalog", "version": self.models["version"], "kinds": {
                "llm": {"items": [x for x in items("llm", ["google/gemini-3.5-flash", "google/gemini-3.1-flash-lite"]) if x["enabled"]]},
                "asr": {"items": items("asr", ["indicconformer", "lang_router"])},
                "tts_voice": {"items": items("tts_voice", self.tts_voices)},
                "vad": {"items": items("vad", ["ten_vad", "silero"])},
            }})
        if path == "/v1/config":
            return _ok({"object": "config", "profile": {"asr": {"provider": "indicconformer"}, "vad": {"end_silence_ms": 900}}})
        if path == "/v1/tts/voices":
            return _ok({"default": "active", "active": {"voice_id": "abc", "filename": "nila.mp3"}, "voices": [{"reference_id": v} for v in self.tts_voices]})
        if path == "/v1/tts/tts":
            if body.get("reference_id") and body["reference_id"] not in self.tts_voices:
                return _err(403, "model_disabled")
            return httpx.Response(200, content=b"RIFF....WAVEfmt ", headers={"content-type": "audio/wav"})
        return _err(404, "not_found")

    def _crud(self, table, tenant, method, path, body, request, root, prefix):
        rest = path[len(root):].strip("/")
        if not rest:
            if method == "GET":
                return _ok({"object": "list", "data": [v for (t, _), v in table.items() if t == tenant], "next_cursor": None})
            if method == "POST":
                if prefix == "tool" and any(v["name"] == body.get("name") for (t, _), v in table.items() if t == tenant):
                    return _err(409, "already_exists")
                key = request.headers.get("idempotency-key")
                if key:
                    for (t, _), v in table.items():
                        if t == tenant and v.get("_key") == key:
                            return _ok(_public(v), 201, v["version"])
                item = {**copy.deepcopy(body), "id": self._id(prefix), "version": 1, "_key": key}
                table[(tenant, item["id"])] = item
                return _ok(_public(item), 201, 1)
        item = table.get((tenant, rest))
        if not item:
            return _err(404, f"{prefix}_not_found")
        if method == "GET":
            return _ok(_public(item), version=item["version"])
        if method in ("PATCH", "DELETE") and request.headers.get("if-match") not in (None, f'"v{item["version"]}"'):
            return _err(412, "version_mismatch")
        if method == "PATCH":
            item.update(copy.deepcopy(body))
            item["version"] += 1
            return _ok(_public(item), version=item["version"])
        if method == "DELETE":
            del table[(tenant, rest)]
            return httpx.Response(204)
        return _err(405, "method_not_allowed")

    def _voice_agents(self, tenant, method, path, body, request):
        rest = path[len("/v1/voice-agents"):].strip("/")
        if method == "POST" and not rest:
            vid = body.get("id") or self._id("vagent")
            if (tenant, vid) in self.voice_agents:
                return _err(409, "already_exists")
            if (tenant, body.get("llm_agent_id")) not in self.llm_agents:
                return _err(400, "validation_error", "llm agent not found", details={"errors": [{"loc": ["body", "llm_agent_id"], "msg": "not found"}]})
            item = {**copy.deepcopy(body), "id": vid, "version": 1}
            self.voice_agents[(tenant, vid)] = item
            return _ok(item, 201, 1)
        if rest.endswith("/profile"):
            item = self.voice_agents.get((tenant, rest[: -len("/profile")]))
            return _ok({"vad": {"end_silence_ms": 900, **(item or {}).get("vad", {})}}) if item else _err(404, "voice_agent_not_found")
        if not rest and method == "GET":
            return _ok({"object": "list", "data": [v for (t, _), v in self.voice_agents.items() if t == tenant], "next_cursor": None})
        item = self.voice_agents.get((tenant, rest))
        if not item:
            return _err(404, "voice_agent_not_found")
        if method == "GET":
            return _ok(item, version=item["version"])
        if request.headers.get("if-match") not in (None, f'"v{item["version"]}"'):
            return _err(412, "version_mismatch")
        if method == "PATCH":
            for k, v in body.items():
                item[k] = v
            item["version"] += 1
            return _ok(item, version=item["version"])
        if method == "DELETE":
            del self.voice_agents[(tenant, rest)]
            return httpx.Response(204)
        return _err(405, "method_not_allowed")

    def _sessions(self, tenant, method, path, body, q):
        rest = path[len("/v1/voice/sessions"):].strip("/")
        if not rest:
            want = q.get("status")
            rows = [s for (t, _), s in self.sessions.items() if t == tenant and ((want == "live") == (s["status"] == "active"))]
            return _ok({"object": "list", "data": rows, "next_cursor": None})
        sid, _, action = rest.partition("/")
        s = self.sessions.get((tenant, sid))
        if not s:
            return _err(404, "session_not_found")
        if method == "GET" and not action:
            return _ok({**s, "live": s["status"] == "active"})
        if action == "events":
            types = set(filter(None, (q.get("types") or "").split(",")))
            return _ok({"object": "list", "data": [e for e in self.events.get(sid, []) if not types or e["type"] in types], "next_after_seq": None})
        if method == "POST":
            if s["status"] != "active":
                return _err(409, "session_ended")
            self.controls.append((sid, action, body))
            if action == "end":
                s["status"], s["end_reason"] = "ended", body.get("reason")
            if action == "handoff":
                s["mode"] = "handoff_pending"
                s["handoff"] = {"id": f"handoff_{sid}", "status": "pending"}
            return _ok({"ok": True})
        return _err(404, "not_found")

    def _llm_sessions(self, tenant, method, path, body):
        rest = path[len("/v1/llm/sessions"):].strip("/")
        if not rest and method == "POST":
            sid = self._id("sess")
            self.llm_sessions[sid] = {"agent_id": body.get("agent_id"), "turns": []}
            return _ok({"session_id": sid}, 201)
        sid, _, action = rest.partition("/")
        if method == "DELETE":
            self.llm_sessions.pop(sid, None)
            return httpx.Response(204)
        if action == "responses":
            text = body.get("input", "")
            if body.get("instructions"):
                return _ok({"status": "completed", "text": "Book a visit"})
            if "person" in text:
                return _ok({"status": "requires_action", "text": "", "tool_calls": [{"name": "transfer_to_human", "arguments": "{}"}]})
            return _ok({"status": "completed", "text": self.reply})
        return _err(404, "not_found")

    def _admin(self, method, path, body, q, request):
        if path == "/health/ready":
            return _ok({"ok": True})
        if path == "/v1/admin/status":
            return _ok({"object": "admin_status", "sessions": {"live": len([s for s in self.sessions.values() if s["status"] == "active"]), "max": 8, "accepting": self.admission}, "components": {}})
        if path == "/v1/admin/config":
            cur = f'"v{self.config["version"]}"'
            if method != "GET" and request.headers.get("if-match") not in (None, cur):
                return _err(412, "version_mismatch")
            if method == "PATCH":
                if "vad" in body.get("set", {}) and body["set"]["vad"].get("end_silence_ms", 900) > 5000:
                    return _err(400, "validation_error", details={"errors": [{"loc": ["vad", "end_silence_ms"], "msg": "less than or equal to 5000"}]})
                if q.get("dry_run") != "true":
                    self.config["overrides"] = {**self.config["overrides"], **body.get("set", {})}
                    for p in body.get("reset", []):
                        self.config["overrides"].pop(p.split(".")[0], None)
                    self.config["version"] += 1
            if method == "DELETE":
                self.config["overrides"] = {}
                self.config["version"] += 1
                return httpx.Response(204)
            return _ok({"object": "admin_config", "version": self.config["version"], "overrides": self.config["overrides"], "effective": {}, "boot": {}, "boot_error": None}, version=self.config["version"])
        if path == "/v1/admin/config/schema":
            return _ok({"json_schema": {"type": "object", "properties": {}}, "locked": ["env"], "secrets": ["tts.api_key"], "apply": {}, "presets": ["balanced"]})
        if path.startswith("/v1/admin/models/"):
            kind, _, mid = path[len("/v1/admin/models/"):].partition("/")
            if mid.endswith(("/load", "/unload")):
                return _ok({"ok": True})
            if mid == "indicconformer" and not body.get("enabled"):
                return _err(409, "model_in_use", "asr.provider uses it")
            (self.models["disabled"].discard if body.get("enabled") else self.models["disabled"].add)(mid)
            self.models["version"] += 1
            return _ok({"id": mid, "enabled": body.get("enabled")}, version=self.models["version"])
        if path == "/v1/admin/admission":
            self.admission = body.get("accepting")
            return _ok({"accepting": self.admission})
        if path == "/v1/admin/sessions":
            return _ok({"object": "list", "data": [s for s in self.sessions.values() if s["status"] == "active"]})
        if re.fullmatch(r"/v1/admin/sessions/[^/]+/end", path):
            return _ok({"ok": True})
        return _ok({"ok": True})


def _public(item: dict) -> dict:
    out = {k: v for k, v in item.items() if not k.startswith("_") and k != "secret_headers"}
    if "secret_headers" in item:
        out["secret_header_names"] = sorted(item["secret_headers"])
    return out
