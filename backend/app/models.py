"""Request and response bodies. Field names are camelCase on the wire to
match frontend/src/auth/types.ts."""
from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic.alias_generators import to_camel

from .access import ALL_PERMISSIONS

Role = Literal["owner", "admin", "supervisor", "front_desk", "viewer"]
PlatformRole = Literal["master_admin", "staff"]
OrgStatus = Literal["pending_review", "active", "declined", "suspended"]
BusinessType = Literal["hospital", "clinic", "diagnostics", "other"]
Language = Literal["tamil", "english", "tanglish"]
ActivityArea = Literal["team", "agents", "library", "settings", "billing", "access"]


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, str_strip_whitespace=True)


# ---- requests ----


class LoginIn(Camel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    remember: bool = False


class BusinessIn(Camel):
    name: str = Field(min_length=3, max_length=120)
    type: BusinessType
    city: str = Field(min_length=1, max_length=80)
    languages: list[Language] = Field(min_length=1, max_length=3)


class SignupIn(Camel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone: str
    password: str = Field(min_length=1, max_length=256)
    business: BusinessIn
    accepted_terms: bool

    @field_validator("phone")
    @classmethod
    def indian_mobile(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v)
        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        elif len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]
        if not re.fullmatch(r"[6-9]\d{9}", digits):
            raise ValueError("Enter a 10-digit mobile number.")
        return digits


class EmailIn(Camel):
    email: EmailStr


class CodeIn(Camel):
    code: str = Field(min_length=10, max_length=512)


class ResetIn(Camel):
    code: str = Field(min_length=10, max_length=512)
    password: str = Field(min_length=1, max_length=256)


class AcceptInviteIn(Camel):
    name: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class ReasonIn(Camel):
    reason: str = Field(min_length=10, max_length=500)


class StaffInviteIn(Camel):
    email: EmailStr
    role: PlatformRole = "staff"


class RoleChangeIn(Camel):
    """None takes the bitNtech role away."""

    role: PlatformRole | None
    reason: str = Field(min_length=10, max_length=500)


# ---- organisation requests (/api/orgs/{slug}/…)


class InviteMemberIn(Camel):
    email: EmailStr
    role: Role


class MemberRoleIn(Camel):
    role: Role


class MemberPermissionsIn(Camel):
    """None: back to the role's defaults."""

    permissions: list[Annotated[str, Field(max_length=40)]] | None = Field(..., max_length=len(ALL_PERMISSIONS))

    @field_validator("permissions")
    @classmethod
    def known(cls, v: list[str] | None) -> list[str] | None:
        if v is not None and any(p not in ALL_PERMISSIONS for p in v):
            raise ValueError("unknown permission")
        return v


class DayHoursIn(Camel):
    open: bool
    from_: str = Field(alias="from", max_length=5)
    to: str = Field(max_length=5)


class ClosedDayIn(Camel):
    date: str = Field(max_length=10)
    label: str = Field(max_length=200)


class OrgSettingsIn(Camel):
    """Lengths here only cap the size; the route checks each value and says
    what's wrong in words."""

    name: str = Field(max_length=500)
    city: str = Field(max_length=500)
    languages: list[Language] = Field(max_length=10)
    hours: list[DayHoursIn] = Field(max_length=14)
    closed: list[ClosedDayIn] = Field(max_length=200)


# The landing page's demo form. snake_case on the wire, as the form sends it;
# the choices match frontend/src/landing/content.ts (INDUSTRIES, VOLUMES).
Industry = Literal["Hospital / clinic", "Mobility / logistics", "Retail / services", "Education", "Real estate", "Other"]
Volume = Literal["<50", "50–200", "200–1000", "1000+"]
Tag = Annotated[str, Field(max_length=200)]


class DemoRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=100)
    company: str = Field(min_length=1, max_length=120)
    phone: str
    industry: Industry
    calls_per_day: Volume
    utm_source: Tag | None = None
    utm_medium: Tag | None = None
    utm_campaign: Tag | None = None
    utm_term: Tag | None = None
    utm_content: Tag | None = None
    gclid: Tag | None = None
    fbclid: Tag | None = None
    page: str | None = Field(None, max_length=500)
    submitted_at: str | None = Field(None, max_length=40)
    # Honeypot: hidden from people, filled in by naive bots.
    website: str | None = Field(None, max_length=200)

    @field_validator("phone")
    @classmethod
    def ten_digits(cls, v: str) -> str:
        # Same rule as the form: an optional +91 or 0, then ten digits.
        digits = re.sub(r"[\s\-().]", "", v)
        digits = re.sub(r"^(\+?91|0)(?=\d{10}$)", "", digits)
        if not re.fullmatch(r"\d{10}", digits):
            raise ValueError("Enter a 10-digit phone number.")
        return digits


