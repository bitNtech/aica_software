"""/api/orgs/{slug}/knowledge — what the agents answer from (Phase 5).

Metadata and files only. Reading a source into passages (indexing), its
passages and searching them are the AI pipeline's work: new and refreshed
sources stay "being read" until it exists, and search finds nothing.

- Reading: `library.knowledge` or `agents.view`; bitNtech too.
- Changing: `library.knowledge`. A source can't be deleted while any agent
  (any version) or draft uses it.
- Documents and tables go straight from the browser to the private bucket
  with a signed URL (app/blobs.py), then the browser says it's done.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import Field

from ...accounts import iso
from ...errors import ApiError, bad_input, forbidden
from ...models import Camel
from ...orgs import OrgContext, org_member, org_permission
from ...ratelimit import limit_caller
from ...store import KnowledgeDoc, Tx, new_id, now
from ...usage import knowledge_users, live_knowledge, usage_map

router = APIRouter(prefix="/api/orgs/{slug}/knowledge", tags=["org"])
WRITE_LIMIT = Depends(limit_caller("org-knowledge", 30))

MAX_FILE = 50 * 1024 * 1024
FILE_TYPES = {
    "document": {".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain", ".md": "text/markdown"},
    "table": {".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".csv": "text/csv"},
}
HTTPS = re.compile(r"^https://[^\s/]+\.[^\s]+$", re.IGNORECASE)
REFRESH = ("never", "daily", "weekly")
# An upload the browser never finished is shown as failed after this long.
UPLOAD_GRACE = timedelta(hours=1)


class FaqIn(Camel):
    q: str = Field(max_length=1000)
    a: str = Field(max_length=4000)


class KnowledgeIn(Camel):
    kind: str = Field(max_length=20)
    name: str = Field(max_length=500)
    description: str = Field("", max_length=2000)
    expires_at: str | None = Field(None, max_length=40)
    file_name: str | None = Field(None, max_length=300)
    size: int | None = None
    url: str | None = Field(None, max_length=2000)
    refresh_every: str | None = Field(None, max_length=10)
    faq: list[FaqIn] | None = Field(None, max_length=300)


class KnowledgePatchIn(Camel):
    name: str | None = Field(None, max_length=500)
    description: str | None = Field(None, max_length=2000)
    expires_at: str | None = Field(None, max_length=40)
    refresh_every: str | None = Field(None, max_length=10)
    faq: list[FaqIn] | None = Field(None, max_length=300)


class SearchIn(Camel):
    source_ids: list[str] = Field(default_factory=list, max_length=100)
    question: str = Field(max_length=1000)


def can_read(ctx: OrgContext) -> bool:
    return bool(ctx.access.platform) or ctx.access.has("library.knowledge") or ctx.access.has("agents.view")


def _not_found() -> ApiError:
    return ApiError(404, "invalid_input", "That source doesn't exist any more. It may have been deleted.")


def _status(k: KnowledgeDoc) -> tuple[str, str | None]:
    if k.kind in FILE_TYPES and not k.uploaded and k.status != "failed":
        if now() - k.createdAt > UPLOAD_GRACE:
            return "failed", "The file didn't finish uploading. Add it again."
    return k.status, k.error


def knowledge_out(k: KnowledgeDoc, used: set[str] | None, live: list[str]) -> dict:
    status, error = _status(k)
    out = {
        "id": k.id, "name": k.name, "kind": k.kind, "origin": k.origin, "description": k.description, "status": status, "passages": k.passages,
        "refreshedAt": iso(k.refreshedAt), "expiresAt": iso(k.expiresAt) if k.expiresAt else None, "refreshEvery": k.refreshEvery,
        "usedByAgentIds": live, "usedBy": sorted(used or []),
    }
    if k.faq is not None:
        out["faq"] = k.faq
    if error:
        out["error"] = error
    return out


def _out(ctx: OrgContext, k: KnowledgeDoc) -> dict:
    return knowledge_out(k, usage_map(ctx.svc, ctx.slug)["knowledge"].get(k.id), live_knowledge(ctx.svc, ctx.slug).get(k.id, []))


def _name(name: str, others: list[KnowledgeDoc], own_id: str | None = None) -> str:
    name = name.strip()
    if len(name) < 3 or len(name) > 80:
        raise bad_input("Give the source a name of at least 3 characters.")
    if any(o.name.strip().lower() == name.lower() and o.id != own_id for o in others):
        raise bad_input(f"There's already a source called “{name}”.")
    return name


def _expires(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise bad_input("Choose a real date for when it stops being true.")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _faq(entries: list[FaqIn] | None, empty_message: str) -> list[dict]:
    faq = [{"q": e.q.strip(), "a": e.a.strip()} for e in entries or [] if e.q.strip() or e.a.strip()]
    if not faq or any(not e["q"] or not e["a"] for e in faq):
        raise bad_input(empty_message)
    if any(len(e["q"]) > 200 or len(e["a"]) > 800 for e in faq):
        raise bad_input("Keep questions under 200 characters and answers under 800.")
    if len(faq) > 200:
        raise bad_input("Keep it to 200 questions. Split the rest into another FAQ.")
    return faq


def upload_instructions(url: str, content_type: str, size: int) -> dict:
    return {"url": url, "method": "PUT", "headers": {"Content-Type": content_type, "x-goog-content-length-range": f"{size},{size}"}}


@router.get("")
def list_knowledge(ctx: OrgContext = Depends(org_member)):
    if not can_read(ctx):
        raise forbidden("You don't have permission to see the knowledge library.")
    used, live = usage_map(ctx.svc, ctx.slug)["knowledge"], live_knowledge(ctx.svc, ctx.slug)
    rows = sorted(ctx.svc.store.list_records(ctx.slug, "knowledge"), key=lambda k: k.createdAt, reverse=True)
    return [knowledge_out(k, used.get(k.id), live.get(k.id, [])) for k in rows]


@router.post("", dependencies=[WRITE_LIMIT])
def add_knowledge(body: KnowledgeIn, ctx: OrgContext = Depends(org_permission("library.knowledge", what="add knowledge"))):
    """Returns {source, upload}: for a document or table, `upload` says where
    to PUT the file; the browser then calls /{id}/uploaded."""
    if body.kind not in ("document", "table", "web", "faq"):
        raise bad_input("Choose what kind of source it is.")
    name = _name(body.name, ctx.svc.store.list_records(ctx.slug, "knowledge"))
    description = body.description.strip()
    if len(description) > 300:
        raise bad_input("Keep the description under 300 characters.")
    expires, t = _expires(body.expires_at), now()
    k = KnowledgeDoc(id=new_id("kn"), name=name, kind=body.kind, origin="", description=description, status="indexing", passages=0, refreshedAt=t, expiresAt=expires)
    upload = None
    if body.kind in FILE_TYPES:
        file_name = (body.file_name or "").strip()
        ext = ("." + file_name.rsplit(".", 1)[-1].lower()) if "." in file_name else ""
        types = FILE_TYPES[body.kind]
        if ext not in types:
            raise bad_input(f"Choose a {', '.join(types)} file.")
        size = body.size or 0
        if size > MAX_FILE:
            raise bad_input("Choose a file of 50 MB or less.")
        k.origin, k.fileName, k.size, k.contentType = file_name, file_name, size, types[ext]
        if size <= 0:
            k.status, k.error = "failed", "The file is empty. Export it again and re-upload it."
        else:
            if not ctx.svc.blobs:
                raise ApiError(503, "unknown", "File uploads aren't set up yet: the server has no storage bucket. bitNtech needs to set STORAGE_BUCKET.")
            k.objectPath = f"orgs/{ctx.slug}/knowledge/{k.id}{ext}"
            upload = upload_instructions(ctx.svc.blobs.upload_url(k.objectPath, k.contentType, size), k.contentType, size)
    elif body.kind == "web":
        url = (body.url or "").strip()
        if not HTTPS.match(url):
            raise bad_input("Give a full web address starting with https://.")
        k.origin, k.url = url, url
        k.refreshEvery = body.refresh_every if body.refresh_every in REFRESH else "never"
    else:
        k.faq = _faq(body.faq, "Add at least one question with its answer.")
        k.origin, k.passages = f"{len(k.faq)} questions", len(k.faq)

    def run(tx: Tx) -> KnowledgeDoc:
        tx.save_record(ctx.slug, "knowledge", k)
        ctx.log(tx, "library", f"Added the knowledge source “{k.name}”")
        return k

    ctx.svc.store.transact(run)
    return {"source": _out(ctx, k), "upload": upload}


@router.post("/{source_id}/uploaded", dependencies=[WRITE_LIMIT])
def finish_upload(source_id: str, ctx: OrgContext = Depends(org_permission("library.knowledge", what="add knowledge"))):
    k = ctx.svc.store.get_record(ctx.slug, "knowledge", source_id)
    if not k or not k.objectPath:
        raise _not_found()
    if not k.uploaded:
        got = ctx.svc.blobs.size(k.objectPath) if ctx.svc.blobs else None
        if got != k.size:
            raise ApiError(409, "invalid_input", "The file didn't arrive. Add it again.")
        k.uploaded, k.status = True, "indexing"
        ctx.svc.store.save_record(ctx.slug, "knowledge", k)
    return _out(ctx, k)


@router.post("/search")
def search(body: SearchIn, ctx: OrgContext = Depends(org_member)):
    """Finding passages is the AI pipeline's work; until it exists nothing is indexed, so nothing is found."""
    if not can_read(ctx):
        raise forbidden("You don't have permission to see the knowledge library.")
    if not body.question.strip():
        raise bad_input("Ask a question first.")
    return []


