"""/api/ops/voice/… — the voice orchestrator's control plane for bitNtech
(docs/orchestrator-contract.md §Admin), and linking organisations to
their tenant.

- bitNtech staff may read status and live calls; everything else, and
  every change, is the master admin's.
- Each change is written to the platform audit log (who, what, which
  setting), never with the values themselves: they can be secrets.
- Changes carry the version the page loaded (If-Match on the orchestrator),
  so two admins can't overwrite each other: a stale one gets "conflict".
- Saving settings supports a dry run (`dryRun`), which validates the whole
  configuration without storing anything.
- Secrets read back as "***", and "***" sent back means "unchanged".
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import Field

from ..auth.sessions import Caller, master_caller, staff_caller
from ..core.errors import ApiError, bad_input
from ..core.ratelimit import limit
from ..core.services import Services, get_services
from ..integrations.orchestrator import OrchestratorError, api_error, etag_of, field_errors, require, version_of
from ..models import Camel

router = APIRouter(prefix="/api/ops", tags=["ops"])
WRITE_LIMIT = Depends(limit("ops-voice", 60))
TENANT = re.compile(r"^ten_[A-Za-z0-9]{6,64}$")
KINDS = ("llm", "tts_voice", "asr", "vad", "denoise", "turn", "lid", "diarization", "correction")
COMPONENTS = ("asr", "prepipe", "llm", "tts")


class ConfigPatchIn(Camel):
    set: dict = Field(default_factory=dict)
    reset: list[str] = Field(default_factory=list, max_length=200)
    version: int | None = None
    dry_run: bool = False


class ConfigReplaceIn(Camel):
    overrides: dict
    version: int | None = None
    dry_run: bool = False


class VersionIn(Camel):
    version: int | None = None
    dry_run: bool = False


class ModelSwitchIn(Camel):
    enabled: bool
    version: int | None = None


class ModelsBulkIn(Camel):
    changes: dict[str, dict[str, bool]]
    version: int | None = None


class UpstreamTestIn(Camel):
    base_url: str = Field(max_length=500)
    api_key: str | None = Field(None, max_length=500)


class AdmissionIn(Camel):
    accepting: bool


class EndIn(Camel):
    reason: str = Field("", max_length=300)


class TenantIn(Camel):
    tenant_id: str | None = Field(None, max_length=80)


def _admin_error(e: OrchestratorError, what: str) -> ApiError:
    """Admins get the server's own words, which name the setting."""
    if e.status in (400, 422):
        lines = field_errors(e) or ([e.message] if e.message else [])
        return ApiError(422, "invalid_input", f"The voice server refused to {what}: {'; '.join(lines) or e.code}."[:1200])
    if e.code == "model_in_use":
        return ApiError(409, "invalid_input", f"It's in use, so it can't be switched off: {e.message}"[:600])
    return api_error(e, what)


def _run(fn, what: str):
    try:
        return fn()
    except OrchestratorError as e:
        raise _admin_error(e, what)


def _with_version(reply) -> Any:
    data = reply.data
    v = version_of(reply.etag)
    if isinstance(data, dict) and v is not None:
        data = {**data, "version": data.get("version", v)}
    return data


def _audit(svc: Services, caller: Caller, action: str, target: str, detail: str = "") -> None:
    svc.store.audit(caller.uid, action, target, detail[:300])


# ---------------------------------------------------------------- reading


@router.get("/voice/status")
def status(_: Caller = Depends(staff_caller), svc: Services = Depends(get_services)):
    orch = require(svc)
    out = _run(lambda: orch.get("/v1/admin/status").data, "load the status")
    try:
        ready = orch.request("GET", "/health/ready", raw=True)
        out = {**out, "ready": {"ok": ready.status == 200}}
    except OrchestratorError as e:
        reasons = (e.details or {}).get("reasons") if e.details else None
        out = {**out, "ready": {"ok": False, "status": e.status, "reasons": reasons}}
    return {**out, "baseUrl": orch.base_url}


