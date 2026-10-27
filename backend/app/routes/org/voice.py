"""/api/orgs/{slug}/… — the voice stack, through the orchestrator
(docs/orchestrator-contract.md): agents' voice copies, test calls and
scenarios, voice previews, live calls and their controls, joining a call as
an operator, and bringing finished calls into Call history.

- The organisation's tenant comes from its record (`orchTenantId`); the
  API key never reaches the browser, which gets short-lived tokens only.
- Only calls of this organisation's own agents are shown or recorded, even
  if a tenant were shared: a call belongs here when its voice agent is one
  of ours (live or test) or it was started from this organisation's console.
- Permissions follow the pages: seeing agents for their voice state;
  `agents.test` for test calls and scenarios; `agents.publish` to sync
  again; `calls.viewAll` / `calls.take` to see live calls; `calls.take` to
  act on them. bitNtech staff look; they don't start calls or change them.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field

from ...access.orgs import OrgContext, org_member
from ...auth.accounts import iso
from ...auth.sessions import Caller, current_caller
from ...core.services import Services, get_services
from ...core.errors import ApiError, bad_input, forbidden
from ...core.ratelimit import limit_caller
from ...data.store import AgentDoc, CallDoc, HandoffDoc, Tx, now
from ...domain import voicecalls as vc
from ...domain.rollups import record_call
from ...integrations import voicesync
from ...integrations.orchestrator import OrchestratorError, api_error, require, tenant_of
from ...models import Camel

log = logging.getLogger("aica.voice")
router = APIRouter(prefix="/api/orgs/{slug}", tags=["org"])
catalogue_router = APIRouter(prefix="/api/catalogue", tags=["catalogue"])

TOKEN_LIMIT = Depends(limit_caller("voice-tokens", 20))
CONTROL_LIMIT = Depends(limit_caller("voice-control", 60))
PREVIEW_LIMIT = Depends(limit_caller("voice-preview", 10))
SCENARIO_LIMIT = Depends(limit_caller("voice-scenarios", 6))
SYNC_LIMIT = Depends(limit_caller("voice-sync", 12))
TOKEN_TTL_S = 600
LIVE_EVENTS = 200
MAX_LIVE = 20


class TokenIn(Camel):
    target: str = Field("test", max_length=10)  # test | live


class PreviewIn(Camel):
    text: str = Field(max_length=300)
    voice_id: str | None = Field(None, max_length=64)


class SayIn(Camel):
    text: str = Field(max_length=1000)


class ReasonIn(Camel):
    reason: str = Field("", max_length=300)


class ReleaseIn(Camel):
    resume_ai: bool = True
    reason: str = Field("", max_length=300)


class JoinIn(Camel):
    mode: str = Field("listen", max_length=10)  # listen | takeover


# ---------------------------------------------------------------- helpers


def _allow(ctx: OrgContext, perms: tuple[str, ...], what: str) -> None:
    if not (ctx.access.platform == "master_admin" or any(ctx.access.has(p) for p in perms)):
        raise forbidden(f"You don’t have permission to {what}.")


def _no_staff(ctx: OrgContext) -> None:
    if ctx.access.platform and ctx.access.platform != "master_admin":
        raise forbidden("bitNtech staff can look, not change. Ask the master admin.")


def _orch(ctx: OrgContext):
    return require(ctx.svc), tenant_of(ctx.org)


def _call(fn, what: str):
    try:
        return fn()
    except OrchestratorError as e:
        raise api_error(e, what)


def _agent(ctx: OrgContext, agent_id: str) -> AgentDoc:
    a = ctx.svc.store.get_record(ctx.slug, "agent", agent_id)
    if not a:
        raise ApiError(404, "invalid_input", "That agent doesn't exist any more. It may have been deleted.")
    return a


def _ours(ctx: OrgContext) -> tuple[dict[str, AgentDoc], dict[str, str]]:
    return ours(ctx.svc, ctx.slug)


def ours(svc, slug: str) -> tuple[dict[str, AgentDoc], dict[str, str]]:
    """Voice agent id → agent, for this organisation's live and test copies;
    and agent id → its number."""
    agents = svc.store.list_records(slug, "agent")
    by_voice: dict[str, AgentDoc] = {}
    for a in agents:
        for state in (a.voice or {}).values():
            if state.get("voiceAgentId"):
                by_voice[state["voiceAgentId"]] = a
    numbers = {n.id: n.number for n in svc.store.list_records(slug, "number")}
    return by_voice, {a.id: numbers.get(a.numberId) for a in agents if a.numberId}


def _belongs(ctx: OrgContext, session: dict, by_voice: dict) -> bool:
    if session.get("voice_agent_id") in by_voice:
        return True
    meta = session.get("metadata") or {}
    return meta.get("aica_org") == ctx.slug


def _token(ctx: OrgContext, body: dict) -> dict:
    orch, tenant = _orch(ctx)
    r = _call(lambda: orch.post("/v1/voice/tokens", {"ttl_s": TOKEN_TTL_S, **body}, tenant=tenant), "start the call")
    return {"token": r.data["token"], "expiresAt": r.data.get("expires_at"), "wsBase": orch.ws_base}


# ---------------------------------------------------------------- catalogue


def _models(orch, tenant: str | None) -> dict:
    """The console's ModelCatalogue from the orchestrator's (enabled entries only)."""
    raw = orch.get("/v1/models", tenant=tenant).data or {}
    kinds = raw.get("kinds") or {}

    def items(kind: str) -> list[dict]:
        return [{"id": i["id"], "label": i["id"], "note": i.get("description") or ""} for i in (kinds.get(kind) or {}).get("items", []) if i.get("enabled", True)]

    cfg = orch.get("/v1/config", tenant=tenant).data or {}
    llm = items("llm")
    return {
        "speech": items("asr"),
        "language": llm,
        "voice": items("tts_voice"),
        "defaults": {
            "speech": ((cfg.get("profile") or {}).get("asr") or {}).get("provider") or "",
            "language": next((i["id"] for i in (kinds.get("llm") or {}).get("items", []) if i.get("default")), llm[0]["id"] if llm else ""),
            "voice": "the voice server's active voice",
        },
        "live": True,
    }


@catalogue_router.get("/models")
def models(_: Caller = Depends(current_caller), svc: Services = Depends(get_services)):
    """What an agent's voice pipeline can choose from, from the voice server."""
    orch = require(svc)
    return _call(lambda: _models(orch, None), "list the models")


