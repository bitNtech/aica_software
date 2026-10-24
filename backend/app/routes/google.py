"""/api/auth/google — Google sign-in, run entirely on the server.

start:    sets a state + PKCE verifier cookie and redirects to Google.
callback: checks state, swaps the code for Google's ID token and verifies it
          (signature, issuer, expiry, audience = our client), finds or creates
          the Firebase user by that verified email, signs them in with a
          Firebase custom token, and sets the session cookie.
This works with any Google OAuth client — it doesn't depend on Firebase's own
Google provider settings, so a client from another Google Cloud project is fine.
The browser never holds a Google or Firebase token.
"""
from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from ..auth.accounts import ensure_profile, link, mark_active
from ..auth.identity import pkce_pair
from ..auth.sessions import start_session
from ..core.errors import ApiError
from ..core.services import Services, get_services

log = logging.getLogger("aica.google")
router = APIRouter(prefix="/api/auth/google", tags=["google"])

STATE_COOKIE = "aica_oauth"
COOKIE_PATH = "/api/auth/google"


def _back_to_login(svc: Services, error: str | None = None) -> RedirectResponse:
    r = RedirectResponse(link(svc, f"/login?error={error}" if error else "/login"), status_code=303)
    r.delete_cookie(STATE_COOKIE, path=COOKIE_PATH)
    return r


@router.get("/start")
def start(svc: Services = Depends(get_services)):
    if not svc.google:
        return _back_to_login(svc, "google_unavailable")
    state = secrets.token_urlsafe(24)
    verifier, challenge = pkce_pair()
    r = RedirectResponse(svc.google.authorize_url(state, challenge), status_code=303)
    r.set_cookie(
        STATE_COOKIE,
        f"{state}.{verifier}",
        max_age=600,
        httponly=True,
        secure=svc.settings.cookie_secure,
        samesite="lax",  # sent on Google's top-level redirect back to us
        path=COOKIE_PATH,
    )
    return r


@router.get("/callback")
def callback(request: Request, svc: Services = Depends(get_services)):
    if not svc.google:
        return _back_to_login(svc, "google_unavailable")
    params = request.query_params
    if params.get("error"):
        return _back_to_login(svc, "google_cancelled")

    saved = request.cookies.get(STATE_COOKIE, "")
    state, _, verifier = saved.partition(".")
    if not state or not secrets.compare_digest(state, params.get("state", "")) or not params.get("code"):
        return _back_to_login(svc, "google_failed")

    try:
        google = svc.google.exchange_code(params["code"], verifier)
        email = google["email"]
        user = svc.admin.get_user_by_email(email)
        if user is None:
            uid = svc.admin.create_user(email, None, google["name"], email_verified=True)
        else:
            uid = user.uid
            if user.disabled:
                return _back_to_login(svc, "account_locked")
            if not user.email_verified:
                # Someone registered this address with a password but never proved
                # it. Google just did: verify it and drop that password, so whoever
                # set it can't keep a way into the real owner's account.
                svc.admin.update_user(uid, email_verified=True, password=secrets.token_urlsafe(32))
        ensure_profile(svc, uid, email, google["name"] or (user.display_name if user else "") or "")
        result = svc.identity.sign_in_with_custom_token(svc.admin.create_custom_token(uid))
        r = _back_to_login(svc)  # /login sends a signed-in person on to their home
        start_session(svc, r, result["idToken"], remember=False, request=request)
        svc.store.audit(uid, "login", uid, "google")
        mark_active(svc, uid, force=True)
        return r
    except ApiError as e:
        log.warning("google sign-in failed: %s", e.code)
        return _back_to_login(svc, "account_locked" if e.code == "account_locked" else "google_failed")
    except Exception:  # noqa: BLE001 — a redirect flow must always land back on a page
        log.exception("google sign-in failed unexpectedly")
        return _back_to_login(svc, "google_failed")
