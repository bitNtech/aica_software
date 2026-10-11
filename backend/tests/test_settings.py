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


# ---------------------------------------------------------------- vercel

VERCEL_ENV = ("APP_URL", "ALLOWED_ORIGINS", "COOKIE_SECURE", "VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL")


@pytest.fixture()
def clean_env(monkeypatch):
    for k in VERCEL_ENV:
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_local_defaults_unchanged(clean_env):
    s = settings()
    assert s.app_url == "http://localhost:5173"
    assert s.origins == {"http://localhost:5173"}
    assert s.cookie_secure is False


def test_vercel_preview_uses_its_own_url(clean_env):
    clean_env.setenv("VERCEL_ENV", "preview")
    clean_env.setenv("VERCEL_URL", "aica-abc123.vercel.app")
    s = settings()
    assert s.app_url == "https://aica-abc123.vercel.app"
    assert "https://aica-abc123.vercel.app" in s.origins
    assert s.cookie_secure is True


def test_vercel_production_uses_production_url(clean_env):
    clean_env.setenv("VERCEL_ENV", "production")
    clean_env.setenv("VERCEL_URL", "aica-abc123.vercel.app")
    clean_env.setenv("VERCEL_PROJECT_PRODUCTION_URL", "aica.vercel.app")
    s = settings()
    assert s.app_url == "https://aica.vercel.app"
    assert {"https://aica.vercel.app", "https://aica-abc123.vercel.app"} <= s.origins


def test_explicit_settings_win_on_vercel(clean_env):
    clean_env.setenv("VERCEL_ENV", "production")
    clean_env.setenv("VERCEL_URL", "aica-abc123.vercel.app")
    clean_env.setenv("APP_URL", "https://console.example.com")
    clean_env.setenv("ALLOWED_ORIGINS", "https://console.example.com")
    clean_env.setenv("COOKIE_SECURE", "false")
    s = settings()
    assert s.app_url == "https://console.example.com"
    assert s.cookie_secure is False
    assert "https://console.example.com" in s.origins


def test_other_vercel_apps_are_not_trusted(clean_env):
    clean_env.setenv("VERCEL_URL", "aica-abc123.vercel.app")
    assert "https://evil.vercel.app" not in settings().origins