@catalogue_router.get("/voices/live")
def live_voices(_: Caller = Depends(current_caller), svc: Services = Depends(get_services)):
    """The TTS server's voices (reference ids) and its active voice."""
    orch = require(svc)
    data = _call(lambda: orch.get("/v1/tts/voices").data or {}, "list the voices")
    active = data.get("active") or {}
    return {
        "active": {"id": active.get("voice_id"), "name": (active.get("filename") or "Active voice").rsplit(".", 1)[0]} if active else None,
        "voices": [{"id": v.get("reference_id") or v.get("id") or v.get("voice_id"), "name": v.get("name") or v.get("reference_id") or v.get("id")} for v in data.get("voices") or [] if isinstance(v, dict)],
    }


@router.post("/voice/preview", dependencies=[PREVIEW_LIMIT])
def preview(body: PreviewIn, ctx: OrgContext = Depends(org_member)):
    """A short sample in a voice, as WAV. The agent's voice when the TTS
    server has it, else the server's active voice."""
    _allow(ctx, ("agents.configure", "agents.test"), "hear voices")
    text = body.text.strip()
    if not text:
        raise bad_input("Write something for the voice to say.")
    orch, tenant = _orch(ctx)
    cat = _call(lambda: voicesync.catalogue(orch, tenant), "load the voices")
    ref = voicesync.reference_for({"behaviour": {"voiceId": body.voice_id}}, cat)
    req = {"text": text, "format": "wav", **({"reference_id": ref} if ref else {})}
    r = _call(lambda: orch.request("POST", "/v1/tts/tts", tenant=tenant, json=req, raw=True, timeout=60), "play the voice")
    return Response(r.content, media_type="audio/wav", headers={"X-Voice": ref or "active", "Cache-Control": "no-store"})


# ---------------------------------------------------------------- an agent's copies


@router.get("/agents/{agent_id}/voice")
def agent_voice(agent_id: str, ctx: OrgContext = Depends(org_member)):
    """Its sync state and, when synced, the settings a call actually uses."""
    _allow(ctx, ("agents.view", "agents.test", "agents.configure"), "see agents")
    a = _agent(ctx, agent_id)
    out = {**voicesync.voice_out(a), "connected": ctx.svc.orch is not None and bool(ctx.org.orchTenantId), "profile": None}
    vid = out.get("voiceAgentId")
    if vid and out["connected"]:
        try:
            out["profile"] = ctx.svc.orch.get(f"/v1/voice-agents/{vid}/profile", tenant=ctx.org.orchTenantId).data
        except OrchestratorError as e:
            out["profileError"] = api_error(e).message
    return out


