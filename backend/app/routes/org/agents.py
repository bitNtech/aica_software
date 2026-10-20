"""/api/orgs/{slug}/agents and /drafts — agents' setups, versions, builder
drafts and test scenarios (Phase 6). The rules and messages follow the
demo client (frontend/src/console/demoClient.ts).

- Anyone in the organisation sees the list of agents (other pages label
  and filter by them). Opening one needs `agents.view`, `agents.test` or
  `agents.configure`.
- Everyday settings: `agents.configure`. The structure (flow, details to
  collect, global flows, tools, voice pipeline, analysis fields) is the
  master admin's: anyone else who changes it is refused.
- Publishing, rolling back, pausing and turning on: `agents.publish`.
  Moving an agent to another line: `library.numbers`. Creating, building
  and deleting agents: the master admin.
- Versions are written once and never changed. Saves carry the revision
  they were made from; a save from an older copy is refused (409
  "conflict") instead of overwriting someone else's work.
- Publishing a draft is safe to retry: the draft remembers the agent it
  became.
- Running scenarios and reading a flow from calls are AI work, not here.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import Field, ValidationError

from ...access import Access
from ...accounts import iso
from ...agentspec import SpecField, locked
from ...catalogue import AGENT_TYPES, VOICES, default_analysis, default_behaviour, default_context, default_guardrails, default_pipeline, default_speech, sub_type
from ...errors import ApiError, bad_input, forbidden
from ...models import Camel
from ...orgs import OrgContext, org_member
from ...ratelimit import limit_caller
from ...reports import calls_this_week, window
from ...sessions import Caller, current_caller
from ...store import AgentDoc, DraftDoc, ScenarioDoc, Tx, VersionDoc, new_id, now

router = APIRouter(prefix="/api/orgs/{slug}", tags=["org"])
catalogue_router = APIRouter(prefix="/api/catalogue", tags=["catalogue"])
WRITE_LIMIT = Depends(limit_caller("org-agents", 120))  # autosave runs often
VERSIONS_SHOWN = 20

STRUCTURE = "The flow, tools and voice pipeline are set up by bitNtech. Send them a request to change these."
CONFLICT = "Someone else saved changes to this agent since you opened it. Reload to see them; your latest edits weren't saved."


class SaveAgentIn(Camel):
    working: dict
    revision: int | None = None  # the agent's revision the edits were made from


class NoteIn(Camel):
    note: str = Field("", max_length=2000)
    revision: int | None = None  # what the person saw: publishing something else is refused


class RollbackIn(Camel):
    version: int
    revision: int | None = None


class RevisionIn(Camel):
    revision: int | None = None


class AgentPatchIn(Camel):
    name: str | None = Field(None, max_length=500)
    status: str | None = Field(None, max_length=20)
    number_id: str | None = Field(None, max_length=128)


class NewDraftIn(Camel):
    org_name: str = Field("", max_length=200)


class SaveDraftIn(Camel):
    draft: dict
    revision: int | None = None


class PublishDraftIn(Camel):
    number_id: str | None = Field(None, max_length=128)


class ScenarioIn(Camel):
    id: str | None = Field(None, max_length=128)
    name: str = Field(max_length=500)
    caller_says: list[str] = Field(max_length=50)
    expect: dict


def _not_found(what: str) -> ApiError:
    return ApiError(404, "invalid_input", f"That {what} doesn't exist any more. It may have been deleted.")


def conflict() -> ApiError:
    return ApiError(409, "conflict", CONFLICT)


def _master(a: Access) -> bool:
    return a.platform == "master_admin"


def _allow(ctx: OrgContext, perms: tuple[str, ...], what: str) -> None:
    if not (_master(ctx.access) or any(ctx.access.has(p) for p in perms)):
        raise forbidden(f"You don’t have permission to {what}.")


def _no_staff_writes(ctx: OrgContext) -> None:
    """bitNtech staff hold agents.test to look, not to change anything."""
    if ctx.access.platform and not _master(ctx.access):
        raise forbidden("bitNtech staff can look, not change. Ask the master admin.")


def _allow_master(ctx: OrgContext, what: str) -> None:
    if not _master(ctx.access):
        raise forbidden(f"Only bitNtech can {what}. Send them a request instead.")


def _valid(fn, raw: dict) -> dict:
    try:
        return fn(raw)
    except (ValidationError, ValueError):
        raise bad_input("Some of the agent's settings aren't valid. Reload the page and try again.")


# ---------------------------------------------------------------- shapes


def _versions(svc, slug: str, agent_id: str) -> list[VersionDoc]:
    return sorted(svc.store.list_records(slug, "version", (("agentId", "==", agent_id),), limit=100000), key=lambda v: v.version, reverse=True)


def _week(ctx: OrgContext) -> dict[str, int]:
    start, today, _, _ = window(7, now())
    return calls_this_week(ctx.svc.store.list_rollups(ctx.slug, start.isoformat(), today.isoformat()), now())


def summary_out(a: AgentDoc, numbers: dict, week: dict[str, int]) -> dict:
    n = numbers.get(a.numberId) if a.numberId else None
    out = {
        "id": a.id, "name": a.name, "useCase": a.useCase, "status": a.status, "phoneNumber": n.number if n else None, "languages": a.languages,
        "version": a.version, "lastPublishedAt": iso(a.lastPublishedAt) if a.lastPublishedAt else None, "updatedAt": iso(a.updatedAt),
        "callsThisWeek": week.get(a.id, 0), "hasChanges": a.changed,
    }
    if a.builtBy:
        out["builtBy"] = a.builtBy
    return out


def draft_summary(d: DraftDoc) -> dict:
    data = d.data
    st = sub_type(data.get("typeId"), data.get("subTypeId"))
    return {
        "id": d.id, "name": (data.get("name") or "").strip() or "Untitled agent", "useCase": st["label"] if st else "Use case not chosen", "status": "draft",
        "phoneNumber": None, "languages": (data.get("behaviour") or {}).get("languages", []), "version": None, "lastPublishedAt": None,
        "updatedAt": iso(d.updatedAt), "callsThisWeek": 0, "setupStep": data.get("reached", "calls"),
    }


def detail_out(ctx: OrgContext, a: AgentDoc) -> dict:
    numbers = {n.id: n for n in ctx.svc.store.list_records(ctx.slug, "number")}
    versions = _versions(ctx.svc, ctx.slug, a.id)[:VERSIONS_SHOWN]
    return {
        "agent": summary_out(a, numbers, _week(ctx)),
        "working": a.working,
        "versions": [{"version": v.version, "publishedAt": iso(v.publishedAt), "publishedBy": v.publishedBy, "note": v.note, "spec": v.spec} for v in versions],
        "revision": a.revision,
    }


def draft_out(d: DraftDoc) -> dict:
    return {**d.data, "id": d.id, "updatedAt": iso(d.updatedAt), "revision": d.revision}


def _release(tx: Tx, ctx: OrgContext, a: AgentDoc, spec: dict, note: str) -> None:
    """Publishes `spec` as the agent's next version."""
    t = now()
    a.version = (a.version or 0) + 1
    tx.save_record(ctx.slug, "version", VersionDoc(id=f"{a.id}_{a.version:06d}", agentId=a.id, version=a.version, publishedAt=t, publishedBy=ctx.actor()[0], note=note, spec=spec))
    a.working, a.changed, a.lastPublishedAt, a.updatedAt = spec, False, t, t
    a.languages = list((spec.get("behaviour") or {}).get("languages", a.languages))
    a.revision += 1


