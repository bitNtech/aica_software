"""The AICA voice orchestrator (docs/orchestrator-contract.md): voice agents,
calls, handoffs, browser tokens, the model catalogue, the admin control
plane, and its passthroughs to the LLM server (/v1/llm/…) and the TTS
server (/v1/tts/…).

The API holds one platform admin key (ORCH_API_KEY) and names the tenant on
every tenant call with X-Tenant-ID. The tenant always comes from the
organisation's own record (OrgDoc.orchTenantId), never from the browser.
The browser only ever gets short-lived voice and operator tokens.

Nothing here logs bodies: they carry prompts, transcripts and keys. Failures
become `OrchestratorError` with the server's error code, and `api_error`
turns that into a message for the person using the console.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..core.errors import ApiError

log = logging.getLogger("aica.orchestrator")

UNAVAILABLE = "The voice server isn't answering right now. Try again in a moment."
NOT_SET_UP = "The voice server isn't connected to AICA yet. Ask bitNtech to set it up."
NO_TENANT = "This organisation isn't linked to the voice server yet. Ask bitNtech to link it."


class OrchestratorError(Exception):
    def __init__(self, status: int, code: str, message: str, *, request_id: str | None = None, details: dict | None = None, retry_after: int | None = None):
        super().__init__(f"{status} {code}")
        self.status, self.code, self.message = status, code, message
        self.request_id, self.details, self.retry_after = request_id, details or {}, retry_after


@dataclass
class Reply:
    status: int
    data: Any
    etag: str | None = None
    headers: dict = field(default_factory=dict)
    content: bytes = b""


def version_of(etag: str | None) -> int | None:
    """'"v3"' → 3."""
    if not etag:
        return None
    v = etag.strip().strip('"').lstrip("W/").strip('"')
    return int(v[1:]) if v.startswith("v") and v[1:].isdigit() else None


def etag_of(version: int | None) -> str | None:
    return f'"v{version}"' if version is not None else None


class Orchestrator:
    """A small synchronous client (routes run in FastAPI's thread pool).
    Only GETs are retried, once, on a dropped connection or a 502/503."""

    def __init__(self, base_url: str, api_key: str, *, timeout: float = 15.0, transport: httpx.BaseTransport | None = None):
        self.base_url = base_url.rstrip("/")
        self._key = api_key
        self._client = httpx.Client(base_url=self.base_url, timeout=timeout, transport=transport, follow_redirects=False)

    @property
    def ws_base(self) -> str:
        """wss://… for the browser's sockets."""
        if self.base_url.startswith("https://"):
            return "wss://" + self.base_url[len("https://"):]
        if self.base_url.startswith("http://"):
            return "ws://" + self.base_url[len("http://"):]
        return self.base_url

    def request(
        self,
        method: str,
        path: str,
        *,
        tenant: str | None = None,
        json: Any = None,
        params: dict | None = None,
        if_match: str | None = None,
        idempotency_key: str | None = None,
        request_id: str | None = None,
        timeout: float | None = None,
        raw: bool = False,
    ) -> Reply:
        headers = {"Authorization": f"Bearer {self._key}", "Accept": "application/json"}
        if tenant:
            headers["X-Tenant-ID"] = tenant
        if if_match:
            headers["If-Match"] = if_match
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        if request_id:
            headers["X-Request-ID"] = request_id
        clean = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
        attempts = 2 if method == "GET" else 1
        started = time.monotonic()
        for attempt in range(attempts):
            try:
                kw: dict = {"headers": headers, "params": clean or None}
                if json is not None:
                    kw["json"] = json
                if timeout is not None:
                    kw["timeout"] = timeout
                res = self._client.request(method, path, **kw)
            except httpx.TimeoutException:
                if attempt + 1 < attempts:
                    continue
                log.warning("orchestrator timeout", extra={"method": method, "path": _route(path)})
                raise OrchestratorError(504, "timeout", UNAVAILABLE)
            except httpx.HTTPError:
                if attempt + 1 < attempts:
                    continue
                log.warning("orchestrator unreachable", extra={"method": method, "path": _route(path)})
                raise OrchestratorError(503, "unreachable", UNAVAILABLE)
            if res.status_code in (502, 503) and attempt + 1 < attempts:
                continue
            break
        ms = int((time.monotonic() - started) * 1000)
        rid = res.headers.get("x-request-id")
        if res.status_code >= 400:
            err = _envelope(res)
            log.info("orchestrator error", extra={"method": method, "path": _route(path), "status": res.status_code, "code": err.get("code"), "ms": ms, "upstream_request_id": rid})
            retry = res.headers.get("retry-after")
            raise OrchestratorError(
                res.status_code, str(err.get("code") or "error"), str(err.get("message") or ""), request_id=err.get("request_id") or rid,
                details=err.get("details") if isinstance(err.get("details"), dict) else None, retry_after=int(retry) if retry and retry.isdigit() else None,
            )
        etag = res.headers.get("etag")
        if raw:
            return Reply(res.status_code, None, etag, dict(res.headers), res.content)
        data = None
        if res.status_code != 204 and res.content:
            try:
                data = res.json()
            except ValueError:
                data = None
        return Reply(res.status_code, data, etag, dict(res.headers))

    def get(self, path: str, **kw) -> Reply:
        return self.request("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw) -> Reply:
        return self.request("POST", path, json=body if body is not None else {}, **kw)

    def patch(self, path: str, body: Any, **kw) -> Reply:
        return self.request("PATCH", path, json=body, **kw)

    def put(self, path: str, body: Any, **kw) -> Reply:
        return self.request("PUT", path, json=body, **kw)

    def delete(self, path: str, **kw) -> Reply:
        return self.request("DELETE", path, **kw)

    def close(self) -> None:
        self._client.close()


def _envelope(res: httpx.Response) -> dict:
    try:
        body = res.json()
    except ValueError:
        return {}
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        return err
    # FastAPI's own {"detail": …}
    if isinstance(body, dict) and "detail" in body:
        return {"code": "error", "message": str(body["detail"])[:300]}
    return {}


def _route(path: str) -> str:
    """The path without ids, for logs: /v1/voice-agents/vagent_x → /v1/voice-agents/:id."""
    parts = path.split("?")[0].split("/")
    return "/".join(":id" if ("_" in p and any(c.isdigit() for c in p)) else p for p in parts)


def field_errors(e: OrchestratorError) -> list[str]:
    """`validation_error` details as "vad.end_silence_ms: …" lines."""
    out = []
    for item in (e.details.get("errors") or [])[:8]:
        if isinstance(item, dict):
            loc = ".".join(str(x) for x in (item.get("loc") or []) if x not in ("body",))
            out.append(f"{loc}: {item.get('msg', '')}".strip(": "))
    return out


def api_error(e: OrchestratorError, what: str = "do that") -> ApiError:
    """The orchestrator's failure, worded for the console (frontend AuthErrorCode)."""
    code = e.code
    if e.status == 412 or code == "version_mismatch":
        return ApiError(409, "conflict", "Someone else changed this on the voice server since it was loaded. Reload and try again.")
    if e.status == 429:
        return ApiError(429, "rate_limited", "The voice server is busy. Try again in a moment.", e.retry_after or 5)
    if code == "model_disabled":
        return ApiError(422, "invalid_input", "That model or voice has been switched off. Choose another one.")
    if code == "model_in_use":
        return ApiError(409, "invalid_input", f"That one is in use and can't be switched off. {e.message}".strip())
    if code in ("session_live", "no_handoff", "session_ended"):
        return ApiError(409, "invalid_input", "That call has changed since you looked. Refresh to see where it is now.")
    if e.status == 404:
        return ApiError(404, "invalid_input", "The voice server doesn't have that any more. It may have ended or been deleted.")
    if e.status in (400, 422):
        lines = field_errors(e)
        detail = f" ({'; '.join(lines)})" if lines else (f" ({e.message})" if e.message else "")
        return ApiError(422, "invalid_input", f"The voice server refused to {what}{detail}."[:600])
    if e.status in (401, 403):
        # Our key or our tenant: not something the person can fix.
        log.error("orchestrator refused our credentials", extra={"status": e.status, "code": code})
        return ApiError(503, "unknown", "The voice server refused AICA's credentials. Ask bitNtech to check the connection.")
    return ApiError(503, "unknown", UNAVAILABLE)


def require(svc) -> Orchestrator:
    orch = getattr(svc, "orch", None)
    if orch is None:
        raise ApiError(503, "unknown", NOT_SET_UP)
    return orch


def tenant_of(org) -> str:
    t = getattr(org, "orchTenantId", None)
    if not t:
        raise ApiError(409, "invalid_input", NO_TENANT)
    return t
