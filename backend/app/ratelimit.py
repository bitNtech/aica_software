"""A small in-process rate limit per client IP and route, against scripted
abuse of sign-up, reset and resend. One process only; put a shared limiter
(or the reverse proxy's) in front when running more than one worker."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import Request

from .errors import ApiError

_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_lock = Lock()


def limit(bucket: str, per_minute: int):
    def dep(request: Request) -> None:
        ip = request.client.host if request.client else "?"
        key, t = (bucket, ip), time.monotonic()
        with _lock:
            q = _hits[key]
            while q and t - q[0] > 60:
                q.popleft()
            if len(q) >= per_minute:
                raise ApiError(429, "rate_limited", "Too many requests. Wait a minute and try again.", int(60 - (t - q[0])) + 1)
            q.append(t)

    return dep


def reset() -> None:
    with _lock:
        _hits.clear()
