"""Turns an AICA agent setup (AgentSpec) into what the voice stack runs:

- an **LLM agent** on the LLM server (via the orchestrator's /v1/llm
  passthrough): instructions written from the persona, rules, flow, details
  to collect, global flows, guardrails and FAQ knowledge; the model,
  temperature, greeting and tools;
- a **voice agent** on the orchestrator: VAD, ASR, voice, barge-in,
  fillers, idle handling, handoff and caller-facing prompts, as overrides
  of the server's defaults (only what the setup actually says).

Pure functions, no I/O: routes/org/voice.py does the calls. Setup fields the
voice stack has nothing for are listed by `unmapped`, so the console can
say so instead of pretending (docs/orchestrator-contract.md §Mapping).
"""
from __future__ import annotations

import hashlib
import json
import re

MAX_INSTRUCTIONS = 60_000
LANG_NAMES = {"tamil": "Tamil", "english": "English", "tanglish": "Tanglish (Tamil and English mixed, as people speak it)"}
TONES = {
    "warm": "warm, friendly and patient",
    "formal": "polite and formal",
    "brisk": "efficient and to the point, still polite",
}
END_TOOL = "end_conversation"  # the LLM server's built-in
HANDOFF_TOOL = "transfer_to_human"  # injected by the orchestrator
FAQ_LIMIT = 200


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def _quote(s: str | None) -> str:
    return '"' + _clean(s).replace('"', "'") + '"'


def _clamp(v, lo, hi, default):
    try:
        x = int(round(float(v)))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, x))


# ---------------------------------------------------------------- flow


def _number(flow: list[dict]) -> dict[str, str]:
    """Node id → "2.1.3": its position in the tree, for joins to refer to."""
    out: dict[str, str] = {}

    def walk(nodes: list[dict], prefix: str) -> None:
        for i, n in enumerate(nodes, 1):
            num = f"{prefix}{i}"
            if n.get("id"):
                out[n["id"]] = num
            walk(n.get("children") or [], f"{num}.")

    walk(flow, "")
    return out


def _flow_lines(flow: list[dict]) -> list[str]:
    nums = _number(flow)
    lines: list[str] = []

    def node(n: dict, depth: int) -> None:
        pad = "  " * depth
        num = nums.get(n.get("id", ""), "?")
        kind = n.get("kind")
        label = _clean(n.get("label"))
        if kind == "intent":
            head = f"{pad}Intent {num}: {label}"
            if n.get("condition"):
                head += f" (when {_clean(n['condition'])})"
        elif kind == "branch":
            head = f"{pad}{num}. If {_clean(n.get('condition')) or label}: {label}"
        else:
            head = f"{pad}{num}. {label}"
        if n.get("say"):
            head += f" Say: {_quote(n['say'])}"
        lines.append(head)
        kids = n.get("children") or []
        branches = [k for k in kids if k.get("kind") == "branch"]
        if len(kids) > 1 or branches:
            lines.append(f"{pad}  Then, depending on the caller:")
            for k in kids:
                if k.get("kind") != "branch":
                    lines.append(f"{pad}  Otherwise:")
                node(k, depth + 1)
        else:
            for k in kids:
                node(k, depth + 1)
        target = n.get("joinsAt")
        if target and target in nums:
            lines.append(f"{pad}  After this, carry on at step {nums[target]}.")

    for n in flow:
        node(n, 0)
    return lines


# ---------------------------------------------------------------- instructions