@router.get("/{source_id}/passages")
def passages(source_id: str, ctx: OrgContext = Depends(org_member)):
    if not can_read(ctx):
        raise forbidden("You don't have permission to see the knowledge library.")
    k = ctx.svc.store.get_record(ctx.slug, "knowledge", source_id)
    if not k:
        raise _not_found()
    status, _ = _status(k)
    if status == "failed":
        raise bad_input("This source couldn’t be read, so it has no sections.")
    if status != "ready":
        raise bad_input("This source is still being read. Its sections will show soon.")
    return []


@router.post("/{source_id}", dependencies=[WRITE_LIMIT])
def update_knowledge(source_id: str, body: KnowledgePatchIn, ctx: OrgContext = Depends(org_permission("library.knowledge", what="change knowledge"))):
    sent = body.model_fields_set
    others = ctx.svc.store.list_records(ctx.slug, "knowledge")

    def run(tx: Tx) -> KnowledgeDoc:
        k = tx.get_record(ctx.slug, "knowledge", source_id)
        if not k:
            raise _not_found()
        # Check everything first: a refused change changes nothing.
        name = _name(body.name, others, k.id) if body.name is not None else k.name
        description = body.description.strip() if body.description is not None else k.description
        if len(description) > 300:
            raise bad_input("Keep the description under 300 characters.")
        expires = _expires(body.expires_at) if "expires_at" in sent else k.expiresAt
        faq = _faq(body.faq, "Keep at least one question with its answer.") if body.faq is not None and k.kind == "faq" else k.faq
        k.name, k.description, k.expiresAt = name, description, expires
        if k.kind == "web" and body.refresh_every in REFRESH:
            k.refreshEvery = body.refresh_every
        if k.kind == "faq" and faq != k.faq:
            k.faq, k.passages, k.origin, k.status, k.error = faq, len(faq), f"{len(faq)} questions", "indexing", None
        tx.save_record(ctx.slug, "knowledge", k)
        return k

    return _out(ctx, ctx.svc.store.transact(run))


