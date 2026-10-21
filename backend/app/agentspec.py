"""Checks for an agent's setup (AgentSpec) and a builder draft (AgentDraft),
mirroring frontend/src/console/types.ts. Limits are generous: they stop
abuse and accidents (a 5 MB greeting), not anything the console allows.
Unknown fields are kept, so a newer console doesn't lose data; the whole
setup is capped in size instead. The voice pipeline block is kept as
given until its contract is fixed (docs/backend-workflow.md §5).

Locked fields: only bitNtech's master admin changes an agent's structure.
`LOCKED` is the demo client's exact list (demoClient.ts saveAgent).
"""
from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .catalogue import VOICE_IDS

Language = Literal["tamil", "english", "tanglish"]
Text = lambda n: Annotated[str, Field(max_length=n)]  # noqa: E731
MAX_SPEC_BYTES = 256 * 1024
MAX_NODES = 1000
BUILDER_STEPS = ("calls", "type", "behaviour", "flow", "attributes", "global", "context", "review")


class _M(BaseModel):
    model_config = ConfigDict(extra="allow")


class Behaviour(_M):
    persona: Text(80)
    tone: Literal["warm", "formal", "brisk"]
    languages: list[Language] = Field(min_length=1, max_length=3)
    startLanguage: Language
    followCaller: bool
    greeting: Text(1000)
    closing: Text(600)
    voiceId: Text(64)
    rate: Literal["slower", "normal", "faster"]
    rules: list[Text(500)] = Field(max_length=50)

    @model_validator(mode="after")
    def _consistent(self):
        if self.startLanguage not in self.languages:
            raise ValueError("start language must be one of the languages")
        if self.voiceId not in VOICE_IDS:
            raise ValueError("unknown voice")
        return self


class Pronunciation(_M):
    word: Text(120)
    sayAs: Text(160)


class Speech(_M):
    pronunciations: list[Pronunciation] = Field(max_length=200)
    hints: list[Text(120)] = Field(max_length=300)
    allowInterruptions: bool
    silenceSec: float = Field(ge=0, le=300)


class FlowNode(_M):
    id: Text(80)
    kind: Literal["intent", "step", "branch"]
    label: Text(300)
    say: Text(2000) | None = None
    condition: Text(600) | None = None
    confidence: float | None = Field(None, ge=0, le=1)
    sourceCallIds: list[Text(80)] = Field(default_factory=list, max_length=500)
    children: list["FlowNode"] = Field(default_factory=list, max_length=200)


class Attribute(_M):
    id: Text(80)
    label: Text(160)
    type: Literal["text", "name", "phone", "date", "time", "number", "choice", "patient_id"]
    required: bool
    personal: bool
    confirm: bool
    ask: Text(600)
    options: list[Text(160)] | None = Field(None, max_length=100)


class GlobalFlow(_M):
    kind: Literal["handoff", "emergency", "repeat", "out_of_scope", "silence", "end_call"]
    enabled: bool
    trigger: Text(600)
    response: Text(1000)


class Context(_M):
    knowledgeSourceIds: list[Text(80)] = Field(max_length=100)
    answerOnlyFromKnowledge: bool
    topK: int = Field(ge=1, le=100)
    minScore: float = Field(ge=0, le=1)
    toolIds: list[Text(80)] = Field(max_length=100)
    confirmBeforeActions: bool


class Guardrails(_M):
    handoffAfterFailures: int = Field(ge=0, le=50)
    transferTo: Text(160)
    emergencyTo: Text(240)
    refuseTopics: list[Text(240)] = Field(max_length=60)
    recordingNotice: bool
    recordingNoticeText: Text(600)
    maxCallMinutes: float = Field(ge=1, le=240)


class AnalysisField(_M):
    id: Text(80)
    label: Text(120)
    type: Literal["text", "yes_no", "number", "choice"]
    description: Text(600)
    options: list[Text(120)] | None = Field(None, max_length=60)


class Analysis(_M):
    summary: bool
    sentiment: bool
    successCriteria: Text(1000)
    fields: list[AnalysisField] = Field(max_length=60)


class AgentSpecIn(_M):
    typeId: Text(64) | None
    subTypeId: Text(64) | None
    redact: bool
    behaviour: Behaviour
    speech: Speech
    flow: list[FlowNode] = Field(max_length=200)
    attributes: list[Attribute] = Field(max_length=100)
    globalFlows: list[GlobalFlow] = Field(max_length=20)
    context: Context
    guardrails: Guardrails
    pipeline: dict
    analysis: Analysis


class AgentDraftIn(_M):
    """The builder's draft. id and updatedAt are the server's."""

    reached: Literal[BUILDER_STEPS]  # type: ignore[valid-type]
    sourceCallIds: list[Text(80)] = Field(max_length=500)
    consent: bool
    redact: bool
    typeId: Text(64) | None
    subTypeId: Text(64) | None
    name: Text(120)
    behaviour: Behaviour
    extraction: dict | None = None
    flow: list[FlowNode] = Field(max_length=200)
    attributes: list[Attribute] = Field(max_length=100)
    globalFlows: list[GlobalFlow] = Field(max_length=20)
    context: Context
    pipeline: dict


def _count(nodes: list[dict]) -> int:
    return sum(1 + _count(n.get("children") or []) for n in nodes)


def check_size(data: dict) -> None:
    """Whole-setup limits that per-field checks can't see."""
    if len(json.dumps(data, ensure_ascii=False).encode()) > MAX_SPEC_BYTES:
        raise ValueError("too large")
    if _count(data.get("flow") or []) > MAX_NODES:
        raise ValueError("too many flow steps")
    if len(json.dumps(data.get("pipeline") or {}).encode()) > 32 * 1024:
        raise ValueError("pipeline settings too large")


# What only the master admin may change (demoClient.ts saveAgent).
def locked(spec: dict) -> list:
    ctx = spec.get("context") or {}
    return [spec.get("typeId"), spec.get("subTypeId"), spec.get("redact"), spec.get("flow"), spec.get("attributes"), spec.get("globalFlows"),
            spec.get("pipeline"), ctx.get("toolIds"), ctx.get("confirmBeforeActions"), (spec.get("analysis") or {}).get("fields")]


class SpecField(BaseModel):
    """Used by routes to validate a raw dict into the stored form."""

    @staticmethod
    def spec(raw: dict) -> dict:
        AgentSpecIn.model_validate(raw)
        check_size(raw)
        return raw

    @staticmethod
    def draft(raw: dict) -> dict:
        data = {k: v for k, v in raw.items() if k not in ("id", "updatedAt", "revision")}
        AgentDraftIn.model_validate(data)
        check_size(data)
        return data