def instructions(spec: dict, *, org_name: str, use_case: str, faq: list[dict] | None = None, tool_names: list[str] | None = None) -> str:
    b = spec.get("behaviour") or {}
    g = spec.get("guardrails") or {}
    ctx = spec.get("context") or {}
    persona = _clean(b.get("persona")) or "the receptionist"
    langs = [LANG_NAMES.get(x, x) for x in b.get("languages") or []]
    start = LANG_NAMES.get(b.get("startLanguage") or "", "")
    out: list[str] = [
        f"You are {persona}, the phone receptionist for {_clean(org_name) or 'the hospital'}. You handle calls about: {_clean(use_case) or 'general enquiries'}.",
        f"Your manner is {TONES.get(b.get('tone') or '', 'warm and polite')}.",
        "This is a phone call: reply in one or two short spoken sentences. Never use lists, headings, markdown, emojis or URLs. Ask one question at a time.",
    ]
    if langs:
        lang_line = f"You speak {', '.join(langs)}."
        if start:
            lang_line += f" The greeting is in {start}."
        lang_line += " After that, always reply in the language the caller is speaking, and switch when they do." if b.get("followCaller") else " Keep to that language unless the caller can't follow it."
        out.append(lang_line)

    rules = [_clean(r) for r in b.get("rules") or [] if _clean(r)]
    refuse = [_clean(t) for t in g.get("refuseTopics") or [] if _clean(t)]
    if rules or refuse:
        out.append("\nRules you always follow:")
        out += [f"- {r}" for r in rules]
        transfer = _clean(g.get("transferTo")) or "a member of staff"
        out += [f"- Never discuss {t}. Say you can't help with that on this call and offer to connect them to {transfer}." for t in refuse]

    flow = spec.get("flow") or []
    if flow:
        out.append("\nHow calls go. Work out which intent the caller has, then follow its steps in order. A step's \"Say\" is what to say, in the caller's language; keep its meaning, you may word it naturally.")
        out += _flow_lines(flow)

    attrs = spec.get("attributes") or []
    if attrs:
        out.append("\nDetails to collect when the call needs them:")
        for a in attrs:
            bits = [f"- {_clean(a.get('label'))} ({'required' if a.get('required') else 'if the caller has it'}, {a.get('type', 'text').replace('_', ' ')})"]
            if a.get("ask"):
                bits.append(f"ask: {_quote(a['ask'])}")
            if a.get("options"):
                bits.append("one of: " + ", ".join(_clean(o) for o in a["options"]))
            if a.get("confirm"):
                bits.append("read it back to confirm")
            if a.get("personal"):
                bits.append("personal: don't repeat it unless confirming")
            out.append("; ".join(bits))

    situations = []
    for f in spec.get("globalFlows") or []:
        if not f.get("enabled"):
            continue
        kind, trig, resp = f.get("kind"), _clean(f.get("trigger")), _clean(f.get("response"))
        if kind == "handoff":
            situations.append(f"- If {trig or 'the caller asks for a person'}: say {_quote(resp)} and call {HANDOFF_TOOL}.")
        elif kind == "emergency":
            to = _clean(g.get("emergencyTo"))
            situations.append(f"- If {trig or 'it sounds like an emergency'}: say {_quote(resp)}" + (f" Tell them to contact {to}." if to else "") + f" Then call {HANDOFF_TOOL} with reason \"emergency\".")
        elif kind == "end_call":
            situations.append(f"- If {trig or 'the caller is done'}: say {_quote(resp or b.get('closing'))} and call {END_TOOL}.")
        elif kind in ("repeat", "out_of_scope"):
            situations.append(f"- If {trig}: {resp}")
    fails = g.get("handoffAfterFailures") or 0
    if fails:
        situations.append(f"- If you fail to understand or help the caller {fails} times in a row, offer a person and call {HANDOFF_TOOL}.")
    if situations:
        out.append("\nAt any point in the call:")
        out += situations

    if tool_names:
        out.append("\nYou can use these tools: " + ", ".join(tool_names) + ".")
        if ctx.get("confirmBeforeActions"):
            out.append("Before any tool that books, changes or sends something, read the details back and get the caller's yes.")

    if faq:
        if ctx.get("answerOnlyFromKnowledge"):
            out.append("\nAnswer factual questions about the hospital only from the information below. If it isn't there, say you'll have someone check, and offer a person.")
        else:
            out.append("\nInformation about the hospital:")
        for q in faq[:FAQ_LIMIT]:
            out.append(f"Q: {_clean(q.get('q'))}\nA: {_clean(q.get('a'))}")

    prons = (spec.get("speech") or {}).get("pronunciations") or []
    if prons:
        out.append("\nWrite these words in your replies exactly as shown on the right, so they are said correctly:")
        out += [f"- {_clean(p.get('word'))} → {_clean(p.get('sayAs'))}" for p in prons if p.get("word")]

    closing = _clean(b.get("closing"))
    if closing:
        out.append(f"\nWhen the caller has what they need, say {_quote(closing)} and call {END_TOOL}.")
    text = "\n".join(out)
    return text[:MAX_INSTRUCTIONS]


