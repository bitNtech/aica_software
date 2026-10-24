"""What callers' personal details look like on the way out, and the call
log's search tokens.

The server decides what a person sees: without `calls.personal`, callers'
names, the details marked personal and the personal values inside
transcripts are removed here, not only hidden by the console. Callers'
numbers on calls and handoffs are always masked, as the console shows them;
callbacks carry the full number, because whoever calls back needs it.
"""
from __future__ import annotations

import re

PERSONAL_MARK = re.compile(r"\{\{(\w+):([^}]*)\}\}")
NO_NAME = "A caller"


def digits(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def mask_phone(phone: str) -> str:
    """"+91 ••••• 43210", as the console shows callers everywhere but callbacks."""
    d = digits(phone)
    return f"+91 ••••• {d[-5:]}" if len(d) >= 5 else "+91 •••••"


def format_phone(phone: str) -> str:
    """"+91 98402 33415" for a ten-digit Indian number (with or without 91)."""
    d = digits(phone)
    if len(d) == 12 and d.startswith("91"):
        d = d[2:]
    return f"+91 {d[:5]} {d[5:]}" if len(d) == 10 else (phone or "")


def redact_text(text: str) -> str:
    """{{name:Lakshmi}} → [name], as the console renders a redacted turn."""
    return PERSONAL_MARK.sub(lambda m: f"[{m.group(1).replace('_', ' ', 1)}]", text or "")


def without_name(text: str, name: str | None) -> str:
    out = redact_text(text)
    if name:
        out = re.sub(re.escape(name), NO_NAME, out, flags=re.IGNORECASE)
    return out


def details_out(details: list[dict], personal: bool) -> list[dict]:
    return [{"label": d.get("label", ""), "value": d.get("value", "") if personal or not d.get("personal") else "", "personal": bool(d.get("personal"))} for d in details]


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9஀-௿]+", (text or "").lower()) if len(w) >= 2]


def search_tokens(caller_phone: str, intent: str, agent_name: str, caller_name: str | None) -> list[str]:
    """What the call log's search can match: any 3-5 digit run of the
    number's last five digits (all the console shows), intent and agent
    words, and the caller's name words (prefixed, searchable only by those
    who may see names)."""
    last = digits(caller_phone)[-5:]
    tokens = {last[i : i + n] for n in (3, 4, 5) for i in range(len(last) - n + 1)}
    tokens |= set(_words(intent)) | set(_words(agent_name))
    tokens |= {f"n:{w}" for w in _words(caller_name or "")}
    return sorted(tokens)


def query_tokens(q: str, personal: bool) -> list[str] | None:
    """The token to look for. Firestore matches one array value, so a
    several-word search uses its longest word."""
    q = (q or "").strip().lower()
    if not q:
        return None
    d = digits(q)
    if len(d) >= 3 and len(d) == len(re.sub(r"[\s+\-()]", "", q)):
        return [d[-5:]]
    words = _words(q)
    if not words:
        return None
    w = max(words, key=len)
    return [w, f"n:{w}"] if personal else [w]
