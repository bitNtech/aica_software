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
