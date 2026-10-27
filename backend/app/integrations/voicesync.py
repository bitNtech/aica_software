"""Keeps an AICA agent's copies on the voice stack in step with its setup
(docs/orchestrator-contract.md §Sync).

Each agent has up to two pairs of copies, each an LLM agent (on the LLM
server, through the orchestrator's /v1/llm passthrough) and a voice agent
(on the orchestrator) that answers with it:

- "live": the published version, which callers get. Synced after every
  publish, rollback and draft publish, and on Retry. Paused agents'
  voice agents are `disabled`.
- "test": the working setup (saved, unpublished edits), for test calls
  and scenarios, so testing never changes what callers hear. Synced when a
  test starts, skipped when nothing changed since the last one.

Firestore stays the source of truth: the version is saved first, then
synced. A failed sync is recorded on the agent (`status: "failed"`) with a
message, and never undoes the publish. The copies are ours, so a stale
ETag (someone edited them on the server) is resolved by reading the
current version and writing ours over it.
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import time

from ..auth.accounts import iso
from ..core.errors import ApiError
from ..data.store import AgentDoc, DraftDoc, Tx, now
from ..domain import agentcompile as compile_
from ..domain.catalogue import default_analysis, default_guardrails, default_speech
from .orchestrator import Orchestrator, OrchestratorError, api_error, etag_of, require, tenant_of

log = logging.getLogger("aica.voicesync")

CATALOGUE_TTL_S = 60.0


# ---------------------------------------------------------------- catalogue


def catalogue(orch: Orchestrator, tenant: str, *, fresh: bool = False) -> dict:
    """The enabled models by kind ({"llm": {...ids}, "asr": …, "tts_voice": …}),
    plus the raw reply, cached for a minute per tenant."""
    cache: dict = orch.__dict__.setdefault("_catalogue_cache", {})
    hit = cache.get(tenant)
    if hit and not fresh and time.monotonic() - hit[0] < CATALOGUE_TTL_S:
        return hit[1]
    raw = orch.get("/v1/models", tenant=tenant).data or {}
    kinds = raw.get("kinds") or {}
    out = {
        "raw": raw,
        "ids": {k: {i["id"] for i in (v.get("items") or []) if i.get("enabled", True)} for k, v in kinds.items()},
        "defaultLlm": next((i["id"] for i in (kinds.get("llm") or {}).get("items", []) if i.get("default")), None),
    }
    cache[tenant] = (time.monotonic(), out)
    return out


def reference_for(spec: dict, cat: dict, warnings: list[str] | None = None) -> str | None:
    """The TTS voice: the pipeline's voice model if chosen, else the agent's
    voice when the TTS server has one by that id, else None (its active voice)."""
    tts = cat["ids"].get("tts_voice", set())
    vm = (spec.get("pipeline") or {}).get("voiceModel")
    if vm and vm != "default" and vm in tts:
        return vm
    vid = (spec.get("behaviour") or {}).get("voiceId")
    if vid and vid in tts:
        return vid
    if warnings is not None and vid:
        warnings.append(f"The voice “{vid}” isn't on the voice server yet, so the agent speaks with the server's active voice.")
    return None


def _choose(spec: dict, cat: dict, warnings: list[str]) -> tuple[dict, str | None]:
    """The spec with model choices the server doesn't offer reset to its
    default (with a warning), and the LLM model to use (None: the server's)."""
    spec = copy.deepcopy(spec)
    p = spec.setdefault("pipeline", {})
    ids = cat["ids"]
    model = None
    lm = p.get("languageModel")
    if lm and lm != "default":
        if lm in ids.get("llm", set()):
            model = lm
        else:
            warnings.append(f"The language model “{lm}” isn't available on the voice server, so its default is used.")
    for key, kind, what in (("speechModel", "asr", "speech recogniser"), ("voiceModel", "tts_voice", "voice")):
        v = p.get(key)
        if v and v != "default" and v not in ids.get(kind, set()):
            warnings.append(f"The {what} “{v}” isn't available on the voice server, so its default is used.")
            p[key] = "default"
    return spec, model


# ---------------------------------------------------------------- tools and knowledge


def _tools(svc, slug: str, orch: Orchestrator, tenant: str, spec: dict, warnings: list[str]) -> tuple[list[dict], list[str]]:
    """The LLM tool references for the setup's tools, creating or updating
    their LLM-server copies when they changed. Built-in transfer is the
    orchestrator's own handoff; ending the call is always available."""
    refs, names = [], []
    for tool_id in (spec.get("context") or {}).get("toolIds") or []:
        t = svc.store.get_record(slug, "tool", tool_id)
        if t is None:
            from ..domain.catalogue import BUILTIN_TOOLS

            b = next((x for x in BUILTIN_TOOLS if x["id"] == tool_id), None)
            if b and b.get("builtin") in ("transfer", "end_call"):
                names.append(b["name"].lower())
            elif b:
                warnings.append(f"“{b['name']}” isn't available on the voice server yet, so the agent can't use it.")
            continue
        if t.kind == "builtin":
            if t.builtin in ("transfer", "end_call"):
                names.append(t.name.lower())
            else:
                warnings.append(f"“{t.name}” isn't available on the voice server yet, so the agent can't use it.")
            continue
        if not t.enabled:
            warnings.append(f"“{t.name}” is switched off, so the agent can't use it.")
            continue
        secret = None
        cred = svc.store.get_record(slug, "credential", t.credentialName) if t.credentialName else None
        if t.credentialName:
            if not cred or not svc.secrets:
                warnings.append(f"“{t.name}” needs the secret {t.credentialName}, which isn't set, so the agent can't use it.")
                continue
            secret = svc.secrets.open(slug, cred.id, cred.ciphertext, cred.keyId)
        body = compile_.http_tool_body(t, secret)
        # The secret itself never goes into the stored hash: when it was set does.
        h = compile_.tool_hash({**{k: v for k, v in body.items() if k != "secret_headers"}, "secretSetAt": iso(cred.setAt) if cred else None})
        state = dict(t.llm or {})
        try:
            if state.get("id") and state.get("hash") == h:
                pass
            elif state.get("id"):
                state = _write_tool(orch, tenant, state, body, h)
            else:
                r = orch.post("/v1/llm/tools", body, tenant=tenant, idempotency_key=f"aica-{slug}-{t.id}-{h}")
                state = {"id": r.data["id"], "version": r.data.get("version"), "hash": h}
        except OrchestratorError as e:
            if e.code == "already_exists":
                warnings.append(f"“{t.name}” has the same name as another tool on the LLM server, so the agent can't use it. Rename it.")
                continue
            raise
        if state != t.llm:
            t.llm = state
            svc.store.save_record(slug, "tool", t)
        refs.append({"type": "tool", "id": state["id"]})
        names.append(body["name"])
    return refs, names


def _write_tool(orch: Orchestrator, tenant: str, state: dict, body: dict, h: str) -> dict:
    path = f"/v1/llm/tools/{state['id']}"
    try:
        r = orch.patch(path, body, tenant=tenant, if_match=etag_of(state.get("version")))
    except OrchestratorError as e:
        if e.status == 404:
            r = orch.post("/v1/llm/tools", body, tenant=tenant)
            return {"id": r.data["id"], "version": r.data.get("version"), "hash": h}
        if e.status != 412:
            raise
        cur = orch.get(path, tenant=tenant).data or {}
        r = orch.patch(path, body, tenant=tenant, if_match=etag_of(cur.get("version")))
    return {"id": state["id"], "version": (r.data or {}).get("version"), "hash": h}


def _faq(svc, slug: str, spec: dict) -> list[dict]:
    out: list[dict] = []
    for sid in (spec.get("context") or {}).get("knowledgeSourceIds") or []:
        k = svc.store.get_record(slug, "knowledge", sid)
        if k and k.kind == "faq" and k.status == "ready":
            out += [q for q in (k.faq or []) if q.get("q") and q.get("a")]
    return out


# ---------------------------------------------------------------- the pair


def _upsert_llm(orch: Orchestrator, tenant: str, state: dict, body: dict, key: str) -> dict:
    aid = state.get("llmAgentId")
    if aid:
        path = f"/v1/llm/agents/{aid}"
        try:
            r = orch.patch(path, body, tenant=tenant, if_match=etag_of(state.get("llmVersion")))
            return {"llmAgentId": aid, "llmVersion": (r.data or {}).get("version")}
        except OrchestratorError as e:
            if e.status == 412:
                cur = orch.get(path, tenant=tenant).data or {}
                r = orch.patch(path, body, tenant=tenant, if_match=etag_of(cur.get("version")))
                return {"llmAgentId": aid, "llmVersion": (r.data or {}).get("version")}
            if e.status != 404:
                raise
    r = orch.post("/v1/llm/agents", body, tenant=tenant, idempotency_key=f"{key}-{_digest(body)}")
    return {"llmAgentId": r.data["id"], "llmVersion": r.data.get("version")}


def _upsert_voice(orch: Orchestrator, tenant: str, state: dict, body: dict, vid: str) -> dict:
    path = f"/v1/voice-agents/{vid}"
    if state.get("voiceAgentId") == vid:
        try:
            r = orch.patch(path, body, tenant=tenant, if_match=etag_of(state.get("voiceVersion")))
            return {"voiceAgentId": vid, "voiceVersion": (r.data or {}).get("version")}
        except OrchestratorError as e:
            if e.status == 412:
                cur = orch.get(path, tenant=tenant).data or {}
                r = orch.patch(path, body, tenant=tenant, if_match=etag_of(cur.get("version")))
                return {"voiceAgentId": vid, "voiceVersion": (r.data or {}).get("version")}
            if e.status != 404:
                raise
    try:
        r = orch.post("/v1/voice-agents", {"id": vid, **body}, tenant=tenant)
    except OrchestratorError as e:
        if e.status != 409:
            raise
        # Made before we could record it (a retried publish): take it over.
        cur = orch.get(path, tenant=tenant).data or {}
        r = orch.patch(path, body, tenant=tenant, if_match=etag_of(cur.get("version")))
    return {"voiceAgentId": vid, "voiceVersion": (r.data or {}).get("version")}


def _digest(data) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:24]


