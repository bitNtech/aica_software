"""One test request for an HTTP tool, from AICA's servers, made safely.

A tool's address is typed by a person, so the request is guarded against
being pointed at AICA's own network (server-side request forgery):
- HTTPS only; redirects are never followed;
- the host name is looked up first, and every address it has must be on the
  public internet (no private, loopback, link-local, carrier-grade NAT,
  multicast or reserved ranges, and so no cloud metadata service);
- the request then goes to that checked address, with the host name kept for
  TLS (SNI and certificate checks) and the Host header, so a second lookup
  can't swap in another address (DNS rebinding);
- the tool's own timeout, and at most 64 KB of the reply is read.

The secret goes in `Authorization: Bearer <secret>`, or in the tool's own
header when it names one. It is never logged, and is blanked from the reply
summary if the system echoes it back.
"""
from __future__ import annotations

import ipaddress
import socket
import time
from urllib.parse import urlencode, urlsplit

import httpx

MAX_BYTES = 64 * 1024
SUMMARY_CHARS = 300


class Blocked(Exception):
    pass


def default_resolve(host: str, port: int) -> list[str]:
    return list(dict.fromkeys(info[4][0] for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)))


def _ordered(addrs: list[str]) -> list[str]:
    """IPv4 first: many servers (Vercel's among them) have no IPv6 route out."""
    return sorted(addrs, key=lambda a: ipaddress.ip_address(a.split("%")[0]).version)


def public_addresses(host: str, port: int, resolve) -> list[str]:
    try:
        ip = ipaddress.ip_address(host)
        addrs = [str(ip)]
    except ValueError:
        try:
            addrs = (resolve or default_resolve)(host, port)
        except OSError as e:
            raise Blocked(f"Couldn't find {host}. Check the address.") from e
    if not addrs:
        raise Blocked(f"Couldn't find {host}. Check the address.")
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%")[0])
        if not ip.is_global or ip.is_multicast:
            raise Blocked("AICA can only call systems on the public internet. This address is on a private network.")
    return addrs


def _typed(value: str, kind: str):
    if kind == "number":
        try:
            n = float(value)
            return int(n) if n.is_integer() else n
        except ValueError:
            return value
    if kind == "boolean":
        return value.strip().lower() in ("true", "yes", "1")
    return value


def _summary(text: str, secret: str | None) -> str:
    text = " ".join(text.split())
    if secret:
        text = text.replace(secret, "••••")
    return text[:SUMMARY_CHARS] + ("…" if len(text) > SUMMARY_CHARS else "")


def run_test(*, method: str, url: str, params: list[dict], inputs: dict[str, str], timeout_ms: int, secret: str | None,
             secret_header: str | None, resolve=None, transport=None) -> dict:
    """{ok, status?, ms, summary} — the frontend's ToolTestResult. Never raises."""
    started = time.perf_counter()
    ms = lambda: int((time.perf_counter() - started) * 1000)  # noqa: E731
    parts = urlsplit(url)
    try:
        port = parts.port or 443
    except ValueError:
        return {"ok": False, "ms": 0, "summary": "The address has a port number that isn't valid."}
    if parts.scheme != "https" or not parts.hostname:
        return {"ok": False, "ms": 0, "summary": "Give the full address, starting with https://."}
    host = parts.hostname
    try:
        addrs = _ordered(public_addresses(host, port, resolve))
    except Blocked as e:
        return {"ok": False, "ms": ms(), "summary": str(e)}
    types = {p.get("name"): p.get("type", "string") for p in params}
    values = {k: _typed(v, types.get(k, "string")) for k, v in inputs.items() if v != ""}
    path = parts.path or "/"
    query = parts.query
    if method == "GET" and values:
        query = "&".join(q for q in (query, urlencode(values)) if q)
    # Uncompressed: the 64 KB cap must hold for what's read, not after inflating it.
    headers = {"Host": host if port == 443 else f"{host}:{port}", "Accept": "application/json", "Accept-Encoding": "identity", "User-Agent": "AICA-tool-test/1"}
    if secret:
        headers[secret_header or "Authorization"] = secret if secret_header else f"Bearer {secret}"
    deadline = time.perf_counter() + timeout_ms / 1000
    status, body, failure = None, b"", f"Couldn't connect to {host}."
    # Each checked address in turn, until one answers.
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%")[0])
        netloc = f"[{ip}]" if ip.version == 6 else str(ip)
        target = f"https://{netloc}:{port}{path}" + (f"?{query}" if query else "")
        try:
            with httpx.Client(transport=transport, timeout=timeout_ms / 1000, follow_redirects=False) as client:
                req = client.build_request(method, target, headers=headers, json=values if method == "POST" else None, extensions={"sni_hostname": host})
                res = client.send(req, stream=True)
                try:
                    try:
                        for chunk in res.iter_raw():
                            body += chunk
                            if len(body) >= MAX_BYTES:
                                body = body[:MAX_BYTES]
                                break
                            if time.perf_counter() > deadline:  # a slow trickle counts against the timeout too
                                raise httpx.ReadTimeout("deadline", request=req)
                    except httpx.StreamConsumed:
                        body = res.content[:MAX_BYTES]  # an in-memory reply (tests), already read
                    status = res.status_code
                finally:
                    res.close()
            break
        except httpx.TimeoutException:
            return {"ok": False, "ms": ms(), "summary": f"No reply within {timeout_ms / 1000:g} seconds."}
        except httpx.ConnectError as e:
            if "CERTIFICATE" in str(e).upper() or "SSL" in str(e).upper():
                return {"ok": False, "ms": ms(), "summary": f"{host}'s security certificate isn't valid."}
            continue
        except httpx.HTTPError:
            failure = "The request failed before the system replied."
            continue
    if status is None:
        return {"ok": False, "ms": ms(), "summary": failure}
    if 300 <= status < 400:
        return {"ok": False, "status": status, "ms": ms(), "summary": "The system answered with a redirect. AICA doesn't follow redirects: use the final address."}
    text = body.decode("utf-8", errors="replace") or "(an empty reply)"
    return {"ok": 200 <= status < 300, "status": status, "ms": ms(), "summary": _summary(text, secret)}
