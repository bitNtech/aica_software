"""Session cookies and the dependencies that guard routes.

A session is a Firebase session cookie in an HttpOnly cookie. Every request
verifies it with Firebase (signature, expiry, revocation, disabled user), so
disabling an account or resetting a password cuts access at once. Platform
roles come from custom claims, which only this backend can set.

A master admin can act as a client user. A second HttpOnly cookie holds a
random token whose hash names an `impersonations` record; while that record
is live and belongs to the signed-in master admin, requests run as the
target user, with the master admin kept on `Caller.impersonator`. The master
admin's own session is checked first on every request, so revoking or
demoting them ends the acting session too.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import Depends, Request, Response

from .errors import forbidden, unauthenticated
from .identity import InvalidSession
from .services import Services, get_services
from .store import ImpersonationDoc, hash_key, now

COOKIE = "aica_session"
ACT_COOKIE = "aica_act_as"
PLATFORM_CLAIM = "platform_role"
PLATFORM_ROLES = {"master_admin", "staff"}


@dataclass
class Impersonator:
    """The master admin behind a request made while acting as someone."""

    uid: str
    email: str
    key: str  # impersonations/{key}
    reason: str
    expires_at: datetime


@dataclass
class Caller:
    uid: str
    email: str
    platform_role: str | None
    remember: bool
    expires_at: int  # epoch seconds
    impersonator: Impersonator | None = None


def start_session(svc: Services, response: Response, id_token: str, remember: bool, request: Request | None = None) -> None:
    s = svc.settings
    lifetime = timedelta(days=s.remember_days) if remember else timedelta(hours=s.session_hours)
    cookie = svc.admin.create_session_cookie(id_token, lifetime)
    response.set_cookie(
        COOKIE,
        cookie,
        # Without "keep me signed in" it is a browser-session cookie; Firebase
        # still expires it server-side after session_hours.
        max_age=int(lifetime.total_seconds()) if remember else None,
        httponly=True,
        secure=s.cookie_secure,
        samesite=s.cookie_samesite,
        path="/",
    )
    # A fresh sign-in never resumes an earlier acting session.
    if request is not None and request.cookies.get(ACT_COOKIE):
        clear_act_cookie(response, svc)


def end_session(response: Response, svc: Services) -> None:
    response.delete_cookie(COOKIE, path="/", secure=svc.settings.cookie_secure, httponly=True, samesite=svc.settings.cookie_samesite)
    clear_act_cookie(response, svc)


def set_act_cookie(response: Response, svc: Services, token: str) -> None:
    s = svc.settings
    response.set_cookie(
        ACT_COOKIE, token, max_age=s.act_as_minutes * 60, httponly=True, secure=s.cookie_secure, samesite=s.cookie_samesite, path="/"
    )


def clear_act_cookie(response: Response, svc: Services) -> None:
    response.delete_cookie(ACT_COOKIE, path="/", secure=svc.settings.cookie_secure, httponly=True, samesite=svc.settings.cookie_samesite)


def acting_record(request: Request, svc: Services, real: Caller) -> tuple[str, ImpersonationDoc] | None:
    """The live acting session this browser holds for `real`, if any."""
    token = request.cookies.get(ACT_COOKIE)
    if not token or real.platform_role != "master_admin" or real.impersonator:
        return None
    key = hash_key(token)
    doc = svc.store.get_impersonation(key)
    if not doc or doc.endedAt or doc.actorUid != real.uid or doc.expiresAt <= now():
        return None
    return key, doc


def read_session(request: Request, svc: Services, *, acting: bool = True) -> Caller | None:
    """The caller, or None. With `acting`, a master admin's live acting
    session turns them into the user they act as."""
    real = _own_session(request, svc)
    if not real or not acting:
        return real
    record = acting_record(request, svc, real)
    if not record:
        return real
    key, doc = record
    target = svc.admin.get_user(doc.targetUid)
    # Checked again on every request: the target may have been disabled or
    # given a bitNtech role since.
    if not target or target.disabled or target.claims.get(PLATFORM_CLAIM):
        return real
    return Caller(
        uid=target.uid,
        email=target.email,
        platform_role=None,
        remember=real.remember,
        expires_at=real.expires_at,
        impersonator=Impersonator(uid=real.uid, email=real.email, key=key, reason=doc.reason, expires_at=doc.expiresAt),
    )


def _own_session(request: Request, svc: Services) -> Caller | None:
    cookie = request.cookies.get(COOKIE)
    if not cookie:
        return None
    try:
        claims = svc.admin.verify_session_cookie(cookie)
    except InvalidSession:
        return None
    role = claims.get(PLATFORM_CLAIM)
    iat, exp = int(claims.get("iat", time.time())), int(claims.get("exp", time.time()))
    return Caller(
        uid=claims["uid"] if "uid" in claims else claims["sub"],
        email=str(claims.get("email", "")).lower(),
        platform_role=role if role in PLATFORM_ROLES else None,
        remember=(exp - iat) > 24 * 3600,
        expires_at=exp,
    )


def current_caller(request: Request, svc: Services = Depends(get_services)) -> Caller:
    caller = read_session(request, svc)
    if not caller:
        raise unauthenticated()
    return caller


ACTING = "You're acting as someone. End that first."


def not_acting(caller: Caller = Depends(current_caller)) -> Caller:
    """For routes nobody should use on someone else's behalf."""
    if caller.impersonator:
        raise forbidden(ACTING)
    return caller


def staff_caller(caller: Caller = Depends(current_caller)) -> Caller:
    if caller.impersonator:
        raise forbidden(ACTING)
    if not caller.platform_role:
        raise forbidden("Only bitNtech accounts can do that.")
    return caller


def master_caller(caller: Caller = Depends(current_caller)) -> Caller:
    if caller.impersonator:
        raise forbidden(ACTING)
    if caller.platform_role != "master_admin":
        raise forbidden("Only the master admin can do that.")
    return caller
