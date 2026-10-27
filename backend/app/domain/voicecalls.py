"""The orchestrator's calls, events and handoffs in the console's shapes
(docs/orchestrator-contract.md §Calls). Pure functions; the routes fetch.

Privacy: the orchestrator's transcripts carry no personal-data marks, so
whatever the caller (or staff) said is marked personal as a whole, and the
agent's words too when the agent hides personal details (`redact`). People
without `calls.personal` then see "[caller words]" (app/domain/redact.py).

Outcomes are provisional until calls are analysed: handed over when a
person was asked for; dropped when the caller hung up having said little;
otherwise resolved.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .redact import redact_text

CALLER_MARK = "caller_words"
AGENT_MARK = "agent_words"
AGENT_ENDED = {"end_conversation", "agent_ended", "agent_hangup", "end_requested", "hangup_after_reprompts", "idle_timeout", "max_duration"}


def parse_ts(v) -> datetime | None:
    if not v or not isinstance(v, str):
        return None
    try:
        t = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _mark(kind: str, text: str) -> str:
    # The mark's own delimiters can't appear inside it.
    clean = (text or "").replace("{", "(").replace("}", ")")
    return f"{{{{{kind}:{clean}}}}}" if clean.strip() else ""


def turns_from_events(events: list[dict], started: datetime | None, *, redact_agent: bool) -> list[dict]:
    """TranscriptTurn[] from the call's event log (`transcript` events),
    with interrupted replies cut to what the caller heard."""
    cut = {e["data"].get("response_id"): e["data"].get("spoken_text", "") for e in events if e.get("type") == "response.interrupted" and isinstance(e.get("data"), dict)}
    out = []
    for e in events:
        if e.get("type") != "transcript":
            continue
        d = e.get("data") or {}
        text = d.get("text") or ""
        role = d.get("role")
        rid = d.get("response_id")
        interrupted = rid in cut
        if interrupted:
            text = cut[rid]
        if not text.strip():
            continue
        at = parse_ts(e.get("ts"))
        secs = int(max(0, (at - started).total_seconds())) if at and started else 0
        if role == "assistant":
            turn = {"speaker": "agent", "at": secs, "text": _mark(AGENT_MARK, text) if redact_agent else text}
        else:
            turn = {"speaker": "staff" if role == "operator" else "caller", "at": secs, "text": _mark(CALLER_MARK, text)}
        if interrupted:
            turn["interrupted"] = True
        out.append(turn)
    return out


def for_viewer(turns: list[dict], personal: bool) -> list[dict]:
    return turns if personal else [{**t, "text": redact_text(t.get("text", ""))} for t in turns]


def tool_calls_from_events(events: list[dict]) -> list[dict]:
    out = []
    for e in events:
        if e.get("type") == "tool_call":
            d = e.get("data") or {}
            out.append({"name": d.get("name", ""), "summary": f"{d.get('name', '')} ({d.get('kind', 'tool')})", "ok": True})
    return out[:50]


def outcome_of(session: dict) -> str:
    stats = session.get("stats") or {}
    if (stats.get("handoffs") or 0) > 0:
        return "handed_over"
    reason = (session.get("end_reason") or "").lower()
    if reason in AGENT_ENDED:
        return "resolved"
    if (stats.get("turns") or 0) <= 1:
        return "dropped"
    return "resolved"


def language_of(languages: list[str]) -> str:
    return languages[0] if len(languages) == 1 else "mixed"


def caller_phone(session: dict) -> str:
    meta = session.get("metadata") or {}
    for k in ("caller_phone", "from", "caller", "ani"):
        v = meta.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def line_of(session: dict, number: str | None) -> str:
    ch = (session.get("channel") or "").lower()
    if ch in ("web", "console", "app"):
        return "Web call"
    return number or ch or "Phone"


def call_fields(session: dict, events: list[dict], *, agent, number: str | None) -> dict:
    """CallDoc fields for an ended session."""
    started = parse_ts(session.get("started_at")) or parse_ts(session.get("ended_at")) or datetime.now(timezone.utc)
    stats = session.get("stats") or {}
    spec = (agent.working if agent else {}) or {}
    fa = stats.get("first_audio_ms") or {}
    metrics: dict = {}
    if isinstance(fa.get("p50"), (int, float)):
        metrics = {"firstAudioMsP50": fa.get("p50"), "firstAudioMsMax": fa.get("max"), "bargeIns": stats.get("barge_ins", 0), "interruptions": stats.get("barge_ins", 0)}
    return {
        "id": session["id"],
        "agentId": agent.id if agent else (session.get("voice_agent_id") or "unknown"),
        "agentName": agent.name if agent else "Unknown agent",
        "line": line_of(session, number),
        "callerPhone": caller_phone(session),
        "startedAt": started,
        "durationSec": int(round(float(stats.get("duration_s") or 0))),
        "language": language_of(list(agent.languages) if agent else []),
        "intent": "Not analysed yet",
        "outcome": outcome_of(session),
        "transcript": turns_from_events(events, started, redact_agent=bool(spec.get("redact", True))),
        "toolCalls": tool_calls_from_events(events),
        "metrics": metrics,
        "summary": "",
        "analysis": {"voice": {k: stats.get(k) for k in ("turns", "responses", "barge_ins", "false_interruptions", "asr_errors", "handoffs", "tool_calls", "audio_in_s", "audio_out_s")}, "endReason": session.get("end_reason")},
    }


HANDOFF_STATUS = {"pending": "waiting", "active": "taken", "released": "taken", "ended": "taken", "timeout": "missed"}


def handoff_fields(h: dict, *, agent_name: str, line: str, phone: str, language: str, recent: list[dict] | None = None) -> dict:
    reason = (h.get("reason") or "The agent asked for a person.").strip()
    summary = ""
    if recent:
        lines = [f"{'Caller' if t.get('role') == 'user' else 'Agent'}: {t.get('text') or t.get('content') or ''}".strip() for t in recent[-6:]]
        summary = _mark(CALLER_MARK, " / ".join(x for x in lines if x))
    op = h.get("operator") or {}
    return {
        "id": h["id"], "callId": h.get("session_id", ""), "agentName": agent_name, "line": line, "callerPhone": phone, "reason": reason[:500],
        "summary": summary, "language": language, "waitingSince": parse_ts(h.get("requested_at")) or datetime.now(timezone.utc),
        "status": HANDOFF_STATUS.get(h.get("status") or "pending", "waiting"), "takenBy": op.get("name") if h.get("status") != "pending" else None,
        "emergency": "emergenc" in reason.lower(),
    }


def live_call(session: dict, events: list[dict], *, agent, number: str | None, personal: bool) -> dict:
    """The console's LiveCall for a call in progress."""
    started = parse_ts(session.get("started_at"))
    spec = (agent.working if agent else {}) or {}
    turns = for_viewer(turns_from_events(events, started, redact_agent=bool(spec.get("redact", True))), personal)
    handoff = session.get("handoff") if isinstance(session.get("handoff"), dict) else None
    ops = session.get("operators") if isinstance(session.get("operators"), list) else []
    mode = session.get("mode") or ""
    taken = None
    if mode == "human" or (handoff and handoff.get("status") == "active"):
        taken = ((handoff or {}).get("operator") or {}).get("name") or (ops[0].get("name") if ops and isinstance(ops[0], dict) else None) or "A colleague"
    meta = session.get("metadata") or {}
    stats = session.get("stats") or {}
    return {
        "id": session["id"],
        "agentId": agent.id if agent else (session.get("voice_agent_id") or ""),
        "agentName": agent.name if agent else ("Test call" if meta.get("aica_target") == "test" else "Unknown agent"),
        "line": line_of(session, number),
        "callerPhone": "+91 •••••" if not caller_phone(session) else _masked(caller_phone(session)),
        "startedAt": session.get("started_at"),
        "language": language_of(list(agent.languages) if agent else []),
        "intent": None,
        "step": {"handoff_pending": "Waiting for a person", "human": "With a person"}.get(mode),
        "turns": turns,
        "flagged": bool((stats.get("asr_errors") or 0) >= 3 or (handoff and handoff.get("status") == "pending")),
        "takenBy": taken,
        "whispers": [],
        "transferredTo": None,
        "test": meta.get("aica_target") == "test",
        "mode": mode or "ai",
        "handoffId": (handoff or {}).get("id"),
    }


def _masked(phone: str) -> str:
    from .redact import mask_phone

    return mask_phone(phone)