def voice_agent_id(slug: str, owner_id: str, target: str) -> str:
    """Ours, so a retried create can't make a second one: vagent_ + 24 hex."""
    return "vagent_" + hashlib.sha256(f"aica:{slug}:{owner_id}:{target}".encode()).hexdigest()[:24]


def _full_spec(spec: dict) -> dict:
    """A draft's data lacks the blocks only published agents carry."""
    s = dict(spec)
    s.setdefault("speech", default_speech())
    s.setdefault("guardrails", default_guardrails())
    s.setdefault("analysis", default_analysis(s.get("subTypeId")))
    return s


def build(svc, org, *, owner_id: str, name: str, use_case: str, spec: dict, target: str, active: bool, version: int | None = None) -> tuple[dict, dict, list[str], str]:
    """The two bodies (before ids), warnings, and the hash they make."""
    orch = require(svc)
    tenant = tenant_of(org)
    warnings: list[str] = []
    spec = _full_spec(spec)
    cat = catalogue(orch, tenant)
    spec, model = _choose(spec, cat, warnings)
    reference = reference_for(spec, cat, warnings)
    refs, names = _tools(svc, org.slug, orch, tenant, spec, warnings)
    faq = _faq(svc, org.slug, spec)
    warnings += compile_.unmapped(spec)
    meta = {"aica_org": org.slug, "aica_agent_id": owner_id, "aica_target": target}
    if version is not None:
        meta["aica_version"] = str(version)
    label = name if target == "live" else f"{name} (test)"
    llm = compile_.llm_agent(spec, name=label, org_name=org.name, use_case=use_case, model=model, tool_refs=refs, tool_names=names, faq=faq, metadata=meta)
    webhook = svc.settings.orchestrator_webhook_url if target == "live" else None
    voice = compile_.voice_agent(spec, name=label, llm_agent_id="", status="active" if active else "disabled", webhook_url=webhook, metadata=meta, reference_id=reference)
    return llm, voice, warnings, _digest([llm, voice])


