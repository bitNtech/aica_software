"""/api/orgs/{slug}/tools and /credentials — what agents can do during a
call, and the secrets those tools send (Phase 5).

- Reading: `library.secrets`, or anyone who sees agents and isn't a
  viewer; bitNtech too. Secret values are never returned: only names and
  when and by whom they were set.
- Tools are set up by bitNtech's master admin (adding, changing, switching
  on or off, deleting, testing). Built-in tools can be switched off, not
  deleted.
- Secrets are set and deleted with `library.secrets`. They are encrypted
  at rest (app/data/vault.py), and every change is in the activity log.
- A tool or secret can't be deleted while something uses it.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends
from pydantic import Field

from ...access.orgs import OrgContext, org_member, org_permission
from ...auth.accounts import iso
from ...core.errors import ApiError, bad_input, forbidden
from ...core.ratelimit import limit_caller
from ...data.store import CredentialDoc, ToolDoc, Tx, new_id, now
from ...domain.catalogue import BUILTIN_TOOLS
from ...domain.usage import tool_users, usage_map
from ...integrations.toolhttp import run_test
from ...models import Camel

router = APIRouter(prefix="/api/orgs/{slug}", tags=["org"])
WRITE_LIMIT = Depends(limit_caller("org-tools", 30))

HTTPS = re.compile(r"^https://[^\s/]+\.[^\s]+$", re.IGNORECASE)
PARAM_NAME = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
SECRET_NAME = re.compile(r"^[A-Z][A-Z0-9_]{2,39}$")
HEADER_NAME = re.compile(r"^[A-Za-z0-9-]{1,40}$")
# Headers a secret can't be sent in: they'd break or hijack the request.
RESERVED_HEADERS = {"host", "content-length", "content-type", "cookie", "connection", "transfer-encoding", "user-agent", "accept"}
TIMEOUTS = (3000, 5000, 8000, 15000)
PARAM_TYPES = ("string", "number", "date", "boolean")


class ToolParamIn(Camel):
    name: str = Field(max_length=100)
    type: str = Field(max_length=20)
    required: bool = False
    description: str = Field("", max_length=500)


class ToolIn(Camel):
    """The frontend's AgentTool. Lengths only cap the size; rules follow."""

    id: str | None = Field(None, max_length=128)
    name: str = Field(max_length=500)
    kind: str = Field("http", max_length=20)
    description: str = Field("", max_length=2000)
    acts: bool = False
    method: str | None = Field(None, max_length=10)
    url: str | None = Field(None, max_length=2000)
    credential_name: str | None = Field(None, max_length=100)
    credential_header: str | None = Field(None, max_length=100)
    timeout_ms: int | None = None
    retries: int | None = None
    params: list[ToolParamIn] = Field(default_factory=list, max_length=20)
    enabled: bool = True


class ToolTestIn(Camel):
    inputs: dict[str, str] = Field(default_factory=dict, max_length=20)


class CredentialIn(Camel):
    name: str = Field(max_length=100)
    value: str = Field(max_length=8192)


def can_read(ctx: OrgContext) -> bool:
    a = ctx.access
    return bool(a.platform) or a.has("library.secrets") or (a.has("agents.view") and a.role != "viewer")


def _master(ctx: OrgContext, what: str) -> None:
    if ctx.access.platform != "master_admin":
        raise forbidden(f"Only bitNtech can {what}. Send them a request instead.")


def _not_found(what: str) -> ApiError:
    return ApiError(404, "invalid_input", f"That {what} doesn't exist any more. It may have been deleted.")


def _builtin(spec: dict) -> ToolDoc:
    return ToolDoc(id=spec["id"], name=spec["name"], kind="builtin", builtin=spec["builtin"], description=spec["description"], acts=spec["acts"], enabled=spec["enabled"], params=spec["params"])


def all_tools(tx_or_store, slug: str) -> list[ToolDoc]:
    """The built-in tools (as switched for this organisation) and its own."""
    stored = {t.id: t for t in tx_or_store.list_records(slug, "tool")}
    builtins = [stored.get(b["id"]) or _builtin(b) for b in BUILTIN_TOOLS]
    return builtins + sorted((t for t in stored.values() if t.kind == "http"), key=lambda t: t.name.lower())


def tool_out(t: ToolDoc, used: set[str] | None = None) -> dict:
    out = {"id": t.id, "name": t.name, "kind": t.kind, "description": t.description, "acts": t.acts, "params": t.params, "enabled": t.enabled, "usedBy": sorted(used or [])}
    if t.kind == "builtin":
        out["builtin"] = t.builtin
    else:
        out.update(method=t.method, url=t.url, credentialName=t.credentialName, credentialHeader=t.credentialHeader, timeoutMs=t.timeoutMs, retries=t.retries,
                   lastTestedAt=iso(t.lastTestedAt) if t.lastTestedAt else None)
    return out


