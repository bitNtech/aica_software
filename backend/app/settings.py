"""Configuration from environment / backend/.env. Secrets live only here."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    firebase_credentials: Path = Path("secrets/service-account.json")
    # The key's JSON itself, for hosts with no file system for secrets (Vercel).
    # Takes precedence over FIREBASE_CREDENTIALS when set.
    firebase_credentials_json: str = ""
    firebase_web_api_key: str = ""
    # Firestore database ID. This project has only "(default)" (asia-south1).
    firestore_database: str = "(default)"

    resend_api_key: str = ""
    email_from: str = "AICA <onboarding@resend.dev>"
    # Who gets the landing page's demo requests. Comma-separated.
    demo_request_to: str = "support@bitntech.in"
    # Who at bitNtech hears about new requests and hospitals' replies. Comma-separated.
    change_requests_to: str = "support@bitntech.in"

    google_client_id: str = ""
    google_client_secret: str = ""

    # The frontend's public URL: email links and redirects after Google go here.
    app_url: str = "http://localhost:5173"
    # This API's public URL, when it isn't served from the frontend's origin
    # (e.g. https://api.aica.bitntech.in). Empty: same origin as APP_URL, as in
    # local dev through the Vite proxy.
    api_url: str = ""
    # Frontend origins allowed to call the API with cookies (CORS) and to make
    # writes (CSRF check). Comma-separated. Defaults to APP_URL's origin.
    allowed_origins: str = ""
    cookie_secure: bool = False
    # "lax" works whenever the frontend and API share a site (aica.bitntech.in
    # and api.aica.bitntech.in). "none" requires COOKIE_SECURE and is dropped by
    # browsers that block third-party cookies.
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    session_hours: int = Field(8, ge=1, le=24 * 14)
    remember_days: int = Field(14, ge=1, le=14)  # Firebase caps session cookies at 14 days.
    max_login_attempts: int = 5
    lockout_minutes: int = 15
    invite_days: int = 7
    # How long a master admin's "act as" session lasts.
    act_as_minutes: int = Field(30, ge=5, le=120)
    # "text" for a terminal, "json" for log search (the default on Vercel).
    log_format: Literal["text", "json"] = "text"

    # Vercel system variables (hostnames, no scheme), set only on Vercel.
    # Only production deployments exist (see docs/cicd.md).
    vercel_url: str = ""
    vercel_project_production_url: str = ""

    @model_validator(mode="after")
    def _defaults(self) -> Settings:
        """The frontend and this API are deployed separately, so on Vercel
        APP_URL must be set: this deployment's own address is the API's, not
        the frontend's. API_URL defaults to the project's production address,
        cookies to Secure and logs to JSON. Explicitly set values always win."""
        if self.vercel_url:
            if "app_url" not in self.model_fields_set:
                raise ValueError("APP_URL must be set on Vercel: the frontend's public URL, e.g. https://aica.bitntech.in")
            own = self.vercel_project_production_url or self.vercel_url
            if "api_url" not in self.model_fields_set and own:
                self.api_url = f"https://{own}"
            if "cookie_secure" not in self.model_fields_set:
                self.cookie_secure = True
            if "log_format" not in self.model_fields_set:
                self.log_format = "json"
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        return self

    @property
    def origins(self) -> set[str]:
        configured = {o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()}
        if configured:
            return configured
        u = urlsplit(self.app_url)
        return {f"{u.scheme}://{u.netloc}"}

    @property
    def demo_recipients(self) -> list[str]:
        return [a.strip() for a in self.demo_request_to.split(",") if a.strip()]

    @property
    def change_request_recipients(self) -> list[str]:
        return [a.strip() for a in self.change_requests_to.split(",") if a.strip()]

    @property
    def firestore_database_id(self) -> str | None:
        """None selects the default database in the client library."""
        v = self.firestore_database.strip()
        return None if v in ("", "(default)", "default") else v

    @property
    def credentials_path(self) -> Path:
        p = self.firebase_credentials
        return p if p.is_absolute() else BACKEND_DIR / p

    @property
    def public_api_url(self) -> str:
        return (self.api_url or self.app_url).rstrip("/")

    @property
    def google_redirect_uri(self) -> str:
        # Back to this API, so the session cookie lands on the API's host. In
        # dev that is the Vite proxy, i.e. the frontend's origin.
        return f"{self.public_api_url}/api/auth/google/callback"

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