def sync(svc, org, *, owner_id: str, name: str, use_case: str, spec: dict, state: dict, target: str, active: bool, version: int | None = None, force: bool = False) -> dict:
    """Writes the pair and returns its new state. Raises ApiError on failure."""
    orch = require(svc)
    tenant = tenant_of(org)
    try:
        llm, voice, warnings, h = build(svc, org, owner_id=owner_id, name=name, use_case=use_case, spec=spec, target=target, active=active, version=version)
        if not force and state.get("hash") == h and state.get("voiceAgentId") and state.get("status") == "synced":
            return {**state, "warnings": warnings}
        out = dict(state)
        out.update(_upsert_llm(orch, tenant, state, llm, key=f"aica-{org.slug}-{owner_id}-{target}"))
        voice["llm_agent_id"] = out["llmAgentId"]
        out.update(_upsert_voice(orch, tenant, out, voice, voice_agent_id(org.slug, owner_id, target)))
    except OrchestratorError as e:
        log.warning("voice sync failed", extra={"org": org.slug, "target": target, "status": e.status, "code": e.code})
        raise api_error(e, "save the agent")
    out.update({"status": "synced", "error": None, "warnings": warnings, "hash": h, "syncedAt": iso(now()), "tenantId": tenant})
    if version is not None:
        out["syncedVersion"] = version
    return out


