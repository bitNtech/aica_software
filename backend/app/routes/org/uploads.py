"""/api/orgs/{slug}/uploads — recordings of past calls, for building agents
(Phase 5; the frontend's SourceCall).

Storage and metadata only. Transcribing a recording and reading a flow
from it are the AI pipeline's work: uploads stay "queued" until it exists,
and transcripts aren't available.

- Reading: `library.uploads`, or someone who sees agents and callers'
  details (recordings hold personal details); bitNtech's master admin.
- Adding and removing: `library.uploads`. Recordings go straight from the
  browser to the private bucket with a signed URL (app/blobs.py), up to
  200 MB each; the browser then calls /{id}/uploaded.
"""
from __future__ import annotations

import re
from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import Field

from ...accounts import iso
from ...errors import ApiError, bad_input, forbidden
from ...models import Camel
from ...orgs import OrgContext, org_member, org_permission
from ...ratelimit import limit_caller
from ...store import Tx, UploadDoc, new_id, now
from ...usage import usage_map
from .knowledge import upload_instructions

router = APIRouter(prefix="/api/orgs/{slug}/uploads", tags=["org"])
WRITE_LIMIT = Depends(limit_caller("org-uploads", 30))

MAX_BYTES = 200 * 1024 * 1024
AUDIO = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".flac": "audio/flac", ".opus": "audio/opus", ".webm": "audio/webm"}
UPLOAD_GRACE = timedelta(hours=1)
AUDIO_TYPE = re.compile(r"^audio/[a-z0-9.+-]{1,40}$")


class RecordingIn(Camel):
    name: str = Field(max_length=300)
    size: int
    type: str = Field("", max_length=100)


class RecordingsIn(Camel):
    files: list[RecordingIn] = Field(min_length=1, max_length=20)


def can_read(ctx: OrgContext) -> bool:
    a = ctx.access
    return a.platform == "master_admin" or a.has("library.uploads") or (a.has("agents.view") and a.has("calls.personal"))


def upload_out(u: UploadDoc, used: set[str] | None) -> dict:
    status, error = u.status, u.error
    if not u.uploaded and status != "failed" and now() - u.addedAt > UPLOAD_GRACE:
        status, error = "failed", "The recording didn't finish uploading. Add it again."
    out = {"id": u.id, "name": u.name, "durationSec": u.durationSec, "language": u.language, "status": status, "addedAt": iso(u.addedAt), "size": u.size, "usedBy": sorted(used or [])}
    if error:
        out["error"] = error
    if u.topic:
        out["topic"] = u.topic
    return out


def _not_found() -> ApiError:
    return ApiError(404, "invalid_input", "That call doesn't exist any more. It may have been deleted.")


@router.get("")
def list_uploads(ctx: OrgContext = Depends(org_member)):
    if not can_read(ctx):
        raise forbidden("You don't have permission to see call uploads.")
    used = usage_map(ctx.svc, ctx.slug)["uploads"]
    return [upload_out(u, used.get(u.id)) for u in sorted(ctx.svc.store.list_records(ctx.slug, "upload"), key=lambda u: u.addedAt, reverse=True)]


@router.post("", dependencies=[WRITE_LIMIT])
def add_recordings(body: RecordingsIn, ctx: OrgContext = Depends(org_permission("library.uploads", what="upload calls"))):
    """Returns {calls, uploads}: where to PUT each file that has content."""
    docs, uploads = [], []
    for f in body.files:
        name = f.name.strip() or "recording"
        ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
        if ext not in AUDIO:
            ext = ""  # never build a storage path from what someone typed
        if not ext and not AUDIO_TYPE.match(f.type):
            raise bad_input(f"{name}: not an audio file.")
        if f.size > MAX_BYTES:
            raise bad_input(f"{name}: larger than 200 MB.")
        content_type = AUDIO.get(ext) or f.type
        u = UploadDoc(id=new_id("call"), name=name, size=max(0, f.size), contentType=content_type, objectPath="", addedAt=now(),
                      durationSec=max(0, round(f.size / (1024 * 1024) * 60)))  # about a minute per MB, until it's read
        if f.size <= 0:
            u.status, u.error = "failed", "The file is empty. Export the recording again and re-upload it."
        else:
            if not ctx.svc.blobs:
                raise ApiError(503, "unknown", "Recordings can't be uploaded yet: the server has no storage bucket. bitNtech needs to set STORAGE_BUCKET.")
            u.objectPath = f"orgs/{ctx.slug}/uploads/{u.id}{ext}"
            uploads.append({"id": u.id, **upload_instructions(ctx.svc.blobs.upload_url(u.objectPath, content_type, f.size), content_type, f.size)})
        docs.append(u)

    def run(tx: Tx) -> None:
        for u in docs:
            tx.save_record(ctx.slug, "upload", u)

    ctx.svc.store.transact(run)
    return {"calls": [upload_out(u, None) for u in docs], "uploads": uploads}


@router.post("/{call_id}/uploaded", dependencies=[WRITE_LIMIT])
def finish_upload(call_id: str, ctx: OrgContext = Depends(org_permission("library.uploads", what="upload calls"))):
    u = ctx.svc.store.get_record(ctx.slug, "upload", call_id)
    if not u or not u.objectPath:
        raise _not_found()
    if not u.uploaded:
        got = ctx.svc.blobs.size(u.objectPath) if ctx.svc.blobs else None
        if got != u.size:
            raise ApiError(409, "invalid_input", "The recording didn't arrive. Add it again.")
        u.uploaded = True
        ctx.svc.store.save_record(ctx.slug, "upload", u)
    return upload_out(u, None)


@router.get("/{call_id}/transcript")
def transcript(call_id: str, ctx: OrgContext = Depends(org_member)):
    if not can_read(ctx):
        raise forbidden("You don't have permission to see call uploads.")
    u = ctx.svc.store.get_record(ctx.slug, "upload", call_id)
    if not u:
        raise _not_found()
    # Transcripts come from the AI pipeline, which doesn't exist yet.
    raise bad_input("This call is still being processed. Its transcript will be ready soon.")


@router.post("/{call_id}/delete", status_code=204, dependencies=[WRITE_LIMIT])
def delete_upload(call_id: str, ctx: OrgContext = Depends(org_permission("library.uploads", what="remove recordings"))):
    """Drafts stop learning from it; flows already read from it keep their steps."""

    def run(tx: Tx) -> UploadDoc:
        u = tx.get_record(ctx.slug, "upload", call_id)
        if not u:
            raise _not_found()
        drafts = [d for d in tx.list_records(ctx.slug, "draft") if call_id in (d.data.get("sourceCallIds") or [])]
        for d in drafts:
            d.data["sourceCallIds"] = [x for x in d.data["sourceCallIds"] if x != call_id]
            tx.save_record(ctx.slug, "draft", d)
        tx.delete_record(ctx.slug, "upload", u.id)
        return u

    u = ctx.svc.store.transact(run)
    if u.objectPath and ctx.svc.blobs:
        ctx.svc.blobs.delete(u.objectPath)
