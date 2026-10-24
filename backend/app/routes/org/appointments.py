"""/api/orgs/{slug}/appointments — bookings made on calls (Phase 3).

`appointments.manage` changes them; `calls.viewAll` reads them. The
patient's phone number is shown only to those who manage appointments, and
their name only with `calls.personal`.
"""
from __future__ import annotations

import re
from datetime import date as Date

from fastapi import APIRouter, Depends, Query

from ...access.orgs import OrgContext, org_permission
from ...auth.accounts import iso
from ...core.errors import ApiError, bad_input
from ...core.ratelimit import limit_caller
from ...data.store import AppointmentDoc, Tx
from ...domain.redact import format_phone, mask_phone
from ...models import AppointmentOut, AppointmentPatchIn

router = APIRouter(prefix="/api/orgs/{slug}/appointments", tags=["org"])

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MAX_RANGE_DAYS = 62


def _real_date(v: str) -> bool:
    try:
        return Date.fromisoformat(v).isoformat() == v
    except ValueError:
        return False


def appointment_out(a: AppointmentDoc, manage: bool, personal: bool) -> AppointmentOut:
    return AppointmentOut(
        id=a.id, patient_name=a.patientName if personal else "A patient", phone=format_phone(a.phone) if manage else mask_phone(a.phone),
        department=a.department, doctor=a.doctor, date=a.date, time=a.time, status=a.status,
        check_reason=a.checkReason if a.status == "needs_check" else None, booked_by=a.bookedBy, agent_name=a.agentName,
        call_id=a.callId, created_at=iso(a.createdAt), note=a.note or None,
    )


@router.get("", response_model=list[AppointmentOut], response_model_by_alias=True)
def list_appointments(
    date_from: str = Query(alias="from", max_length=10),
    date_to: str = Query(alias="to", max_length=10),
    ctx: OrgContext = Depends(org_permission("appointments.manage", "calls.viewAll", what="see appointments")),
):
    if not (DATE.match(date_from) and DATE.match(date_to) and _real_date(date_from) and _real_date(date_to)) or date_from > date_to:
        raise bad_input("Choose a real date range.")
    if (Date.fromisoformat(date_to) - Date.fromisoformat(date_from)).days > MAX_RANGE_DAYS:
        raise bad_input(f"Choose up to {MAX_RANGE_DAYS} days at a time.")
    manage, personal = ctx.access.has("appointments.manage"), ctx.access.has("calls.personal")
    rows = sorted(ctx.svc.store.list_appointments(ctx.slug, date_from, date_to), key=lambda a: (a.date, a.time))
    return [appointment_out(a, manage, personal) for a in rows]


@router.post("/{appointment_id}", response_model=AppointmentOut, response_model_by_alias=True, dependencies=[Depends(limit_caller("org-appointments", 60))])
def update_appointment(appointment_id: str, body: AppointmentPatchIn, ctx: OrgContext = Depends(org_permission("appointments.manage", what="change appointments"))):
    if body.date is not None:
        if not DATE.match(body.date):
            raise bad_input("Choose a date.")
        if not _real_date(body.date):
            raise bad_input("Choose a real date.")
    if body.time is not None and not TIME.match(body.time):
        raise bad_input("Choose a time.")
    department = body.department.strip() if body.department is not None else None
    doctor = body.doctor.strip() if body.doctor is not None else None
    if department is not None and not 1 <= len(department) <= 80:
        raise bad_input("Choose a department.")
    if doctor is not None and not 1 <= len(doctor) <= 80:
        raise bad_input("Choose a doctor.")
    note = body.note.strip() if body.note is not None else None
    if note and len(note) > 500:
        raise bad_input("Keep the note under 500 characters.")

    def run(tx: Tx) -> AppointmentDoc:
        a = tx.get_record(ctx.slug, "appointment", appointment_id)
        if not a:
            raise ApiError(404, "invalid_input", "That appointment doesn't exist any more. It may have been deleted.")
        if a.status == "cancelled" and body.status is not None and body.status != "booked":
            raise bad_input("This appointment was cancelled. Book it again first.")
        for name, value in (("date", body.date), ("time", body.time), ("department", department), ("doctor", doctor)):
            if value is not None:
                setattr(a, name, value)
        if body.note is not None:
            a.note = note or None
        if body.status is not None:
            a.status = body.status
        if a.status != "needs_check":
            a.checkReason = None
        tx.save_record(ctx.slug, "appointment", a)
        return a

    return appointment_out(ctx.svc.store.transact(run), True, ctx.access.has("calls.personal"))
