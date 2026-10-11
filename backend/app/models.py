"""Request and response bodies. Field names are camelCase on the wire to
match frontend/src/auth/types.ts."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic.alias_generators import to_camel

Role = Literal["owner", "admin", "supervisor", "front_desk", "viewer"]
PlatformRole = Literal["master_admin", "staff"]
OrgStatus = Literal["pending_review", "active", "declined", "suspended"]
BusinessType = Literal["hospital", "clinic", "diagnostics", "other"]
Language = Literal["tamil", "english", "tanglish"]


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


# ---- responses ----


class MembershipOut(Camel):
    org_slug: str
    org_name: str
    city: str
    role: Role
    org_status: OrgStatus
    status_reason: str | None = None


class UserOut(Camel):
    id: str
    name: str
    email: str
    platform_role: PlatformRole | None = None
    memberships: list[MembershipOut]


class SessionOut(Camel):
    user: UserOut
    remember: bool
    expires_at: str


class EmailOut(Camel):
    email: str


class InviteOut(Camel):
    email: str
    org_name: str
    role: str
    invited_by: str
    expires_at: str


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
    owner_email: str
    created_at: str
