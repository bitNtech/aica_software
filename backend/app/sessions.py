"""Session cookies and the dependencies that guard routes.

A session is a Firebase session cookie in an HttpOnly cookie. Every request
verifies it with Firebase (signature, expiry, revocation, disabled user), so
disabling an account or resetting a password cuts access at once. Platform
roles come from custom claims, which only this backend can set.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, Request, Response

from .errors import forbidden, unauthenticated
from .identity import InvalidSession
from .services import Services, get_services

COOKIE = "aica_session"
PLATFORM_CLAIM = "platform_role"
PLATFORM_ROLES = {"master_admin", "staff"}


@dataclass
class Caller:
    uid: str
    email: str
    platform_role: str | None
    remember: bool
    expires_at: int  # epoch seconds


def start_session(svc: Services, response: Response, id_token: str, remember: bool) -> None:
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


def end_session(response: Response, svc: Services) -> None:
    response.delete_cookie(COOKIE, path="/", secure=svc.settings.cookie_secure, httponly=True, samesite=svc.settings.cookie_samesite)


def read_session(request: Request, svc: Services) -> Caller | None:
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


def staff_caller(caller: Caller = Depends(current_caller)) -> Caller:
    if not caller.platform_role:
        raise forbidden("Only bitNtech accounts can do that.")
    return caller


def master_caller(caller: Caller = Depends(current_caller)) -> Caller:
    if caller.platform_role != "master_admin":
        raise forbidden("Only the master admin can do that.")
    return caller
