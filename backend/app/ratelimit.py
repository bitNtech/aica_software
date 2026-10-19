"""Rate limits against scripted abuse, shared by every API instance: the
counters are in the store (Firestore in production), in fixed one-minute
windows. Anonymous routes count per client IP; signed-in routes count per
person, so people behind one hospital network don't share a limit.

If the store can't be reached the request is allowed and a warning is
logged: an outage of the limiter shouldn't take the console down with it.
"""
from __future__ import annotations

import logging

from fastapi import Depends, Request

from .errors import ApiError
from .services import Services, get_services
from .sessions import Caller, current_caller

log = logging.getLogger("aica.ratelimit")

WINDOW_SECONDS = 60


def client_ip(request: Request, svc: Services) -> str:
    # Vercel's edge sets X-Real-IP to the client's address and overwrites
    # what the client sent, so it can be trusted there and only there.
    if svc.settings.vercel_url:
        real = (request.headers.get("x-real-ip") or "").strip()
        if real:
            return real
    return request.client.host if request.client else "?"


def _check(svc: Services, bucket: str, key: str, per_minute: int) -> None:
    try:
        wait = svc.store.hit(f"{bucket}|{key}", per_minute, WINDOW_SECONDS)
    except Exception as e:  # noqa: BLE001 — fail open, see the module docstring
        log.warning("rate limiter unavailable (%s); request allowed", type(e).__name__)
        return
    if wait is not None:
        raise ApiError(429, "rate_limited", "Too many requests. Wait a minute and try again.", max(1, wait))


def limit(bucket: str, per_minute: int):
    """Per client IP, for routes anyone can call."""

    def dep(request: Request, svc: Services = Depends(get_services)) -> None:
        _check(svc, bucket, f"ip:{client_ip(request, svc)}", per_minute)

    return dep


def limit_caller(bucket: str, per_minute: int):
    """Per signed-in person. Acting as someone counts against the master
    admin, not the person acted as."""

    def dep(caller: Caller = Depends(current_caller), svc: Services = Depends(get_services)) -> None:
        who = caller.impersonator.uid if caller.impersonator else caller.uid
        _check(svc, bucket, f"uid:{who}", per_minute)

    return dep