@router.post("/agents/{agent_id}/voice/sync", dependencies=[SYNC_LIMIT])
def resync(agent_id: str, ctx: OrgContext = Depends(org_member)):
    """Retry: the published version to the voice stack again."""
    _allow(ctx, ("agents.publish",), "publish agents")
    _no_staff(ctx)
    _orch(ctx)
    a = _agent(ctx, agent_id)
    if not a.version:
        raise bad_input("Publish the agent first.")
    a = voicesync.sync_live(ctx.svc, ctx.org, a, force=True)
    return voicesync.voice_out(a)


@router.post("/agents/{agent_id}/voice-token", dependencies=[TOKEN_LIMIT])
def agent_token(agent_id: str, body: TokenIn, ctx: OrgContext = Depends(org_member)):
    """A browser token for a test call: "test" talks to the saved setup
    (synced to the agent's test copy first), "live" to what callers get."""
    _allow(ctx, ("agents.test",), "test agents")
    _no_staff(ctx)
    if body.target not in ("test", "live"):
        raise bad_input("Choose the saved changes or the live version.")
    a = _agent(ctx, agent_id)
    if body.target == "test":
        state = voicesync.sync_test(ctx.svc, ctx.org, a)
    else:
        state = (a.voice or {}).get("live") or {}
        if state.get("status") != "synced" or not state.get("voiceAgentId"):
            raise bad_input("The live version isn't on the voice server yet. Publish it, or retry the sync on the Settings tab.")
        if a.status != "live":
            raise bad_input("The agent is paused, so it doesn't answer calls. Test the saved changes instead.")
    tok = _token(ctx, {"kind": "voice", "voice_agent_id": state["voiceAgentId"]})
    return {**tok, "voiceAgentId": state["voiceAgentId"], "warnings": state.get("warnings") or [],
            "metadata": {"aica_org": ctx.slug, "aica_agent_id": a.id, "aica_target": body.target}}


@router.post("/drafts/{draft_id}/voice-token", dependencies=[TOKEN_LIMIT])
def draft_token(draft_id: str, ctx: OrgContext = Depends(org_member)):
    """A test call with an agent still being built (bitNtech's master admin)."""
    if ctx.access.platform != "master_admin":
        raise forbidden("Only bitNtech can build agents. Send them a request instead.")
    d = ctx.svc.store.get_record(ctx.slug, "draft", draft_id)
    if not d or d.publishedAgentId:
        raise ApiError(404, "invalid_input", "That draft doesn't exist any more. It may have been deleted.")
    state = voicesync.sync_draft(ctx.svc, ctx.org, d)
    tok = _token(ctx, {"kind": "voice", "voice_agent_id": state["voiceAgentId"]})
    return {**tok, "voiceAgentId": state["voiceAgentId"], "warnings": state.get("warnings") or [],
            "metadata": {"aica_org": ctx.slug, "aica_draft_id": d.id, "aica_target": "test"}}


@router.get("/voice/calls/{call_id}/transcript")
def test_transcript(call_id: str, ctx: OrgContext = Depends(org_member)):
    """What was said on one of this organisation's test calls, as the agent heard it."""
    _allow(ctx, ("agents.test",), "test agents")
    orch, tenant = _orch(ctx)
    s = _call(lambda: orch.get(f"/v1/voice/sessions/{call_id}", tenant=tenant).data or {}, "load the call")
    by_voice, _ = _ours(ctx)
    if not _belongs(ctx, s, by_voice):
        raise ApiError(404, "invalid_input", "That call doesn't exist any more.")
    events = _call(lambda: (orch.get(f"/v1/voice/sessions/{call_id}/events", tenant=tenant, params={"limit": 500, "types": "transcript,response.interrupted"}).data or {}).get("data") or [], "load the call")
    started = vc.parse_ts(s.get("started_at"))
    return {"callId": call_id, "turns": vc.for_viewer(vc.turns_from_events(events, started, redact_agent=False), True), "stats": s.get("stats") or {}, "endReason": s.get("end_reason")}


# ---------------------------------------------------------------- scenarios


