"""Everything that talks to Firebase Auth and Google.

`FirebaseAdmin` wraps the Admin SDK (users, claims, session cookies, action
links). `IdentityToolkit` calls the Firebase Auth REST API for the things the
Admin SDK cannot do — checking a password, exchanging a Google ID token, and
applying email action codes. `GoogleOAuth` runs the server-side OAuth code
flow. Routes depend on these classes, so tests can swap in fakes.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from dataclasses import dataclass, field
from datetime import timedelta
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from ..core.errors import ApiError

log = logging.getLogger("aica.identity")

IDENTITY = "https://identitytoolkit.googleapis.com/v1"
GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"


@dataclass
class AuthUser:
    uid: str
    email: str
    email_verified: bool
    disabled: bool
    display_name: str | None = None
    claims: dict = field(default_factory=dict)


class EmailExists(Exception):
    pass


class InvalidSession(Exception):
    pass


def network_error() -> ApiError:
    return ApiError(503, "network", "We couldn't reach the sign-in service. Try again in a moment.")


# --------------------------------------------------------------------------- Admin SDK


class FirebaseAdmin:
    def __init__(self, app):  # firebase_admin.App
        from firebase_admin import auth

        self._app = app
        self._auth = auth

    def _to_user(self, rec) -> AuthUser:
        return AuthUser(
            uid=rec.uid,
            email=(rec.email or "").lower(),
            email_verified=bool(rec.email_verified),
            disabled=bool(rec.disabled),
            display_name=rec.display_name,
            claims=dict(rec.custom_claims or {}),
        )

    def get_user(self, uid: str) -> AuthUser | None:
        try:
            return self._to_user(self._auth.get_user(uid, app=self._app))
        except self._auth.UserNotFoundError:
            return None

    def get_users(self, uids: list[str]) -> dict[str, AuthUser]:
        """Many accounts at once (Firebase takes up to 100 per call). Missing ones are left out."""
        out: dict[str, AuthUser] = {}
        ids = list(dict.fromkeys(uids))
        for i in range(0, len(ids), 100):
            found = self._auth.get_users([self._auth.UidIdentifier(u) for u in ids[i : i + 100]], app=self._app)
            out.update({rec.uid: self._to_user(rec) for rec in found.users})
        return out

    def get_user_by_email(self, email: str) -> AuthUser | None:
        try:
            return self._to_user(self._auth.get_user_by_email(email, app=self._app))
        except self._auth.UserNotFoundError:
            return None

    def list_users(self) -> list[AuthUser]:
        return [self._to_user(rec) for rec in self._auth.list_users(app=self._app).iterate_all()]

    def create_user(self, email: str, password: str | None, name: str, email_verified: bool = False) -> str:
        try:
            kwargs = dict(email=email, display_name=name, email_verified=email_verified, app=self._app)
            if password:
                kwargs["password"] = password
            return self._auth.create_user(**kwargs).uid
        except self._auth.EmailAlreadyExistsError as e:
            raise EmailExists() from e

    def create_custom_token(self, uid: str) -> str:
        # Signed locally with the service-account key.
        token = self._auth.create_custom_token(uid, app=self._app)
        return token.decode() if isinstance(token, bytes) else token

    def delete_user(self, uid: str) -> None:
        self._auth.delete_user(uid, app=self._app)

    def update_user(self, uid: str, **fields) -> None:
        self._auth.update_user(uid, app=self._app, **fields)

    def set_claims(self, uid: str, claims: dict) -> None:
        self._auth.set_custom_user_claims(uid, claims or None, app=self._app)

    def revoke_sessions(self, uid: str) -> None:
        self._auth.revoke_refresh_tokens(uid, app=self._app)

    def create_session_cookie(self, id_token: str, expires_in: timedelta) -> str:
        return self._auth.create_session_cookie(id_token, expires_in=expires_in, app=self._app)

    def verify_session_cookie(self, cookie: str) -> dict:
        """Checks signature, expiry, revocation and that the user isn't disabled.
        A network failure reaching Google is not a bad session: it raises a 503
        instead, so a blip doesn't sign everyone out."""
        try:
            return self._auth.verify_session_cookie(cookie, check_revoked=True, app=self._app)
        except self._auth.CertificateFetchError as e:
            log.warning("could not fetch Firebase session-cookie keys: %s", type(e).__name__)
            raise network_error() from e
        except (
            self._auth.InvalidSessionCookieError,
            self._auth.ExpiredSessionCookieError,
            self._auth.RevokedSessionCookieError,
            self._auth.UserDisabledError,
            self._auth.UserNotFoundError,
            ValueError,
        ) as e:
            raise InvalidSession() from e

    def email_verification_code(self, email: str) -> str:
        return _oob_code(self._auth.generate_email_verification_link(email, app=self._app))

    def password_reset_code(self, email: str) -> str:
        return _oob_code(self._auth.generate_password_reset_link(email, app=self._app))


def _oob_code(link: str) -> str:
    """Firebase builds links to its own action page; we only need the code,
    and send people to the console's own /verify and /reset pages."""
    code = parse_qs(urlparse(link).query).get("oobCode", [""])[0]
    if not code:
        raise RuntimeError("Firebase action link had no oobCode")
    return code


