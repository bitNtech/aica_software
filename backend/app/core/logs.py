"""Logging. One line per request with a request id, the route template (never
the raw path: invite tokens travel in paths), the method, status, duration,
the caller's uid and the organisation slug. With LOG_FORMAT=json every line
is a JSON object, for Vercel's log search.

Never log email addresses, names, phone numbers, call content, transcripts,
tokens, cookie values or request bodies. tests/test_logging.py checks it.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone

from fastapi import Request

log = logging.getLogger("aica.request")

REQUEST_ID_HEADER = "X-Request-Id"
# Extra fields a log record may carry, in output order.
FIELDS = ("request_id", "method", "route", "status", "duration_ms", "uid", "org", "outcome")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat().replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for f in FIELDS:
            v = getattr(record, f, None)
            if v is not None:
                out[f] = v
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def __init__(self):
        super().__init__("%(asctime)s %(levelname)s %(name)s: %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        extra = " ".join(f"{f}={getattr(record, f)}" for f in FIELDS if getattr(record, f, None) is not None)
        return f"{line} {extra}" if extra else line


def configure(fmt: str) -> None:
    """Replaces the root handler's formatter. Safe to call more than once."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if not root.handlers:
        root.addHandler(logging.StreamHandler())
    for h in root.handlers:
        h.setFormatter(JsonFormatter() if fmt == "json" else TextFormatter())
    # httpx logs every request's full URL at INFO, and the Identity Toolkit
    # URLs carry the Firebase web API key. Warnings and errors still show.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)


def note(request: Request, *, uid: str | None = None, org: str | None = None) -> None:
    """Records who the request is for, for its log line. The state dict is
    the request scope's, so it is shared with the logging middleware even
    when set from a dependency running in a worker thread."""
    if uid is not None:
        request.state.log_uid = uid
    if org is not None:
        request.state.log_org = org


def _route(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", None) or "unmatched"


async def log_requests(request: Request, call_next):
    if not request.url.path.startswith("/api/"):
        return await call_next(request)
    rid = uuid.uuid4().hex
    request.state.request_id = rid
    start = time.perf_counter()

    def line(status: int) -> None:
        state = request.scope.get("state", {})
        level = logging.ERROR if status >= 500 else logging.INFO
        log.log(
            level,
            "request",
            extra={
                "request_id": rid,
                "method": request.method,
                "route": _route(request),
                "status": status,
                "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                "uid": state.get("log_uid"),
                "org": state.get("log_org"),
                "outcome": "ok" if status < 400 else "refused" if status < 500 else "error",
            },
        )

    try:
        response = await call_next(request)
    except Exception:
        line(500)
        raise
    line(response.status_code)
    response.headers[REQUEST_ID_HEADER] = rid
    return response
