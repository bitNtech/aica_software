"""System secrets (a hospital's API keys for its own systems), encrypted at
rest with AES-256-GCM. The key is SECRETS_KEY: 32 random bytes, base64,
held only in the server's environment (Vercel, marked Sensitive). Make one
with:  python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"

Each ciphertext is bound to its organisation and name (associated data), so
one copied to another document doesn't decrypt. Values are never returned
by the API, logged, or put in errors. `keyId` lets the key be replaced
later: keep the old one as SECRETS_KEY_PREVIOUS while re-encrypting.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import os


class SecretsUnavailable(Exception):
    """SECRETS_KEY isn't set or isn't a 32-byte base64 key."""


def _key(raw: str) -> bytes:
    try:
        key = base64.b64decode(raw.strip(), validate=True)
    except (binascii.Error, ValueError) as e:
        raise SecretsUnavailable() from e
    if len(key) != 32:
        raise SecretsUnavailable()
    return key


def key_id(raw: str) -> str:
    """A short fingerprint of the key, stored with each ciphertext. Not secret."""
    return hashlib.sha256(_key(raw)).hexdigest()[:12]


class SecretBox:
    def __init__(self, current: str, previous: str = ""):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        if not current:
            raise SecretsUnavailable()
        self._keys = {key_id(current): AESGCM(_key(current))}
        if previous:
            self._keys[key_id(previous)] = AESGCM(_key(previous))
        self.current_id = key_id(current)

    @staticmethod
    def _aad(org: str, name: str) -> bytes:
        return f"aica:{org}:{name}".encode()

    def seal(self, org: str, name: str, value: str) -> tuple[str, str]:
        """(ciphertext as base64, key id)."""
        nonce = os.urandom(12)
        ct = self._keys[self.current_id].encrypt(nonce, value.encode(), self._aad(org, name))
        return base64.b64encode(nonce + ct).decode(), self.current_id

    def open(self, org: str, name: str, ciphertext: str, kid: str) -> str:
        box = self._keys.get(kid)
        if not box:
            raise SecretsUnavailable()
        raw = base64.b64decode(ciphertext)
        return box.decrypt(raw[:12], raw[12:], self._aad(org, name)).decode()