# ---------------------------------------------------------------- catalogue


@catalogue_router.get("/agent-types")
def agent_types(_: Caller = Depends(current_caller)):
    return AGENT_TYPES


@catalogue_router.get("/voices")
def voices(_: Caller = Depends(current_caller)):
    return VOICES


# ---------------------------------------------------------------- agents


@router.get("/agents")
def list_agents(ctx: OrgContext = Depends(org_member)):
    """Published agents, then drafts still being built (with setupStep)."""
    numbers = {n.id: n for n in ctx.svc.store.list_records(ctx.slug, "number")}
    week = _week(ctx)
    agents = sorted(ctx.svc.store.list_records(ctx.slug, "agent"), key=lambda a: a.createdAt)
    drafts = sorted((d for d in ctx.svc.store.list_records(ctx.slug, "draft") if not d.publishedAgentId), key=lambda d: d.updatedAt)
    return [summary_out(a, numbers, week) for a in agents] + [draft_summary(d) for d in drafts]


@router.get("/agents/{agent_id}")
def get_agent(agent_id: str, ctx: OrgContext = Depends(org_member)):
    _allow(ctx, ("agents.view", "agents.test", "agents.configure"), "see agents")
    a = ctx.svc.store.get_record(ctx.slug, "agent", agent_id)
    if not a:
        raise _not_found("agent")
    return detail_out(ctx, a)