# ---- responses ----


class MembershipOut(Camel):
    org_slug: str
    org_name: str
    city: str
    role: Role
    # Changed from the role's defaults; None when it has them.
    permissions: list[str] | None = None
    org_status: OrgStatus
    status_reason: str | None = None


class UserOut(Camel):
    id: str
    name: str
    email: str
    platform_role: PlatformRole | None = None
    memberships: list[MembershipOut]


class ImpersonatorOut(Camel):
    """Set while a master admin acts as `user`."""

    name: str
    email: str
    reason: str
    expires_at: str


class SessionOut(Camel):
    user: UserOut
    remember: bool
    expires_at: str
    impersonator: ImpersonatorOut | None = None


class EmailOut(Camel):
    email: str


class InviteOut(Camel):
    email: str
    org_name: str
    role: str
    invited_by: str
    expires_at: str
    # The address already has an AICA account: they sign in and join
    # instead of choosing a password. Only shown to holders of the link.
    has_account: bool = False


class OwnerOut(Camel):
    name: str
    email: str
    phone: str
    email_verified: bool


class SignupRequestOut(Camel):
    org_slug: str
    org_name: str
    business_type: BusinessType
    city: str
    languages: list[Language]
    owner: OwnerOut
    submitted_at: str


class OrgSummaryOut(Camel):
    slug: str
    name: str
    city: str
    business_type: BusinessType
    status: OrgStatus
    status_reason: str | None = None
    owner_id: str
    owner_email: str
    created_at: str


class PersonMembershipOut(Camel):
    org_slug: str
    org_name: str
    role: Role


class PersonOut(Camel):
    id: str
    name: str
    email: str
    platform_role: PlatformRole | None = None
    disabled: bool
    email_verified: bool
    memberships: list[PersonMembershipOut]
    created_at: str | None = None


class AuditEntryOut(Camel):
    at: str
    actor: str
    actor_label: str
    action: str
    target: str
    target_label: str
    detail: str


class AuditPageOut(Camel):
    entries: list[AuditEntryOut]
    # Pass as `before` for the next page; None on the last page.
    next_before: str | None = None


class MemberOut(Camel):
    id: str
    name: str
    email: str
    role: Role
    permissions: list[str] | None = None
    last_active_at: str | None = None
    status: Literal["active", "invited", "disabled"]
    invited_at: str | None = None
    invited_by: str | None = None


class DayHoursOut(Camel):
    open: bool
    from_: str = Field(serialization_alias="from")
    to: str


class ClosedDayOut(Camel):
    date: str
    label: str


class OrgSettingsOut(Camel):
    name: str
    city: str
    languages: list[Language]
    hours: list[DayHoursOut]
    closed: list[ClosedDayOut]
    updated_at: str
    updated_by: str


class ActivityEntryOut(Camel):
    id: str
    at: str
    actor: str
    actor_kind: Literal["member", "bitntech", "aica"]
    actor_id: str | None = None
    area: ActivityArea
    text: str
    detail: str | None = None


class ActivityPageOut(Camel):
    entries: list[ActivityEntryOut]
    # Pass as `before` for the next page; None on the last page.
    next_before: str | None = None


# ---- Phase 2: requests to bitNtech (frontend/src/console/types.ts ChangeRequest)


class NewChangeRequestIn(Camel):
    """Sizes only cap the body; the route checks each value and says what's wrong."""

    kind: str = Field(max_length=40)
    agent_id: str | None = Field(None, max_length=128)
    # The agent's name as the console shows it. Agents aren't on the server
    # until Phase 6, so it's taken as given (and only for display).
    agent_name: str | None = Field(None, max_length=120)
    title: str = Field(max_length=1000)
    detail: str = Field(max_length=10000)
    urgency: str = Field(max_length=20)


