"""/api/orgs/{slug}/activity — the organisation's own audit log, newest
first (`activity.view`). Billing entries are for owners only. bitNtech's
platform-wide log stays separate, under /api/ops/audit."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ...access.orgs import OrgContext, org_permission
from ...auth.accounts import iso
from ...core.errors import ApiError
from ...data.store import IndexMissing
from ...models import ActivityArea, ActivityEntryOut, ActivityPageOut

router = APIRouter(prefix="/api/orgs/{slug}/activity", tags=["org"])


@router.get("", response_model=ActivityPageOut, response_model_by_alias=True)
def list_activity(
    area: ActivityArea | None = None,
    actor_id: str | None = Query(None, alias="actorId", max_length=128),
    # The `nextBefore` of the previous page: an opaque cursor.
    before: str | None = Query(None, max_length=128),
    size: int = Query(25, ge=1, le=100, alias="limit"),
    ctx: OrgContext = Depends(org_permission("activity.view", what="read the organisation's activity")),
):
    try:
        rows = ctx.svc.store.list_activity(ctx.slug, size + 1, before or None, area, actor_id or None, include_owner_only=ctx.access.is_owner)
    except IndexMissing:
        raise ApiError(503, "unknown", "This filter needs a Firestore index that hasn't been created yet. See backend/README.md.")
    more = len(rows) > size
    rows = rows[:size]
    return ActivityPageOut(
        entries=[
            ActivityEntryOut(id=e.id, at=iso(e.at), actor=e.actor, actor_kind=e.actorKind, actor_id=e.actorId, area=e.area, text=e.text, detail=e.detail or None)
            for e in rows
        ],
        next_before=rows[-1].id if more and rows else None,
    )