@router.post("/agents/{agent_id}", dependencies=[WRITE_LIMIT])
def save_agent(agent_id: str, body: SaveAgentIn, ctx: OrgContext = Depends(org_member)):
    """Saves edits as unpublished changes; callers keep answering the live version."""
    _allow(ctx, ("agents.configure",), "change agents")
    working = _valid(SpecField.spec, body.working)

    def run(tx: Tx) -> AgentDoc:
        a = tx.get_record(ctx.slug, "agent", agent_id)
        if not a:
            raise _not_found("agent")
        if body.revision is not None and body.revision != a.revision:
            raise conflict()
        if not _master(ctx.access) and locked(working) != locked(a.working):
            raise forbidden(STRUCTURE)
        latest = tx.get_record(ctx.slug, "version", f"{a.id}_{a.version:06d}") if a.version else None
        a.working = working
        a.changed = not latest or working != latest.spec
        a.updatedAt = now()
        a.revision += 1
        tx.save_record(ctx.slug, "agent", a)
        return a

    return detail_out(ctx, ctx.svc.store.transact(run))


@router.post("/agents/{agent_id}/publish", dependencies=[WRITE_LIMIT])
def publish(agent_id: str, body: NoteIn, ctx: OrgContext = Depends(org_member)):
    _allow(ctx, ("agents.publish",), "publish agents")
    note = body.note.strip()

    def run(tx: Tx) -> AgentDoc:
        a = tx.get_record(ctx.slug, "agent", agent_id)
        if not a:
            raise _not_found("agent")
        if body.revision is not None and body.revision != a.revision:
            raise conflict()
        if not a.changed:
            raise bad_input("There are no unpublished changes to publish.")
        _release(tx, ctx, a, a.working, note[:500] or "No note.")
        tx.save_record(ctx.slug, "agent", a)
        ctx.log(tx, "agents", f"Published {a.name}, version {a.version}", note[:500])
        return a

    return detail_out(ctx, ctx.svc.store.transact(run))


@router.post("/agents/{agent_id}/discard", dependencies=[WRITE_LIMIT])
def discard(agent_id: str, body: RevisionIn | None = None, ctx: OrgContext = Depends(org_member)):
    _allow(ctx, ("agents.publish", "agents.configure"), "discard changes")

    def run(tx: Tx) -> AgentDoc:
        a = tx.get_record(ctx.slug, "agent", agent_id)
        if not a:
            raise _not_found("agent")
        if body and body.revision is not None and body.revision != a.revision:
            raise conflict()
        latest = tx.get_record(ctx.slug, "version", f"{a.id}_{a.version:06d}") if a.version else None
        if latest:
            a.working = latest.spec
        a.changed, a.updatedAt = False, now()
        a.revision += 1
        tx.save_record(ctx.slug, "agent", a)
        return a

    return detail_out(ctx, ctx.svc.store.transact(run))


@router.post("/agents/{agent_id}/rollback", dependencies=[WRITE_LIMIT])
def rollback(agent_id: str, body: RollbackIn, ctx: OrgContext = Depends(org_member)):
    """Publishes an earlier version's setup again, as the next version."""
    _allow(ctx, ("agents.publish",), "roll agents back")

    def run(tx: Tx) -> AgentDoc:
        a = tx.get_record(ctx.slug, "agent", agent_id)
        if not a:
            raise _not_found("agent")
        if body.revision is not None and body.revision != a.revision:
            raise conflict()
        old = tx.get_record(ctx.slug, "version", f"{a.id}_{body.version:06d}") if body.version > 0 else None
        if not old:
            raise _not_found("version")
        _release(tx, ctx, a, old.spec, f"Went back to version {body.version}.")
        tx.save_record(ctx.slug, "agent", a)
        ctx.log(tx, "agents", f"Rolled {a.name} back to version {body.version}", f"Published as version {a.version}.")
        return a

    return detail_out(ctx, ctx.svc.store.transact(run))


