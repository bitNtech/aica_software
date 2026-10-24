"""Agent types, voices, built-in tools and the defaults a new agent starts
from, from catalogue.json. That file is generated from the frontend's
defaults (frontend/src/console/demo/…), and
frontend/src/test/catalogue-parity.test.ts fails if the two drift.
Templates become editable by bitNtech in Phase 8; until then this is fixed.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

_DATA = json.loads(Path(__file__).with_name("catalogue.json").read_text(encoding="utf-8"))

AGENT_TYPES: list[dict] = _DATA["agentTypes"]
VOICES: list[dict] = _DATA["voices"]
BUILTIN_TOOLS: list[dict] = _DATA["builtinTools"]
VOICE_IDS = {v["id"] for v in VOICES}


def sub_type(type_id: str | None, sub_type_id: str | None) -> dict | None:
    t = next((t for t in AGENT_TYPES if t["id"] == type_id), None)
    return next((s for s in t["subTypes"] if s["id"] == sub_type_id), None) if t else None


def default_behaviour(org_name: str) -> dict:
    b = copy.deepcopy(_DATA["behaviour"])
    b["greeting"] = b["greeting"].replace("{orgName}", org_name)
    return b


def default_pipeline() -> dict:
    return copy.deepcopy(_DATA["pipeline"])


def default_speech() -> dict:
    return copy.deepcopy(_DATA["speech"])


def default_guardrails() -> dict:
    return copy.deepcopy(_DATA["guardrails"])


def default_context() -> dict:
    return copy.deepcopy(_DATA["context"])


def default_analysis(sub_type_id: str | None) -> dict:
    return copy.deepcopy(_DATA["analysis"].get(sub_type_id or "", _DATA["analysis"]["default"]))
