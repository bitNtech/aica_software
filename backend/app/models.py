"""Request and response bodies. Field names are camelCase on the wire to
match frontend/src/auth/types.ts."""
from __future__ import annotations

import re
from typing import Annotated, Literal

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