def _converse(orch, tenant: str, agent_id: str, lines: list[str], intents: list[str]) -> dict:
    """One scripted caller through a throwaway LLM session (no audio)."""
    session = orch.post("/v1/llm/sessions", {
        "agent_id": agent_id, "metadata": {"aica_scenario": True},
        "tools": [{"type": "client", "name": vc_handoff_tool(), "description": "Transfer the caller to a human staff member when they ask for a person, or when you cannot help.", "parameters": {"type": "object", "properties": {"reason": {"type": "string"}}}}],
    }, tenant=tenant).data
    sid = session.get("session_id") or session.get("id")
    replies, handover = [], False
    try:
        greet = (orch.get(f"/v1/llm/agents/{agent_id}", tenant=tenant).data or {}).get("greeting")
        if greet:
            replies.append(greet)
        for line in lines:
            r = orch.post(f"/v1/llm/sessions/{sid}/responses", {"input": line, "stream": False}, tenant=tenant, timeout=60).data or {}
            if r.get("text"):
                replies.append(r["text"])
            if any(t.get("name") == vc_handoff_tool() for t in r.get("tool_calls") or []):
                handover = True
                break
        intent = None
        if intents:
            r = orch.post(f"/v1/llm/sessions/{sid}/responses", {
                "input": "(internal check, not from the caller)", "stream": False,
                "instructions": "Ignore the caller for this one reply. Which of these intents did this call follow? Answer with exactly one of: " + " | ".join(intents) + " | NONE",
            }, tenant=tenant, timeout=60).data or {}
            intent = (r.get("text") or "").strip().strip(".")
    finally:
        try:
            orch.delete(f"/v1/llm/sessions/{sid}", tenant=tenant)
        except OrchestratorError:
            pass
    return {"replies": replies, "handover": handover, "intent": intent}


def vc_handoff_tool() -> str:
    from ...domain.agentcompile import HANDOFF_TOOL

    return HANDOFF_TOOL


@router.post("/agents/{agent_id}/scenarios/run", dependencies=[SCENARIO_LIMIT])
def run_scenarios(agent_id: str, ctx: OrgContext = Depends(org_member)):
    """Runs every scenario against the saved setup (its test copy), as text."""
    _allow(ctx, ("agents.test",), "run test scenarios")
    _no_staff(ctx)
    a = _agent(ctx, agent_id)
    state = voicesync.sync_test(ctx.svc, ctx.org, a)
    orch, tenant = _orch(ctx)
    intents = [n.get("label", "") for n in (a.working.get("flow") or []) if n.get("kind") == "intent" and n.get("label")]
    rows = sorted(ctx.svc.store.list_records(ctx.slug, "scenario", (("agentId", "==", agent_id),), limit=500), key=lambda s: s.createdAt)[:20]
    out = []
    for s in rows:
        try:
            res = _converse(orch, tenant, state["llmAgentId"], s.callerSays, intents if s.expect.get("intent") else [])
        except OrchestratorError as e:
            raise api_error(e, "run the scenarios")
        problems = []
        said = " ".join(res["replies"]).lower()
        for w in s.expect.get("mustSay") or []:
            if w.lower() not in said:
                problems.append(f"It never said “{w}”.")
        want = s.expect.get("handover")
        if want is True and not res["handover"]:
            problems.append("It didn't hand over to a person.")
        if want is False and res["handover"]:
            problems.append("It handed over to a person.")
        exp_intent = (s.expect.get("intent") or "").strip()
        if exp_intent and (res["intent"] or "").lower() != exp_intent.lower():
            problems.append(f"It followed “{res['intent'] or 'no intent'}”, not “{exp_intent}”.")
        s.lastRun = {"at": iso(now()), "passed": not problems, "problems": problems, "replies": res["replies"], "version": None}
        ctx.svc.store.save_record(ctx.slug, "scenario", s)
        out.append({"id": s.id, "name": s.name, "callerSays": s.callerSays, "expect": s.expect, "lastRun": s.lastRun})
    return out


# ---------------------------------------------------------------- live calls


def _see_calls(ctx: OrgContext) -> None:
    _allow(ctx, ("calls.viewAll", "calls.take"), "see calls")


def _act(ctx: OrgContext) -> None:
    _allow(ctx, ("calls.take",), "act on calls")
    _no_staff(ctx)


