from __future__ import annotations

import json

import pytest

from app.services import firebase_certificate
from app.settings import Settings

KEY = {"type": "service_account", "project_id": "demo", "private_key": "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n"}


def settings(**kw):
    return Settings(_env_file=None, **kw)


def test_credentials_json_takes_precedence_over_file(tmp_path):
    path = tmp_path / "key.json"
    path.write_text("{}")
    assert firebase_certificate(settings(firebase_credentials=path, firebase_credentials_json=json.dumps(KEY))) == KEY


def test_credentials_file_used_when_json_unset(tmp_path):
    path = tmp_path / "key.json"
    path.write_text(json.dumps(KEY))
    assert firebase_certificate(settings(firebase_credentials=path)) == str(path)


@pytest.mark.parametrize("raw", ["not json", "[1, 2]", json.dumps({"type": "authorized_user", "private_key": "secret"})])
def test_bad_credentials_json_fails_without_echoing_it(raw):
    with pytest.raises(RuntimeError) as e:
        firebase_certificate(settings(firebase_credentials_json=raw))
    assert "FIREBASE_CREDENTIALS_JSON" in str(e.value)
    assert "secret" not in str(e.value)


def test_missing_file_and_no_json(tmp_path):
    with pytest.raises(RuntimeError, match="not found"):
        firebase_certificate(settings(firebase_credentials=tmp_path / "missing.json"))


# ---------------------------------------------------------------- deployment

DEPLOY_ENV = ("APP_URL", "API_URL", "ALLOWED_ORIGINS", "COOKIE_SECURE", "COOKIE_SAMESITE", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL")


@pytest.fixture()
def clean_env(monkeypatch):
    for k in DEPLOY_ENV:
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_local_defaults_unchanged(clean_env):
    s = settings()
    assert s.app_url == "http://localhost:5173"
    assert s.origins == {"http://localhost:5173"}
    assert s.cookie_secure is False
    assert s.cookie_samesite == "lax"
    # Same origin through the Vite proxy.
    assert s.google_redirect_uri == "http://localhost:5173/api/auth/google/callback"


def test_origins_default_to_app_url_origin(clean_env):
    assert settings(app_url="https://aica.bitntech.in/").origins == {"https://aica.bitntech.in"}
    assert settings(app_url="https://aica.bitntech.in", allowed_origins="https://a.example, https://b.example/").origins == {"https://a.example", "https://b.example"}


def test_separate_api_host(clean_env):
    s = settings(app_url="https://aica.bitntech.in", api_url="https://api.aica.bitntech.in/")
    assert s.google_redirect_uri == "https://api.aica.bitntech.in/api/auth/google/callback"
    assert s.origins == {"https://aica.bitntech.in"}  # the frontend, not the API


def test_vercel_requires_app_url(clean_env):
    clean_env.setenv("VERCEL_URL", "aica-api-abc123.vercel.app")
    with pytest.raises(ValueError, match="APP_URL must be set"):
        settings()


def test_vercel_api_url_is_production(clean_env):
    clean_env.setenv("VERCEL_URL", "aica-api-abc123.vercel.app")
    clean_env.setenv("VERCEL_PROJECT_PRODUCTION_URL", "aica-api.vercel.app")
    clean_env.setenv("APP_URL", "https://aica.bitntech.in")
    s = settings()
    assert s.api_url == "https://aica-api.vercel.app"
    assert s.origins == {"https://aica.bitntech.in"}
    assert s.cookie_secure is True


def test_vercel_api_url_falls_back_to_the_deployment(clean_env):
    clean_env.setenv("VERCEL_URL", "aica-api-abc123.vercel.app")
    clean_env.setenv("APP_URL", "https://aica.bitntech.in")
    assert settings().api_url == "https://aica-api-abc123.vercel.app"


def test_explicit_settings_win_on_vercel(clean_env):
    clean_env.setenv("VERCEL_URL", "aica-api-abc123.vercel.app")
    clean_env.setenv("APP_URL", "https://aica.bitntech.in")
    clean_env.setenv("API_URL", "https://api.aica.bitntech.in")
    clean_env.setenv("COOKIE_SECURE", "false")
    s = settings()
    assert s.api_url == "https://api.aica.bitntech.in"
    assert s.cookie_secure is False


def test_own_vercel_hostnames_are_not_frontend_origins(clean_env):
    clean_env.setenv("VERCEL_URL", "aica-api-abc123.vercel.app")
    clean_env.setenv("APP_URL", "https://aica.bitntech.in")
    o = settings().origins
    assert "https://aica-api-abc123.vercel.app" not in o and "https://evil.vercel.app" not in o


def test_samesite_none_requires_secure(clean_env):
    with pytest.raises(ValueError, match="COOKIE_SECURE"):
        settings(cookie_samesite="none")
    assert settings(cookie_samesite="none", cookie_secure=True).cookie_samesite == "none"
    with pytest.raises(ValueError):
        settings(cookie_samesite="sometimes")


def test_demo_recipients():
    assert settings().demo_recipients == ["support@bitntech.in"]
    assert settings(demo_request_to=" a@x.in, ,b@x.in ").demo_recipients == ["a@x.in", "b@x.in"]