def _problems(body: ToolIn, others: list[ToolDoc]) -> str | None:
    """The first thing wrong, in console/toolRules.ts's words."""
    name = body.name.strip()
    if len(name) < 3 or len(name) > 60:
        return "Give it a name of at least 3 characters, e.g. “Book an appointment”."
    if any(o.name.strip().lower() == name.lower() and o.id != body.id for o in others):
        return "Another tool has that name."
    if len(body.description.strip()) < 10 or len(body.description) > 300:
        return "Say what it does in a sentence: agents use this to decide when to call it."
    if not HTTPS.match((body.url or "").strip()):
        return "Give the full address, starting with https://."
    try:
        urlsplit((body.url or "").strip()).port
    except ValueError:
        return "The address has a port number that isn't valid."
    if body.method not in ("GET", "POST"):
        return "Choose GET or POST."
    if body.timeout_ms not in TIMEOUTS:
        return "Choose how long to wait for a reply."
    if body.retries is None or not 0 <= body.retries <= 3:
        return "Choose how many times to retry."
    seen: set[str] = set()
    for p in body.params:
        if not PARAM_NAME.match(p.name):
            return "Use lower-case letters, digits and underscores, starting with a letter, e.g. patient_id."
        if p.name in seen:
            return f"“{p.name}” is used twice."
        seen.add(p.name)
        if p.type not in PARAM_TYPES or len(p.description) > 120:
            return "Each detail needs a type and a short description."
    if body.credential_header is not None and (not HEADER_NAME.match(body.credential_header) or body.credential_header.lower() in RESERVED_HEADERS):
        return "Give a plain header name for the secret, e.g. X-Api-Key."
    return None


# ---------------------------------------------------------------- tools


@router.get("/tools")
def list_tools(ctx: OrgContext = Depends(org_member)):
    if not can_read(ctx):
        raise forbidden("You don't have permission to see tools.")
    used = usage_map(ctx.svc, ctx.slug)["tools"]
    return [tool_out(t, used.get(t.id)) for t in all_tools(ctx.svc.store, ctx.slug)]


@router.post("/tools", dependencies=[WRITE_LIMIT])
def save_tool(body: ToolIn, ctx: OrgContext = Depends(org_member)):
    _master(ctx, "set up tools")
    builtin_ids = {b["id"] for b in BUILTIN_TOOLS}

    def run(tx: Tx) -> ToolDoc:
        tools = all_tools(tx, ctx.slug)
        existing = next((t for t in tools if body.id and t.id == body.id), None)
        if body.id and not existing:
            raise _not_found("tool")
        if existing and existing.id in builtin_ids:
            # Built-in tools are only switched on or off.
            existing.enabled, existing.updatedAt = body.enabled, now()
            tx.save_record(ctx.slug, "tool", existing)
            return existing
        problem = _problems(body, [t for t in tools if t.kind == "http"])
        if problem:
            raise bad_input(problem)
        cred = body.credential_name.strip().upper() if body.credential_name else None
        if cred and not tx.get_record(ctx.slug, "credential", cred):
            raise bad_input(f"There's no secret called {cred}. Add it under Secrets first.")
        t = ToolDoc(
            id=existing.id if existing else new_id("tool"), name=body.name.strip(), kind="http", description=body.description.strip(),
            acts=body.acts, enabled=body.enabled, params=[p.model_dump() for p in body.params], method=body.method, url=(body.url or "").strip(),
            credentialName=cred, credentialHeader=body.credential_header or None, timeoutMs=body.timeout_ms,
            retries=0 if body.acts else body.retries,  # never repeat something that acts
            lastTestedAt=None,
        )
        tx.save_record(ctx.slug, "tool", t)
        # A tool that sends a secret, pointed somewhere new, gets that secret: say so.
        was_host = urlsplit(existing.url or "").hostname if existing else None
        now_host = urlsplit(t.url or "").hostname
        detail = f"Its address moved from {was_host} to {now_host}; it sends {t.credentialName} there." if existing and t.credentialName and was_host != now_host else ""
        ctx.log(tx, "library", f"{'Changed' if existing else 'Added'} the tool “{t.name}”", detail)
        return t

    t = ctx.svc.store.transact(run)
    ctx.audit_acting("tool_saved", t.id)
    return tool_out(t, usage_map(ctx.svc, ctx.slug)["tools"].get(t.id))


@router.post("/tools/{tool_id}/delete", status_code=204, dependencies=[WRITE_LIMIT])
def delete_tool(tool_id: str, ctx: OrgContext = Depends(org_member)):
    _master(ctx, "remove tools")
    if tool_id in {b["id"] for b in BUILTIN_TOOLS}:
        raise bad_input("Built-in tools can be switched off, not deleted.")
    users = tool_users(ctx.svc, ctx.slug, tool_id)

    def run(tx: Tx) -> None:
        t = tx.get_record(ctx.slug, "tool", tool_id)
        if not t:
            raise _not_found("tool")
        if users:
            raise bad_input(f"{', '.join(users)} {'uses' if len(users) == 1 else 'use'} “{t.name}”. Take it out of {'that agent' if len(users) == 1 else 'those agents'} first.")
        tx.delete_record(ctx.slug, "tool", t.id)
        ctx.log(tx, "library", f"Deleted the tool “{t.name}”")

    ctx.svc.store.transact(run)