def _live_one(ctx: OrgContext, orch, tenant: str, s: dict, by_voice: dict, numbers: dict, personal: bool) -> dict:
    agent = by_voice.get(s.get("voice_agent_id"))
    try:
        events = (orch.get(f"/v1/voice/sessions/{s['id']}/events", tenant=tenant, params={"limit": LIVE_EVENTS, "types": "transcript,response.interrupted"}).data or {}).get("data") or []
    except OrchestratorError:
        events = []
    return vc.live_call(s, events, agent=agent, number=numbers.get(agent.id) if agent else None, personal=personal)


@router.get("/live-calls")
def live_calls(ctx: OrgContext = Depends(org_member)):
    _see_calls(ctx)
    orch, tenant = _orch(ctx)
    sessions = _call(lambda: (orch.get("/v1/voice/sessions", tenant=tenant, params={"status": "live", "limit": 100}).data or {}).get("data") or [], "list live calls")
    by_voice, numbers = _ours(ctx)
    mine = [s for s in sessions if _belongs(ctx, s, by_voice)][:MAX_LIVE]
    personal = ctx.access.has("calls.personal")
    return [_live_one(ctx, orch, tenant, s, by_voice, numbers, personal) for s in mine]


def _live_session(ctx: OrgContext, call_id: str) -> tuple:
    orch, tenant = _orch(ctx)
    s = _call(lambda: orch.get(f"/v1/voice/sessions/{call_id}", tenant=tenant).data or {}, "load the call")
    by_voice, numbers = _ours(ctx)
    if not _belongs(ctx, s, by_voice):
        raise ApiError(404, "invalid_input", "That call has ended or isn't one of yours.")
    if not s.get("live"):
        raise ApiError(409, "invalid_input", "That call has ended.")
    return orch, tenant, s, by_voice, numbers


@router.get("/live-calls/{call_id}")
def live_call(call_id: str, ctx: OrgContext = Depends(org_member)):
    _see_calls(ctx)
    orch, tenant, s, by_voice, numbers = _live_session(ctx, call_id)
    return _live_one(ctx, orch, tenant, s, by_voice, numbers, ctx.access.has("calls.personal"))


def _control(ctx: OrgContext, call_id: str, action: str, body: dict, what: str) -> dict:
    _act(ctx)
    orch, tenant, *_ = _live_session(ctx, call_id)
    _call(lambda: orch.post(f"/v1/voice/sessions/{call_id}/{action}", body, tenant=tenant), what)
    try:
        return live_call(call_id, ctx)
    except ApiError:
        return {"id": call_id, "ended": True}


@router.post("/live-calls/{call_id}/end", dependencies=[CONTROL_LIMIT])
def end_call(call_id: str, body: ReasonIn, ctx: OrgContext = Depends(org_member)):
    return _control(ctx, call_id, "end", {"reason": body.reason.strip() or "ended_by_staff"}, "end the call")


@router.post("/live-calls/{call_id}/interrupt", dependencies=[CONTROL_LIMIT])
def interrupt_call(call_id: str, ctx: OrgContext = Depends(org_member)):
    return _control(ctx, call_id, "interrupt", {}, "stop the agent")


@router.post("/live-calls/{call_id}/say", dependencies=[CONTROL_LIMIT])
def say(call_id: str, body: SayIn, ctx: OrgContext = Depends(org_member)):
    text = body.text.strip()
    if not text:
        raise bad_input("Write what the agent should say.")
    return _control(ctx, call_id, "say", {"text": text}, "say that")


@router.post("/live-calls/{call_id}/handoff", dependencies=[CONTROL_LIMIT])
def request_person(call_id: str, body: ReasonIn, ctx: OrgContext = Depends(org_member)):
    who = ctx.actor()[0]
    return _control(ctx, call_id, "handoff", {"reason": body.reason.strip() or f"{who} is taking the call"}, "hand the call to a person")


@router.post("/live-calls/{call_id}/release", dependencies=[CONTROL_LIMIT])
def release(call_id: str, body: ReleaseIn, ctx: OrgContext = Depends(org_member)):
    return _control(ctx, call_id, "handoff/release", {"resume_ai": body.resume_ai, "reason": body.reason.strip() or "released_by_staff"}, "give the call back")


@router.post("/live-calls/{call_id}/operator-token", dependencies=[TOKEN_LIMIT])
def operator_token(call_id: str, body: JoinIn, ctx: OrgContext = Depends(org_member)):
    """A browser token to listen in on, or take over, one live call."""
    _act(ctx)
    if body.mode not in ("listen", "takeover"):
        raise bad_input("Choose listen or take over.")
    _live_session(ctx, call_id)
    tok = _token(ctx, {"kind": "operator", "session_id": call_id})
    name = (ctx.member.name if ctx.member else ctx.actor()[0]) or "Staff"
    return {**tok, "path": f"/v1/voice/sessions/{call_id}/operator", "mode": body.mode, "name": name[:60]}