@router.post("/agents/{agent_id}/settings", dependencies=[WRITE_LIMIT])
def update_agent(agent_id: str, body: AgentPatchIn, ctx: OrgContext = Depends(org_member)):
    """Name, number and live/paused: they apply at once, outside versions."""
    sent = body.model_fields_set
    name = body.name.strip() if body.name is not None else None
    if name is not None and not 3 <= len(name) <= 60:
        raise bad_input("Give the agent a name of 3 to 60 characters.")
    if body.status is not None and body.status not in ("live", "paused"):
        raise bad_input("Choose live or paused.")
    if name is not None:
        _allow(ctx, ("agents.configure",), "rename agents")
    if body.status is not None:
        _allow(ctx, ("agents.publish",), "pause or turn on agents")
    if "number_id" in sent:
        _allow(ctx, ("library.numbers",), "move agents between lines")

    def run(tx: Tx) -> AgentDoc:
        a = tx.get_record(ctx.slug, "agent", agent_id)
        if not a:
            raise _not_found("agent")
        agents = tx.list_records(ctx.slug, "agent")
        if name is not None and any(o.id != a.id and o.name.strip().lower() == name.lower() for o in agents):
            raise bad_input(f"Another agent is already called “{name}”.")
        numbers = {n.id: n for n in tx.list_records(ctx.slug, "number")}
        number_id = body.number_id if "number_id" in sent else a.numberId
        if number_id:
            n = numbers.get(number_id)
            if not n:
                raise _not_found("phone number")
            if n.agentId and n.agentId != a.id:
                raise bad_input(f"{n.number} already has an agent. Choose a free number.")
        if body.status == "live" and not number_id:
            raise bad_input("Give the agent a phone number before turning it on.")
        # No number, nothing to answer: it stops.
        status = (body.status or a.status) if number_id else "paused"
        # ---- writes
        was_name, was_status = a.name, a.status
        if "number_id" in sent:
            for n in numbers.values():
                if n.agentId == a.id and n.id != number_id:
                    n.agentId = None
                    tx.save_record(ctx.slug, "number", n)
            if number_id and numbers[number_id].agentId != a.id:
                numbers[number_id].agentId = a.id
                tx.save_record(ctx.slug, "number", numbers[number_id])
            a.numberId = number_id
        if name is not None:
            a.name = name
        a.status, a.updatedAt = status, now()
        tx.save_record(ctx.slug, "agent", a)
        if a.name != was_name:
            ctx.log(tx, "agents", f"Renamed {was_name} to {a.name}")
        if a.status != was_status:
            ctx.log(tx, "agents", f"{'Paused' if a.status == 'paused' else 'Turned on'} {a.name}")
        return a

    return detail_out(ctx, ctx.svc.store.transact(run))


@router.post("/agents/{agent_id}/delete", status_code=204, dependencies=[WRITE_LIMIT])
def delete_agent(agent_id: str, ctx: OrgContext = Depends(org_member)):
    _allow_master(ctx, "delete agents")

    def run(tx: Tx) -> None:
        a = tx.get_record(ctx.slug, "agent", agent_id)
        if not a:
            raise _not_found("agent")
        held = tx.list_records(ctx.slug, "number", (("agentId", "==", a.id),))
        for n in held:
            n.agentId = None
            tx.save_record(ctx.slug, "number", n)
        tx.delete_record(ctx.slug, "agent", a.id)
        ctx.log(tx, "agents", f"Deleted the agent {a.name}")

    ctx.svc.store.transact(run)
    # Its versions and scenarios go after: there can be more than one
    # transaction may write (500), and left over they'd only be unused.
    for kind in ("version", "scenario"):
        for r in ctx.svc.store.list_records(ctx.slug, kind, (("agentId", "==", agent_id),), limit=5000):
            ctx.svc.store.delete_record(ctx.slug, kind, r.id)
    ctx.audit_acting("agent_deleted", agent_id)


# ---------------------------------------------------------------- drafts (bitNtech's master admin)


