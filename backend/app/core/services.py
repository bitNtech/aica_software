"""The things routes need, built once at startup and kept on app.state.
Tests build the same container from fakes."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from fastapi import Request

from ..auth.identity import FirebaseAdmin, GoogleOAuth, IdentityToolkit
from ..data.blobs import Blobs
from ..data.store import FirestoreStore, Store
from ..data.vault import SecretBox, SecretsUnavailable
from ..integrations.mailer import Mailer
from .config import Settings

log = logging.getLogger("aica")


@dataclass
class Services:
    settings: Settings
    admin: FirebaseAdmin
    identity: IdentityToolkit
    store: Store
    mailer: Mailer
    google: GoogleOAuth | None
    # None when not configured: the routes that need them say so.
    secrets: SecretBox | None = None
    blobs: Blobs | None = None
    # For tool tests: how a host name is looked up, and the HTTP transport.
    # Tests replace both (app/integrations/toolhttp.py).
    resolve: object = None
    tool_transport: object = None


def build_services(settings: Settings) -> Services:
    import firebase_admin
    from firebase_admin import credentials, firestore

    cert = firebase_certificate(settings)
    if not settings.firebase_web_api_key:
        raise RuntimeError("FIREBASE_WEB_API_KEY is not set in backend/.env")

    app = firebase_admin.initialize_app(credentials.Certificate(cert), name="aica")
    db = firestore.client(app=app, database_id=settings.firestore_database_id)
    _check_database(db, settings)
    google = (
        GoogleOAuth(settings.google_client_id, settings.google_client_secret, settings.google_redirect_uri)
        if settings.google_enabled
        else None
    )
    if not google:
        log.warning("Google sign-in disabled: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set")
    if not settings.resend_api_key:
        log.warning("RESEND_API_KEY not set: emails will not be sent")
    try:
        box = SecretBox(settings.secrets_key, settings.secrets_key_previous)
    except SecretsUnavailable:
        box = None
        log.warning("SECRETS_KEY not set or not a 32-byte base64 key: system secrets can't be set")
    blobs = None
    if settings.storage_bucket:
        from firebase_admin import storage

        blobs = Blobs(storage.bucket(settings.storage_bucket, app=app))
    else:
        log.warning("STORAGE_BUCKET not set: recordings and knowledge files can't be uploaded")
    return Services(
        settings=settings,
        admin=FirebaseAdmin(app),
        identity=IdentityToolkit(settings.firebase_web_api_key),
        store=FirestoreStore(db),
        mailer=Mailer(settings.resend_api_key, settings.email_from),
        google=google,
        secrets=box,
        blobs=blobs,
    )


def firebase_certificate(settings: Settings) -> dict | str:
    """The service-account key: FIREBASE_CREDENTIALS_JSON if set, else the
    file at FIREBASE_CREDENTIALS. Errors never echo the key's contents."""
    raw = settings.firebase_credentials_json.strip()
    if raw:
        try:
            cert = json.loads(raw)
        except ValueError:
            cert = None
        if not isinstance(cert, dict) or cert.get("type") != "service_account":
            raise RuntimeError("FIREBASE_CREDENTIALS_JSON is not a service-account key. Paste the whole downloaded JSON file as the value.")
        return cert
    path = settings.credentials_path
    if not path.is_file():
        raise RuntimeError(
            f"Firebase service-account file not found at {path}. "
            "Download a key (Google Cloud console → IAM → Service accounts) and save it there, "
            "or set FIREBASE_CREDENTIALS_JSON."
        )
    return str(path)


def _check_database(db, settings: Settings) -> None:
    """Fail at startup, with the fix in the message, if the configured
    Firestore database doesn't exist — not on the first request."""
    from google.api_core.exceptions import NotFound

    try:
        list(db.collection("_startup_check").limit(1).stream())
    except NotFound as e:
        raise RuntimeError(
            f"Firestore database {settings.firestore_database!r} does not exist in this Firebase project. "
            "Set FIRESTORE_DATABASE in backend/.env to an existing database ID — "
            "usually (default); see Firebase console → Firestore Database."
        ) from e


def get_services(request: Request) -> Services:
    return request.app.state.services