def greeting(spec: dict) -> str:
    b = spec.get("behaviour") or {}
    g = spec.get("guardrails") or {}
    text = _clean(b.get("greeting"))
    if g.get("recordingNotice") and _clean(g.get("recordingNoticeText")):
        text = f"{text} {_clean(g['recordingNoticeText'])}".strip()
    return text


# ---------------------------------------------------------------- tools


PARAM_SCHEMA = {"string": {"type": "string"}, "number": {"type": "number"}, "boolean": {"type": "boolean"}, "date": {"type": "string", "format": "date"}}


def tool_name(t) -> str:
    """A model-facing function name from the tool's name: "Book an appointment" → book_an_appointment."""
    n = re.sub(r"[^a-z0-9]+", "_", (t.name or "").lower()).strip("_")[:48] or "tool"
    return n if n[0].isalpha() else f"t_{n}"


def http_tool_body(t, secret: str | None) -> dict:
    """An AICA http tool (ToolDoc) as an LLM-server tool."""
    props, required = {}, []
    for p in t.params or []:
        props[p["name"]] = {**PARAM_SCHEMA.get(p.get("type"), {"type": "string"}), "description": _clean(p.get("description"))[:500]}
        if p.get("required"):
            required.append(p["name"])
    body = {
        "name": tool_name(t), "description": _clean(t.description)[:1000] or _clean(t.name), "kind": "http",
        "parameters": {"type": "object", "properties": props, "required": required},
        "http": {"url": t.url, "method": (t.method or "POST").upper(), "body_mode": "arguments"},
        "side_effects": bool(t.acts), "timeout_s": max(1, min(30, (t.timeoutMs or 5000) / 1000)),
    }
    if t.credentialName and secret is not None:
        header = t.credentialHeader or "Authorization"
        body["secret_headers"] = {header: secret if t.credentialHeader else f"Bearer {secret}"}
    return body


def tool_hash(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]


# ---------------------------------------------------------------- the two agents


def llm_agent(spec: dict, *, name: str, org_name: str, use_case: str, model: str | None, tool_refs: list[dict], tool_names: list[str], faq: list[dict], metadata: dict) -> dict:
    p = spec.get("pipeline") or {}
    try:
        temperature = max(0.0, min(2.0, float(p.get("temperature", 0.4))))
    except (TypeError, ValueError):
        temperature = 0.4
    body = {
        "name": _clean(name)[:120] or "AICA agent",
        "description": f"AICA: {_clean(org_name)} — {_clean(use_case)}"[:500],
        "instructions": instructions(spec, org_name=org_name, use_case=use_case, faq=faq, tool_names=tool_names),
        "params": {"temperature": temperature, "max_tokens": 300, "reasoning_effort": "minimal"},
        "tools": [{"type": "builtin", "name": "get_current_time"}, {"type": "builtin", "name": END_TOOL}, *tool_refs],
        "greeting": greeting(spec),
        "segmentation": True,
        "metadata": metadata,
    }
    if model:
        body["model"] = model
    return body


def asr_language(spec: dict) -> str | None:
    langs = set((spec.get("behaviour") or {}).get("languages") or [])
    if langs == {"tamil"}:
        return "ta"
    if langs == {"english"}:
        return "en"
    return None  # mixed or Tanglish: auto-detect