@router.post("/drafts", dependencies=[WRITE_LIMIT])
def create_draft(body: NewDraftIn, ctx: OrgContext = Depends(org_member)):
    _allow_master(ctx, "create agents")
    t = now()
    data = {
        "reached": "calls", "sourceCallIds": [], "consent": False, "redact": True, "typeId": None, "subTypeId": None, "name": "",
        "behaviour": default_behaviour(body.org_name.strip() or ctx.org.name), "flow": [], "attributes": [], "globalFlows": [],
        "context": default_context(), "pipeline": default_pipeline(),
    }
    d = DraftDoc(id=new_id("draft"), data=data, updatedAt=t, createdBy=ctx.actor()[0])
    ctx.svc.store.save_record(ctx.slug, "draft", d)
    return draft_out(d)


def _draft(store_or_tx, slug: str, draft_id: str) -> DraftDoc:
    d = store_or_tx.get_record(slug, "draft", draft_id)
    if not d or d.publishedAgentId:
        raise _not_found("draft")
    return d


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: str, ctx: OrgContext = Depends(org_member)):
    _allow_master(ctx, "build agents")
    return draft_out(_draft(ctx.svc.store, ctx.slug, draft_id))


@router.post("/drafts/{draft_id}", dependencies=[WRITE_LIMIT])
def save_draft(draft_id: str, body: SaveDraftIn, ctx: OrgContext = Depends(org_member)):
    _allow_master(ctx, "build agents")
    data = _valid(SpecField.draft, body.draft)

    def run(tx: Tx) -> DraftDoc:
        d = _draft(tx, ctx.slug, draft_id)
        if body.revision is not None and body.revision != d.revision:
            raise ApiError(409, "conflict", "Someone else saved this draft since you opened it. Reload to see their changes; your latest edits weren't saved.")
        d.data, d.updatedAt = data, now()
        d.revision += 1
        tx.save_record(ctx.slug, "draft", d)
        return d

    return draft_out(ctx.svc.store.transact(run))


@router.post("/drafts/{draft_id}/discard", status_code=204, dependencies=[WRITE_LIMIT])
def discard_draft(draft_id: str, ctx: OrgContext = Depends(org_member)):
    _allow_master(ctx, "discard drafts")
    _draft(ctx.svc.store, ctx.slug, draft_id)
    ctx.svc.store.delete_record(ctx.slug, "draft", draft_id)


@router.post("/drafts/{draft_id}/publish", dependencies=[WRITE_LIMIT])
def publish_draft(draft_id: str, body: PublishDraftIn, ctx: OrgContext = Depends(org_member)):
    """Turns the draft into a live agent on the number, or a paused one with
    none. Retrying after it worked returns the agent it became."""
    _allow_master(ctx, "publish new agents")
    by = ctx.actor()[0]

    def run(tx: Tx) -> AgentDoc:
        d = tx.get_record(ctx.slug, "draft", draft_id)
        if not d:
            raise _not_found("draft")
        if d.publishedAgentId:
            done = tx.get_record(ctx.slug, "agent", d.publishedAgentId)
            if done:
                return done
            raise _not_found("draft")
        number = tx.get_record(ctx.slug, "number", body.number_id) if body.number_id else None
        if body.number_id and not number:
            raise _not_found("phone number")
        if number and number.agentId:
            raise bad_input(f"{number.number} already has an agent. Choose a free number.")
        data = d.data
        st = sub_type(data.get("typeId"), data.get("subTypeId"))
        spec = {
            "typeId": data.get("typeId"), "subTypeId": data.get("subTypeId"), "redact": data.get("redact", True), "behaviour": data["behaviour"],
            "speech": default_speech(), "flow": data.get("flow", []), "attributes": data.get("attributes", []), "globalFlows": data.get("globalFlows", []),
            "context": data.get("context") or default_context(), "guardrails": default_guardrails(), "pipeline": data.get("pipeline") or default_pipeline(),
            "analysis": default_analysis(data.get("subTypeId")),
        }
        t = now()
        a = AgentDoc(
            id=new_id("agt"), name=(data.get("name") or "").strip() or "Untitled agent", useCase=st["label"] if st else "General enquiries",
            status="live" if number else "paused", working=spec, updatedAt=t, numberId=number.id if number else None, builtBy=f"bitNtech ({by.replace(' (bitNtech)', '')})",
        )
        _release(tx, ctx, a, spec, "First version, from the builder.")
        tx.save_record(ctx.slug, "agent", a)
        if number:
            number.agentId = a.id
            tx.save_record(ctx.slug, "number", number)
        d.publishedAgentId = a.id
        tx.save_record(ctx.slug, "draft", d)
        ctx.log(tx, "agents", f"Published {a.name}, version 1", f"Answering {number.number}." if number else "Paused: no number yet.")
        return a

    a = ctx.svc.store.transact(run)
    numbers = {n.id: n for n in ctx.svc.store.list_records(ctx.slug, "number")}
    return summary_out(a, numbers, {})


