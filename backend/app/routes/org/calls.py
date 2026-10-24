"""/api/orgs/{slug}/calls — the call log, one call, and notes (Phase 3).

Calls are written by the voice pipeline once its contract is agreed
(docs/backend-workflow.md §5); until then they come from the seed script.

- `calls.viewAll`: every call. Without it, `calls.take` holders see only the
  calls they handled, matched by their id (`handledById`), never by name.
- Without `calls.personal`, callers' names, personal details and the
  personal values in transcripts are removed here (app/domain/redact.py).
- Callers' numbers are always masked on calls.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from ...access.orgs import OrgContext, org_member
from ...auth.accounts import iso
from ...core.errors import ApiError, bad_input, forbidden
from ...core.ratelimit import limit_caller
from ...data.store import CallDoc, CallFilter, IndexMissing, NoteDoc, new_id, now
from ...domain.redact import details_out, mask_phone, query_tokens, redact_text, without_name
from ...models import CallLogPageOut, CallNoteOut, CallOutcome, CallRecordOut, CallSummaryOut, CollectedDetailOut, NoteIn

router = APIRouter(prefix="/api/orgs/{slug}/calls", tags=["org"])

IST = timezone(timedelta(hours=5, minutes=30))
DAYS = (1, 7, 30, 90)


def since_days(days: int, at: datetime | None = None) -> datetime:
    """The start of the window: IST midnight, `days - 1` days ago (1 = today)."""
    local = (at or now()).astimezone(IST)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    return midnight.astimezone(timezone.utc)


def _own_only(ctx: OrgContext) -> bool:
    """True when the caller sees only their own calls; refuses those who see none."""
    if ctx.access.has("calls.viewAll"):
        return False
    if ctx.access.has("calls.take"):
        return True
    raise forbidden("You don’t have permission to see calls.")


def _not_found() -> ApiError:
    return ApiError(404, "invalid_input", "That call doesn't exist any more. It may have been deleted.")


def summary_out(c: CallDoc, personal: bool) -> CallSummaryOut:
    return CallSummaryOut(
        id=c.id, agent_id=c.agentId, agent_name=c.agentName, line=c.line, caller_phone=mask_phone(c.callerPhone),
        caller_name=c.callerName if personal else None, started_at=iso(c.startedAt), duration_sec=c.durationSec,
        language=c.language, intent=c.intent, outcome=c.outcome, handled_by=c.handledBy,
    )


def record_out(c: CallDoc, notes: list[NoteDoc], personal: bool) -> CallRecordOut:
    hidden = {d.get("label") for d in c.details if d.get("personal")}
    analysis = dict(c.analysis)
    tool_calls = c.toolCalls
    if not personal:
        # Pipeline-written text may name the caller too. Until the pipeline
        # contract says which fields are personal (§5), scrub them all.
        if isinstance(analysis.get("fields"), list):
            analysis["fields"] = [{**f, "value": "" if f.get("label") in hidden else without_name(str(f.get("value", "")), c.callerName)} for f in analysis["fields"]]
        if isinstance(analysis.get("successReason"), str):
            analysis["successReason"] = without_name(analysis["successReason"], c.callerName)
        tool_calls = [{**t, "summary": without_name(str(t.get("summary", "")), c.callerName)} for t in tool_calls]
    return CallRecordOut(
        **summary_out(c, personal).model_dump(),
        summary=c.summary if personal else without_name(c.summary, c.callerName),
        path=c.path,
        details=[CollectedDetailOut(**d) for d in details_out(c.details, personal)],
        tool_calls=tool_calls,
        knowledge_used=c.knowledgeUsed,
        transcript=c.transcript if personal else [{**t, "text": redact_text(t.get("text", ""))} for t in c.transcript],
        notes=[CallNoteOut(id=n.id, by=n.by, at=iso(n.at), text=n.text) for n in notes],
        has_recording=c.hasRecording,
        handled_by_id=c.handledById,
        analysis=analysis,
        metrics=c.metrics,
    )


@router.get("", response_model=CallLogPageOut, response_model_by_alias=True)
def call_log(
    days: int = 7,
    agent_id: str | None = Query(None, alias="agentId", max_length=128),
    outcome: CallOutcome | None = None,
    q: str | None = Query(None, max_length=100),
    limit: int = Query(50, ge=1, le=500),
    ctx: OrgContext = Depends(org_member),
):
    """Newest first, up to `limit`, and how many match in all."""
    if days not in DAYS:
        raise bad_input("Choose 1, 7, 30 or 90 days.")
    own = _own_only(ctx)
    personal = ctx.access.has("calls.personal")
    f = CallFilter(since=since_days(days), agent_id=agent_id or None, outcome=outcome, handled_by_id=ctx.caller.uid if own else None, tokens=query_tokens(q or "", personal))
    try:
        calls, total = ctx.svc.store.list_calls(ctx.slug, f, limit)
    except IndexMissing:
        raise ApiError(503, "unknown", "This filter needs a Firestore index that hasn't been created yet. See backend/README.md.")
    return CallLogPageOut(calls=[summary_out(c, personal) for c in calls], total=total)


@router.get("/{call_id}", response_model=CallRecordOut, response_model_by_alias=True)
def get_call(call_id: str, ctx: OrgContext = Depends(org_member)):
    own = _own_only(ctx)
    c = ctx.svc.store.get_record(ctx.slug, "call", call_id)
    if not c:
        raise _not_found()
    if own and c.handledById != ctx.caller.uid:
        raise forbidden("You can open the calls you handled.")
    return record_out(c, ctx.svc.store.list_notes(ctx.slug, call_id), ctx.access.has("calls.personal"))


@router.post("/{call_id}/notes", response_model=CallNoteOut, response_model_by_alias=True, dependencies=[Depends(limit_caller("org-notes", 60))])
def add_note(call_id: str, body: NoteIn, ctx: OrgContext = Depends(org_member)):
    text = body.text.strip()
    if not text:
        raise bad_input("Write the note first.")
    if len(text) > 1000:
        raise bad_input("Keep notes under 1,000 characters.")
    if ctx.access.role == "viewer" or (ctx.access.platform and ctx.access.platform != "master_admin"):
        raise forbidden("Viewers can read notes, not add them.")
    own = _own_only(ctx)
    c = ctx.svc.store.get_record(ctx.slug, "call", call_id)
    if not c:
        raise _not_found()
    if own and c.handledById != ctx.caller.uid:
        raise forbidden("You can add notes to the calls you handled.")
    by, by_id = ctx.actor()[0], ctx.member_id
    note = NoteDoc(id=new_id("note"), by=by, at=now(), text=text, byId=by_id)
    ctx.svc.store.add_note(ctx.slug, call_id, note)
    return CallNoteOut(id=note.id, by=note.by, at=iso(note.at), text=note.text)