class ReplyIn(Camel):
    text: str = Field(max_length=10000)


class NumberRequestIn(Camel):
    note: str = Field("", max_length=10000)


class ChangeRequestPatchIn(Camel):
    status: Literal["open", "in_progress", "done", "declined"] | None = None
    reply: str | None = Field(None, max_length=10000)


class ChangeReplyOut(Camel):
    id: str
    by: str
    by_kind: Literal["member", "bitntech"]
    at: str
    text: str


class ChangeRequestOut(Camel):
    id: str
    org_slug: str
    kind: Literal["new_agent", "flow_change", "integration", "number", "other"]
    agent_id: str | None
    agent_name: str | None
    title: str
    detail: str
    urgency: Literal["normal", "soon", "urgent"]
    status: Literal["open", "in_progress", "done", "declined", "withdrawn"]
    created_at: str
    created_by: str
    created_by_id: str | None
    updated_at: str
    replies: list[ChangeReplyOut]


class OpsChangeRequestOut(ChangeRequestOut):
    org_name: str


# ---- Phase 3: operations data


CallOutcome = Literal["resolved", "booked", "handed_over", "callback", "dropped", "emergency"]
AppointmentStatus = Literal["needs_check", "booked", "confirmed", "cancelled"]


class CollectedDetailOut(Camel):
    label: str
    value: str
    personal: bool


class CallNoteOut(Camel):
    id: str
    by: str
    at: str
    text: str


class CallSummaryOut(Camel):
    id: str
    agent_id: str
    agent_name: str
    line: str
    caller_phone: str
    caller_name: str | None
    started_at: str
    duration_sec: int
    language: str
    intent: str
    outcome: CallOutcome
    handled_by: str | None


class CallRecordOut(CallSummaryOut):
    summary: str
    path: list[str]
    details: list[CollectedDetailOut]
    # Passed through as the pipeline wrote them (TranscriptTurn, ToolCallRecord, …).
    tool_calls: list[dict]
    knowledge_used: list[str]
    transcript: list[dict]
    notes: list[CallNoteOut]
    has_recording: bool
    handled_by_id: str | None
    analysis: dict
    metrics: dict


class CallLogPageOut(Camel):
    calls: list[CallSummaryOut]
    total: int


class NoteIn(Camel):
    text: str = Field(max_length=10000)


class AssigneeOut(Camel):
    id: str
    name: str


class CallbackOut(Camel):
    id: str
    caller_name: str | None
    caller_phone: str
    reason: str
    requested_at: str
    due_by: str
    assigned_to: AssigneeOut | None
    status: Literal["open", "done", "unreachable"]
    attempts: int
    notes: list[CallNoteOut]
    call_id: str | None


class CallbackPatchIn(Camel):
    # Absent: unchanged. null: unassign.
    assigned_to: str | None = Field(None, max_length=128)
    attempt: Literal["reached", "no_answer"] | None = None
    reopen: bool | None = None
    note: str | None = Field(None, max_length=10000)


class AppointmentOut(Camel):
    id: str
    patient_name: str
    phone: str
    department: str
    doctor: str
    date: str
    time: str
    status: AppointmentStatus
    check_reason: str | None = None
    booked_by: Literal["agent", "staff"]
    agent_name: str | None
    call_id: str | None
    created_at: str
    note: str | None = None


class AppointmentPatchIn(Camel):
    status: AppointmentStatus | None = None
    date: str | None = Field(None, max_length=20)
    time: str | None = Field(None, max_length=10)
    department: str | None = Field(None, max_length=1000)
    doctor: str | None = Field(None, max_length=1000)
    note: str | None = Field(None, max_length=10000)


class HandoffOut(Camel):
    id: str
    call_id: str
    agent_name: str
    line: str
    caller_phone: str
    reason: str
    summary: str
    details: list[CollectedDetailOut]
    language: str
    waiting_since: str
    status: Literal["waiting", "taken", "missed"]
    taken_by: str | None
    taken_at: str | None
    emergency: bool
