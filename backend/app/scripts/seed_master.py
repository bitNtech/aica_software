"""Make (or confirm) master admins. Run from backend/:

    .venv/bin/python -m app.scripts.seed_master support@bitntech.in admin@bitntech.in
    .venv/bin/python -m app.scripts.seed_master --no-email admin@bitntech.in

For each address: creates the Firebase user if missing (no password), marks
the email verified, sets the `platform_role: master_admin` claim, writes the
Firestore profile, and emails a "set your password" link. They can also sign
in with Google on the same address. Safe to run again.

--no-email skips the "set your password" email, for an account that already
has a password. A new account always gets the email: it has no other way in
except Google.
"""
from __future__ import annotations

import argparse
import sys

from ..accounts import link
from ..services import Services, build_services
from ..sessions import PLATFORM_CLAIM
from ..settings import get_settings
from ..store import UserDoc


def seed(svc: Services, raw: str, send_email: bool = True) -> str:
    email = raw.strip().lower()
    user = svc.admin.get_user_by_email(email)
    if user:
        uid = user.uid
        if not user.email_verified:
            svc.admin.update_user(uid, email_verified=True)
        created = False
    else:
        uid = svc.admin.create_user(email, None, email.split("@")[0], email_verified=True)
        created = True
    claims = dict(user.claims) if user else {}
    claims[PLATFORM_CLAIM] = "master_admin"
    svc.admin.set_claims(uid, claims)
    doc = svc.store.get_user(uid) or UserDoc(uid=uid, name=email.split("@")[0], email=email)
    doc.platformRole = "master_admin"
    svc.store.save_user(doc)
    svc.store.audit("seed", "master_admin_set", uid, email)
    if send_email or created:
        sent = svc.mailer.set_password(email, link(svc, f"/reset/{svc.admin.password_reset_code(email)}"))
        mail = f"set-password email {'sent' if sent else 'NOT sent (check RESEND / EMAIL_FROM)'}"
    else:
        mail = "no email sent"
    return f"{email}: {'created' if created else 'existing'} · master_admin claim set · {mail}"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="seed_master", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("emails", nargs="+")
    parser.add_argument("--no-email", action="store_true", help="don't send the set-password email to existing accounts")
    args = parser.parse_args(argv)
    svc = build_services(get_settings())
    for raw in args.emails:
        print(seed(svc, raw, send_email=not args.no_email))
    print("Each person must sign out and back in for the role to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
