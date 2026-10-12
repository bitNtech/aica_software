"""/api/auth — sign in and out, the session, sign-up, email verification and
password reset. Routes are plain `def`: FastAPI runs them in its threadpool,
which suits the blocking Firebase Admin and Firestore clients."""
from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response

from ..accounts import create_org_for, ensure_profile, link, session_out
from ..errors import ApiError, bad_input
from ..identity import EmailExists
from ..models import BusinessIn, CodeIn, EmailIn, EmailOut, LoginIn, ResetIn, SessionOut, SignupIn
from ..passwords import password_problem
from ..ratelimit import limit
from ..services import Services, get_services
from ..sessions import ACT_COOKIE, Caller, acting_record, clear_act_cookie, end_session, not_acting, read_session, start_session
from ..store import UserDoc, hash_key, now

log = logging.getLogger("aica.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/session", response_model=SessionOut, response_model_by_alias=True)
def get_session(request: Request, svc: Services = Depends(get_services)):
    caller = read_session(request, svc)
    if not caller:
        raise ApiError(401, "unauthenticated", "Not signed in.")
    return session_out(svc, caller)


@router.post("/login", response_model=SessionOut, response_model_by_alias=True, dependencies=[Depends(limit("login", 20))])
def login(body: LoginIn, request: Request, response: Response, svc: Services = Depends(get_services)):
    email = body.email.lower()
    key = hash_key(email)
    s = svc.settings

    count, until = svc.store.get_attempts(key)
    if until and until > now():
        raise ApiError(429, "rate_limited", "Too many attempts.", int((until - now()).total_seconds()) + 1)
    if until and until <= now():
        count = 0

    try:
        result = svc.identity.sign_in_with_password(email, body.password)
    except ApiError as e:
        if e.code == "invalid_credentials":
            count += 1
            lock = now() + timedelta(minutes=s.lockout_minutes) if count >= s.max_login_attempts else None
            svc.store.set_attempts(key, count, lock)
            if lock:
                raise ApiError(429, "rate_limited", "Too many attempts.", s.lockout_minutes * 60) from e
        raise

    user = svc.admin.get_user(result["localId"])
    if not user:
        raise ApiError(401, "invalid_credentials", "That email and password don't match.")
    if user.disabled:
        raise ApiError(403, "account_locked", "This account is locked.")
    if not user.email_verified:
        raise ApiError(403, "email_unverified", "Verify your email before signing in.")

    svc.store.clear_attempts(key)
    start_session(svc, response, result["idToken"], body.remember, request)
    caller = Caller(
        uid=user.uid,
        email=user.email,
        platform_role=user.claims.get("platform_role") if user.claims.get("platform_role") in {"master_admin", "staff"} else None,
        remember=body.remember,
        expires_at=int((now() + (timedelta(days=s.remember_days) if body.remember else timedelta(hours=s.session_hours))).timestamp()),
    )
    return session_out(svc, caller)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, svc: Services = Depends(get_services)):
    # Clears this browser only. Password resets and suspensions revoke every session.
    if request.cookies.get(ACT_COOKIE):
        try:
            _end_acting(request, svc)
        except ApiError:
            log.warning("could not close the acting session at sign-out; it expires on its own")
    end_session(response, svc)


def _end_acting(request: Request, svc: Services) -> Caller | None:
    """Closes this browser's acting session, if live. Returns the master admin."""
    real = read_session(request, svc, acting=False)
    record = acting_record(request, svc, real) if real else None
    if record:
        key, doc = record
        doc.endedAt = now()
        svc.store.save_impersonation(key, doc)
        svc.store.audit(real.uid, "act_as_ended", doc.targetUid)
    return real


@router.post("/act-as/end", response_model=SessionOut, response_model_by_alias=True)
def end_acting(request: Request, response: Response, svc: Services = Depends(get_services)):
    """Back to the master admin's own session."""
    real = _end_acting(request, svc)
    if not real:
        raise ApiError(401, "unauthenticated", "Not signed in.")
    clear_act_cookie(response, svc)
    return session_out(svc, real)