@router.post("/tools/{tool_id}/test", dependencies=[Depends(limit_caller("org-tool-test", 5))])
def test_tool(tool_id: str, body: ToolTestIn, ctx: OrgContext = Depends(org_member)):
    """Runs the tool once with sample inputs, from AICA's servers (app/integrations/toolhttp.py)."""
    _master(ctx, "test tools")
    t = next((x for x in all_tools(ctx.svc.store, ctx.slug) if x.id == tool_id), None)
    if not t:
        raise _not_found("tool")
    missing = [p["name"] for p in t.params if p.get("required") and not (body.inputs.get(p["name"]) or "").strip()]
    if missing:
        return {"ok": False, "ms": 0, "summary": f"Fill in {', '.join(missing)} to run a test."}
    if not t.enabled:
        return {"ok": False, "ms": 0, "summary": "The tool is switched off. Switch it on to test it."}
    if t.kind == "builtin":
        return {"ok": True, "ms": 0, "summary": "Works. In a test nothing is sent to anyone."}
    secret = None
    if t.credentialName:
        c = ctx.svc.store.get_record(ctx.slug, "credential", t.credentialName)
        if not c:
            return {"ok": False, "status": 401, "ms": 0, "summary": f"The secret {t.credentialName} isn't set, so the system refused the request."}
        if not ctx.svc.secrets:
            return {"ok": False, "ms": 0, "summary": "Secrets can't be read: the server's encryption key (SECRETS_KEY) isn't set."}
        try:
            secret = ctx.svc.secrets.open(ctx.slug, c.id, c.ciphertext, c.keyId)
        except Exception:  # noqa: BLE001 — a replaced key, or a damaged record; never echo either
            return {"ok": False, "ms": 0, "summary": f"The secret {c.id} can't be read with the server's current key. Set it again."}
    result = run_test(
        method=t.method or "GET", url=t.url or "", params=t.params, inputs={k: v for k, v in body.inputs.items() if len(v) <= 500},
        timeout_ms=t.timeoutMs or 5000, secret=secret, secret_header=t.credentialHeader, resolve=ctx.svc.resolve, transport=ctx.svc.tool_transport,
    )
    if result["ok"]:
        t.lastTestedAt = now()
        ctx.svc.store.save_record(ctx.slug, "tool", t)
    return result


# ---------------------------------------------------------------- secrets


def credential_out(c: CredentialDoc) -> dict:
    return {"name": c.id, "setAt": iso(c.setAt), "setBy": c.setBy}


@router.get("/credentials")
def list_credentials(ctx: OrgContext = Depends(org_member)):
    if not can_read(ctx):
        raise forbidden("You don't have permission to see secrets.")
    return [credential_out(c) for c in sorted(ctx.svc.store.list_records(ctx.slug, "credential"), key=lambda c: c.id)]


@router.post("/credentials", dependencies=[WRITE_LIMIT])
def set_credential(body: CredentialIn, ctx: OrgContext = Depends(org_permission("library.secrets", what="set secrets"))):
    name = body.name.strip().upper()
    if not SECRET_NAME.match(name):
        raise bad_input("Use 3 to 40 capital letters, digits and underscores, starting with a letter, e.g. HIS_API_KEY.")
    value = body.value.strip()
    if not value:
        raise bad_input("Paste the secret’s value.")
    if len(value) > 4096:
        raise bad_input("That's longer than any secret we expect. Check what you pasted.")
    if not ctx.svc.secrets:
        raise ApiError(503, "unknown", "Secrets can't be stored yet: the server has no encryption key. bitNtech needs to set SECRETS_KEY.")
    ciphertext, kid = ctx.svc.secrets.seal(ctx.slug, name, value)
    by = ctx.actor()[0]

    def run(tx: Tx) -> CredentialDoc:
        had = tx.get_record(ctx.slug, "credential", name)
        c = CredentialDoc(id=name, ciphertext=ciphertext, keyId=kid, setAt=now(), setBy=by)
        tx.save_record(ctx.slug, "credential", c)
        ctx.log(tx, "library", f"{'Changed' if had else 'Set'} the secret {name}", "The value isn’t shown here or anywhere else.")
        return c

    c = ctx.svc.store.transact(run)
    ctx.audit_acting("secret_set", name)
    return credential_out(c)


@router.post("/credentials/{name}/delete", status_code=204, dependencies=[WRITE_LIMIT])
def delete_credential(name: str, ctx: OrgContext = Depends(org_permission("library.secrets", what="delete secrets"))):
    name = name.strip().upper()

    def run(tx: Tx) -> None:
        users = [t for t in tx.list_records(ctx.slug, "tool") if t.credentialName == name]
        if users:
            names = ", ".join(f"“{t.name}”" for t in users)
            raise bad_input(f"{names} {'uses' if len(users) == 1 else 'use'} {name}. Change {'that tool' if len(users) == 1 else 'those tools'} first.")
        if not tx.get_record(ctx.slug, "credential", name):
            raise _not_found("secret")
        tx.delete_record(ctx.slug, "credential", name)
        ctx.log(tx, "library", f"Deleted the secret {name}")

    ctx.svc.store.transact(run)
    ctx.audit_acting("secret_deleted", name)