def voice_agent(spec: dict, *, name: str, llm_agent_id: str, status: str, webhook_url: str | None, metadata: dict, reference_id: str | None = None) -> dict:
    """Overrides of the orchestrator's voice profile (CONFIGURATION.md §Voice profile)."""
    p = spec.get("pipeline") or {}
    s = spec.get("speech") or {}
    g = spec.get("guardrails") or {}
    flows = {f.get("kind"): f for f in spec.get("globalFlows") or []}
    hints = ", ".join(_clean(h) for h in s.get("hints") or [] if _clean(h))[:1000]
    asr: dict = {"language": asr_language(spec), "prompt": hints or None}
    if p.get("speechModel") and p["speechModel"] != "default":
        asr["provider"] = p["speechModel"]
    body: dict = {
        "name": _clean(name)[:120] or "AICA agent",
        "llm_agent_id": llm_agent_id,
        "status": status,
        "vad": {
            "semantic_turn": p.get("turnDetection", "semantic") == "semantic",
            "turn_check_ms": _clamp(p.get("minEndpointMs"), 40, 2000, 160),
            "end_silence_ms": _clamp(p.get("maxEndpointMs"), 100, 5000, 900),
        },
        "asr": asr,
        "pipeline": {
            "barge_in": {
                "enabled": bool(s.get("allowInterruptions", True)),
                "min_speech_ms": _clamp(p.get("interruptMinMs"), 0, 5000, 200),
                "false_interruption": "continue" if p.get("resumeAfterFalseInterruption", True) else "ignore",
            },
            "acknowledgement": {"enabled": bool(p.get("backchannel"))},
            "fillers": {"enabled": bool(p.get("fillerPhrases")), "phrases": [_clean(x) for x in p.get("fillerPhrases") or [] if _clean(x)] or ["One moment."]},
            "greeting": {"mode": "agent"},
            "idle": {"reprompt_after_s": max(0.0, float(s.get("silenceSec") or 10)), "max_reprompts": _clamp(p.get("silenceReprompts"), 0, 10, 2)},
            "max_call_duration_s": max(60.0, float(g.get("maxCallMinutes") or 30) * 60),
        },
        "handoff": {"enabled": bool((flows.get("handoff") or {}).get("enabled", True))},
        "metadata": metadata,
    }
    # None: the TTS server's active voice.
    body["voice"] = {"reference_id": reference_id, "use_active_voice": reference_id is None}
    prompts: dict = {}
    if (flows.get("handoff") or {}).get("enabled") and _clean(flows["handoff"].get("response")):
        prompts["handoff_message"] = _clean(flows["handoff"]["response"])
    if (flows.get("silence") or {}).get("enabled") and _clean(flows["silence"].get("response")):
        prompts["idle_goodbye"] = _clean(flows["silence"]["response"])
    # PATCH replaces a section it's given and keeps the rest, so always send it:
    # {} clears prompts set earlier.
    body["prompts"] = prompts
    if webhook_url:
        body["webhook_url"] = webhook_url
    return body


def unmapped(spec: dict) -> list[str]:
    """Settings the voice stack doesn't use, worded for the console."""
    p = spec.get("pipeline") or {}
    b = spec.get("behaviour") or {}
    out = []
    if p.get("noiseCancellation", "off") != "off":
        out.append("Noise cancellation is set for the whole voice server by bitNtech, not per agent.")
    if p.get("ambience", "none") != "none":
        out.append("Background ambience isn't available on the voice server yet.")
    if p.get("keypadInput"):
        out.append("Keypad input isn't available on the voice server yet.")
    if p.get("preemptiveReplies") is False:
        out.append("Replies always start as early as possible; this can't be switched off.")
    if (p.get("interruptMinWords") or 0) > 1:
        out.append("Interruptions are decided by how long the caller speaks and what they say, not by a word count.")
    if b.get("rate", "normal") != "normal":
        out.append("Speaking rate isn't adjustable on the voice server yet.")
    ctx = spec.get("context") or {}
    if ctx.get("knowledgeSourceIds"):
        out.append("Only question-and-answer knowledge reaches the agent for now; documents and web pages don't yet.")
    return out