def set_status(svc, org, state: dict, active: bool) -> dict:
    """Pauses or turns on the live voice agent without a full sync."""
    if not state.get("voiceAgentId") or svc.orch is None or not getattr(org, "orchTenantId", None):
        return state
    orch, tenant = svc.orch, org.orchTenantId
    path = f"/v1/voice-agents/{state['voiceAgentId']}"
    body = {"status": "active" if active else "disabled"}
    try:
        try:
            r = orch.patch(path, body, tenant=tenant, if_match=etag_of(state.get("voiceVersion")))
        except OrchestratorError as e:
            if e.status != 412:
                raise
            cur = orch.get(path, tenant=tenant).data or {}
            r = orch.patch(path, body, tenant=tenant, if_match=etag_of(cur.get("version")))
    except OrchestratorError as e:
        raise api_error(e, "pause or turn on the agent")
    return {**state, "voiceVersion": (r.data or {}).get("version")}


def remove(svc, org, state: dict) -> None:
    """Deletes a pair. Best effort: what's already gone is fine."""
    if svc.orch is None or not getattr(org, "orchTenantId", None):
        return
    orch, tenant = svc.orch, org.orchTenantId
    for path in ([f"/v1/voice-agents/{state['voiceAgentId']}"] if state.get("voiceAgentId") else []) + ([f"/v1/llm/agents/{state['llmAgentId']}"] if state.get("llmAgentId") else []):
        try:
            orch.delete(path, tenant=tenant)
        except OrchestratorError as e:
            if e.status != 404:
                log.warning("voice copy not deleted", extra={"org": org.slug, "status": e.status, "code": e.code})


# ---------------------------------------------------------------- agents and drafts


def _save_state(svc, slug: str, agent_id: str, target: str, state: dict) -> AgentDoc | None:
    def run(tx: Tx) -> AgentDoc | None:
        a = tx.get_record(slug, "agent", agent_id)
        if not a:
            return None
        a.voice = {**(a.voice or {}), target: state}
        if target == "live":
            a.voiceAgentId = state.get("voiceAgentId")
        tx.save_record(slug, "agent", a)
        return a

    return svc.store.transact(run)


def sync_live(svc, org, a: AgentDoc, *, force: bool = False) -> AgentDoc:
    """After a publish: the published version to its live pair. Never raises
    for a failed sync; the agent records it instead."""
    if svc.orch is None or not getattr(org, "orchTenantId", None):
        return a
    latest = svc.store.get_record(org.slug, "version", f"{a.id}_{a.version:06d}") if a.version else None
    if not latest:
        return a
    state = dict((a.voice or {}).get("live") or {})
    try:
        state = sync(svc, org, owner_id=a.id, name=a.name, use_case=a.useCase, spec=latest.spec, state=state, target="live", active=a.status == "live", version=a.version, force=force)
    except ApiError as e:
        state = {**state, "status": "failed", "error": e.message, "failedAt": iso(now()), "failedVersion": a.version}
    return _save_state(svc, org.slug, a.id, "live", state) or a


def sync_test(svc, org, a: AgentDoc) -> dict:
    """The working setup to the agent's test pair. Raises ApiError."""
    state = sync(svc, org, owner_id=a.id, name=a.name, use_case=a.useCase, spec=a.working, state=dict((a.voice or {}).get("test") or {}), target="test", active=True)
    _save_state(svc, org.slug, a.id, "test", state)
    return state


def sync_draft(svc, org, d: DraftDoc) -> dict:
    from ..domain.catalogue import sub_type

    data = d.data
    st = sub_type(data.get("typeId"), data.get("subTypeId"))
    spec = {k: data.get(k) for k in ("typeId", "subTypeId", "redact", "behaviour", "flow", "attributes", "globalFlows", "context", "pipeline")}
    state = sync(svc, org, owner_id=d.id, name=(data.get("name") or "").strip() or "Untitled agent", use_case=st["label"] if st else "General enquiries", spec=spec, state=dict(d.voice or {}), target="test", active=True)

    def run(tx: Tx) -> None:
        cur = tx.get_record(org.slug, "draft", d.id)
        if cur:
            cur.voice = state
            tx.save_record(org.slug, "draft", cur)

    svc.store.transact(run)
    return state


def voice_out(a: AgentDoc) -> dict:
    """What the console shows about an agent's voice copies."""
    live = (a.voice or {}).get("live") or {}
    test = (a.voice or {}).get("test") or {}
    status = live.get("status") or "not_synced"
    if status == "synced" and live.get("syncedVersion") != a.version:
        status = "out_of_date"
    return {
        "status": status,
        "error": live.get("error"),
        "warnings": live.get("warnings") or [],
        "syncedAt": live.get("syncedAt"),
        "syncedVersion": live.get("syncedVersion"),
        "voiceAgentId": live.get("voiceAgentId"),
        "llmAgentId": live.get("llmAgentId"),
        "testVoiceAgentId": test.get("voiceAgentId"),
        "testSyncedAt": test.get("syncedAt"),
    }