# --------------------------------------------------------------------------- Auth REST API

# Firebase REST error strings → (status, our code, message)
_IDENTITY_ERRORS: dict[str, tuple[int, str, str]] = {
    "INVALID_LOGIN_CREDENTIALS": (401, "invalid_credentials", "That email and password don't match."),
    "EMAIL_NOT_FOUND": (401, "invalid_credentials", "That email and password don't match."),
    "INVALID_PASSWORD": (401, "invalid_credentials", "That email and password don't match."),
    "INVALID_EMAIL": (401, "invalid_credentials", "That email and password don't match."),
    "USER_DISABLED": (403, "account_locked", "This account is locked."),
    "TOO_MANY_ATTEMPTS_TRY_LATER": (429, "rate_limited", "Too many attempts. Try again later."),
    "EXPIRED_OOB_CODE": (410, "expired_token", "This link has expired."),
    "INVALID_OOB_CODE": (400, "invalid_token", "This link isn't valid. It may have been used already."),
    "WEAK_PASSWORD": (422, "weak_password", "Choose a stronger password."),
}


class IdentityToolkit:
    def __init__(self, api_key: str, client: httpx.Client | None = None):
        self._key = api_key
        self._http = client or httpx.Client(timeout=10.0)

    def _post(self, path: str, body: dict) -> dict:
        if not self._key:
            raise RuntimeError("FIREBASE_WEB_API_KEY is not set")
        try:
            r = self._http.post(f"{IDENTITY}/{path}", params={"key": self._key}, json=body)
        except httpx.HTTPError as e:
            log.warning("identity toolkit unreachable: %s", type(e).__name__)
            raise network_error() from e
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            raw = str(data.get("error", {}).get("message", "UNKNOWN"))
            key = raw.split(" ")[0].split(":")[0]
            status, code, msg = _IDENTITY_ERRORS.get(key, (502, "unknown", "Sign-in failed on our side. Try again in a moment."))
            if code == "unknown":
                log.error("identity toolkit error %s on %s", key, path)
            raise ApiError(status, code, msg)
        return data

    def sign_in_with_password(self, email: str, password: str) -> dict:
        """→ {idToken, localId, email, ...}"""
        return self._post("accounts:signInWithPassword", {"email": email, "password": password, "returnSecureToken": True})

    def sign_in_with_custom_token(self, custom_token: str) -> dict:
        """Exchanges an Admin-SDK custom token for a Firebase ID token. → {idToken, ...}"""
        return self._post("accounts:signInWithCustomToken", {"token": custom_token, "returnSecureToken": True})

    def apply_email_verification(self, code: str) -> str:
        """Marks the email verified. → email"""
        return self._post("accounts:update", {"oobCode": code})["email"].lower()

    def check_reset_code(self, code: str) -> str:
        """→ email the reset code was issued for (does not use the code up)."""
        data = self._post("accounts:resetPassword", {"oobCode": code})
        return data["email"].lower()

    def reset_password(self, code: str, new_password: str) -> str:
        return self._post("accounts:resetPassword", {"oobCode": code, "newPassword": new_password})["email"].lower()


# --------------------------------------------------------------------------- Google OAuth


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


class GoogleOAuth:
    def __init__(self, client_id: str, client_secret: str, redirect_uri: str, client: httpx.Client | None = None):
        self.client_id, self._secret, self.redirect_uri = client_id, client_secret, redirect_uri
        self._http = client or httpx.Client(timeout=10.0)

    def authorize_url(self, state: str, challenge: str) -> str:
        return f"{GOOGLE_AUTH}?" + urlencode(
            {
                "client_id": self.client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "prompt": "select_account",
            }
        )

    def exchange_code(self, code: str, verifier: str) -> dict:
        """Swaps the code for Google's ID token and verifies it: Google's
        signature, issuer, expiry, and that it was issued to *our* client.
        → {email, email_verified, name, sub}"""
        try:
            r = self._http.post(
                GOOGLE_TOKEN,
                data={
                    "code": code,
                    "client_id": self.client_id,
                    "client_secret": self._secret,
                    "redirect_uri": self.redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": verifier,
                },
            )
        except httpx.HTTPError as e:
            raise network_error() from e
        if r.status_code >= 400:
            log.warning("google token exchange failed: %s", r.json().get("error") if r.content else r.status_code)
            raise ApiError(400, "invalid_input", "Google sign-in didn't complete. Try again.")
        return self.verify_id_token(r.json()["id_token"])

    def verify_id_token(self, token: str) -> dict:
        from google.auth.transport.requests import Request
        from google.oauth2 import id_token

        try:
            info = id_token.verify_oauth2_token(token, Request(), audience=self.client_id, clock_skew_in_seconds=10)
        except ValueError as e:
            log.warning("google id token rejected: %s", e)
            raise ApiError(400, "invalid_input", "Google sign-in didn't complete. Try again.") from e
        if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
            raise ApiError(400, "invalid_input", "Google sign-in didn't complete. Try again.")
        if not info.get("email") or not info.get("email_verified"):
            raise ApiError(400, "invalid_input", "Your Google account's email isn't verified.")
        return {"email": info["email"].lower(), "email_verified": True, "name": info.get("name") or "", "sub": info["sub"]}