# ---------------------------------------------------------------- finished calls and handoffs


def record_session(svc, org, s: dict, by_voice: dict, numbers: dict) -> bool:
    """Writes one ended call into Call history (once). Test calls aren't
    customer calls: they stay out of history and reports."""
    meta = s.get("metadata") or {}
    agent = by_voice.get(s.get("voice_agent_id"))
    if meta.get("aica_target") == "test" or not agent or (agent.voice or {}).get("live", {}).get("voiceAgentId") != s.get("voice_agent_id"):
        return False
    if svc.store.get_record(org.slug, "call", s["id"]):
        return False
    events = (svc.orch.get(f"/v1/voice/sessions/{s['id']}/events", tenant=org.orchTenantId, params={"limit": 1000}).data or {}).get("data") or []
    fields = vc.call_fields(s, events, agent=agent, number=numbers.get(agent.id))
    return record_call(svc, org.slug, CallDoc(**fields))


@router.post("/calls/sync", dependencies=[SYNC_LIMIT])
def sync_calls(ctx: OrgContext = Depends(org_member), pages: int = Query(3, ge=1, le=10)):
    """Brings finished calls into Call history, for when the voice server's
    events can't reach this API (local development). Safe to repeat."""
    _allow(ctx, ("calls.viewAll",), "see every call")
    orch, tenant = _orch(ctx)
    by_voice, numbers = _ours(ctx)
    added, cursor = 0, None
    for _ in range(pages):
        page = _call(lambda: orch.get("/v1/voice/sessions", tenant=tenant, params={"status": "ended", "limit": 50, "cursor": cursor}).data or {}, "load finished calls")
        rows = page.get("data") or []
        fresh = 0
        for s in rows:
            if not _belongs(ctx, s, by_voice):
                continue
            try:
                if record_session(ctx.svc, ctx.org, s, by_voice, numbers):
                    added += 1
                    fresh += 1
            except OrchestratorError as e:
                raise api_error(e, "load finished calls")
        cursor = page.get("next_cursor")
        # Newest first: a page with nothing new means the rest is in already.
        if not cursor or (rows and not fresh and all(ctx.svc.store.get_record(ctx.slug, "call", s["id"]) or not _belongs(ctx, s, by_voice) for s in rows)):
            break
    return {"added": added}


def upsert_handoff(svc, org, h: dict, by_voice: dict, numbers: dict, recent: list[dict] | None = None) -> HandoffDoc | None:
    agent = by_voice.get(h.get("voice_agent_id"))
    if not agent:
        return None
    fields = vc.handoff_fields(h, agent_name=agent.name, line=numbers.get(agent.id) or "Web call", phone="", language=vc.language_of(list(agent.languages)), recent=recent)

    def run(tx: Tx) -> HandoffDoc:
        cur = tx.get_record(org.slug, "handoff", fields["id"])
        if cur:
            # Taking it here (takenBy) and its summary are kept; the state follows the voice server.
            if fields["status"] != "waiting" or cur.status == "waiting":
                cur.status = cur.status if cur.status == "taken" and fields["status"] == "missed" else fields["status"]
            cur.takenBy = cur.takenBy or fields["takenBy"]
            if fields["summary"] and not cur.summary:
                cur.summary = fields["summary"]
            tx.save_record(org.slug, "handoff", cur)
            return cur
        doc = HandoffDoc(**fields)
        tx.save_record(org.slug, "handoff", doc)
        return doc

    return svc.store.transact(run)


def pull_handoffs(ctx: OrgContext) -> None:
    """The voice server's recent handoffs into the queue (best effort)."""
    if ctx.svc.orch is None or not ctx.org.orchTenantId:
        return
    try:
        rows = (ctx.svc.orch.get("/v1/handoffs", tenant=ctx.org.orchTenantId, params={"limit": 50}).data or {}).get("data") or []
    except OrchestratorError:
        return
    by_voice, numbers = _ours(ctx)
    since = now() - timedelta(hours=24)
    for h in rows:
        t = vc.parse_ts(h.get("requested_at"))
        if t and t >= since:
            upsert_handoff(ctx.svc, ctx.org, h, by_voice, numbers)