# ---------------------------------------------------------------- scenarios


def scenario_out(s: ScenarioDoc) -> dict:
    return {"id": s.id, "name": s.name, "callerSays": s.callerSays, "expect": s.expect, "lastRun": s.lastRun}


def _agent_exists(ctx: OrgContext, agent_id: str) -> None:
    if not ctx.svc.store.get_record(ctx.slug, "agent", agent_id):
        raise _not_found("agent")


@router.get("/agents/{agent_id}/scenarios")
def list_scenarios(agent_id: str, ctx: OrgContext = Depends(org_member)):
    _allow(ctx, ("agents.test", "agents.view"), "see test scenarios")
    _agent_exists(ctx, agent_id)
    rows = ctx.svc.store.list_records(ctx.slug, "scenario", (("agentId", "==", agent_id),), limit=500)
    return [scenario_out(s) for s in sorted(rows, key=lambda s: s.createdAt)]


@router.post("/agents/{agent_id}/scenarios", dependencies=[WRITE_LIMIT])
def save_scenario(agent_id: str, body: ScenarioIn, ctx: OrgContext = Depends(org_member)):
    """Creates (no id) or changes a scenario. A change forgets its last run."""
    _allow(ctx, ("agents.test",), "change test scenarios")
    _no_staff_writes(ctx)
    _agent_exists(ctx, agent_id)
    name = body.name.strip()
    if not 3 <= len(name) <= 80:
        raise bad_input("Give the scenario a name of 3 to 80 characters.")
    lines = [x.strip() for x in body.caller_says if x.strip()]
    if not lines:
        raise bad_input("Add at least one thing the caller says.")
    if len(lines) > 10:
        raise bad_input("Keep scenarios to 10 lines or fewer.")
    if any(len(x) > 500 for x in lines):
        raise bad_input("Keep each line under 500 characters.")
    exp = body.expect or {}
    handover = exp.get("handover")
    expect = {
        "intent": str(exp.get("intent") or "").strip()[:200],
        "mustSay": [str(w).strip()[:200] for w in (exp.get("mustSay") or [])[:20] if str(w).strip()],
        "handover": handover if isinstance(handover, bool) else None,
    }

    def run(tx: Tx) -> ScenarioDoc:
        others = tx.list_records(ctx.slug, "scenario", (("agentId", "==", agent_id),), limit=500)
        if any(s.name.strip().lower() == name.lower() and s.id != body.id for s in others):
            raise bad_input(f"There’s already a scenario called “{name}”.")
        if body.id:
            s = next((x for x in others if x.id == body.id), None)
            if not s:
                raise _not_found("scenario")
            s.name, s.callerSays, s.expect, s.lastRun = name, lines, expect, None
        else:
            s = ScenarioDoc(id=new_id("scn"), agentId=agent_id, name=name, callerSays=lines, expect=expect)
        tx.save_record(ctx.slug, "scenario", s)
        return s

    return scenario_out(ctx.svc.store.transact(run))


@router.post("/agents/{agent_id}/scenarios/{scenario_id}/delete", status_code=204, dependencies=[WRITE_LIMIT])
def delete_scenario(agent_id: str, scenario_id: str, ctx: OrgContext = Depends(org_member)):
    _allow(ctx, ("agents.test",), "change test scenarios")
    _no_staff_writes(ctx)
    s = ctx.svc.store.get_record(ctx.slug, "scenario", scenario_id)
    if not s or s.agentId != agent_id:
        raise _not_found("scenario")
    ctx.svc.store.delete_record(ctx.slug, "scenario", scenario_id)
