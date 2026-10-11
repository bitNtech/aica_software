"""Configuration from environment / backend/.env. Secrets live only here."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
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

    google_client_id: str = ""
    google_client_secret: str = ""

    app_url: str = "http://localhost:5173"
    allowed_origins: str = "http://localhost:5173"
    cookie_secure: bool = False

    session_hours: int = Field(8, ge=1, le=24 * 14)
    remember_days: int = Field(14, ge=1, le=14)  # Firebase caps session cookies at 14 days.
    max_login_attempts: int = 5
    lockout_minutes: int = 15
    invite_days: int = 7

    @property
    def origins(self) -> set[str]:
        return {o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()}

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
    def google_redirect_uri(self) -> str:
        # Through the Vite proxy in dev, so the cookie lands on the console's origin.
        return f"{self.app_url.rstrip('/')}/api/auth/google/callback"

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