@router.get("/voice/config")
def get_config(_: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    orch = require(svc)
    return _run(lambda: _with_version(orch.get("/v1/admin/config")), "load the settings")


@router.get("/voice/config/schema")
def get_schema(_: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    orch = require(svc)
    return _run(lambda: orch.get("/v1/admin/config/schema").data, "load the settings")


@router.get("/voice/config/history")
def history(limit_: int = Query(50, alias="limit", ge=1, le=200), before: str | None = Query(None, max_length=80), _: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    orch = require(svc)
    return _run(lambda: orch.get("/v1/admin/config/history", params={"limit": limit_, "before": before}).data, "load the history")


@router.get("/voice/presets")
def presets(_: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    orch = require(svc)
    return _run(lambda: orch.get("/v1/admin/presets").data, "load the presets")


@router.get("/voice/models")
def models(kind: str | None = Query(None, max_length=20), _: Caller = Depends(staff_caller), svc: Services = Depends(get_services)):
    if kind and kind not in KINDS:
        raise bad_input("Unknown kind.")
    orch = require(svc)
    return _run(lambda: _with_version(orch.get("/v1/admin/models", params={"kind": kind})), "load the models")


@router.get("/voice/sessions")
def sessions(tenant_id: str | None = Query(None, alias="tenantId", max_length=80), _: Caller = Depends(staff_caller), svc: Services = Depends(get_services)):
    orch = require(svc)
    data = _run(lambda: orch.get("/v1/admin/sessions", params={"tenant_id": tenant_id}).data or {}, "list live calls")
    tenants = {o.orchTenantId: {"slug": o.slug, "name": o.name} for o in svc.store.list_orgs() if o.orchTenantId}
    rows = data.get("data") or []
    for r in rows:
        if isinstance(r, dict):
            r["org"] = tenants.get(r.get("tenant_id"))
    return {**data, "data": rows}


# ---------------------------------------------------------------- changing


@router.post("/voice/config", dependencies=[WRITE_LIMIT])
def patch_config(body: ConfigPatchIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    if not body.set and not body.reset:
        raise bad_input("Nothing to change.")
    orch = require(svc)
    out = _run(lambda: _with_version(orch.patch("/v1/admin/config", {"set": body.set, "reset": body.reset}, params={"dry_run": "true" if body.dry_run else None}, if_match=etag_of(body.version))), "save the settings")
    if not body.dry_run:
        _audit(svc, caller, "voice_config_changed", "orchestrator", "set " + ", ".join(sorted(_paths(body.set)))[:200] + ("; reset " + ", ".join(body.reset) if body.reset else ""))
    return out


def _paths(d: dict, prefix: str = "") -> list[str]:
    out = []
    for k, v in d.items():
        p = f"{prefix}{k}"
        out += _paths(v, p + ".") if isinstance(v, dict) and v else [p]
    return out


@router.post("/voice/config/replace", dependencies=[WRITE_LIMIT])
def replace_config(body: ConfigReplaceIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    orch = require(svc)
    out = _run(lambda: _with_version(orch.put("/v1/admin/config", {"overrides": body.overrides}, params={"dry_run": "true" if body.dry_run else None}, if_match=etag_of(body.version))), "replace the settings")
    if not body.dry_run:
        _audit(svc, caller, "voice_config_replaced", "orchestrator")
    return out


@router.post("/voice/config/reset", dependencies=[WRITE_LIMIT])
def reset_config(body: VersionIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    orch = require(svc)
    _run(lambda: orch.delete("/v1/admin/config", if_match=etag_of(body.version)), "reset the settings")
    _audit(svc, caller, "voice_config_reset", "orchestrator")
    return _run(lambda: _with_version(orch.get("/v1/admin/config")), "load the settings")


@router.post("/voice/presets/{name}/apply", dependencies=[WRITE_LIMIT])
def apply_preset(name: str, body: VersionIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    if not re.fullmatch(r"[a-z0-9_]{1,40}", name):
        raise bad_input("Unknown preset.")
    orch = require(svc)
    out = _run(lambda: _with_version(orch.post(f"/v1/admin/presets/{name}/apply", {}, params={"dry_run": "true" if body.dry_run else None}, if_match=etag_of(body.version))), "apply the preset")
    if not body.dry_run:
        _audit(svc, caller, "voice_preset_applied", "orchestrator", name)
    return out


@router.post("/voice/models/{kind}/{model_id:path}/switch", dependencies=[WRITE_LIMIT])
def switch_model(kind: str, model_id: str, body: ModelSwitchIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    if kind not in KINDS or not model_id or len(model_id) > 200:
        raise bad_input("Unknown model.")
    orch = require(svc)
    out = _run(lambda: _with_version(orch.patch(f"/v1/admin/models/{kind}/{model_id}", {"enabled": body.enabled}, if_match=etag_of(body.version))), "switch the model")
    _audit(svc, caller, "voice_model_switched", f"{kind}/{model_id}", "on" if body.enabled else "off")
    return out


@router.post("/voice/models", dependencies=[WRITE_LIMIT])
def switch_models(body: ModelsBulkIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    if not body.changes or any(k not in KINDS for k in body.changes):
        raise bad_input("Unknown kind.")
    orch = require(svc)
    out = _run(lambda: _with_version(orch.patch("/v1/admin/models", {"changes": body.changes}, if_match=etag_of(body.version))), "switch the models")
    _audit(svc, caller, "voice_models_switched", "orchestrator", ", ".join(f"{k}/{i}={'on' if v else 'off'}" for k, m in body.changes.items() for i, v in m.items()))
    return out


@router.post("/voice/asr/{name}/{action}", dependencies=[WRITE_LIMIT])
def asr_load(name: str, action: str, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    if action not in ("load", "unload") or not re.fullmatch(r"[a-z0-9_]{1,40}", name):
        raise bad_input("Unknown recogniser.")
    orch = require(svc)
    out = _run(lambda: orch.post(f"/v1/admin/models/asr/{name}/{action}").data, f"{action} the recogniser")
    _audit(svc, caller, f"voice_asr_{action}", name)
    return out


@router.post("/voice/upstreams/{which}/test", dependencies=[WRITE_LIMIT])
def test_upstream(which: str, body: UpstreamTestIn, _: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    if which not in ("llm", "tts"):
        raise bad_input("Choose the LLM or TTS server.")
    if not re.fullmatch(r"https?://[^\s]+", body.base_url.strip()):
        raise bad_input("Give the server's address, starting with https://.")
    orch = require(svc)
    req: dict = {"base_url": body.base_url.strip()}
    if body.api_key:
        req["api_key"] = body.api_key
    return _run(lambda: orch.post(f"/v1/admin/upstreams/{which}/test", req, timeout=30).data, "test the server")


@router.post("/voice/reload/{component}", dependencies=[WRITE_LIMIT])
def reload(component: str, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    if component not in COMPONENTS:
        raise bad_input("Unknown component.")
    orch = require(svc)
    out = _run(lambda: orch.post(f"/v1/admin/reload/{component}").data, "reload it")
    _audit(svc, caller, "voice_reload", component)
    return out


@router.post("/voice/admission", dependencies=[WRITE_LIMIT])
def admission(body: AdmissionIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    orch = require(svc)
    out = _run(lambda: orch.post("/v1/admin/admission", {"accepting": body.accepting}).data, "change admission")
    _audit(svc, caller, "voice_admission", "orchestrator", "accepting" if body.accepting else "maintenance")
    return out


@router.post("/voice/sessions/{session_id}/end", dependencies=[WRITE_LIMIT])
def end_session(session_id: str, body: EndIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", session_id):
        raise bad_input("Unknown call.")
    orch = require(svc)
    out = _run(lambda: orch.post(f"/v1/admin/sessions/{session_id}/end", {"reason": body.reason.strip() or "ended_by_master_admin"}).data, "end the call")
    _audit(svc, caller, "voice_session_ended", session_id, body.reason.strip())
    return out


# ---------------------------------------------------------------- organisations


def _org(svc: Services, slug: str):
    org = svc.store.get_org(slug)
    if not org:
        raise ApiError(404, "invalid_input", "That organisation doesn't exist.")
    return org


@router.get("/orgs/{slug}/voice")
def org_voice(slug: str, _: Caller = Depends(staff_caller), svc: Services = Depends(get_services)):
    org = _org(svc, slug)
    return {"tenantId": org.orchTenantId, "connected": svc.orch is not None, "webhooks": bool(svc.settings.orchestrator_webhook_url)}


@router.post("/orgs/{slug}/voice", dependencies=[WRITE_LIMIT])
def link_tenant(slug: str, body: TenantIn, caller: Caller = Depends(master_caller), svc: Services = Depends(get_services)):
    """Links (or, with null, unlinks) the organisation's voice tenant. The
    tenant is checked by listing its voice agents first."""
    org = _org(svc, slug)
    tenant = (body.tenant_id or "").strip() or None
    if tenant:
        if not TENANT.fullmatch(tenant):
            raise bad_input("A tenant id looks like ten_ followed by letters and numbers.")
        orch = require(svc)
        _run(lambda: orch.get("/v1/voice-agents", tenant=tenant, params={"limit": 1}), "find that tenant")
        other = next((o for o in svc.store.list_orgs() if o.slug != slug and o.orchTenantId == tenant), None)
        if other:
            raise bad_input(f"{other.name} already uses that tenant. Each organisation needs its own.")
    svc.store.transact(lambda tx: tx.update_org(slug, {"orchTenantId": tenant}))
    _audit(svc, caller, "voice_tenant_linked" if tenant else "voice_tenant_unlinked", slug, tenant or (org.orchTenantId or ""))
    return {"tenantId": tenant, "connected": svc.orch is not None, "webhooks": bool(svc.settings.orchestrator_webhook_url)}
