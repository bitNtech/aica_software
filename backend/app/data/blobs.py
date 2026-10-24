"""Files people add (call recordings, knowledge documents), in a private
Cloud Storage bucket (STORAGE_BUCKET). The browser uploads straight to the
bucket with a short-lived signed URL bound to the file's size and type, so
files never pass through this API (Vercel caps request bodies). Objects
are private; nothing here returns a public URL.

The bucket needs a CORS rule allowing PUT from the console's origin; see
backend/README.md.
"""
from __future__ import annotations

from datetime import timedelta


class BlobsUnavailable(Exception):
    """STORAGE_BUCKET isn't set."""


class Blobs:
    def __init__(self, bucket):  # google.cloud.storage.Bucket
        self._bucket = bucket

    def upload_url(self, path: str, content_type: str, size: int, minutes: int = 15) -> str:
        blob = self._bucket.blob(path)
        return blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=minutes),
            method="PUT",
            content_type=content_type,
            # The upload must be exactly this size.
            headers={"x-goog-content-length-range": f"{size},{size}"},
        )

    def size(self, path: str) -> int | None:
        """The uploaded object's size, or None if it isn't there."""
        blob = self._bucket.get_blob(path)
        return int(blob.size) if blob is not None else None

    def delete(self, path: str) -> None:
        blob = self._bucket.blob(path)
        try:
            blob.delete()
        except Exception as e:  # noqa: BLE001
            from google.api_core.exceptions import NotFound

            if not isinstance(e, NotFound):
                raise
