"""/api/orgs/{slug}/reports — the Reports section of Home (Phase 4), from
the rollups in app/domain/rollups.py, and a CSV of the call list.

- The report needs `reports.view`. It holds counts only: no caller details.
- The call list CSV needs `reports.export`, and follows the call log's own
  rules: everything with `calls.viewAll`, otherwise only calls the person
  handled; numbers masked, names only with `calls.personal`. Cells that a
  spreadsheet would run as a formula are made plain text.
"""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from ...access.orgs import OrgContext, org_permission
from ...core.errors import ApiError, bad_input, forbidden
from ...core.ratelimit import limit_caller
from ...data.store import CallFilter, IndexMissing, now
from ...domain.redact import mask_phone
from ...domain.rollups import build_report, ist, window
from .calls import DAYS, since_days

router = APIRouter(prefix="/api/orgs/{slug}/reports", tags=["org"])

EXPORT_MAX = 20000
OUTCOME_WORD = {"resolved": "Answered", "booked": "Booked", "handed_over": "Handed over", "callback": "Callback", "dropped": "Caller hung up", "emergency": "Emergency"}


def _days(days: int) -> int:
    if days not in DAYS:
        raise bad_input("Choose 1, 7, 30 or 90 days.")
    return days


@router.get("")
def get_report(
    days: int = 7,
    agent_id: str | None = Query(None, alias="agentId", max_length=128),
    ctx: OrgContext = Depends(org_permission("reports.view", what="see reports")),
):
    """The frontend's Report type (console/types.ts)."""
    days, at = _days(days), now()
    start, today, prev_start, _ = window(days, at)
    rollups = ctx.svc.store.list_rollups(ctx.slug, prev_start.isoformat(), today.isoformat(), agent_id or None)
    return build_report(rollups, days, at)


def _cell(v) -> str:
    t = "" if v is None else str(v)
    # A leading = + - @ (or tab/CR) makes spreadsheets run the cell as a formula.
    return f"'{t}" if t[:1] in ("=", "+", "-", "@", "\t", "\r") else t


@router.get("/calls.csv", dependencies=[Depends(limit_caller("org-export", 10))])
def export_calls(
    days: int = 7,
    agent_id: str | None = Query(None, alias="agentId", max_length=128),
    ctx: OrgContext = Depends(org_permission("reports.export", what="download call lists")),
):
    days = _days(days)
    if ctx.access.has("calls.viewAll"):
        own = None
    elif ctx.access.has("calls.take"):
        own = ctx.caller.uid
    else:
        raise forbidden("You don’t have permission to see calls.")
    personal = ctx.access.has("calls.personal")
    try:
        calls, total = ctx.svc.store.list_calls(ctx.slug, CallFilter(since=since_days(days), agent_id=agent_id or None, handled_by_id=own), EXPORT_MAX)
    except IndexMissing:
        raise ApiError(503, "unknown", "This export needs a Firestore index that hasn't been created yet. See backend/README.md.")
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Started (India time)", "Agent", "Line", "Caller", "Caller's name", "Asked about", "What happened", "Length (s)", "Handled by"])
    for c in calls:
        w.writerow([_cell(x) for x in (
            ist(c.startedAt).strftime("%Y-%m-%d %H:%M"), c.agentName, c.line, mask_phone(c.callerPhone),
            c.callerName if personal else "", c.intent, OUTCOME_WORD.get(c.outcome, c.outcome), c.durationSec, c.handledBy or "",
        )])
    if total > len(calls):
        w.writerow([f"Only the newest {len(calls)} of {total} calls are listed. Choose a shorter period for the rest."])
    ctx.audit_acting("calls_exported", f"{days} days")
    return Response(
        content="﻿" + out.getvalue(),  # BOM: Excel reads it as UTF-8 (Tamil names)
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="aica-calls-{days}d.csv"'},
    )
