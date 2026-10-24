"""What uses what, for refusing deletes and listing "Used by": every agent's
working setup and all its published versions (any could be rolled back to),
and every draft still being built."""
from __future__ import annotations

from ..core.services import Services


def _setups(svc: Services, slug: str) -> list[tuple[str, str, dict]]:
    """(agent or draft id, name, spec-like dict)."""
    out = []
    for a in svc.store.list_records(slug, "agent"):
        out.append((a.id, a.name, a.working))
        for v in svc.store.list_records(slug, "version", (("agentId", "==", a.id),), limit=100000):
            out.append((a.id, a.name, v.spec))
    for d in svc.store.list_records(slug, "draft"):
        if not d.publishedAgentId:
            out.append((d.id, (d.data.get("name") or "").strip() or "Untitled agent", d.data))
    return out


def _names(rows: list[tuple[str, str, dict]]) -> list[str]:
    return sorted({name for _, name, _ in rows})


def knowledge_users(svc: Services, slug: str, source_id: str) -> list[str]:
    return _names([r for r in _setups(svc, slug) if source_id in (r[2].get("context") or {}).get("knowledgeSourceIds", [])])


def tool_users(svc: Services, slug: str, tool_id: str) -> list[str]:
    return _names([r for r in _setups(svc, slug) if tool_id in (r[2].get("context") or {}).get("toolIds", [])])


def _flow_calls(nodes: list) -> set[str]:
    out: set[str] = set()
    for n in nodes or []:
        out |= set(n.get("sourceCallIds") or [])
        out |= _flow_calls(n.get("children") or [])
    return out


def upload_users(svc: Services, slug: str, call_id: str) -> list[str]:
    return _names([r for r in _setups(svc, slug) if call_id in (r[2].get("sourceCallIds") or []) or call_id in _flow_calls(r[2].get("flow") or [])])


def usage_map(svc: Services, slug: str) -> dict[str, dict[str, set[str]]]:
    """All of it at once, for lists: {"knowledge"|"tools"|"uploads": {id: {names}}}."""
    out: dict[str, dict[str, set[str]]] = {"knowledge": {}, "tools": {}, "uploads": {}}
    for _, name, spec in _setups(svc, slug):
        ctx = spec.get("context") or {}
        for k in ctx.get("knowledgeSourceIds", []):
            out["knowledge"].setdefault(k, set()).add(name)
        for t in ctx.get("toolIds", []):
            out["tools"].setdefault(t, set()).add(name)
        for c in set(spec.get("sourceCallIds") or []) | _flow_calls(spec.get("flow") or []):
            out["uploads"].setdefault(c, set()).add(name)
    return out


def live_knowledge(svc: Services, slug: str) -> dict[str, list[str]]:
    """Knowledge id → agent ids whose latest published version uses it (KnowledgeSource.usedByAgentIds)."""
    out: dict[str, list[str]] = {}
    for a in svc.store.list_records(slug, "agent"):
        latest = svc.store.get_record(slug, "version", f"{a.id}_{a.version:06d}") if a.version else None
        if latest:
            for k in (latest.spec.get("context") or {}).get("knowledgeSourceIds", []):
                out.setdefault(k, []).append(a.id)
    return out
