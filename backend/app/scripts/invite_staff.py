"""Invite a bitNtech staff member from the command line. The usual way is the
Ops People page (master admins); this is for when nobody can sign in yet. From backend/:

    .venv/bin/python -m app.scripts.invite_staff someone@bitntech.in --by "Support"

Emails an invitation link; the person sets their name and password on /invite/:token.
"""
from __future__ import annotations

import argparse
import sys

from ..core.config import get_settings
from ..core.services import build_services
from ..routes.invites import issue_invite


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("email")
    p.add_argument("--by", default="BitNTech")
    a = p.parse_args()
    svc = build_services(get_settings())
    if svc.admin.get_user_by_email(a.email.lower()):
        print(f"{a.email} already has an account.")
        return 1
    issue_invite(svc, email=a.email, role="staff", org_name="BitNTech", invited_by=a.by)
    svc.store.audit("cli", "staff_invited", a.email.lower())
    print(f"Invitation emailed to {a.email}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