@router.post("/signup", response_model=EmailOut, response_model_by_alias=True, dependencies=[Depends(limit("signup", 5))])
def signup(body: SignupIn, svc: Services = Depends(get_services)):
    email = body.email.lower()
    if not body.accepted_terms:
        raise bad_input("Accept the terms to continue.")
    problem = password_problem(body.password, email)
    if problem:
        raise ApiError(422, "weak_password", problem)
    try:
        uid = svc.admin.create_user(email, body.password, body.name)
    except EmailExists:
        raise ApiError(409, "email_taken", "An account with this email already exists.")

    try:
        owner = UserDoc(uid=uid, name=body.name, email=email, phone=body.phone)
        svc.store.save_user(owner)
        org = create_org_for(svc, owner, body.business)
    except Exception:
        # Don't leave a Firebase user without its profile and organisation.
        log.exception("signup failed after creating the auth user; rolling back")
        svc.admin.delete_user(uid)
        raise
    svc.store.audit(uid, "signup", org.slug)
    _send_verification(svc, email, body.name)
    return EmailOut(email=email)


def _send_verification(svc: Services, email: str, name: str) -> None:
    try:
        code = svc.admin.email_verification_code(email)
    except Exception:  # noqa: BLE001 — never fail the request over the email
        log.exception("could not create verification code")
        return
    svc.mailer.verify_email(email, name, link(svc, f"/verify/{code}"))


@router.post("/verify-email/resend", status_code=204, dependencies=[Depends(limit("resend", 5))])
def resend_verification(body: EmailIn, svc: Services = Depends(get_services)):
    # Same answer whether or not the account exists.
    user = svc.admin.get_user_by_email(body.email.lower())
    if user and not user.email_verified and not user.disabled:
        doc = svc.store.get_user(user.uid)
        _send_verification(svc, user.email, doc.name if doc else "")


@router.post("/verify-email", response_model=EmailOut, response_model_by_alias=True)
def verify_email(body: CodeIn, svc: Services = Depends(get_services)):
    try:
        return EmailOut(email=svc.identity.apply_email_verification(body.code))
    except ApiError as e:
        # Opening the same link twice: the code is spent but the email is verified.
        if e.code == "invalid_token":
            raise ApiError(400, "invalid_token", "This link isn't valid. If you already confirmed your email, just sign in.") from e
        raise


@router.post("/password/forgot", status_code=204, dependencies=[Depends(limit("forgot", 5))])
def forgot_password(body: EmailIn, svc: Services = Depends(get_services)):
    email = body.email.lower()
    user = svc.admin.get_user_by_email(email)
    if not user or user.disabled:
        return  # Same answer whether or not the account exists.
    try:
        code = svc.admin.password_reset_code(email)
    except Exception:  # noqa: BLE001
        log.exception("could not create reset code")
        return
    svc.mailer.reset_password(email, link(svc, f"/reset/{code}"))


@router.post("/password/verify", response_model=EmailOut, response_model_by_alias=True)
def verify_reset(body: CodeIn, svc: Services = Depends(get_services)):
    return EmailOut(email=svc.identity.check_reset_code(body.code))


@router.post("/password/reset", status_code=204, dependencies=[Depends(limit("reset", 10))])
def reset_password(body: ResetIn, svc: Services = Depends(get_services)):
    email = svc.identity.check_reset_code(body.code)
    problem = password_problem(body.password, email)
    if problem:
        raise ApiError(422, "weak_password", problem)
    svc.identity.reset_password(body.code, body.password)
    user = svc.admin.get_user_by_email(email)
    if user:
        # Following the emailed link proves the inbox; sign out everywhere else.
        if not user.email_verified:
            svc.admin.update_user(user.uid, email_verified=True)
        svc.admin.revoke_sessions(user.uid)
        svc.store.audit(user.uid, "password_reset", user.uid)
    svc.store.clear_attempts(hash_key(email))


@router.post("/business", response_model=SessionOut, response_model_by_alias=True, dependencies=[Depends(limit("business", 5))])
def complete_business(body: BusinessIn, caller: Caller = Depends(not_acting), svc: Services = Depends(get_services)):
    """For someone who signed in with Google and has no organisation yet."""
    if caller.platform_role:
        raise bad_input("bitNtech accounts don't sign up a business.")
    doc = ensure_profile(svc, caller.uid, caller.email, "")
    if doc.memberships:
        raise bad_input("Your account already belongs to an organisation.")
    org = create_org_for(svc, doc, body)
    svc.store.audit(caller.uid, "signup", org.slug, "google")
    return session_out(svc, caller)