@router.post("/{source_id}/refresh", dependencies=[WRITE_LIMIT])
def refresh(source_id: str, ctx: OrgContext = Depends(org_permission("library.knowledge", what="refresh knowledge"))):
    k = ctx.svc.store.get_record(ctx.slug, "knowledge", source_id)
    if not k:
        raise _not_found()
    if k.kind == "faq":
        raise bad_input("An FAQ written here is always up to date.")
    k.status, k.error = "indexing", None
    ctx.svc.store.save_record(ctx.slug, "knowledge", k)
    return _out(ctx, k)


@router.post("/{source_id}/delete", status_code=204, dependencies=[WRITE_LIMIT])
def delete_knowledge(source_id: str, ctx: OrgContext = Depends(org_permission("library.knowledge", what="delete knowledge"))):
    users = knowledge_users(ctx.svc, ctx.slug, source_id)

    def run(tx: Tx) -> KnowledgeDoc:
        k = tx.get_record(ctx.slug, "knowledge", source_id)
        if not k:
            raise _not_found()
        if users:
            one = len(users) == 1
            raise bad_input(f"{', '.join(users)} {'uses' if one else 'use'} “{k.name}”. Take it out of {'that agent' if one else 'those agents'} first.")
        tx.delete_record(ctx.slug, "knowledge", k.id)
        ctx.log(tx, "library", f"Deleted the knowledge source “{k.name}”")
        return k

    k = ctx.svc.store.transact(run)
    if k.objectPath and ctx.svc.blobs:
        ctx.svc.blobs.delete(k.objectPath)
